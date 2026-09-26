//! Terminal sessions for the Terminal app: the user's shell in a pseudo-terminal, with its
//! output delivered as text (UTF-8 split across reads is stitched back together).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

use crate::{AppError, Result};

/// What a session reports to the app.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PtyEvent {
    Data {
        text: String,
    },
    /// The shell ended (typed `exit`, or the tab was closed).
    Exit,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// All open sessions, by id.
#[derive(Default)]
pub struct Ptys {
    sessions: Mutex<HashMap<u32, Session>>,
    next_id: Mutex<u32>,
}

/// The user's login shell from $SHELL, falling back to bash.
pub fn default_shell() -> String {
    std::env::var("SHELL").ok().filter(|s| Path::new(s).is_absolute()).unwrap_or_else(|| "/bin/bash".into())
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.clamp(2, 500), cols: cols.clamp(2, 1000), pixel_width: 0, pixel_height: 0 }
}

/// Hold back an incomplete UTF-8 sequence at the end of `buf` for the next read.
fn take_text(pending: &mut Vec<u8>) -> String {
    let valid = match std::str::from_utf8(pending) {
        Ok(_) => pending.len(),
        // An error that is not just a truncated tail means genuinely invalid bytes: pass them
        // through lossily so the stream never stalls.
        Err(e) if e.error_len().is_some() => pending.len(),
        Err(e) => e.valid_up_to(),
    };
    let rest = pending.split_off(valid);
    let text = String::from_utf8_lossy(pending).into_owned();
    *pending = rest;
    text
}

impl Ptys {
    /// Start `program` (default: the user's shell) in a new terminal of `cols` x `rows`.
    /// `on_event` runs on a reader thread for every chunk of output and once at exit.
    pub fn spawn(
        &self,
        program: Option<(&str, &[&str])>,
        cwd: Option<&Path>,
        cols: u16,
        rows: u16,
        on_event: impl Fn(PtyEvent) + Send + 'static,
    ) -> Result<u32> {
        let pty = native_pty_system().openpty(size(cols, rows)).map_err(|e| AppError::Invalid(format!("cannot open a terminal: {e}")))?;
        let shell = default_shell();
        let mut cmd = match program {
            Some((prog, args)) => {
                let mut c = CommandBuilder::new(prog);
                c.args(args);
                c
            }
            None => {
                let mut c = CommandBuilder::new(&shell);
                // A login shell reads the user's profile, like a terminal on macOS.
                c.arg("-l");
                c
            }
        };
        let home = crate::paths::home();
        let dir = cwd.filter(|d| d.is_dir()).map(Path::to_path_buf).unwrap_or(home);
        cmd.cwd(dir);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "HelixOS Terminal");
        if program.is_none() && shell.ends_with("/bash") {
            // Mark where commands start and end (OSC 133, which fish and others emit on their
            // own), so Terminal can say when a long command finishes.
            cmd.env("PS0", "\x1b]133;C\x07");
            cmd.env("PROMPT_COMMAND", "printf '\\033]133;D;%s\\007' \"$?\"");
        }
        let child = pty.slave.spawn_command(cmd).map_err(|e| AppError::Invalid(format!("cannot start {shell}: {e}")))?;
        drop(pty.slave);
        let mut reader = pty.master.try_clone_reader().map_err(|e| AppError::Invalid(e.to_string()))?;
        let writer = pty.master.take_writer().map_err(|e| AppError::Invalid(e.to_string()))?;

        let id = {
            let mut next = self.next_id.lock().unwrap();
            *next += 1;
            *next
        };
        std::thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            let mut pending = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        let text = take_text(&mut pending);
                        if !text.is_empty() {
                            on_event(PtyEvent::Data { text });
                        }
                    }
                }
            }
            if !pending.is_empty() {
                on_event(PtyEvent::Data { text: String::from_utf8_lossy(&pending).into_owned() });
            }
            on_event(PtyEvent::Exit);
        });
        self.sessions.lock().unwrap().insert(id, Session { master: pty.master, writer, child });
        Ok(id)
    }

    fn with<T>(&self, id: u32, f: impl FnOnce(&mut Session) -> Result<T>) -> Result<T> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(&id).ok_or_else(|| AppError::Invalid(format!("no terminal {id}")))?;
        f(session)
    }

    pub fn write(&self, id: u32, data: &str) -> Result<()> {
        self.with(id, |s| {
            s.writer.write_all(data.as_bytes())?;
            s.writer.flush()?;
            Ok(())
        })
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<()> {
        self.with(id, |s| s.master.resize(size(cols, rows)).map_err(|e| AppError::Invalid(e.to_string())))
    }

    /// The shell's current directory (for a new tab in the same place).
    pub fn cwd(&self, id: u32) -> Result<PathBuf> {
        self.with(id, |s| {
            let pid = s.child.process_id().ok_or_else(|| AppError::Invalid("the shell has exited".into()))?;
            Ok(std::fs::read_link(format!("/proc/{pid}/cwd"))?)
        })
    }

    /// End a session (closing its tab). The shell gets SIGHUP like any closed terminal.
    pub fn kill(&self, id: u32) -> Result<()> {
        if let Some(mut session) = self.sessions.lock().unwrap().remove(&id) {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
        Ok(())
    }
}

impl Drop for Ptys {
    fn drop(&mut self) {
        for (_, mut session) in self.sessions.lock().unwrap().drain() {
            let _ = session.child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn collect(rx: &mpsc::Receiver<PtyEvent>) -> (String, bool) {
        let mut text = String::new();
        while let Ok(event) = rx.recv_timeout(Duration::from_secs(5)) {
            match event {
                PtyEvent::Data { text: t } => text.push_str(&t),
                PtyEvent::Exit => return (text, true),
            }
        }
        (text, false)
    }

    #[test]
    fn stitches_split_utf8() {
        let mut pending = "héllo".as_bytes()[..2].to_vec(); // "h" + first byte of "é"
        assert_eq!(take_text(&mut pending), "h");
        pending.extend_from_slice(&"héllo".as_bytes()[2..]);
        assert_eq!(take_text(&mut pending), "éllo");
        let mut invalid = vec![b'a', 0xff, b'b'];
        assert_eq!(take_text(&mut invalid), "a\u{fffd}b");
    }

    #[test]
    fn runs_a_program_and_reports_exit() {
        let ptys = Ptys::default();
        let (tx, rx) = mpsc::channel();
        ptys.spawn(Some(("/bin/sh", &["-c", "printf 'hi %s' \"$TERM\""])), None, 80, 24, move |e| {
            let _ = tx.send(e);
        })
        .unwrap();
        let (text, exited) = collect(&rx);
        assert!(text.contains("hi xterm-256color"), "{text:?}");
        assert!(exited);
    }

    #[test]
    fn writes_input_and_resizes() {
        let ptys = Ptys::default();
        let (tx, rx) = mpsc::channel();
        let id = ptys
            .spawn(Some(("/bin/sh", &["-c", "read line; stty size; echo \"got $line\""])), Some(Path::new("/tmp")), 80, 24, move |e| {
                let _ = tx.send(e);
            })
            .unwrap();
        assert_eq!(ptys.cwd(id).unwrap(), PathBuf::from("/tmp"));
        ptys.resize(id, 100, 30).unwrap();
        ptys.write(id, "hello\r").unwrap();
        let (text, _) = collect(&rx);
        assert!(text.contains("30 100"), "{text:?}");
        assert!(text.contains("got hello"), "{text:?}");
        assert!(ptys.write(999, "x").is_err());
    }
}

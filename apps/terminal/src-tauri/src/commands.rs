//! Terminal's own commands, over `helixos_appkit::pty` (where the logic and its tests live).

use std::path::PathBuf;
use std::sync::Mutex;

use helixos_appkit::pty::{PtyEvent, Ptys};
use helixos_appkit::AppError;
use tauri::ipc::Channel;
use tauri::State;

type Result<T> = std::result::Result<T, AppError>;

/// A command to run in the next tab instead of the shell: `helixos-terminal -- CMD ARGS...`
/// (Settings → Software Update uses this to run the update).
#[derive(Default)]
pub struct Pending(pub Mutex<Option<Vec<String>>>);

/// The arguments after `--`, if any.
pub fn command_arg(args: &[String]) -> Option<Vec<String>> {
    let index = args.iter().position(|a| a == "--")?;
    let rest = args[index + 1..].to_vec();
    (!rest.is_empty()).then_some(rest)
}

/// Start the user's shell, or the pending command. Output and the exit arrive on `on_event`
/// until the session ends.
#[tauri::command]
pub fn term_spawn(
    ptys: State<'_, Ptys>,
    pending: State<'_, Pending>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_event: Channel<PtyEvent>,
) -> Result<u32> {
    let cwd = cwd.map(PathBuf::from);
    let command = pending.0.lock().unwrap().take();
    let args: Vec<&str> = command.iter().flatten().skip(1).map(String::as_str).collect();
    let program = command.as_ref().and_then(|c| c.first()).map(|p| (p.as_str(), args.as_slice()));
    ptys.spawn(program, cwd.as_deref(), cols, rows, move |event| {
        let _ = on_event.send(event);
    })
}

#[tauri::command]
pub fn term_write(ptys: State<'_, Ptys>, id: u32, data: String) -> Result<()> {
    ptys.write(id, &data)
}

#[tauri::command]
pub fn term_resize(ptys: State<'_, Ptys>, id: u32, cols: u16, rows: u16) -> Result<()> {
    ptys.resize(id, cols, rows)
}

#[tauri::command]
pub fn term_kill(ptys: State<'_, Ptys>, id: u32) -> Result<()> {
    ptys.kill(id)
}

#[tauri::command]
pub fn term_cwd(ptys: State<'_, Ptys>, id: u32) -> Result<String> {
    Ok(ptys.cwd(id)?.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::command_arg;

    #[test]
    fn reads_the_command_after_dashes() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(command_arg(&args(&["helixos-terminal", "--", "sh", "-c", "ls"])), Some(args(&["sh", "-c", "ls"])));
        assert_eq!(command_arg(&args(&["helixos-terminal"])), None);
        assert_eq!(command_arg(&args(&["helixos-terminal", "--"])), None);
    }
}

//! helixos-open: open anything. Registered as the handler for Windows programs, Flatpak refs and
//! bundles, AppImages, packages, APKs, and Flathub / appstream links (distro/applications/
//! helixos-open.desktop), so double-clicking in Files or clicking "Install" on flathub.org ends
//! up here.
//!
//! It asks first when something gets installed (a notification with buttons, answered in the
//! Dynamic Island), shows progress in the island while it works, and says when it is done.

mod classify;
mod plan;

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use helixos_appkit::island::{self, Activity};
use helixos_syslib::{CommandRunner, SystemRunner};
use zbus::zvariant::Value;

use classify::{classify, Target};
use plan::{Available, Plan, Step};

const APP: &str = "Installer";
const ICON: &str = "system-software-install";

fn on_path(program: &str) -> bool {
    std::env::var_os("PATH").map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(program).is_file())).unwrap_or(false)
}

fn head(path: &str) -> Vec<u8> {
    let path = path.strip_prefix("file://").unwrap_or(path);
    let mut buffer = vec![0u8; 16];
    match std::fs::File::open(path).and_then(|mut f| f.read(&mut buffer)) {
        Ok(n) => {
            buffer.truncate(n);
            buffer
        }
        Err(_) => vec![],
    }
}

/// Notifications with buttons, and waiting for the answer.
struct Notifier {
    conn: zbus::Connection,
}

impl Notifier {
    async fn new() -> Result<Self> {
        Ok(Self { conn: zbus::Connection::session().await? })
    }

    async fn notify(&self, summary: &str, body: &str, actions: &[(String, String)], critical: bool) -> Result<u32> {
        let mut flat: Vec<&str> = vec![];
        for (id, label) in actions {
            flat.push(id);
            flat.push(label);
        }
        let mut hints: HashMap<&str, Value<'_>> = HashMap::new();
        hints.insert("urgency", Value::U8(if critical { 2 } else { 1 }));
        if !actions.is_empty() {
            hints.insert("resident", Value::Bool(true));
        }
        let reply = self
            .conn
            .call_method(
                Some("org.freedesktop.Notifications"),
                "/org/freedesktop/Notifications",
                Some("org.freedesktop.Notifications"),
                "Notify",
                &(APP, 0u32, ICON, summary, body, flat, hints, if actions.is_empty() { -1i32 } else { 0 }),
            )
            .await?;
        Ok(reply.body().deserialize::<u32>()?)
    }

    /// The action picked for notification `id`, or None if it was dismissed or timed out.
    async fn answer(&self, id: u32, stream: &mut zbus::MessageStream, timeout: Duration) -> Option<String> {
        let wait = async {
            while let Some(Ok(message)) = stream.next().await {
                let header = message.header();
                match header.member().map(|m| m.as_str()) {
                    Some("ActionInvoked") => {
                        if let Ok((got, action)) = message.body().deserialize::<(u32, String)>() {
                            if got == id {
                                return Some(action);
                            }
                        }
                    }
                    Some("NotificationClosed") => {
                        if let Ok((got, _reason)) = message.body().deserialize::<(u32, u32)>() {
                            if got == id {
                                return None;
                            }
                        }
                    }
                    _ => {}
                }
            }
            None
        };
        tokio::time::timeout(timeout, wait).await.ok().flatten()
    }

    async fn signals(&self) -> Result<zbus::MessageStream> {
        // Only the notification server may answer; another app can't click "Install".
        let dbus = zbus::fdo::DBusProxy::new(&self.conn).await?;
        let server = dbus.get_name_owner("org.freedesktop.Notifications".try_into()?).await?;
        let rule = zbus::MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .sender(server.as_str())?
            .interface("org.freedesktop.Notifications")?
            .path("/org/freedesktop/Notifications")?
            .build();
        Ok(zbus::MessageStream::for_match_rule(rule, &self.conn, Some(16)).await?)
    }

    /// Ask with buttons; the answer's action id.
    async fn ask(&self, summary: &str, body: &str, actions: &[(String, String)]) -> Result<Option<String>> {
        let mut stream = self.signals().await?;
        let id = self.notify(summary, body, actions, true).await?;
        Ok(self.answer(id, &mut stream, Duration::from_secs(120)).await)
    }
}

async fn run_step(runner: &dyn CommandRunner, step: &Step) -> Result<()> {
    let (program, args): (String, Vec<String>) = match step {
        Step::Run(argv) => (argv[0].clone(), argv[1..].to_vec()),
        Step::Admin(argv) => ("pkexec".into(), argv.clone()),
        Step::MakeExecutable(path) => {
            make_executable(path)?;
            return Ok(());
        }
        Step::AddAppImage(path) => {
            add_appimage(path)?;
            return Ok(());
        }
    };
    let output = runner.run(&program, &args).await.map_err(|e| anyhow!("{e}"))?;
    if output.success() {
        Ok(())
    } else if program == "pkexec" && (output.status == 126 || output.status == 127) {
        Err(anyhow!("The administrator password wasn’t given."))
    } else {
        let message = output.stderr.trim().lines().last().unwrap_or("").to_string();
        Err(anyhow!(if message.is_empty() { format!("{program} failed ({})", output.status) } else { message }))
    }
}

fn make_executable(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = std::fs::metadata(path)?.permissions();
    permissions.set_mode(permissions.mode() | 0o111);
    std::fs::set_permissions(path, permissions)?;
    Ok(())
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// ~/Applications/<name>, executable, plus a desktop entry so it shows in Launchpad.
fn add_appimage(path: &Path) -> Result<PathBuf> {
    let dir = home().join("Applications");
    std::fs::create_dir_all(&dir)?;
    let name = path.file_name().context("no file name")?;
    let target = dir.join(name);
    if target != path && std::fs::rename(path, &target).is_err() {
        std::fs::copy(path, &target)?;
        std::fs::remove_file(path)?;
    }
    make_executable(&target)?;
    let display = name.to_string_lossy();
    let display = display.split(['-', '_']).next().unwrap_or(&display).trim_end_matches(".AppImage").to_string();
    let apps = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".local/share")).join("applications");
    std::fs::create_dir_all(&apps)?;
    let id: String = display.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
    std::fs::write(apps.join(format!("appimage-{id}.desktop")), plan::appimage_desktop_entry(&display, &target, None))?;
    Ok(target)
}

async fn execute(plan: &Plan, notifier: &Notifier, runner: &dyn CommandRunner) -> Result<()> {
    if let Some((message, link)) = &plan.cannot {
        let actions: Vec<(String, String)> = link.iter().map(|_| ("link".to_string(), "Search Flathub".to_string())).collect();
        if notifier.ask("Can’t open this here", message, &actions).await? == Some("link".into()) {
            if let Some(link) = link {
                runner.spawn_detached("xdg-open", std::slice::from_ref(link)).await.map_err(|e| anyhow!("{e}"))?;
            }
        }
        return Ok(());
    }
    let mut steps = plan.steps.clone();
    let mut open = plan.open.clone();
    let mut done = plan.done.clone();
    if let Some(question) = &plan.question {
        match notifier.ask(&question.title, &question.body, &question.actions).await?.as_deref() {
            Some("install") => {}
            Some("once") => {
                if let Some(Step::AddAppImage(path)) = steps.first().cloned() {
                    let (once_steps, run) = plan::appimage_once(&path);
                    steps = once_steps;
                    open = Some(run);
                    done = None;
                }
            }
            _ => return Ok(()),
        }
    }
    // AppImages move, so open them from where they end up.
    if let (Some(Step::AddAppImage(path)), None) = (steps.first(), &open) {
        let target = add_appimage(path)?;
        steps.remove(0);
        open = Some(vec![target.to_string_lossy().into_owned()]);
    }
    if !steps.is_empty() {
        let activity = Activity {
            app: "helixos-open".into(),
            icon: ICON.into(),
            title: plan.activity.clone(),
            subtitle: String::new(),
            progress: None,
        };
        let id = format!("open-{}", std::process::id());
        let result = island::while_working(&id, activity, tokio::sync::watch::channel(None).1, async {
            for (i, step) in steps.iter().enumerate() {
                let _ = island::show(
                    &id,
                    &Activity {
                        app: "helixos-open".into(),
                        icon: ICON.into(),
                        title: plan.activity.clone(),
                        subtitle: format!("Step {} of {}", i + 1, steps.len()),
                        progress: Some(i as f64 / steps.len() as f64),
                    },
                )
                .await;
                run_step(runner, step).await?;
            }
            Ok::<_, anyhow::Error>(())
        })
        .await;
        if let Err(error) = result {
            notifier.notify("Couldn’t finish", &error.to_string(), &[], false).await?;
            return Err(error);
        }
    }
    let spawn = |argv: Vec<String>| async move { runner.spawn_detached(&argv[0], &argv[1..]).await.map_err(|e| anyhow!("{e}")) };
    match (open, done) {
        (Some(argv), Some(done)) if !plan.open_now => {
            let mut stream = notifier.signals().await?;
            let id = notifier.notify(&done, "", &[("open".into(), "Open".into())], false).await?;
            if notifier.answer(id, &mut stream, Duration::from_secs(60)).await.as_deref() == Some("open") {
                spawn(argv).await?;
            }
        }
        (open, done) => {
            if let Some(argv) = open {
                spawn(argv).await?;
            }
            if let Some(done) = done {
                notifier.notify(&done, "", &[], false).await?;
            }
        }
    }
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args[0] == "--help" {
        println!("usage: helixos-open FILE-OR-LINK...\n\nOpens Windows programs, Flatpaks and Flathub links, AppImages, packages, and Android apps.");
        return Ok(());
    }
    if args[0] == "--classify" {
        for input in &args[1..] {
            println!("{input}: {:?}", classify(input, &head(input)));
        }
        return Ok(());
    }
    let have = Available { wine: on_path("wine"), flatpak: on_path("flatpak"), waydroid: on_path("waydroid") };
    let notifier = Notifier::new().await?;
    // Installs can take a long time; nothing here should time out on its own.
    let runner = SystemRunner { timeout: Duration::from_secs(4 * 3600) };
    let mut failed = false;
    for input in &args {
        let target = classify(input, &head(input));
        let flatpakref = match &target {
            Target::FlatpakRef(path) => std::fs::read_to_string(path).ok().and_then(|c| plan::flatpakref_app_id(&c)),
            _ => None,
        };
        let plan = plan::plan(&target, have, flatpakref.as_deref());
        if let Err(error) = execute(&plan, &notifier, &runner).await {
            eprintln!("helixos-open: {input}: {error}");
            failed = true;
        }
    }
    if failed {
        std::process::exit(1);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    struct FakeServer;
    #[zbus::interface(name = "org.freedesktop.Notifications")]
    impl FakeServer {
        #[allow(clippy::too_many_arguments)]
        fn notify(
            &self,
            _app: String,
            _replaces: u32,
            _icon: String,
            _summary: String,
            _body: String,
            _actions: Vec<String>,
            _hints: HashMap<String, zbus::zvariant::OwnedValue>,
            _timeout: i32,
        ) -> u32 {
            7
        }
    }

    #[tokio::test]
    async fn only_the_notification_server_can_answer() {
        let Ok(mut daemon) = Command::new("dbus-daemon").args(["--session", "--nofork", "--print-address"]).stdout(Stdio::piped()).spawn()
        else {
            eprintln!("dbus-daemon not installed; skipping");
            return;
        };
        let mut address = String::new();
        BufReader::new(daemon.stdout.take().unwrap()).read_line(&mut address).unwrap();
        let address = address.trim().to_string();
        let connect = || async { zbus::connection::Builder::address(address.as_str()).unwrap().build().await.unwrap() };
        let server = zbus::connection::Builder::address(address.as_str())
            .unwrap()
            .name("org.freedesktop.Notifications")
            .unwrap()
            .serve_at("/org/freedesktop/Notifications", FakeServer)
            .unwrap()
            .build()
            .await
            .unwrap();
        let intruder = connect().await;
        let notifier = Notifier { conn: connect().await };

        let emit = |conn: zbus::Connection, action: &'static str| async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            conn.emit_signal(
                None::<&str>,
                "/org/freedesktop/Notifications",
                "org.freedesktop.Notifications",
                "ActionInvoked",
                &(7u32, action),
            )
            .await
            .unwrap();
        };
        // A forged answer from another app is ignored; the server's own one counts.
        let forged = tokio::spawn(emit(intruder.clone(), "install"));
        let real = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            emit(server.clone(), "cancel").await;
            server
        });
        let actions = [("install".to_string(), "Install".to_string()), ("cancel".to_string(), "Cancel".to_string())];
        let answer = notifier.ask("Install x?", "", &actions).await.unwrap();
        forged.await.unwrap();
        let _server = real.await.unwrap();
        assert_eq!(answer.as_deref(), Some("cancel"));
        let _ = daemon.kill();
    }
}

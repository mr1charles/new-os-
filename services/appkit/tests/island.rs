//! The island client against stand-ins for the shell and the notification server on a private
//! D-Bus daemon.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use helixos_appkit::island::{self, Activity, Notification};

struct Bus(Child);
impl Drop for Bus {
    fn drop(&mut self) {
        let _ = self.0.kill();
    }
}

#[derive(Default, Clone)]
struct Seen(Arc<Mutex<Vec<String>>>);

struct FakeIsland(Seen);
#[zbus::interface(name = "org.helixos.Island1")]
impl FakeIsland {
    fn show(&self, #[zbus(header)] h: zbus::message::Header<'_>, id: String, activity: String) {
        self.0 .0.lock().unwrap().push(format!("show {} {id} {activity}", h.sender().unwrap()));
    }
    fn end(&self, id: String) {
        self.0 .0.lock().unwrap().push(format!("end {id}"));
    }
}

struct FakeNotifications(Seen);
#[zbus::interface(name = "org.freedesktop.Notifications")]
impl FakeNotifications {
    #[allow(clippy::too_many_arguments)]
    fn notify(
        &self,
        app: String,
        replaces: u32,
        icon: String,
        summary: String,
        body: String,
        actions: Vec<String>,
        hints: std::collections::HashMap<String, zbus::zvariant::OwnedValue>,
        _timeout: i32,
    ) -> u32 {
        let urgency = hints.get("urgency").and_then(|v| u8::try_from(v).ok()).unwrap_or(0);
        self.0 .0.lock().unwrap().push(format!("notify {app} {replaces} {icon} {summary} {body} {actions:?} {urgency}"));
        7
    }
}

#[tokio::test]
async fn activities_and_notifications_reach_the_shell() {
    let Ok(mut daemon) = Command::new("dbus-daemon").args(["--session", "--nofork", "--print-address"]).stdout(Stdio::piped()).spawn()
    else {
        eprintln!("dbus-daemon not installed; skipping");
        return;
    };
    let mut address = String::new();
    BufReader::new(daemon.stdout.take().unwrap()).read_line(&mut address).unwrap();
    let _bus = Bus(daemon);
    let address = address.trim().to_string();

    let seen = Seen::default();
    let _shell = zbus::connection::Builder::address(address.as_str())
        .unwrap()
        .name("org.helixos.Shell1")
        .unwrap()
        .serve_at("/org/helixos/Island1", FakeIsland(seen.clone()))
        .unwrap()
        .build()
        .await
        .unwrap();
    let _notifications = zbus::connection::Builder::address(address.as_str())
        .unwrap()
        .name("org.freedesktop.Notifications")
        .unwrap()
        .serve_at("/org/freedesktop/Notifications", FakeNotifications(seen.clone()))
        .unwrap()
        .build()
        .await
        .unwrap();

    // SAFETY: set before the client's first connection, and no other test in this binary.
    unsafe { std::env::set_var("HELIXOS_ISLAND_BUS", &address) };
    let activity = Activity {
        app: "helixos-files".into(),
        icon: "folder".into(),
        title: "Copying".into(),
        subtitle: "2 of 5".into(),
        progress: Some(0.4),
    };
    island::show("copy-1", &activity).await.unwrap();
    island::show("copy-1", &Activity { progress: Some(0.8), ..activity }).await.unwrap();
    island::end("copy-1").await.unwrap();
    let id = island::notify(&Notification {
        app_name: "Files".into(),
        icon: "folder".into(),
        summary: "Copied 5 items".into(),
        body: "to Documents".into(),
        replaces: 0,
        urgent: false,
    })
    .await
    .unwrap();
    assert_eq!(id, 7);

    let seen_log = seen.clone();
    let seen = seen.0.lock().unwrap().clone();
    assert_eq!(seen.len(), 4, "{seen:?}");
    // Both updates come from the same connection, so the shell treats them as one activity.
    let sender = |line: &str| line.split(' ').nth(1).unwrap().to_string();
    assert_eq!(sender(&seen[0]), sender(&seen[1]));
    assert!(seen[0].contains(r#""progress":0.4"#) && seen[0].contains(" copy-1 "));
    assert!(seen[1].contains(r#""progress":0.8"#));
    assert_eq!(seen[2], "end copy-1");
    assert_eq!(seen[3], r#"notify Files 0 folder Copied 5 items to Documents ["default", "Open"] 1"#);

    // Quick work never reaches the island; slow work shows progress, then ends.
    let base =
        Activity { app: "helixos-files".into(), icon: "folder".into(), title: "Copying".into(), subtitle: String::new(), progress: None };
    let (_tx, rx) = tokio::sync::watch::channel(None);
    assert_eq!(island::while_working("quick", base.clone(), rx, async { 1 }).await, 1);
    let (tx, rx) = tokio::sync::watch::channel(Some(0.5));
    let slow = async move {
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        drop(tx);
        2
    };
    assert_eq!(island::while_working("slow", base, rx, slow).await, 2);
    let log = seen_log.0.lock().unwrap().clone();
    let later = &log[4..];
    assert!(!later.iter().any(|l| l.contains("quick")), "{later:?}");
    assert!(later.iter().filter(|l| l.starts_with("show") && l.contains(r#""progress":0.5"#)).count() >= 1, "{later:?}");
    assert_eq!(later.last().unwrap(), "end slow");
}

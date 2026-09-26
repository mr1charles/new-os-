//! The service on a real (private) D-Bus daemon, called like the greeter and Settings call
//! it. PAM and the account tools are mocked; tests/pam.sh covers the real ones.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;

use newos_spacesd::auth::MockAuthenticator;
use newos_spacesd::callers::AccountFiles;
use newos_spacesd::ratelimit::RateLimiter;
use newos_spacesd::registry::Registry;
use newos_spacesd::service::{Authorization, Service, BUS_NAME, OBJECT_PATH};
use newos_syslib::{CommandOutput, MockRunner};
use serde_json::Value;
use tokio::sync::Mutex;

struct Bus {
    daemon: Child,
    address: String,
}

impl Drop for Bus {
    fn drop(&mut self) {
        let _ = self.daemon.kill();
    }
}

fn start_bus() -> Option<Bus> {
    let mut daemon = Command::new("dbus-daemon").args(["--session", "--nofork", "--print-address"]).stdout(Stdio::piped()).spawn().ok()?;
    let mut line = String::new();
    BufReader::new(daemon.stdout.take()?).read_line(&mut line).ok()?;
    Some(Bus { daemon, address: line.trim().to_string() })
}

async fn call(
    conn: &zbus::Connection,
    method: &str,
    body: &(impl serde::Serialize + zbus::zvariant::DynamicType),
) -> zbus::Result<zbus::Message> {
    conn.call_method(Some(BUS_NAME), OBJECT_PATH, Some(BUS_NAME), method, body).await
}

fn error_name(e: zbus::Error) -> String {
    match e {
        zbus::Error::MethodError(name, _, _) => name.to_string(),
        other => other.to_string(),
    }
}

#[tokio::test]
async fn create_resolve_and_rate_limit_over_dbus() {
    let Some(bus) = start_bus() else {
        eprintln!("skipping: no dbus-daemon");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let auth = Arc::new(MockAuthenticator::default());
    let runner = Arc::new(MockRunner::new());
    let own_uid = std::fs::metadata("/proc/self").map(|m| std::os::unix::fs::MetadataExt::uid(&m)).unwrap();
    let service = Service {
        registry: Mutex::new(Registry::load(&dir.path().join("spaces.json")).unwrap()),
        auth: auth.clone(),
        runner: runner.clone(),
        limiter: Mutex::new(RateLimiter::default()),
        callers: AccountFiles::default(),
        authorization: Authorization::SameUser,
        own_uid,
    };
    let _server = zbus::connection::Builder::address(bus.address.as_str())
        .unwrap()
        .name(BUS_NAME)
        .unwrap()
        .serve_at(OBJECT_PATH, service)
        .unwrap()
        .build()
        .await
        .unwrap();
    let client = zbus::connection::Builder::address(bus.address.as_str()).unwrap().build().await.unwrap();

    // Create two spaces. The mocked account tools report "no such account" to getent passwd.
    for (name, password) in [("Work", "work-secret"), ("Personal", "home-secret")] {
        runner.respond(CommandOutput::failed(2, "")); // getent passwd space-...
        let reply = call(&client, "CreateSpace", &(name, password, "blue")).await.unwrap();
        let space: Value = serde_json::from_str(&reply.body().deserialize::<String>().unwrap()).unwrap();
        let account = space["account"].as_str().unwrap().to_string();
        auth.set(&account, password);
    }
    let list: Value =
        serde_json::from_str(&call(&client, "ListSpaces", &()).await.unwrap().body().deserialize::<String>().unwrap()).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 2);
    assert_eq!(list[0]["default"], true);
    assert!(runner.inputs().iter().all(|i| i.starts_with("space-")), "passwords go to chpasswd on stdin");

    // A password that already opens a space is refused for a new one.
    let err = call(&client, "CreateSpace", &("Copy", "work-secret", "pink")).await.unwrap_err();
    assert_eq!(error_name(err), "org.newos.Spaces1.Error.Invalid");

    // Each password opens its own space.
    let account = |m: zbus::Message| m.body().deserialize::<String>().unwrap();
    assert_eq!(account(call(&client, "ResolvePassword", &("work-secret",)).await.unwrap()), "space-work");
    assert_eq!(account(call(&client, "ResolvePassword", &("home-secret",)).await.unwrap()), "space-personal");

    // SwitchTo brings a running space to the screen, and names a space that is not running.
    runner.respond(CommandOutput::ok("7 1001 space-work seat0 900 user tty2 no -\n")); // list-sessions
    assert_eq!(account(call(&client, "SwitchTo", &("work-secret",)).await.unwrap()), "space-work");
    assert_eq!(runner.calls().last().unwrap(), &["loginctl", "activate", "7"]);
    runner.respond(CommandOutput::ok("")); // no sessions
    match call(&client, "SwitchTo", &("home-secret",)).await.unwrap_err() {
        zbus::Error::MethodError(name, message, _) => {
            assert_eq!(name.as_str(), "org.newos.Spaces1.Error.NotRunning");
            assert_eq!(message.as_deref(), Some("Personal"));
        }
        other => panic!("unexpected {other}"),
    }

    // Wrong passwords: NoMatch four times, then the fifth locks the caller out.
    for _ in 0..5 {
        let err = call(&client, "ResolvePassword", &("guess",)).await.unwrap_err();
        assert_eq!(error_name(err), "org.newos.Spaces1.Error.NoMatch");
    }
    let err = call(&client, "ResolvePassword", &("work-secret",)).await.unwrap_err();
    assert_eq!(error_name(err), "org.newos.Spaces1.Error.RateLimited", "even the right password waits");

    // Deleting: never the last space; the account tools are called for the others.
    runner.respond(CommandOutput::ok("")); // loginctl list-sessions: none
    call(&client, "DeleteSpace", &("space-personal", false)).await.unwrap();
    assert!(runner.calls().iter().any(|c| c == &["userdel", "--remove", "space-personal"]));
    let err = call(&client, "DeleteSpace", &("space-work", false)).await.unwrap_err();
    assert_eq!(error_name(err), "org.newos.Spaces1.Error.Invalid");

    let saved: Value = serde_json::from_str(&std::fs::read_to_string(dir.path().join("spaces.json")).unwrap()).unwrap();
    assert_eq!(saved["spaces"].as_array().unwrap().len(), 1);
    assert!(!std::fs::read_to_string(dir.path().join("spaces.json")).unwrap().contains("secret"), "no passwords on disk");
}

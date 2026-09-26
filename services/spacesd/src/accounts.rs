//! Creating and removing the Linux accounts behind spaces, with the standard shadow tools.
//! Account names come only from [`crate::registry::Registry::new_account`], never from
//! input, and passwords go to `chpasswd` on stdin.

use newos_syslib::runner::run_checked;
use newos_syslib::CommandRunner;

use crate::registry::valid_account;
use crate::{Error, Result};

pub const GROUP: &str = "newos-spaces";

fn check(account: &str) -> Result<()> {
    if valid_account(account) {
        Ok(())
    } else {
        Err(Error::Invalid(format!("not a space account: {account}")))
    }
}

/// A password good enough for a login: at least 6 characters, no newline or colon (which
/// `chpasswd` reads as separators).
pub fn check_password(password: &str) -> Result<()> {
    if password.chars().count() < 6 {
        return Err(Error::Invalid("Use at least 6 characters for a space’s password.".into()));
    }
    if password.contains(['\n', '\r', ':', '\0']) {
        return Err(Error::Invalid("A password can’t contain line breaks or colons.".into()));
    }
    Ok(())
}

pub async fn ensure_group(runner: &dyn CommandRunner) -> Result<()> {
    let exists = runner.run("getent", &["group".into(), GROUP.into()]).await.map(|o| o.success()).unwrap_or(false);
    if !exists {
        run_checked(runner, "groupadd", &["--system", GROUP]).await?;
    }
    Ok(())
}

pub async fn account_exists(runner: &dyn CommandRunner, account: &str) -> bool {
    runner.run("getent", &["passwd".into(), account.into()]).await.map(|o| o.success()).unwrap_or(false)
}

/// Create the account (home folder, own group, in `newos-spaces` and the usual desktop
/// groups) and set its password.
pub async fn create(runner: &dyn CommandRunner, account: &str, display_name: &str, password: &str) -> Result<()> {
    check(account)?;
    check_password(password)?;
    ensure_group(runner).await?;
    let comment: String = display_name.chars().filter(|c| !c.is_control() && *c != ':' && *c != ',').collect();
    run_checked(
        runner,
        "useradd",
        &[
            "--create-home",
            "--user-group",
            "--groups",
            &format!("{GROUP},video,audio,input"),
            "--shell",
            "/bin/bash",
            "--comment",
            &comment,
            account,
        ],
    )
    .await?;
    if let Err(e) = set_password(runner, account, password).await {
        // Do not leave an account without a password behind.
        let _ = run_checked(runner, "userdel", &["--remove", account]).await;
        return Err(e);
    }
    Ok(())
}

pub async fn set_password(runner: &dyn CommandRunner, account: &str, password: &str) -> Result<()> {
    check(account)?;
    check_password(password)?;
    let out = runner.run_with_input("chpasswd", &[], &format!("{account}:{password}\n")).await?;
    if !out.success() {
        return Err(Error::Invalid(format!("Couldn’t set the password: {}", out.stderr.trim())));
    }
    Ok(())
}

/// Remove the account, and its home folder unless `keep_home`. The caller makes sure the
/// space is not running.
pub async fn remove(runner: &dyn CommandRunner, account: &str, keep_home: bool) -> Result<()> {
    check(account)?;
    let mut args = vec![account];
    if !keep_home {
        args.insert(0, "--remove");
    }
    run_checked(runner, "userdel", &args).await?;
    Ok(())
}

/// True while the account has a login session (it cannot be deleted then).
pub async fn has_session(runner: &dyn CommandRunner, account: &str) -> bool {
    let out = runner.run("loginctl", &["list-sessions".into(), "--no-legend".into()]).await;
    out.map(|o| o.stdout.lines().any(|l| l.split_whitespace().nth(2) == Some(account))).unwrap_or(false)
}

/// A login session from `loginctl list-sessions --no-legend`:
/// "SESSION UID USER SEAT LEADER CLASS TTY IDLE SINCE".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub id: String,
    pub user: String,
    pub seat: String,
    pub class: String,
}

pub fn parse_sessions(output: &str) -> Vec<Session> {
    output
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            (f.len() >= 6).then(|| Session { id: f[0].into(), user: f[2].into(), seat: f[3].into(), class: f[5].into() })
        })
        .collect()
}

/// The account's desktop session on seat0, if it is running.
pub async fn desktop_session(runner: &dyn CommandRunner, account: &str) -> Option<String> {
    let out = runner.run("loginctl", &["list-sessions".into(), "--no-legend".into()]).await.ok()?;
    parse_sessions(&out.stdout).into_iter().find(|s| s.user == account && s.seat == "seat0" && s.class == "user").map(|s| s.id)
}

/// Bring a session to the screen (logind switches to its VT). Sessions left behind stay
/// locked.
pub async fn activate(runner: &dyn CommandRunner, session: &str) -> Result<()> {
    if session.is_empty() || !session.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(Error::Invalid(format!("not a session id: {session}")));
    }
    run_checked(runner, "loginctl", &["activate", session]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use newos_syslib::{CommandOutput, MockRunner};

    #[tokio::test]
    async fn creates_accounts_with_the_password_on_stdin() {
        let runner = MockRunner::new();
        runner.respond(CommandOutput::ok("newos-spaces:x:970:\n")); // getent group
        create(&runner, "space-work", "Work: Mine", "correct horse").await.unwrap();
        let calls = runner.calls();
        assert_eq!(calls[1][0], "useradd");
        assert!(calls[1].contains(&"Work Mine".to_string()), "no colons in the comment");
        assert_eq!(calls[1].last().unwrap(), "space-work");
        assert_eq!(calls[2], ["chpasswd"]);
        assert_eq!(runner.inputs(), ["space-work:correct horse\n"]);
        assert!(!calls.iter().flatten().any(|a| a.contains("correct horse")), "never on a command line");
    }

    #[tokio::test]
    async fn creates_the_group_once() {
        let runner = MockRunner::new();
        runner.respond(CommandOutput::failed(2, ""));
        ensure_group(&runner).await.unwrap();
        assert_eq!(runner.calls()[1], ["groupadd", "--system", "newos-spaces"]);
    }

    #[tokio::test]
    async fn rolls_back_when_the_password_fails() {
        let runner = MockRunner::new();
        runner.respond(CommandOutput::ok("")).respond(CommandOutput::ok("")).respond(CommandOutput::failed(1, "PAM: failure"));
        assert!(create(&runner, "space-home", "Home", "secret1").await.is_err());
        assert_eq!(runner.calls().last().unwrap(), &["userdel", "--remove", "space-home"]);
    }

    #[tokio::test]
    async fn refuses_bad_input() {
        let runner = MockRunner::new();
        assert!(create(&runner, "root", "Root", "secret1").await.is_err());
        assert!(create(&runner, "space-x", "X", "short").await.is_err());
        assert!(set_password(&runner, "space-x", "has:colon").await.is_err());
        assert!(remove(&runner, "a", false).await.is_err());
        assert!(runner.calls().is_empty());
    }

    #[tokio::test]
    async fn finds_and_activates_desktop_sessions() {
        let out = "2 1000 a seat0 805 user tty1 no -\n3 1000 a - 830 manager - no -\n7 1001 space-work seat0 9001 user tty2 no -\n";
        assert_eq!(parse_sessions(out).len(), 3);
        let runner = MockRunner::new();
        runner.respond(CommandOutput::ok(out));
        assert_eq!(desktop_session(&runner, "space-work").await.as_deref(), Some("7"));
        runner.respond(CommandOutput::ok("3 1000 a - 830 manager - no -\n"));
        assert_eq!(desktop_session(&runner, "a").await, None, "the manager session is not a desktop");
        activate(&runner, "7").await.unwrap();
        assert_eq!(runner.calls().last().unwrap(), &["loginctl", "activate", "7"]);
        assert!(activate(&runner, "7; reboot").await.is_err());
    }

    #[tokio::test]
    async fn finds_sessions() {
        let runner = MockRunner::new();
        runner.respond(CommandOutput::ok("  2 1001 space-work seat0 tty2\n  3 1000 a seat0 tty1\n"));
        assert!(has_session(&runner, "space-work").await);
    }
}

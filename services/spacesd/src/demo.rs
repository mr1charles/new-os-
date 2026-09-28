//! Demo mode (`--demo`, the preview): pretend accounts that behave like real ones. Commands
//! that would change the system are answered here instead, and passwords set through
//! `chpasswd` are remembered by the demo authenticator so they work at the lock screen.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use helixos_syslib::runner::BoxFuture;
use helixos_syslib::{CommandOutput, CommandRunner};

use crate::auth::MockAuthenticator;
use crate::registry::{Registry, Space};

/// The two demo spaces and their passwords.
pub const SPACES: [(&str, &str, &str, &str); 2] =
    [("space-work", "Work", "blue", "work-demo"), ("space-personal", "Personal", "pink", "home-demo")];

pub fn authenticator() -> MockAuthenticator {
    MockAuthenticator::with(&SPACES.map(|(account, _, _, password)| (account, password)))
}

/// The demo registry: kept at `path` so changes survive restarts of the demo, seeded with the
/// demo spaces the first time.
pub fn registry(path: &std::path::Path) -> crate::Result<Registry> {
    let mut registry = Registry::load(path)?;
    if registry.spaces.is_empty() {
        for (account, name, accent, _) in SPACES {
            registry.add(Space { account: account.into(), name: name.into(), accent: accent.into(), default: false, last_used: 0 });
        }
        registry.save()?;
    }
    Ok(registry)
}

pub struct DemoRunner {
    accounts: Mutex<HashSet<String>>,
    auth: Arc<MockAuthenticator>,
}

impl DemoRunner {
    pub fn new(registry: &Registry, auth: Arc<MockAuthenticator>) -> Self {
        Self { accounts: Mutex::new(registry.spaces.iter().map(|s| s.account.clone()).collect()), auth }
    }

    fn answer(&self, program: &str, args: &[String]) -> CommandOutput {
        let last = args.last().cloned().unwrap_or_default();
        match program {
            "getent" if args.first().map(String::as_str) == Some("passwd") => {
                if self.accounts.lock().unwrap().contains(&last) {
                    CommandOutput::ok(format!("{last}:x:2000:2000::/home/{last}:/bin/bash\n"))
                } else {
                    CommandOutput::failed(2, "")
                }
            }
            "useradd" => {
                self.accounts.lock().unwrap().insert(last);
                CommandOutput::ok("")
            }
            "userdel" => {
                self.accounts.lock().unwrap().remove(&last);
                CommandOutput::ok("")
            }
            // No demo space ever has a login session.
            "loginctl" => CommandOutput::ok(""),
            _ => CommandOutput::ok(""),
        }
    }
}

impl CommandRunner for DemoRunner {
    fn run<'a>(&'a self, program: &'a str, args: &'a [String]) -> BoxFuture<'a, helixos_syslib::Result<CommandOutput>> {
        Box::pin(async move { Ok(self.answer(program, args)) })
    }

    fn spawn_detached<'a>(&'a self, _program: &'a str, _args: &'a [String]) -> BoxFuture<'a, helixos_syslib::Result<()>> {
        Box::pin(async { Ok(()) })
    }

    fn run_with_input<'a>(
        &'a self,
        program: &'a str,
        _args: &'a [String],
        input: &'a str,
    ) -> BoxFuture<'a, helixos_syslib::Result<CommandOutput>> {
        Box::pin(async move {
            if program == "chpasswd" {
                for line in input.lines() {
                    if let Some((account, password)) = line.split_once(':') {
                        self.auth.set(account, password);
                    }
                }
            }
            Ok(CommandOutput::ok(""))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::Authenticator;

    #[tokio::test]
    async fn accounts_and_passwords_behave_like_real_ones() {
        let dir = tempfile::tempdir().unwrap();
        let registry = registry(&dir.path().join("spaces.json")).unwrap();
        assert_eq!(registry.spaces.len(), 2);
        let auth = Arc::new(authenticator());
        let runner = DemoRunner::new(&registry, auth.clone());
        assert!(crate::accounts::account_exists(&runner, "space-work").await);
        assert!(!crate::accounts::account_exists(&runner, "space-school").await);
        crate::accounts::create(&runner, "space-school", "School", "school-pass").await.unwrap();
        assert!(crate::accounts::account_exists(&runner, "space-school").await);
        assert!(auth.authenticate("space-school", "school-pass"));
        crate::accounts::remove(&runner, "space-school", true).await.unwrap();
        assert!(!crate::accounts::account_exists(&runner, "space-school").await);
        // Saved: a second start keeps what changed.
        assert_eq!(super::registry(&dir.path().join("spaces.json")).unwrap().spaces.len(), 2);
    }
}

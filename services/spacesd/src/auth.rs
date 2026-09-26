//! Checking a password against an account. The real check goes through PAM (service
//! `helixos-spaces`); tests use [`MockAuthenticator`].

use std::collections::HashMap;

/// Password checks are blocking (PAM can take a moment), so callers run them off the async
/// runtime.
pub trait Authenticator: Send + Sync {
    fn authenticate(&self, account: &str, password: &str) -> bool;
}

/// PAM with the `helixos-spaces` service: authenticate and check the account is usable
/// (not expired or locked).
#[cfg(feature = "pam")]
pub struct PamAuthenticator {
    pub service: String,
}

#[cfg(feature = "pam")]
impl Authenticator for PamAuthenticator {
    fn authenticate(&self, account: &str, password: &str) -> bool {
        use pam_client::conv_mock::Conversation;
        use pam_client::{Context, Flag};
        let conversation = Conversation::with_credentials(account, password);
        let Ok(mut context) = Context::new(&self.service, Some(account), conversation) else { return false };
        context.authenticate(Flag::SILENT).is_ok() && context.acct_mgmt(Flag::SILENT).is_ok()
    }
}

/// Test double: account -> password.
#[derive(Default)]
pub struct MockAuthenticator {
    pub passwords: std::sync::Mutex<HashMap<String, String>>,
}

impl MockAuthenticator {
    pub fn with(pairs: &[(&str, &str)]) -> Self {
        Self { passwords: std::sync::Mutex::new(pairs.iter().map(|(a, p)| (a.to_string(), p.to_string())).collect()) }
    }

    pub fn set(&self, account: &str, password: &str) {
        self.passwords.lock().unwrap().insert(account.into(), password.into());
    }
}

impl Authenticator for MockAuthenticator {
    fn authenticate(&self, account: &str, password: &str) -> bool {
        self.passwords.lock().unwrap().get(account).is_some_and(|p| p == password)
    }
}

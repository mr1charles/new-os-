//! HelixOS Dual Space: which space a password opens, and creating and removing spaces.
//! See docs/DUAL-SPACE.md for the design and the rules that keep it safe.

pub mod accounts;
pub mod auth;
pub mod callers;
pub mod demo;
pub mod ratelimit;
pub mod registry;
pub mod service;

use auth::Authenticator;
use registry::{Registry, Space};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Sys(#[from] helixos_syslib::SysError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

/// The space `password` opens, trying the most recently used space first.
pub fn resolve<'a>(registry: &'a Registry, auth: &dyn Authenticator, password: &str) -> Option<&'a Space> {
    registry.try_order().into_iter().find(|space| auth.authenticate(&space.account, password))
}

/// The space (other than `except`) that `password` already opens. Creating a space or setting
/// a password that another space uses is refused, so a password always means one space.
pub fn password_taken<'a>(registry: &'a Registry, auth: &dyn Authenticator, password: &str, except: Option<&str>) -> Option<&'a Space> {
    registry.spaces.iter().filter(|s| Some(s.account.as_str()) != except).find(|s| auth.authenticate(&s.account, password))
}

#[cfg(test)]
mod tests {
    use super::*;
    use auth::MockAuthenticator;

    fn registry() -> Registry {
        let mut registry = Registry::default();
        for (account, last_used) in [("space-work", 5), ("space-home", 9)] {
            registry.add(Space { account: account.into(), name: account.into(), accent: "blue".into(), default: false, last_used });
        }
        registry
    }

    #[test]
    fn a_password_opens_its_space() {
        let registry = registry();
        let auth = MockAuthenticator::with(&[("space-work", "w0rk-pass"), ("space-home", "h0me-pass")]);
        assert_eq!(resolve(&registry, &auth, "w0rk-pass").unwrap().account, "space-work");
        assert_eq!(resolve(&registry, &auth, "h0me-pass").unwrap().account, "space-home");
        assert!(resolve(&registry, &auth, "nope").is_none());
    }

    #[test]
    fn detects_passwords_already_in_use() {
        let registry = registry();
        let auth = MockAuthenticator::with(&[("space-work", "same-pass"), ("space-home", "other")]);
        assert_eq!(password_taken(&registry, &auth, "same-pass", None).unwrap().account, "space-work");
        assert!(password_taken(&registry, &auth, "same-pass", Some("space-work")).is_none());
        assert!(password_taken(&registry, &auth, "fresh-pass", None).is_none());
    }
}

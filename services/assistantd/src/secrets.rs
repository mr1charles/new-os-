//! Finding the Anthropic API key without ever writing it into a plain config file.
//!
//! Order: the configured environment variable, the Secret Service keyring (libsecret's
//! `secret-tool`, which the Settings app writes to), then an optional key file.

use std::path::Path;

use crate::config::CloudConfig;

/// Attributes the key is stored under in the keyring.
pub const KEYRING_ATTRIBUTES: [&str; 4] = ["service", "helixos-assistant", "account", "anthropic-api-key"];

pub fn clean_key(raw: &str) -> Option<String> {
    let key = raw.trim();
    if key.is_empty() || key.chars().any(char::is_whitespace) {
        None
    } else {
        Some(key.to_string())
    }
}

fn from_keyring() -> Option<String> {
    let output = std::process::Command::new("secret-tool")
        .arg("lookup")
        .args(KEYRING_ATTRIBUTES)
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    clean_key(&String::from_utf8_lossy(&output.stdout))
}

fn from_file(path: &Path) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            if meta.permissions().mode() & 0o077 != 0 {
                tracing::warn!("{} is readable by other users; run: chmod 600 {}", path.display(), path.display());
            }
        }
    }
    clean_key(&std::fs::read_to_string(path).ok()?)
}

/// Where the key came from, for the status endpoint (never the key itself).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeySource {
    Environment,
    Keyring,
    File,
}

pub fn find_api_key(cloud: &CloudConfig) -> Option<(String, KeySource)> {
    if let Some(key) = std::env::var(&cloud.api_key_env).ok().and_then(|v| clean_key(&v)) {
        return Some((key, KeySource::Environment));
    }
    if let Some(key) = from_keyring() {
        return Some((key, KeySource::Keyring));
    }
    if let Some(path) = &cloud.api_key_file {
        if let Some(key) = from_file(path) {
            return Some((key, KeySource::File));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_keys() {
        assert_eq!(clean_key("  sk-ant-123\n"), Some("sk-ant-123".into()));
        assert_eq!(clean_key("\n"), None);
        assert_eq!(clean_key("two words"), None);
    }

    #[test]
    fn reads_key_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("key");
        std::fs::write(&path, "sk-ant-file\n").unwrap();
        assert_eq!(from_file(&path), Some("sk-ant-file".into()));
    }
}

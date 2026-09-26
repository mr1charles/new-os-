//! The Anthropic API key in the Secret Service keyring, under the attributes assistantd reads
//! (`services/assistantd/src/secrets.rs`). The key goes to `secret-tool` on stdin, never on a
//! command line or into a file.

use std::io::Write;
use std::process::{Command, Stdio};

use crate::{AppError, Result};

pub const ATTRIBUTES: [&str; 4] = ["service", "newos-assistant", "account", "anthropic-api-key"];

/// Anthropic keys are one token of printable ASCII starting with "sk-ant-".
pub fn valid_api_key(key: &str) -> bool {
    key.starts_with("sk-ant-") && key.len() >= 20 && key.len() <= 512 && key.chars().all(|c| c.is_ascii_graphic())
}

fn secret_tool(args: &[&str], stdin: Option<&str>) -> Result<std::process::Output> {
    let mut child = Command::new("secret-tool")
        .args(args)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => AppError::Invalid("secret-tool is not installed (package libsecret)".into()),
            _ => e.into(),
        })?;
    if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(input.as_bytes())?;
    }
    Ok(child.wait_with_output()?)
}

pub fn store_api_key(key: &str) -> Result<()> {
    let key = key.trim();
    if !valid_api_key(key) {
        return Err(AppError::Invalid("That doesn't look like an Anthropic API key (it starts with \"sk-ant-\").".into()));
    }
    let mut args = vec!["store", "--label=NewOS assistant: Anthropic API key"];
    args.extend(ATTRIBUTES);
    let output = secret_tool(&args, Some(key))?;
    if !output.status.success() {
        return Err(AppError::Invalid(format!("Could not save to the keyring: {}", String::from_utf8_lossy(&output.stderr).trim())));
    }
    Ok(())
}

pub fn has_api_key() -> bool {
    let mut args = vec!["lookup"];
    args.extend(ATTRIBUTES);
    secret_tool(&args, None).map(|o| o.status.success() && !o.stdout.trim_ascii().is_empty()).unwrap_or(false)
}

pub fn clear_api_key() -> Result<()> {
    let mut args = vec!["clear"];
    args.extend(ATTRIBUTES);
    secret_tool(&args, None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_keys() {
        assert!(valid_api_key("sk-ant-api03-abcdefghijklmnop"));
        assert!(!valid_api_key("sk-ant-short"));
        assert!(!valid_api_key("sk-ant-api03-abc def ghijklmnop"));
        assert!(!valid_api_key("openai-sk-abcdefghijklmnopqrstu"));
    }

    #[test]
    fn attributes_match_assistantd() {
        let secrets = include_str!("../../assistantd/src/secrets.rs");
        assert!(secrets.contains(r#"["service", "newos-assistant", "account", "anthropic-api-key"]"#));
    }
}

//! Windows through Hyprland's `hyprctl`.

use serde::{Deserialize, Serialize};

use crate::runner::{run_checked, CommandRunner};
use crate::{Result, SysError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Window {
    pub address: String,
    pub class: String,
    pub title: String,
    pub workspace: Workspace,
    #[serde(rename = "focusHistoryID", default)]
    pub focus_history_id: i64,
}

pub fn parse_clients(json: &str) -> Result<Vec<Window>> {
    let mut windows: Vec<Window> =
        serde_json::from_str(json).map_err(|_| SysError::Parse { program: "hyprctl".into(), output: json.chars().take(200).collect() })?;
    windows.sort_by_key(|w| w.focus_history_id);
    Ok(windows)
}

pub async fn list_windows(runner: &dyn CommandRunner) -> Result<Vec<Window>> {
    let out = run_checked(runner, "hyprctl", &["clients", "-j"]).await?;
    parse_clients(&out)
}

pub async fn active_window(runner: &dyn CommandRunner) -> Result<Option<Window>> {
    let out = run_checked(runner, "hyprctl", &["activewindow", "-j"]).await?;
    if out.trim() == "{}" || out.trim().is_empty() {
        return Ok(None);
    }
    Ok(serde_json::from_str(&out).ok())
}

/// Addresses look like "0x5581a2b3c4d0". Anything else is rejected so input from the model
/// can never smuggle extra dispatcher arguments.
pub fn valid_address(address: &str) -> bool {
    address.len() > 2 && address.starts_with("0x") && address[2..].chars().all(|c| c.is_ascii_hexdigit())
}

pub async fn focus_window(runner: &dyn CommandRunner, address: &str) -> Result<()> {
    if !valid_address(address) {
        return Err(SysError::Invalid(format!("not a window address: {address}")));
    }
    run_checked(runner, "hyprctl", &["dispatch", "focuswindow", &format!("address:{address}")]).await.map(|_| ())
}

pub async fn close_window(runner: &dyn CommandRunner, address: &str) -> Result<()> {
    if !valid_address(address) {
        return Err(SysError::Invalid(format!("not a window address: {address}")));
    }
    run_checked(runner, "hyprctl", &["dispatch", "closewindow", &format!("address:{address}")]).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLIENTS: &str = r#"[
      {"address":"0xaa","class":"firefox","title":"News","workspace":{"id":1,"name":"1"},"focusHistoryID":2,"pid":10},
      {"address":"0xbb","class":"kitty","title":"zsh","workspace":{"id":2,"name":"2"},"focusHistoryID":0}
    ]"#;

    #[test]
    fn parses_clients_most_recent_first() {
        let windows = parse_clients(CLIENTS).unwrap();
        assert_eq!(windows[0].class, "kitty");
        assert_eq!(windows[1].title, "News");
    }

    #[test]
    fn validates_addresses() {
        assert!(valid_address("0x55a1f00d"));
        assert!(!valid_address("0x"));
        assert!(!valid_address("0x12 ; exit"));
        assert!(!valid_address("class:firefox"));
    }
}

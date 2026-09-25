//! Wi-Fi and radios through NetworkManager's `nmcli`, Bluetooth through `bluetoothctl`.

use crate::runner::{run_checked, CommandRunner};
use crate::Result;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct WifiStatus {
    pub enabled: bool,
    pub ssid: Option<String>,
    pub signal: Option<u32>,
}

/// Split one `nmcli --terse` line on unescaped colons (nmcli escapes ':' in values as '\:').
pub fn split_terse(line: &str) -> Vec<String> {
    let mut fields = vec![String::new()];
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(next) = chars.next() {
                    fields.last_mut().unwrap().push(next);
                }
            }
            ':' => fields.push(String::new()),
            _ => fields.last_mut().unwrap().push(c),
        }
    }
    fields
}

/// Parse `nmcli -t -f ACTIVE,SSID,SIGNAL device wifi list` into the active network.
pub fn parse_active_wifi(output: &str) -> Option<(String, u32)> {
    output.lines().find_map(|line| {
        let fields = split_terse(line);
        if fields.first().map(String::as_str) == Some("yes") {
            let ssid = fields.get(1)?.clone();
            let signal = fields.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            Some((ssid, signal))
        } else {
            None
        }
    })
}

pub async fn wifi_status(runner: &dyn CommandRunner) -> Result<WifiStatus> {
    let radio = run_checked(runner, "nmcli", &["radio", "wifi"]).await?;
    let enabled = radio.trim() == "enabled";
    if !enabled {
        return Ok(WifiStatus { enabled, ssid: None, signal: None });
    }
    let list =
        run_checked(runner, "nmcli", &["--terse", "--fields", "ACTIVE,SSID,SIGNAL", "device", "wifi", "list", "--rescan", "no"]).await?;
    let active = parse_active_wifi(&list);
    Ok(WifiStatus { enabled, ssid: active.as_ref().map(|a| a.0.clone()), signal: active.map(|a| a.1) })
}

pub async fn set_wifi(runner: &dyn CommandRunner, enabled: bool) -> Result<()> {
    run_checked(runner, "nmcli", &["radio", "wifi", if enabled { "on" } else { "off" }]).await?;
    Ok(())
}

pub async fn set_bluetooth(runner: &dyn CommandRunner, enabled: bool) -> Result<()> {
    run_checked(runner, "bluetoothctl", &["power", if enabled { "on" } else { "off" }]).await?;
    Ok(())
}

/// Parse `bluetoothctl show` for "Powered: yes".
pub fn parse_bluetooth_powered(output: &str) -> bool {
    output.lines().any(|l| l.trim() == "Powered: yes")
}

pub async fn bluetooth_powered(runner: &dyn CommandRunner) -> Result<bool> {
    let out = run_checked(runner, "bluetoothctl", &["show"]).await?;
    Ok(parse_bluetooth_powered(&out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_escaped_terse_fields() {
        assert_eq!(split_terse(r"yes:My\:Net:78"), vec!["yes", "My:Net", "78"]);
        assert_eq!(split_terse("no::"), vec!["no", "", ""]);
    }

    #[test]
    fn finds_the_active_network() {
        let out = "no:Neighbor:40\nyes:Home WiFi:81\nno:Cafe:30\n";
        assert_eq!(parse_active_wifi(out), Some(("Home WiFi".to_string(), 81)));
        assert_eq!(parse_active_wifi("no:A:1\n"), None);
    }

    #[test]
    fn reads_bluetooth_power() {
        assert!(parse_bluetooth_powered("Controller 00:11\n\tPowered: yes\n"));
        assert!(!parse_bluetooth_powered("\tPowered: no\n"));
    }
}

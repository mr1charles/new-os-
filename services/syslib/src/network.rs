//! Wi-Fi and radios through NetworkManager's `nmcli`, Bluetooth through `bluetoothctl`.

use crate::runner::{run_checked, CommandRunner};
use crate::{Result, SysError};

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

/// A network from a Wi-Fi scan. Access points with the same name are merged (strongest wins).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct WifiNetwork {
    pub ssid: String,
    pub signal: u32,
    /// "WPA2", "WPA1 WPA2", "WPA3", or empty for open networks.
    pub security: String,
    pub in_use: bool,
    /// A saved NetworkManager connection exists for this name.
    pub saved: bool,
}

/// Parse `nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY device wifi list`. Hidden networks (no
/// name) are skipped. Sorted: connected first, then by signal.
pub fn parse_wifi_list(output: &str, saved: &[String]) -> Vec<WifiNetwork> {
    let mut networks: Vec<WifiNetwork> = Vec::new();
    for line in output.lines() {
        let fields = split_terse(line);
        let [in_use, ssid, signal, security, ..] = fields.as_slice() else { continue };
        if ssid.is_empty() {
            continue;
        }
        let network = WifiNetwork {
            ssid: ssid.clone(),
            signal: signal.parse().unwrap_or(0),
            security: security.trim().to_string(),
            in_use: in_use.trim() == "*",
            saved: saved.iter().any(|s| s == ssid),
        };
        match networks.iter_mut().find(|n| n.ssid == network.ssid) {
            Some(existing) => {
                existing.in_use |= network.in_use;
                if network.signal > existing.signal {
                    existing.signal = network.signal;
                    existing.security = network.security;
                }
            }
            None => networks.push(network),
        }
    }
    networks.sort_by(|a, b| b.in_use.cmp(&a.in_use).then(b.signal.cmp(&a.signal)).then(a.ssid.cmp(&b.ssid)));
    networks
}

/// Parse `nmcli -t -f NAME,TYPE connection show` into the names of saved Wi-Fi connections.
pub fn parse_saved_wifi(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|line| {
            let fields = split_terse(line);
            (fields.get(1).map(String::as_str) == Some("802-11-wireless")).then(|| fields[0].clone())
        })
        .collect()
}

pub async fn saved_wifi(runner: &dyn CommandRunner) -> Result<Vec<String>> {
    let out = run_checked(runner, "nmcli", &["--terse", "--fields", "NAME,TYPE", "connection", "show"]).await?;
    Ok(parse_saved_wifi(&out))
}

/// Scan for networks. `rescan` asks the card for a fresh scan (a few seconds).
pub async fn wifi_networks(runner: &dyn CommandRunner, rescan: bool) -> Result<Vec<WifiNetwork>> {
    let saved = saved_wifi(runner).await?;
    let out = run_checked(
        runner,
        "nmcli",
        &["--terse", "--fields", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", if rescan { "yes" } else { "auto" }],
    )
    .await?;
    Ok(parse_wifi_list(&out, &saved))
}

fn check_ssid(ssid: &str) -> Result<()> {
    if ssid.is_empty() || ssid.len() > 32 {
        return Err(SysError::Invalid(format!("not a Wi-Fi network name: {ssid:?}")));
    }
    Ok(())
}

/// Join a network. Saved networks connect with their stored password; new ones need
/// `password` unless they are open.
///
/// The password is passed on nmcli's command line, which other local users can briefly see in
/// the process list. NewOS machines are single-owner, and each space is its own account, so
/// this is accepted for now; a NetworkManager secret agent replaces it later.
pub async fn connect_wifi(runner: &dyn CommandRunner, ssid: &str, password: Option<&str>) -> Result<()> {
    check_ssid(ssid)?;
    let saved = saved_wifi(runner).await?;
    if saved.iter().any(|s| s == ssid) && password.is_none() {
        run_checked(runner, "nmcli", &["connection", "up", "id", ssid]).await?;
        return Ok(());
    }
    let mut args = vec!["device", "wifi", "connect", ssid];
    if let Some(password) = password {
        args.extend(["password", password]);
    }
    run_checked(runner, "nmcli", &args).await?;
    Ok(())
}

pub async fn disconnect_wifi(runner: &dyn CommandRunner, ssid: &str) -> Result<()> {
    check_ssid(ssid)?;
    run_checked(runner, "nmcli", &["connection", "down", "id", ssid]).await.map(|_| ())
}

pub async fn forget_wifi(runner: &dyn CommandRunner, ssid: &str) -> Result<()> {
    check_ssid(ssid)?;
    run_checked(runner, "nmcli", &["connection", "delete", "id", ssid]).await.map(|_| ())
}

/// A network interface as NetworkManager sees it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct NetDevice {
    pub device: String,
    /// "wifi", "ethernet", "bridge", ...
    pub kind: String,
    pub state: String,
    pub connection: String,
    pub ipv4: Vec<String>,
    pub gateway: String,
    pub dns: Vec<String>,
    pub mac: String,
}

/// Parse `nmcli -t -f GENERAL.DEVICE,GENERAL.TYPE,GENERAL.STATE,GENERAL.CONNECTION,
/// GENERAL.HWADDR,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS device show`. Devices are separated by blank
/// lines; loopback and unmanaged devices are left out.
pub fn parse_device_show(output: &str) -> Vec<NetDevice> {
    let mut devices = Vec::new();
    for block in output.split("\n\n") {
        let mut device = NetDevice {
            device: String::new(),
            kind: String::new(),
            state: String::new(),
            connection: String::new(),
            ipv4: Vec::new(),
            gateway: String::new(),
            dns: Vec::new(),
            mac: String::new(),
        };
        for line in block.lines() {
            let Some((key, value)) = line.split_once(':') else { continue };
            let value = value.to_string();
            let key = key.split('[').next().unwrap_or(key);
            match key {
                "GENERAL.DEVICE" => device.device = value,
                "GENERAL.TYPE" => device.kind = value,
                "GENERAL.STATE" => device.state = value.split(" (").nth(1).map(|s| s.trim_end_matches(')').to_string()).unwrap_or(value),
                "GENERAL.CONNECTION" => device.connection = value,
                "GENERAL.HWADDR" => device.mac = value,
                "IP4.ADDRESS" => device.ipv4.push(value),
                "IP4.GATEWAY" => device.gateway = value,
                "IP4.DNS" => device.dns.push(value),
                _ => {}
            }
        }
        if device.device.is_empty() || device.kind == "loopback" || device.state.starts_with("unmanaged") {
            continue;
        }
        devices.push(device);
    }
    devices
}

pub async fn net_devices(runner: &dyn CommandRunner) -> Result<Vec<NetDevice>> {
    let fields = "GENERAL.DEVICE,GENERAL.TYPE,GENERAL.STATE,GENERAL.CONNECTION,GENERAL.HWADDR,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS";
    let out = run_checked(runner, "nmcli", &["--terse", "--fields", fields, "device", "show"]).await?;
    Ok(parse_device_show(&out))
}

/// Airplane mode is on when both Wi-Fi and Bluetooth are off.
pub async fn airplane_mode(runner: &dyn CommandRunner) -> Result<bool> {
    let wifi = run_checked(runner, "nmcli", &["radio", "wifi"]).await?.trim() == "enabled";
    let bluetooth = bluetooth_powered(runner).await.unwrap_or(false);
    Ok(!wifi && !bluetooth)
}

pub async fn set_airplane_mode(runner: &dyn CommandRunner, enabled: bool) -> Result<()> {
    run_checked(runner, "nmcli", &["radio", "all", if enabled { "off" } else { "on" }]).await?;
    set_bluetooth(runner, !enabled).await
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
    use crate::{CommandOutput, MockRunner};

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

    const SCAN: &str = r" :bleural:100:WPA2
 ::99:WPA2
 :bleural:89:WPA2
*:MyOptimum 92904f:87:WPA2
 :MyOptimum 92904f:85:WPA2
 :Cafe\:Guest:40:
";

    #[test]
    fn parses_and_merges_a_scan() {
        let networks = parse_wifi_list(SCAN, &["Cafe:Guest".to_string()]);
        let names: Vec<_> = networks.iter().map(|n| n.ssid.as_str()).collect();
        assert_eq!(names, ["MyOptimum 92904f", "bleural", "Cafe:Guest"]);
        assert!(networks[0].in_use);
        assert_eq!(networks[1].signal, 100);
        assert_eq!(networks[2].security, "");
        assert!(networks[2].saved);
    }

    #[test]
    fn finds_saved_wifi_connections() {
        let out = "MyOptimum 92904f:802-11-wireless\nlo:loopback\nwaydroid0:bridge\n";
        assert_eq!(parse_saved_wifi(out), vec!["MyOptimum 92904f"]);
    }

    #[test]
    fn parses_devices() {
        let out = "GENERAL.DEVICE:wlan0\nGENERAL.TYPE:wifi\nGENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:Home\nGENERAL.HWADDR:C8:94:02:06:75:D3\nIP4.ADDRESS[1]:192.168.1.20/24\nIP4.GATEWAY:192.168.1.1\nIP4.DNS[1]:192.168.1.1\n\nGENERAL.DEVICE:lo\nGENERAL.TYPE:loopback\nGENERAL.STATE:100 (connected (externally))\n";
        let devices = parse_device_show(out);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].state, "connected");
        assert_eq!(devices[0].mac, "C8:94:02:06:75:D3");
        assert_eq!(devices[0].ipv4, ["192.168.1.20/24"]);
    }

    #[tokio::test]
    async fn saved_networks_reconnect_without_a_password() {
        let runner = MockRunner::new();
        runner.respond(CommandOutput::ok("Home:802-11-wireless\n"));
        connect_wifi(&runner, "Home", None).await.unwrap();
        assert_eq!(runner.calls()[1], ["nmcli", "connection", "up", "id", "Home"]);

        let runner = MockRunner::new();
        runner.respond(CommandOutput::ok(""));
        connect_wifi(&runner, "New", Some("hunter22")).await.unwrap();
        assert_eq!(runner.calls()[1], ["nmcli", "device", "wifi", "connect", "New", "password", "hunter22"]);
        assert!(connect_wifi(&runner, "", None).await.is_err());
    }

    #[test]
    fn reads_bluetooth_power() {
        assert!(parse_bluetooth_powered("Controller 00:11\n\tPowered: yes\n"));
        assert!(!parse_bluetooth_powered("\tPowered: no\n"));
    }
}

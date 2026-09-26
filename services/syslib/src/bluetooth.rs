//! Bluetooth devices through `bluetoothctl` (BlueZ). Power on and off lives in
//! [`crate::network`] next to the other radios.

use crate::runner::{run_checked, CommandRunner};
use crate::{Result, SysError};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct BluetoothDevice {
    pub address: String,
    pub name: String,
    /// freedesktop icon name BlueZ reports, e.g. "audio-headset", "input-mouse".
    pub icon: String,
    pub paired: bool,
    pub connected: bool,
    pub trusted: bool,
    pub battery: Option<u32>,
}

/// Addresses look like "AA:BB:CC:DD:EE:FF". Anything else is rejected before it reaches
/// bluetoothctl.
pub fn valid_address(address: &str) -> bool {
    let parts: Vec<&str> = address.split(':').collect();
    parts.len() == 6 && parts.iter().all(|p| p.len() == 2 && p.chars().all(|c| c.is_ascii_hexdigit()))
}

fn check_address(address: &str) -> Result<()> {
    if valid_address(address) {
        Ok(())
    } else {
        Err(SysError::Invalid(format!("not a Bluetooth address: {address}")))
    }
}

/// Parse `bluetoothctl devices`: "Device AA:BB:CC:DD:EE:FF Name with spaces".
pub fn parse_devices(output: &str) -> Vec<(String, String)> {
    output
        .lines()
        .filter_map(|line| {
            let rest = line.trim().strip_prefix("Device ")?;
            let (address, name) = rest.split_once(' ').unwrap_or((rest, rest));
            valid_address(address).then(|| (address.to_string(), name.trim().to_string()))
        })
        .collect()
}

/// Parse `bluetoothctl info <address>`.
pub fn parse_info(address: &str, fallback_name: &str, output: &str) -> BluetoothDevice {
    let mut device = BluetoothDevice {
        address: address.to_string(),
        name: fallback_name.to_string(),
        icon: String::new(),
        paired: false,
        connected: false,
        trusted: false,
        battery: None,
    };
    for line in output.lines() {
        let Some((key, value)) = line.trim().split_once(": ") else { continue };
        let value = value.trim();
        match key {
            "Alias" => device.name = value.to_string(),
            "Icon" => device.icon = value.to_string(),
            "Paired" => device.paired = value == "yes",
            "Connected" => device.connected = value == "yes",
            "Trusted" => device.trusted = value == "yes",
            // "Battery Percentage: 0x5a (90)"
            "Battery Percentage" => {
                device.battery = value.split_once('(').and_then(|(_, n)| n.trim_end_matches(')').parse().ok());
            }
            _ => {}
        }
    }
    device
}

/// Every device BlueZ knows (paired, and anything seen by a recent scan), connected first,
/// then paired, then by name.
pub async fn devices(runner: &dyn CommandRunner) -> Result<Vec<BluetoothDevice>> {
    let out = run_checked(runner, "bluetoothctl", &["devices"]).await?;
    let mut devices = Vec::new();
    for (address, name) in parse_devices(&out) {
        let info = run_checked(runner, "bluetoothctl", &["info", &address]).await.unwrap_or_default();
        devices.push(parse_info(&address, &name, &info));
    }
    devices.sort_by(|a, b| {
        b.connected.cmp(&a.connected).then(b.paired.cmp(&a.paired)).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(devices)
}

/// Discover nearby devices for `seconds`, then list everything.
pub async fn scan(runner: &dyn CommandRunner, seconds: u32) -> Result<Vec<BluetoothDevice>> {
    let seconds = seconds.clamp(1, 30).to_string();
    // `scan on` exits non-zero when the timeout stops it, so the status is ignored.
    let args: Vec<String> = ["--timeout", &seconds, "scan", "on"].iter().map(|s| s.to_string()).collect();
    runner.run("bluetoothctl", &args).await?;
    devices(runner).await
}

/// Pair, trust (so it reconnects on its own), and connect.
pub async fn pair(runner: &dyn CommandRunner, address: &str) -> Result<()> {
    check_address(address)?;
    run_checked(runner, "bluetoothctl", &["--timeout", "25", "pair", address]).await?;
    run_checked(runner, "bluetoothctl", &["trust", address]).await?;
    connect(runner, address).await
}

pub async fn connect(runner: &dyn CommandRunner, address: &str) -> Result<()> {
    check_address(address)?;
    run_checked(runner, "bluetoothctl", &["--timeout", "15", "connect", address]).await.map(|_| ())
}

pub async fn disconnect(runner: &dyn CommandRunner, address: &str) -> Result<()> {
    check_address(address)?;
    run_checked(runner, "bluetoothctl", &["disconnect", address]).await.map(|_| ())
}

/// Unpair and forget.
pub async fn remove(runner: &dyn CommandRunner, address: &str) -> Result<()> {
    check_address(address)?;
    run_checked(runner, "bluetoothctl", &["remove", address]).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CommandOutput, MockRunner};

    const INFO: &str = "Device 11:22:33:44:55:66 (public)
\tName: WH-1000XM4
\tAlias: Headphones
\tClass: 0x00240404
\tIcon: audio-headset
\tPaired: yes
\tTrusted: yes
\tBlocked: no
\tConnected: yes
\tBattery Percentage: 0x5a (90)
";

    #[test]
    fn validates_addresses() {
        assert!(valid_address("C8:94:02:06:75:D4"));
        assert!(!valid_address("C8:94:02:06:75"));
        assert!(!valid_address("C8:94:02:06:75:D4; rm"));
    }

    #[test]
    fn parses_device_lists() {
        let out = "Device 11:22:33:44:55:66 WH-1000XM4\nDevice AA:BB:CC:DD:EE:FF Magic Mouse 2\ngarbage\n";
        assert_eq!(
            parse_devices(out),
            vec![("11:22:33:44:55:66".into(), "WH-1000XM4".into()), ("AA:BB:CC:DD:EE:FF".into(), "Magic Mouse 2".into())]
        );
    }

    #[test]
    fn parses_device_info() {
        let device = parse_info("11:22:33:44:55:66", "WH-1000XM4", INFO);
        assert_eq!(device.name, "Headphones");
        assert_eq!(device.icon, "audio-headset");
        assert!(device.paired && device.connected && device.trusted);
        assert_eq!(device.battery, Some(90));
    }

    #[tokio::test]
    async fn lists_connected_devices_first() {
        let runner = MockRunner::new();
        runner
            .respond(CommandOutput::ok("Device AA:BB:CC:DD:EE:FF Mouse\nDevice 11:22:33:44:55:66 WH-1000XM4\n"))
            .respond(CommandOutput::ok("\tPaired: no\n"))
            .respond(CommandOutput::ok(INFO));
        let list = devices(&runner).await.unwrap();
        assert_eq!(list[0].name, "Headphones");
        assert_eq!(list[1].name, "Mouse");
    }

    #[tokio::test]
    async fn pairing_trusts_and_connects() {
        let runner = MockRunner::new();
        pair(&runner, "11:22:33:44:55:66").await.unwrap();
        let calls = runner.calls();
        assert_eq!(calls[1], ["bluetoothctl", "trust", "11:22:33:44:55:66"]);
        assert_eq!(calls[2][3], "connect");
        assert!(pair(&runner, "nope").await.is_err());
    }
}

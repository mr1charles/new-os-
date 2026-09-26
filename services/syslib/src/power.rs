//! Battery (from sysfs), locking, and sleep.

use std::path::Path;

use crate::runner::{run_checked, CommandRunner};
use crate::Result;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct BatteryStatus {
    pub percent: u32,
    /// "Charging", "Discharging", "Full", "Not charging", ...
    pub state: String,
    pub charging: bool,
}

/// Read the first battery under `power_supply_dir` (normally /sys/class/power_supply).
pub fn read_battery(power_supply_dir: &Path) -> Option<BatteryStatus> {
    let mut entries: Vec<_> = std::fs::read_dir(power_supply_dir).ok()?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let dir = entry.path();
        let kind = std::fs::read_to_string(dir.join("type")).unwrap_or_default();
        if kind.trim() != "Battery" {
            continue;
        }
        let percent = std::fs::read_to_string(dir.join("capacity")).ok()?.trim().parse().ok()?;
        let state = std::fs::read_to_string(dir.join("status")).unwrap_or_default().trim().to_string();
        let charging = state == "Charging" || state == "Full";
        return Some(BatteryStatus { percent, state, charging });
    }
    None
}

pub fn battery() -> Option<BatteryStatus> {
    read_battery(Path::new("/sys/class/power_supply"))
}

pub async fn lock_screen(runner: &dyn CommandRunner) -> Result<()> {
    run_checked(runner, "loginctl", &["lock-session"]).await.map(|_| ())
}

pub async fn suspend(runner: &dyn CommandRunner) -> Result<()> {
    run_checked(runner, "systemctl", &["suspend"]).await.map(|_| ())
}

/// power-profiles-daemon profiles, most economical first.
pub const POWER_PROFILES: [&str; 3] = ["power-saver", "balanced", "performance"];

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PowerProfiles {
    pub active: String,
    pub available: Vec<String>,
}

/// Parse `powerprofilesctl list`: profile headers end with ':' and the active one starts
/// with '*'.
pub fn parse_power_profiles(output: &str) -> PowerProfiles {
    let mut profiles = PowerProfiles { active: String::new(), available: Vec::new() };
    for line in output.lines() {
        let trimmed = line.trim();
        let (active, name) = match trimmed.strip_prefix('*') {
            Some(rest) => (true, rest.trim()),
            None => (false, trimmed),
        };
        let Some(name) = name.strip_suffix(':') else { continue };
        if !POWER_PROFILES.contains(&name) {
            continue;
        }
        if active {
            profiles.active = name.to_string();
        }
        profiles.available.push(name.to_string());
    }
    profiles.available.sort_by_key(|p| POWER_PROFILES.iter().position(|k| k == p));
    profiles
}

pub async fn power_profiles(runner: &dyn CommandRunner) -> Result<PowerProfiles> {
    let out = run_checked(runner, "powerprofilesctl", &["list"]).await?;
    Ok(parse_power_profiles(&out))
}

pub async fn set_power_profile(runner: &dyn CommandRunner, profile: &str) -> Result<()> {
    if !POWER_PROFILES.contains(&profile) {
        return Err(crate::SysError::Invalid(format!("unknown power profile: {profile}")));
    }
    run_checked(runner, "powerprofilesctl", &["set", profile]).await.map(|_| ())
}

/// Battery health and details for Settings → Battery. Missing values are `None`.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct BatteryDetails {
    pub percent: Option<u32>,
    pub state: String,
    /// Full-charge capacity as a percentage of the design capacity.
    pub health: Option<u32>,
    pub cycle_count: Option<u32>,
    /// Current draw (discharging) or charge rate, in watts.
    pub power_watts: Option<f64>,
    pub on_ac: bool,
}

fn read_number(dir: &Path, name: &str) -> Option<f64> {
    std::fs::read_to_string(dir.join(name)).ok()?.trim().parse().ok()
}

/// Read battery details from sysfs. Batteries report either energy (µWh) or charge (µAh).
pub fn read_battery_details(power_supply_dir: &Path) -> Option<BatteryDetails> {
    let mut details = BatteryDetails::default();
    let mut found = false;
    let mut entries: Vec<_> = std::fs::read_dir(power_supply_dir).ok()?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let dir = entry.path();
        let kind = std::fs::read_to_string(dir.join("type")).unwrap_or_default();
        match kind.trim() {
            "Mains" => details.on_ac |= read_number(&dir, "online") == Some(1.0),
            "Battery" if !found => {
                found = true;
                details.percent = read_number(&dir, "capacity").map(|v| v as u32);
                details.state = std::fs::read_to_string(dir.join("status")).unwrap_or_default().trim().to_string();
                details.cycle_count = read_number(&dir, "cycle_count").filter(|c| *c > 0.0).map(|c| c as u32);
                let full = read_number(&dir, "energy_full").or_else(|| read_number(&dir, "charge_full"));
                let design = read_number(&dir, "energy_full_design").or_else(|| read_number(&dir, "charge_full_design"));
                if let (Some(full), Some(design)) = (full, design) {
                    if design > 0.0 {
                        details.health = Some(((full / design) * 100.0).round().min(100.0) as u32);
                    }
                }
                details.power_watts = read_number(&dir, "power_now").map(|uw| uw / 1_000_000.0).or_else(|| {
                    let amps = read_number(&dir, "current_now")? / 1_000_000.0;
                    let volts = read_number(&dir, "voltage_now")? / 1_000_000.0;
                    Some(amps * volts)
                });
            }
            _ => {}
        }
    }
    found.then_some(details)
}

pub fn battery_details() -> Option<BatteryDetails> {
    read_battery_details(Path::new("/sys/class/power_supply"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_power_profiles() {
        let out = "* performance:\n    CpuDriver:\tintel_pstate\n    Degraded:   no\n\n  balanced:\n    CpuDriver:\tintel_pstate\n\n  power-saver:\n    CpuDriver:\tintel_pstate\n";
        let profiles = parse_power_profiles(out);
        assert_eq!(profiles.active, "performance");
        assert_eq!(profiles.available, ["power-saver", "balanced", "performance"]);
    }

    #[test]
    fn reads_battery_health() {
        let dir = tempfile::tempdir().unwrap();
        let ac = dir.path().join("ADP1");
        std::fs::create_dir(&ac).unwrap();
        std::fs::write(ac.join("type"), "Mains\n").unwrap();
        std::fs::write(ac.join("online"), "1\n").unwrap();
        let bat = dir.path().join("BAT0");
        std::fs::create_dir(&bat).unwrap();
        for (name, value) in [
            ("type", "Battery"),
            ("capacity", "80"),
            ("status", "Charging"),
            ("charge_full", "3000000"),
            ("charge_full_design", "3470000"),
            ("current_now", "1000000"),
            ("voltage_now", "12000000"),
            ("cycle_count", "0"),
        ] {
            std::fs::write(bat.join(name), format!("{value}\n")).unwrap();
        }
        let details = read_battery_details(dir.path()).unwrap();
        assert_eq!(details.health, Some(86));
        assert_eq!(details.power_watts, Some(12.0));
        assert_eq!(details.cycle_count, None);
        assert!(details.on_ac);
    }

    #[test]
    fn reads_a_battery_from_sysfs() {
        let dir = tempfile::tempdir().unwrap();
        let ac = dir.path().join("AC");
        std::fs::create_dir(&ac).unwrap();
        std::fs::write(ac.join("type"), "Mains\n").unwrap();
        let bat = dir.path().join("BAT0");
        std::fs::create_dir(&bat).unwrap();
        std::fs::write(bat.join("type"), "Battery\n").unwrap();
        std::fs::write(bat.join("capacity"), "57\n").unwrap();
        std::fs::write(bat.join("status"), "Discharging\n").unwrap();
        assert_eq!(read_battery(dir.path()), Some(BatteryStatus { percent: 57, state: "Discharging".into(), charging: false }));
    }

    #[test]
    fn no_battery_on_desktops() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_battery(dir.path()), None);
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

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

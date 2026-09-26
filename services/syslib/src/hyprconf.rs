//! Hyprland settings the Settings app changes: applied live with `hyprctl keyword` and kept in
//! `~/.config/newos/hyprland-settings.conf`, which the session config sources after the NewOS
//! defaults. Only allowlisted options can be written, each with a typed value check, so the
//! file can never gain an `exec` or a malformed line.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::runner::{run_checked, CommandRunner};
use crate::{Result, SysError};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Bool,
    Int {
        min: i64,
        max: i64,
    },
    Float {
        min: f64,
        max: f64,
    },
    /// Keyboard layout names and options: lowercase letters, digits, and `_ , : ( )`.
    Layout,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OptionSpec {
    pub key: &'static str,
    pub kind: Kind,
}

pub const OPTIONS: &[OptionSpec] = &[
    OptionSpec { key: "input:touchpad:natural_scroll", kind: Kind::Bool },
    OptionSpec { key: "input:touchpad:tap-to-click", kind: Kind::Bool },
    OptionSpec { key: "input:touchpad:clickfinger_behavior", kind: Kind::Bool },
    OptionSpec { key: "input:touchpad:disable_while_typing", kind: Kind::Bool },
    OptionSpec { key: "input:touchpad:drag_lock", kind: Kind::Bool },
    OptionSpec { key: "input:touchpad:scroll_factor", kind: Kind::Float { min: 0.1, max: 3.0 } },
    OptionSpec { key: "input:natural_scroll", kind: Kind::Bool },
    OptionSpec { key: "input:sensitivity", kind: Kind::Float { min: -1.0, max: 1.0 } },
    OptionSpec { key: "input:repeat_rate", kind: Kind::Int { min: 1, max: 100 } },
    OptionSpec { key: "input:repeat_delay", kind: Kind::Int { min: 100, max: 2000 } },
    OptionSpec { key: "input:numlock_by_default", kind: Kind::Bool },
    OptionSpec { key: "input:kb_layout", kind: Kind::Layout },
    OptionSpec { key: "input:kb_variant", kind: Kind::Layout },
    OptionSpec { key: "input:kb_options", kind: Kind::Layout },
    OptionSpec { key: "misc:key_press_enables_dpms", kind: Kind::Bool },
];

pub fn spec(key: &str) -> Option<&'static OptionSpec> {
    OPTIONS.iter().find(|s| s.key == key)
}

/// Check a value against its option and return it in the form Hyprland's config expects.
pub fn normalize(key: &str, value: &str) -> Result<String> {
    let spec = spec(key).ok_or_else(|| SysError::Invalid(format!("not a setting NewOS manages: {key}")))?;
    let value = value.trim();
    let invalid = || SysError::Invalid(format!("invalid value for {key}: {value:?}"));
    match spec.kind {
        Kind::Bool => match value {
            "true" | "1" | "yes" | "on" => Ok("true".into()),
            "false" | "0" | "no" | "off" => Ok("false".into()),
            _ => Err(invalid()),
        },
        Kind::Int { min, max } => {
            let n: i64 = value.parse().map_err(|_| invalid())?;
            if (min..=max).contains(&n) {
                Ok(n.to_string())
            } else {
                Err(invalid())
            }
        }
        Kind::Float { min, max } => {
            let n: f64 = value.parse().map_err(|_| invalid())?;
            if n.is_finite() && (min..=max).contains(&n) {
                Ok(format!("{n:.3}").trim_end_matches('0').trim_end_matches('.').to_string())
            } else {
                Err(invalid())
            }
        }
        Kind::Layout => {
            if value.len() <= 128 && value.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "_,:()-".contains(c)) {
                Ok(value.to_string())
            } else {
                Err(invalid())
            }
        }
    }
}

/// The managed file's contents: options and monitor lines (keyed by monitor name).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HyprSettings {
    pub options: BTreeMap<String, String>,
    pub monitors: BTreeMap<String, String>,
}

impl HyprSettings {
    /// Lines that are not a known option or a monitor are dropped, so a stray edit cannot
    /// survive the next save.
    pub fn parse(text: &str) -> Self {
        let mut settings = Self::default();
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else { continue };
            let (key, value) = (key.trim(), value.trim());
            if key == "monitor" {
                if let Some(name) = value.split(',').next().filter(|n| !n.is_empty()) {
                    settings.monitors.insert(name.to_string(), value.to_string());
                }
            } else if let Ok(value) = normalize(key, value) {
                settings.options.insert(key.to_string(), value);
            }
        }
        settings
    }

    pub fn render(&self) -> String {
        let mut text = String::from("# Written by NewOS Settings. Changes here are overwritten; use hyprland-user.conf instead.\n");
        for line in self.monitors.values() {
            text.push_str(&format!("monitor = {line}\n"));
        }
        for (key, value) in &self.options {
            text.push_str(&format!("{key} = {value}\n"));
        }
        text
    }

    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path).map(|t| Self::parse(&t)).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("conf.tmp");
        std::fs::write(&tmp, self.render())?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }
}

/// `~/.config/newos/hyprland-settings.conf`.
pub fn default_path() -> PathBuf {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));
    config.join("newos").join("hyprland-settings.conf")
}

/// Apply an option now and remember it.
pub async fn set_option(runner: &dyn CommandRunner, path: &Path, key: &str, value: &str) -> Result<String> {
    let value = normalize(key, value)?;
    run_checked(runner, "hyprctl", &["keyword", key, &value]).await?;
    let mut settings = HyprSettings::load(path);
    settings.options.insert(key.to_string(), value.clone());
    settings.save(path)?;
    Ok(value)
}

/// Remember a monitor line that [`crate::display::apply_monitor`] applied.
pub fn save_monitor(path: &Path, name: &str, line: &str) -> Result<()> {
    let mut settings = HyprSettings::load(path);
    settings.monitors.insert(name.to_string(), line.to_string());
    settings.save(path)
}

/// Read an option's current value from the running compositor.
/// `hyprctl getoption <key> -j` answers with one of "int", "float", "str", "bool", or
/// "custom" next to "option".
pub fn parse_getoption(json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    for field in ["bool", "int", "float", "str", "custom"] {
        match value.get(field) {
            Some(serde_json::Value::Bool(b)) => return Some(b.to_string()),
            Some(serde_json::Value::Number(n)) => return Some(n.to_string()),
            Some(serde_json::Value::String(s)) => return Some(if s == "[[EMPTY]]" { String::new() } else { s.trim().to_string() }),
            _ => {}
        }
    }
    None
}

pub async fn get_option(runner: &dyn CommandRunner, key: &str) -> Result<String> {
    spec(key).ok_or_else(|| SysError::Invalid(format!("not a setting NewOS manages: {key}")))?;
    let out = run_checked(runner, "hyprctl", &["getoption", key, "-j"]).await?;
    let raw = parse_getoption(&out).ok_or(SysError::Parse { program: "hyprctl".into(), output: out })?;
    // Hyprland reports booleans as ints (0/1) on some versions.
    Ok(normalize(key, &raw).unwrap_or(raw))
}

/// Every managed option's live value. Options the compositor does not know are skipped.
pub async fn get_options(runner: &dyn CommandRunner) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    for spec in OPTIONS {
        if let Ok(value) = get_option(runner, spec.key).await {
            values.insert(spec.key.to_string(), value);
        }
    }
    values
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CommandOutput, MockRunner};

    #[test]
    fn validates_values() {
        assert_eq!(normalize("input:touchpad:natural_scroll", "1").unwrap(), "true");
        assert_eq!(normalize("input:repeat_rate", "35").unwrap(), "35");
        assert_eq!(normalize("input:sensitivity", "-0.25").unwrap(), "-0.25");
        assert_eq!(normalize("input:kb_layout", "us,de").unwrap(), "us,de");
        assert!(normalize("input:repeat_rate", "9000").is_err());
        assert!(normalize("input:kb_layout", "us\nexec = rm -rf ~").is_err());
        assert!(normalize("exec-once", "true").is_err());
    }

    #[test]
    fn round_trips_the_file_and_drops_unknown_lines() {
        let text = "# comment\nmonitor = eDP-1,1920x1080@60,0x0,1.25\ninput:repeat_rate = 40\nexec-once = evil\ninput:kb_layout = us\n";
        let settings = HyprSettings::parse(text);
        assert_eq!(settings.options.len(), 2);
        assert_eq!(settings.monitors["eDP-1"], "eDP-1,1920x1080@60,0x0,1.25");
        let rendered = settings.render();
        assert!(!rendered.contains("exec"));
        assert_eq!(HyprSettings::parse(&rendered), settings);
    }

    #[test]
    fn reads_getoption_json() {
        assert_eq!(parse_getoption(r#"{"option": "input:touchpad:natural_scroll", "bool": false, "set": false }"#).unwrap(), "false");
        assert_eq!(parse_getoption(r#"{"option": "input:repeat_rate", "int": 25, "set": false}"#).unwrap(), "25");
        assert_eq!(parse_getoption(r#"{"option": "input:kb_layout", "str": "us", "set": true}"#).unwrap(), "us");
        assert_eq!(parse_getoption(r#"{"option": "input:kb_options", "str": "[[EMPTY]]", "set": false}"#).unwrap(), "");
    }

    #[tokio::test]
    async fn applies_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("newos/hyprland-settings.conf");
        let runner = MockRunner::new();
        runner.respond(CommandOutput::ok("ok"));
        set_option(&runner, &path, "input:touchpad:tap-to-click", "on").await.unwrap();
        assert_eq!(runner.calls()[0], ["hyprctl", "keyword", "input:touchpad:tap-to-click", "true"]);
        save_monitor(&path, "eDP-1", "eDP-1,preferred,0x0,1").unwrap();
        let saved = std::fs::read_to_string(&path).unwrap();
        assert!(saved.contains("input:touchpad:tap-to-click = true\n"));
        assert!(saved.contains("monitor = eDP-1,preferred,0x0,1\n"));
    }
}

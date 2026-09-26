//! Screen brightness through `brightnessctl` (works without root via logind), and monitors
//! through Hyprland.

use crate::runner::{run_checked, CommandRunner};
use crate::{to_percent, Result, SysError};

/// Parse `brightnessctl --machine-readable info`:
/// "intel_backlight,backlight,12000,50%,24000" -> 0.5
pub fn parse_brightness(output: &str) -> Option<f64> {
    let line = output.lines().find(|l| l.contains(",backlight,"))?;
    let fields: Vec<&str> = line.trim().split(',').collect();
    let current: f64 = fields.get(2)?.parse().ok()?;
    let max: f64 = fields.get(4)?.parse().ok()?;
    if max <= 0.0 {
        return None;
    }
    Some((current / max).clamp(0.0, 1.0))
}

pub async fn get_brightness(runner: &dyn CommandRunner) -> Result<f64> {
    let out = run_checked(runner, "brightnessctl", &["--class=backlight", "--machine-readable", "info"]).await?;
    parse_brightness(&out).ok_or(SysError::Parse { program: "brightnessctl".into(), output: out })
}

/// Never goes below 1% so the screen stays readable.
pub async fn set_brightness(runner: &dyn CommandRunner, fraction: f64) -> Result<f64> {
    let percent = format!("{}%", to_percent(fraction).max(1));
    run_checked(runner, "brightnessctl", &["--class=backlight", "--quiet", "set", &percent]).await?;
    get_brightness(runner).await
}

/// A connected screen as `hyprctl monitors all -j` reports it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
/// Read in hyprctl's camelCase, written in snake_case like every other syslib type.
#[serde(rename_all(deserialize = "camelCase"))]
pub struct Monitor {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub width: u32,
    pub height: u32,
    pub refresh_rate: f64,
    pub x: i32,
    pub y: i32,
    pub scale: f64,
    #[serde(default)]
    pub transform: u8,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub focused: bool,
    /// Physical size in millimetres (0 when unknown).
    #[serde(default)]
    pub physical_width: u32,
    #[serde(default)]
    pub physical_height: u32,
    /// "1920x1080@60.00Hz"
    #[serde(default)]
    pub available_modes: Vec<String>,
}

impl Monitor {
    /// Built-in laptop panels are eDP (or LVDS/DSI on older and ARM machines).
    pub fn is_builtin(&self) -> bool {
        ["eDP", "LVDS", "DSI"].iter().any(|p| self.name.starts_with(p))
    }
}

pub fn parse_monitors(json: &str) -> Result<Vec<Monitor>> {
    serde_json::from_str(json).map_err(|_| SysError::Parse { program: "hyprctl".into(), output: json.chars().take(200).collect() })
}

pub async fn monitors(runner: &dyn CommandRunner) -> Result<Vec<Monitor>> {
    let out = run_checked(runner, "hyprctl", &["monitors", "all", "-j"]).await?;
    parse_monitors(&out)
}

/// What the user picks for one monitor in Settings → Displays.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MonitorSetup {
    pub name: String,
    /// "1920x1080@60.00" or "preferred".
    pub mode: String,
    pub x: i32,
    pub y: i32,
    pub scale: f64,
    #[serde(default)]
    pub transform: u8,
    #[serde(default)]
    pub disabled: bool,
}

/// Scales Hyprland accepts without blurry fractional rounding on common panels.
pub const SCALES: [f64; 7] = [1.0, 1.25, 1.333333, 1.5, 1.666667, 1.75, 2.0];

fn valid_monitor_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn valid_mode(mode: &str) -> bool {
    if mode == "preferred" || mode == "highres" || mode == "highrr" {
        return true;
    }
    let (size, rate) = mode.split_once('@').unwrap_or((mode, "60"));
    let dims: Vec<&str> = size.split('x').collect();
    dims.len() == 2 && dims.iter().all(|d| d.parse::<u32>().is_ok()) && rate.trim_end_matches("Hz").parse::<f64>().is_ok()
}

impl MonitorSetup {
    /// The value of a Hyprland `monitor =` line, e.g. "eDP-1,1920x1080@60.00,0x0,1.25".
    pub fn to_hyprland(&self) -> Result<String> {
        if !valid_monitor_name(&self.name) {
            return Err(SysError::Invalid(format!("not a monitor name: {}", self.name)));
        }
        if self.disabled {
            return Ok(format!("{},disable", self.name));
        }
        let mode = self.mode.trim_end_matches("Hz");
        if !valid_mode(mode) {
            return Err(SysError::Invalid(format!("not a display mode: {}", self.mode)));
        }
        if !(0.25..=4.0).contains(&self.scale) {
            return Err(SysError::Invalid(format!("scale out of range: {}", self.scale)));
        }
        let scale = format!("{:.6}", self.scale).trim_end_matches('0').trim_end_matches('.').to_string();
        let mut line = format!("{},{},{}x{},{}", self.name, mode, self.x, self.y, scale);
        if self.transform > 0 {
            if self.transform > 7 {
                return Err(SysError::Invalid(format!("transform out of range: {}", self.transform)));
            }
            line.push_str(&format!(",transform,{}", self.transform));
        }
        Ok(line)
    }
}

/// Apply a monitor layout now. Persisting it is [`crate::hyprconf`]'s job.
pub async fn apply_monitor(runner: &dyn CommandRunner, setup: &MonitorSetup) -> Result<String> {
    let line = setup.to_hyprland()?;
    run_checked(runner, "hyprctl", &["keyword", "monitor", &line]).await?;
    Ok(line)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITORS: &str = r#"[{"id":0,"name":"eDP-1","description":"Chimei Innolux Corporation 0x14D4","make":"Chimei Innolux Corporation",
      "width":1920,"height":1080,"physicalWidth":310,"physicalHeight":170,"refreshRate":60.00000,"x":0,"y":0,
      "activeWorkspace":{"id":4,"name":"4"},"reserved":[0,35,0,0],"scale":1,"transform":0,"focused":true,"disabled":false,
      "availableModes":["1920x1080@60.00Hz"]}]"#;

    #[test]
    fn parses_monitors() {
        let monitors = parse_monitors(MONITORS).unwrap();
        assert_eq!(monitors[0].name, "eDP-1");
        assert!(monitors[0].is_builtin());
        assert_eq!(monitors[0].available_modes, ["1920x1080@60.00Hz"]);
    }

    #[test]
    fn builds_monitor_lines() {
        let mut setup =
            MonitorSetup { name: "eDP-1".into(), mode: "1920x1080@60.00Hz".into(), x: 0, y: 0, scale: 1.25, transform: 0, disabled: false };
        assert_eq!(setup.to_hyprland().unwrap(), "eDP-1,1920x1080@60.00,0x0,1.25");
        setup.scale = 1.0;
        setup.transform = 1;
        assert_eq!(setup.to_hyprland().unwrap(), "eDP-1,1920x1080@60.00,0x0,1,transform,1");
        setup.mode = "1920x1080; exec rm".into();
        assert!(setup.to_hyprland().is_err());
        setup.mode = "preferred".into();
        setup.name = "eDP-1,foo".into();
        assert!(setup.to_hyprland().is_err());
    }

    #[test]
    fn parses_machine_readable_info() {
        assert_eq!(parse_brightness("intel_backlight,backlight,12000,50%,24000\n"), Some(0.5));
        assert_eq!(parse_brightness("kbd,leds,1,33%,3\nacpi_video0,backlight,10,100%,10"), Some(1.0));
        assert_eq!(parse_brightness("nothing here"), None);
        assert_eq!(parse_brightness("x,backlight,1,0%,0"), None);
    }
}

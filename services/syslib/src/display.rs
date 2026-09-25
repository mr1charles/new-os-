//! Screen brightness through `brightnessctl` (works without root via logind).

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_machine_readable_info() {
        assert_eq!(parse_brightness("intel_backlight,backlight,12000,50%,24000\n"), Some(0.5));
        assert_eq!(parse_brightness("kbd,leds,1,33%,3\nacpi_video0,backlight,10,100%,10"), Some(1.0));
        assert_eq!(parse_brightness("nothing here"), None);
        assert_eq!(parse_brightness("x,backlight,1,0%,0"), None);
    }
}

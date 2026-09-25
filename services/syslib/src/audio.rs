//! Output volume through WirePlumber's `wpctl`.

use crate::runner::{run_checked, CommandRunner};
use crate::{to_percent, Result, SysError};

const SINK: &str = "@DEFAULT_AUDIO_SINK@";

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Volume {
    /// 0.0 - 1.0 (wpctl can report above 1.0 when over-amplified; clamped here).
    pub level: f64,
    pub muted: bool,
}

/// Parse `wpctl get-volume` output: "Volume: 0.45" or "Volume: 0.45 [MUTED]".
pub fn parse_volume(output: &str) -> Option<Volume> {
    let rest = output.trim().strip_prefix("Volume:")?.trim();
    let mut parts = rest.split_whitespace();
    let level: f64 = parts.next()?.parse().ok()?;
    let muted = rest.contains("[MUTED]");
    Some(Volume { level: level.clamp(0.0, 1.0), muted })
}

pub async fn get_volume(runner: &dyn CommandRunner) -> Result<Volume> {
    let out = run_checked(runner, "wpctl", &["get-volume", SINK]).await?;
    parse_volume(&out).ok_or(SysError::Parse { program: "wpctl".into(), output: out })
}

pub async fn set_volume(runner: &dyn CommandRunner, fraction: f64) -> Result<Volume> {
    let percent = format!("{}%", to_percent(fraction));
    run_checked(runner, "wpctl", &["set-volume", "--limit", "1.0", SINK, &percent]).await?;
    if fraction > 0.0 {
        run_checked(runner, "wpctl", &["set-mute", SINK, "0"]).await?;
    }
    get_volume(runner).await
}

pub async fn set_mute(runner: &dyn CommandRunner, muted: bool) -> Result<Volume> {
    run_checked(runner, "wpctl", &["set-mute", SINK, if muted { "1" } else { "0" }]).await?;
    get_volume(runner).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CommandOutput, MockRunner};

    #[test]
    fn parses_wpctl_output() {
        assert_eq!(parse_volume("Volume: 0.45\n"), Some(Volume { level: 0.45, muted: false }));
        assert_eq!(parse_volume("Volume: 0.30 [MUTED]"), Some(Volume { level: 0.30, muted: true }));
        assert_eq!(parse_volume("Volume: 1.20"), Some(Volume { level: 1.0, muted: false }));
        assert_eq!(parse_volume("garbage"), None);
    }

    #[tokio::test]
    async fn sets_volume_and_unmutes() {
        let runner = MockRunner::new();
        runner.respond(CommandOutput::ok("")).respond(CommandOutput::ok("")).respond(CommandOutput::ok("Volume: 0.40"));
        let volume = set_volume(&runner, 0.4).await.unwrap();
        assert_eq!(volume.level, 0.4);
        let calls = runner.calls();
        assert_eq!(calls[0], ["wpctl", "set-volume", "--limit", "1.0", SINK, "40%"]);
        assert_eq!(calls[1], ["wpctl", "set-mute", SINK, "0"]);
    }
}

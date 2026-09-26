//! Volume and audio devices through WirePlumber's `wpctl`.

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

/// A speaker, headphone, HDMI output, or microphone.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct AudioDevice {
    /// PipeWire object id, used by `wpctl`.
    pub id: u32,
    /// Short name ("Speaker", "Digital Microphone"): the card name is removed when it prefixes
    /// the node name.
    pub name: String,
    pub is_default: bool,
    pub volume: Volume,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct AudioDevices {
    pub outputs: Vec<AudioDevice>,
    pub inputs: Vec<AudioDevice>,
}

/// Parse one tree line like " │  *   56. Speaker [vol: 0.30 MUTED]".
fn parse_node_line(line: &str) -> Option<(u32, String, bool, Option<Volume>)> {
    let line = line.trim_start_matches(|c: char| c.is_whitespace() || "│├└─".contains(c));
    let (is_default, line) = match line.strip_prefix('*') {
        Some(rest) => (true, rest.trim_start()),
        None => (false, line),
    };
    let (id, rest) = line.split_once(". ")?;
    let id: u32 = id.trim().parse().ok()?;
    let (name, volume) = match rest.rsplit_once("[vol:") {
        Some((name, vol)) => {
            let vol = vol.trim_end().trim_end_matches(']');
            let level = vol.split_whitespace().next()?.parse::<f64>().ok()?;
            (name.trim(), Some(Volume { level: level.clamp(0.0, 1.0), muted: vol.contains("MUTED") }))
        }
        None => (rest.trim(), None),
    };
    Some((id, name.to_string(), is_default, volume))
}

/// Parse the "Audio" section of `wpctl status`.
pub fn parse_status(output: &str) -> AudioDevices {
    #[derive(PartialEq)]
    enum Section {
        None,
        Devices,
        Sinks,
        Sources,
    }
    let mut in_audio = false;
    let mut section = Section::None;
    let mut cards: Vec<String> = Vec::new();
    let mut devices = AudioDevices::default();
    for line in output.lines() {
        if !line.starts_with(' ') && !line.trim().is_empty() {
            in_audio = line.trim() == "Audio";
            section = Section::None;
            continue;
        }
        if !in_audio {
            continue;
        }
        let trimmed = line.trim_start_matches(|c: char| c.is_whitespace() || "│├└─".contains(c));
        section = match trimmed.trim_end() {
            "Devices:" => Section::Devices,
            "Sinks:" => Section::Sinks,
            "Sources:" => Section::Sources,
            "Filters:" | "Streams:" => Section::None,
            _ => section,
        };
        let Some((id, name, is_default, volume)) = parse_node_line(line) else { continue };
        match section {
            Section::Devices => {
                // "500 Series ... Audio (HD Audio) [alsa]" -> drop the "[alsa]" API tag.
                let card = name.rsplit_once(" [").map(|(n, _)| n.to_string()).unwrap_or(name);
                cards.push(card);
            }
            Section::Sinks | Section::Sources => {
                let short = cards
                    .iter()
                    .find_map(|card| name.strip_prefix(card.as_str()).map(str::trim))
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&name)
                    .to_string();
                let device = AudioDevice { id, name: short, is_default, volume: volume.unwrap_or(Volume { level: 1.0, muted: false }) };
                if section == Section::Sinks {
                    devices.outputs.push(device);
                } else {
                    devices.inputs.push(device);
                }
            }
            Section::None => {}
        }
    }
    devices
}

pub async fn devices(runner: &dyn CommandRunner) -> Result<AudioDevices> {
    let out = run_checked(runner, "wpctl", &["status", "--nick"]).await?;
    Ok(parse_status(&out))
}

pub async fn set_default_device(runner: &dyn CommandRunner, id: u32) -> Result<()> {
    run_checked(runner, "wpctl", &["set-default", &id.to_string()]).await.map(|_| ())
}

/// Set the volume and mute state of one device by id.
pub async fn set_device_volume(runner: &dyn CommandRunner, id: u32, fraction: f64, muted: bool) -> Result<()> {
    let id = id.to_string();
    let percent = format!("{}%", to_percent(fraction));
    run_checked(runner, "wpctl", &["set-volume", "--limit", "1.0", &id, &percent]).await?;
    run_checked(runner, "wpctl", &["set-mute", &id, if muted { "1" } else { "0" }]).await.map(|_| ())
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

    const STATUS: &str = "PipeWire 'pipewire-0' [1.6.8, a@host, cookie:1]
 └─ Clients:
        32. WirePlumber                         [1.6.8, a@host, pid:903]

Audio
 ├─ Devices:
 │      44. 500 Series Chipset Family On-Package High Definition Audio (HD Audio) [alsa]
 │  
 ├─ Sinks:
 │      53. 500 Series Chipset Family On-Package High Definition Audio (HD Audio) HDMI / DisplayPort 3 Output [vol: 1.00]
 │  *   56. 500 Series Chipset Family On-Package High Definition Audio (HD Audio) Speaker [vol: 0.30 MUTED]
 │  
 ├─ Sources:
 │      57. 500 Series Chipset Family On-Package High Definition Audio (HD Audio) Stereo Microphone [vol: 1.00]
 │  *   58. 500 Series Chipset Family On-Package High Definition Audio (HD Audio) Digital Microphone [vol: 0.85]
 │  
 ├─ Filters:
 │  
 └─ Streams:
        70. Firefox
             71. output_FL       > Speaker:playback_FL	[active]

Video
 ├─ Devices:
 │      48. HP TrueVision HD Camera             [v4l2]
 ├─ Sources:
 │  *   81. HP TrueVision HD Camera (V4L2)
";

    #[test]
    fn parses_wpctl_status() {
        let devices = parse_status(STATUS);
        assert_eq!(devices.outputs.len(), 2);
        assert_eq!(devices.outputs[0].name, "HDMI / DisplayPort 3 Output");
        let speaker = &devices.outputs[1];
        assert_eq!((speaker.id, speaker.name.as_str(), speaker.is_default), (56, "Speaker", true));
        assert_eq!(speaker.volume, Volume { level: 0.30, muted: true });
        assert_eq!(devices.inputs.len(), 2, "video sources must not count as microphones");
        assert_eq!(devices.inputs[1].name, "Digital Microphone");
        assert!(devices.inputs[1].is_default);
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

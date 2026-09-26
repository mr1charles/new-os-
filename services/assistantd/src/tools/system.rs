use helixos_syslib::{audio, display, hyprland, network, power, shell};
use serde_json::{json, Value};

use super::{bool_arg, int_arg, object_schema, str_arg, tool, Tool, ToolContext};
use crate::providers::BoxFuture;

pub fn tools() -> Vec<Tool> {
    vec![
        tool(
            "get_system_status",
            "Get the battery level, Wi-Fi network, volume, and screen brightness. Call this when the user asks about the state of their computer, e.g. \"how much battery do I have\" or \"am I online\".",
            object_schema(json!({}), &[]),
            get_system_status,
        ),
        tool(
            "set_volume",
            "Set the speaker volume to a percentage (0-100). Call this for requests like \"turn it up\", \"volume to 30\", or \"make it quieter\"; for relative requests, read the current volume with get_system_status first.",
            object_schema(json!({"percent": {"type": "integer", "minimum": 0, "maximum": 100, "description": "Target volume in percent"}}), &["percent"]),
            set_volume,
        ),
        tool(
            "set_mute",
            "Mute or unmute the speakers.",
            object_schema(json!({"muted": {"type": "boolean"}}), &["muted"]),
            set_mute,
        ),
        tool(
            "set_brightness",
            "Set the screen brightness to a percentage (1-100). Call this for requests like \"dim the screen\" or \"brightness to max\".",
            object_schema(json!({"percent": {"type": "integer", "minimum": 1, "maximum": 100}}), &["percent"]),
            set_brightness,
        ),
        tool(
            "set_wifi",
            "Turn Wi-Fi on or off.",
            object_schema(json!({"enabled": {"type": "boolean"}}), &["enabled"]),
            set_wifi,
        ),
        tool(
            "set_bluetooth",
            "Turn Bluetooth on or off.",
            object_schema(json!({"enabled": {"type": "boolean"}}), &["enabled"]),
            set_bluetooth,
        ),
        tool(
            "set_dark_mode",
            "Switch the system appearance to dark, light, or automatic (light by day, dark at night).",
            object_schema(json!({"mode": {"type": "string", "enum": ["dark", "light", "auto"]}}), &["mode"]),
            set_dark_mode,
        ),
        tool(
            "set_do_not_disturb",
            "Turn Focus (Do Not Disturb) on or off. While on, notifications are silenced except urgent ones.",
            object_schema(json!({"enabled": {"type": "boolean"}}), &["enabled"]),
            set_do_not_disturb,
        ),
        tool(
            "change_look",
            "Change how the desktop looks and behaves, all at once, live. Use a preset for requests like \"make it look like Windows\" (preset windows), \"like a Mac\" (helix), \"black and white\" or \"clean\" (mono), \"tiling\" or \"minimal\"; use changes for specific tweaks, or both (changes apply on top of the preset). \
Settings you can change, nested by section: appearance {theme: dark|light|auto, accent: blue|purple|pink|red|orange|yellow|green|graphite, glass: clear|tinted, iconStyle: default|dark|clear|tinted, reduceTransparency: bool, startupAnimation: bool}; widgets {show: bool, items: list of weather|batteries|clock|calendar, side: left|right, city: string, fahrenheit: bool}; \
dock {position: bottom|left|right, style: dock|taskbar, iconSize: 28-72, magnification: bool, showRecents: bool}; bar {position: top|bottom, clock24h: bool, showSeconds: bool, showBatteryPercent: bool}; \
windows {layout: floating|arrange|tiling (arrange = automatic halves and quarters), rounding: 0-28, gaps: 0-40, blur: bool, animations: full|reduced|off, controls: mac|windows (window buttons left or right)}; nightShift {enabled: bool, temperature: 2500-6500}. \
Tell the user what changed and that they can say \"undo that\".",
            object_schema(
                json!({
                    "preset": {"type": "string", "enum": ["helix", "mono", "windows", "tiling", "minimal"]},
                    "changes": {"type": "object", "description": "Nested settings to change, e.g. {\"dock\": {\"position\": \"left\"}, \"windows\": {\"rounding\": 4}}"}
                }),
                &[],
            ),
            change_look,
        ),
        tool(
            "undo_look_change",
            "Undo the last change_look, putting the previous look back.",
            object_schema(json!({}), &[]),
            undo_look_change,
        ),
        tool(
            "lock_screen",
            "Lock the screen immediately. Call this when the user says \"lock my computer\" or is stepping away.",
            object_schema(json!({}), &[]),
            lock_screen,
        ),
        Tool {
            confirm: true,
            describe: |_| "Put the computer to sleep".into(),
            ..tool(
                "suspend",
                "Put the computer to sleep. The user is asked to confirm first.",
                object_schema(json!({}), &[]),
                suspend,
            )
        },
    ]
}

fn get_system_status<'a>(ctx: &'a ToolContext, _input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let runner = ctx.runner.as_ref();
        let battery = power::read_battery(&ctx.power_supply_dir);
        let (volume, brightness, wifi, bluetooth, window) = tokio::join!(
            audio::get_volume(runner),
            display::get_brightness(runner),
            network::wifi_status(runner),
            network::bluetooth_powered(runner),
            hyprland::active_window(runner),
        );
        Ok(json!({
            "battery": battery.map(|b| json!({"percent": b.percent, "state": b.state})),
            "volume": volume.ok().map(|v| json!({"percent": helixos_syslib::to_percent(v.level), "muted": v.muted})),
            "brightness_percent": brightness.ok().map(helixos_syslib::to_percent),
            "wifi": wifi.ok(),
            "bluetooth_on": bluetooth.ok(),
            "focused_window": window.ok().flatten().map(|w| json!({"app": w.class, "title": w.title})),
        })
        .to_string())
    })
}

fn set_volume<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let percent = int_arg(&input, "percent")?;
        let volume = audio::set_volume(ctx.runner.as_ref(), percent as f64 / 100.0).await?;
        Ok(format!("Volume is now {}%.", helixos_syslib::to_percent(volume.level)))
    })
}

fn set_mute<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let muted = bool_arg(&input, "muted")?;
        audio::set_mute(ctx.runner.as_ref(), muted).await?;
        Ok(if muted { "Sound muted." } else { "Sound unmuted." }.into())
    })
}

fn set_brightness<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let percent = int_arg(&input, "percent")?;
        let level = display::set_brightness(ctx.runner.as_ref(), percent as f64 / 100.0).await?;
        Ok(format!("Brightness is now {}%.", helixos_syslib::to_percent(level)))
    })
}

fn set_wifi<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let enabled = bool_arg(&input, "enabled")?;
        network::set_wifi(ctx.runner.as_ref(), enabled).await?;
        Ok(format!("Wi-Fi turned {}.", if enabled { "on" } else { "off" }))
    })
}

fn set_bluetooth<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let enabled = bool_arg(&input, "enabled")?;
        network::set_bluetooth(ctx.runner.as_ref(), enabled).await?;
        Ok(format!("Bluetooth turned {}.", if enabled { "on" } else { "off" }))
    })
}

fn set_dark_mode<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let mode = str_arg(&input, "mode")?;
        shell::shell_request(ctx.runner.as_ref(), &["theme", mode]).await?;
        Ok(format!("Appearance set to {mode}."))
    })
}

fn set_do_not_disturb<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let enabled = bool_arg(&input, "enabled")?;
        shell::shell_request(ctx.runner.as_ref(), &["dnd", if enabled { "on" } else { "off" }]).await?;
        Ok(format!("Do Not Disturb is {}.", if enabled { "on" } else { "off" }))
    })
}

fn change_look<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let runner = ctx.runner.as_ref();
        let mut changed: Vec<Value> = vec![];
        if let Some(preset) = input.get("preset").and_then(Value::as_str) {
            let out = shell::shell_request(runner, &["look", "preset", preset]).await?;
            changed.extend(parse_changes(&out)?);
        }
        if let Some(changes) = input.get("changes").filter(|c| c.as_object().is_some_and(|o| !o.is_empty())) {
            let json = serde_json::to_string(changes)?;
            let out = shell::shell_request(runner, &["look", "apply", &json]).await?;
            changed.extend(parse_changes(&out)?);
        }
        if changed.is_empty() {
            return Ok("Nothing changed: those settings already had those values, or they aren't settings that exist.".into());
        }
        Ok(format!("Changed: {}", serde_json::to_string(&changed)?))
    })
}

fn parse_changes(out: &str) -> anyhow::Result<Vec<Value>> {
    if let Some(error) = out.strip_prefix("error: ") {
        anyhow::bail!("{error}");
    }
    Ok(serde_json::from_str::<Vec<Value>>(out).unwrap_or_default())
}

fn undo_look_change<'a>(ctx: &'a ToolContext, _input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let out = shell::shell_request(ctx.runner.as_ref(), &["look", "undo"]).await?;
        let changed = parse_changes(&out)?;
        Ok(format!("Put back the previous look ({} settings).", changed.len()))
    })
}

fn lock_screen<'a>(ctx: &'a ToolContext, _input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        power::lock_screen(ctx.runner.as_ref()).await?;
        Ok("Screen locked.".into())
    })
}

fn suspend<'a>(ctx: &'a ToolContext, _input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        power::suspend(ctx.runner.as_ref()).await?;
        Ok("Going to sleep.".into())
    })
}

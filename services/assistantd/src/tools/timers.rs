//! Timers live in the shell's Dynamic Island; the daemon announces them on /v1/events.

use serde::Serialize;
use serde_json::{json, Value};

use super::{int_arg, object_schema, opt_str, str_arg, tool, Tool, ToolContext};
use crate::events::SystemEvent;
use crate::providers::BoxFuture;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TimerInfo {
    pub id: String,
    pub label: String,
    pub ends_at_ms: i64,
    pub duration_ms: i64,
}

pub fn tools() -> Vec<Tool> {
    vec![
        tool(
            "set_timer",
            "Start a countdown timer shown in the Dynamic Island; it rings when done. Call this for \"set a timer\", \"remind me in 10 minutes\", and similar.",
            object_schema(
                json!({
                    "seconds": {"type": "integer", "minimum": 1, "maximum": 86400},
                    "label": {"type": "string", "maxLength": 60, "description": "What the timer is for, e.g. \"Pasta\""},
                }),
                &["seconds"],
            ),
            set_timer,
        ),
        tool(
            "cancel_timer",
            "Cancel a running timer by its id or label.",
            object_schema(json!({"id_or_label": {"type": "string"}}), &["id_or_label"]),
            cancel_timer,
        ),
        tool("list_timers", "List running timers and how long is left on each.", object_schema(json!({}), &[]), list_timers),
    ]
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn running(ctx: &ToolContext) -> std::sync::MutexGuard<'_, Vec<TimerInfo>> {
    let mut timers = ctx.timers.lock().unwrap_or_else(|p| p.into_inner());
    let now = now_ms();
    timers.retain(|t| t.ends_at_ms > now);
    timers
}

fn set_timer<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let seconds = int_arg(&input, "seconds")?;
        let label = opt_str(&input, "label").unwrap_or_default().trim().to_string();
        let duration_ms = seconds * 1000;
        let timer = TimerInfo {
            id: format!("t{}", &uuid::Uuid::new_v4().simple().to_string()[..8]),
            label: label.clone(),
            ends_at_ms: now_ms() + duration_ms,
            duration_ms,
        };
        running(ctx).push(timer.clone());
        let _ = ctx.events.send(SystemEvent::TimerStarted {
            timer_id: timer.id.clone(),
            label: timer.label.clone(),
            ends_at_ms: timer.ends_at_ms,
            duration_ms,
        });
        let what = if label.is_empty() { String::new() } else { format!(" for {label}") };
        Ok(format!("Timer{what} set for {} (id {}).", human_duration(seconds), timer.id))
    })
}

fn cancel_timer<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let wanted = str_arg(&input, "id_or_label")?.trim().to_lowercase();
        let removed: Vec<TimerInfo> = {
            let mut timers = running(ctx);
            let (gone, keep): (Vec<_>, Vec<_>) = timers
                .drain(..)
                .partition(|t| t.id.to_lowercase() == wanted || (!wanted.is_empty() && t.label.to_lowercase().contains(&wanted)));
            *timers = keep;
            gone
        };
        anyhow::ensure!(!removed.is_empty(), "no running timer matches \"{wanted}\"");
        for timer in &removed {
            let _ = ctx.events.send(SystemEvent::TimerCancelled { timer_id: timer.id.clone() });
        }
        Ok(format!("Cancelled {} timer(s).", removed.len()))
    })
}

fn list_timers<'a>(ctx: &'a ToolContext, _input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let now = now_ms();
        let list: Vec<Value> = running(ctx)
            .iter()
            .map(|t| json!({"id": t.id, "label": t.label, "remaining": human_duration((t.ends_at_ms - now) / 1000)}))
            .collect();
        Ok(if list.is_empty() { "No timers running.".into() } else { Value::Array(list).to_string() })
    })
}

pub fn human_duration(seconds: i64) -> String {
    let seconds = seconds.max(0);
    let (h, m, s) = (seconds / 3600, (seconds % 3600) / 60, seconds % 60);
    let mut parts = Vec::new();
    if h > 0 {
        parts.push(format!("{h} hour{}", if h == 1 { "" } else { "s" }));
    }
    if m > 0 {
        parts.push(format!("{m} minute{}", if m == 1 { "" } else { "s" }));
    }
    if s > 0 || parts.is_empty() {
        parts.push(format!("{s} second{}", if s == 1 { "" } else { "s" }));
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_durations() {
        assert_eq!(human_duration(600), "10 minutes");
        assert_eq!(human_duration(3661), "1 hour 1 minute 1 second");
        assert_eq!(human_duration(0), "0 seconds");
    }
}

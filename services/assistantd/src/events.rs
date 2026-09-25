//! Events streamed to clients: per-request chat events and daemon-wide system events.

use serde::Serialize;
use serde_json::Value;

use crate::providers::ProviderKind;

/// Events on a `/v1/chat` stream. The SSE event name is the `type` tag.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatEvent {
    Start { conversation_id: String, provider: ProviderKind, model: String },
    Text { delta: String },
    ToolCall { id: String, name: String, input: Value },
    ToolResult { id: String, name: String, ok: bool, output: String },
    Confirm { request_id: String, tool: String, summary: String },
    Fallback { from: ProviderKind, to: ProviderKind, model: String, reason: String },
    Done { stop_reason: String },
    Error { message: String },
}

/// Events on `/v1/events`, broadcast to every listener (the shell follows these).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SystemEvent {
    TimerStarted { timer_id: String, label: String, ends_at_ms: i64, duration_ms: i64 },
    TimerCancelled { timer_id: String },
    ProviderChanged { provider: String, model: String },
    Notify { title: String, body: String },
}

pub trait EventName {
    fn event_name(&self) -> &'static str;
}

impl EventName for ChatEvent {
    fn event_name(&self) -> &'static str {
        match self {
            ChatEvent::Start { .. } => "start",
            ChatEvent::Text { .. } => "text",
            ChatEvent::ToolCall { .. } => "tool_call",
            ChatEvent::ToolResult { .. } => "tool_result",
            ChatEvent::Confirm { .. } => "confirm",
            ChatEvent::Fallback { .. } => "fallback",
            ChatEvent::Done { .. } => "done",
            ChatEvent::Error { .. } => "error",
        }
    }
}

impl EventName for SystemEvent {
    fn event_name(&self) -> &'static str {
        match self {
            SystemEvent::TimerStarted { .. } => "timer_started",
            SystemEvent::TimerCancelled { .. } => "timer_cancelled",
            SystemEvent::ProviderChanged { .. } => "provider_changed",
            SystemEvent::Notify { .. } => "notify",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_names_match_type_tags() {
        let events = [
            ChatEvent::Text { delta: "x".into() },
            ChatEvent::Done { stop_reason: "end_turn".into() },
            ChatEvent::Confirm { request_id: "r".into(), tool: "t".into(), summary: "s".into() },
        ];
        for event in events {
            let value = serde_json::to_value(&event).unwrap();
            assert_eq!(value["type"], event.event_name());
        }
        let timer = SystemEvent::TimerCancelled { timer_id: "t1".into() };
        assert_eq!(serde_json::to_value(&timer).unwrap()["type"], timer.event_name());
    }
}

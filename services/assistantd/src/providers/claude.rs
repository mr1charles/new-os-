//! Claude through the Anthropic Messages API (raw HTTP; there is no official Rust SDK).
//!
//! - Streams with SSE and accumulates content blocks, keeping thinking blocks verbatim so they
//!   can be replayed unchanged on the next request.
//! - Sets `eager_input_streaming` on every tool, so tool inputs stream as generated. The API
//!   then no longer validates them, so the agent parses strictly and validates against the
//!   schema before running anything.
//! - Opts into server-side refusal fallbacks (`fallbacks: "default"`), so a declined request is
//!   re-run on Anthropic's recommended fallback model inside the same call.
//! - Caches the prompt prefix with top-level automatic `cache_control`.

use std::collections::BTreeMap;

use futures::StreamExt;
use serde_json::{json, Map, Value};
use tokio::sync::mpsc::UnboundedSender;

use super::sse::{SseDecoder, SseEvent};
use super::{
    transport_error, BoxFuture, Provider, ProviderError, ProviderKind, StopReason, StreamEvent, ToolSpec, TurnOutput, TurnRequest,
};
use crate::conversation::{Block, Message, Role};

pub const API_VERSION: &str = "2023-06-01";
pub const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

#[derive(Debug, Clone)]
pub struct ClaudeSettings {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub effort: String,
    pub thinking: bool,
    pub fallbacks: bool,
}

pub struct ClaudeProvider {
    http: reqwest::Client,
    settings: ClaudeSettings,
}

impl ClaudeProvider {
    pub fn new(http: reqwest::Client, settings: ClaudeSettings) -> Self {
        Self { http, settings }
    }

    pub fn build_body(&self, request: &TurnRequest<'_>) -> Value {
        build_body(&self.settings, request)
    }
}

pub fn build_body(settings: &ClaudeSettings, request: &TurnRequest<'_>) -> Value {
    let mut body = Map::new();
    body.insert("model".into(), json!(settings.model));
    body.insert("max_tokens".into(), json!(request.max_tokens));
    body.insert("stream".into(), json!(true));
    // Automatic caching: the breakpoint lands on the last cacheable block, so the stable
    // system prompt, tools, and earlier turns are read from cache on every agent step.
    body.insert("cache_control".into(), json!({"type": "ephemeral"}));
    body.insert("system".into(), json!(request.system));
    body.insert("messages".into(), Value::Array(to_claude_messages(request.messages)));
    if !request.tools.is_empty() {
        body.insert("tools".into(), Value::Array(request.tools.iter().map(tool_definition).collect()));
    }
    if settings.thinking {
        body.insert("thinking".into(), json!({"type": "adaptive"}));
    }
    let effort = request.effort.unwrap_or(&settings.effort);
    body.insert("output_config".into(), json!({"effort": effort}));
    if settings.fallbacks {
        body.insert("fallbacks".into(), json!("default"));
    }
    Value::Object(body)
}

fn tool_definition(tool: &ToolSpec) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.input_schema,
        "eager_input_streaming": true,
    })
}

/// Convert the neutral conversation to Messages API `messages`.
pub fn to_claude_messages(messages: &[Message]) -> Vec<Value> {
    messages
        .iter()
        .filter_map(|message| {
            let content: Vec<Value> = message
                .content
                .iter()
                .filter_map(|block| match block {
                    Block::Text { text } if text.is_empty() => None,
                    Block::Text { text } => Some(json!({"type": "text", "text": text})),
                    Block::ToolUse { id, name, input } => Some(json!({"type": "tool_use", "id": id, "name": name, "input": input})),
                    Block::ToolResult { tool_use_id, content, is_error } => {
                        let mut value = json!({"type": "tool_result", "tool_use_id": tool_use_id, "content": content});
                        if *is_error {
                            value["is_error"] = json!(true);
                        }
                        Some(value)
                    }
                    Block::Raw { provider, value } if provider == "claude" => Some(value.clone()),
                    Block::Raw { .. } => None,
                })
                .collect();
            if content.is_empty() {
                return None;
            }
            let role = match message.role {
                Role::User => "user",
                Role::Assistant => "assistant",
            };
            Some(json!({"role": role, "content": content}))
        })
        .collect()
}

enum Partial {
    Text(String),
    ToolUse {
        id: String,
        name: String,
        json: String,
    },
    /// Thinking, redacted thinking, fallback markers, and anything newer: kept verbatim with
    /// deltas applied in place.
    Raw(Value),
}

/// Accumulates one streamed message. Pure, so it is tested against recorded streams.
#[derive(Default)]
pub struct StreamAccumulator {
    blocks: BTreeMap<usize, Partial>,
    model: String,
    stop_reason: Option<String>,
    refusal_category: Option<String>,
    error: Option<ProviderError>,
    finished: bool,
}

impl StreamAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn handle(&mut self, event: &SseEvent, events: &UnboundedSender<StreamEvent>) {
        let Ok(data) = serde_json::from_str::<Value>(&event.data) else { return };
        let index = data["index"].as_u64().map(|i| i as usize);
        match data["type"].as_str().unwrap_or(event.event.as_str()) {
            "message_start" => {
                self.model = data["message"]["model"].as_str().unwrap_or_default().to_string();
            }
            "content_block_start" => {
                let Some(index) = index else { return };
                let block = &data["content_block"];
                let partial = match block["type"].as_str() {
                    Some("text") => {
                        let text = block["text"].as_str().unwrap_or_default().to_string();
                        if !text.is_empty() {
                            let _ = events.send(StreamEvent::Text(text.clone()));
                        }
                        Partial::Text(text)
                    }
                    Some("tool_use") => Partial::ToolUse {
                        id: block["id"].as_str().unwrap_or_default().to_string(),
                        name: block["name"].as_str().unwrap_or_default().to_string(),
                        json: String::new(),
                    },
                    Some("fallback") => {
                        let _ = events.send(StreamEvent::ModelFallback {
                            from: block["from"]["model"].as_str().unwrap_or_default().to_string(),
                            to: block["to"]["model"].as_str().unwrap_or_default().to_string(),
                        });
                        Partial::Raw(block.clone())
                    }
                    _ => Partial::Raw(block.clone()),
                };
                self.blocks.insert(index, partial);
            }
            "content_block_delta" => {
                let Some(partial) = index.and_then(|i| self.blocks.get_mut(&i)) else { return };
                let delta = &data["delta"];
                match (delta["type"].as_str(), partial) {
                    (Some("text_delta"), Partial::Text(text)) => {
                        let piece = delta["text"].as_str().unwrap_or_default();
                        text.push_str(piece);
                        let _ = events.send(StreamEvent::Text(piece.to_string()));
                    }
                    (Some("input_json_delta"), Partial::ToolUse { json, .. }) => {
                        json.push_str(delta["partial_json"].as_str().unwrap_or_default());
                    }
                    (Some("thinking_delta"), Partial::Raw(value)) => append(value, "thinking", &delta["thinking"]),
                    (Some("signature_delta"), Partial::Raw(value)) => append(value, "signature", &delta["signature"]),
                    _ => {}
                }
            }
            "message_delta" => {
                if let Some(reason) = data["delta"]["stop_reason"].as_str() {
                    self.stop_reason = Some(reason.to_string());
                }
                if let Some(category) = data["delta"]["stop_details"]["category"].as_str() {
                    self.refusal_category = Some(category.to_string());
                }
            }
            "message_stop" => self.finished = true,
            "error" => {
                let kind = data["error"]["type"].as_str().unwrap_or("error");
                let message = data["error"]["message"].as_str().unwrap_or("unknown error").to_string();
                self.error = Some(match kind {
                    "overloaded_error" | "rate_limit_error" | "api_error" => ProviderError::Unavailable(message),
                    "authentication_error" | "permission_error" => ProviderError::Auth(message),
                    _ => ProviderError::Api { status: 200, message },
                });
            }
            _ => {}
        }
    }

    pub fn finish(self) -> Result<TurnOutput, ProviderError> {
        if let Some(error) = self.error {
            return Err(error);
        }
        let Some(stop_reason) = self.stop_reason else {
            return Err(ProviderError::Protocol("the stream ended before the message finished".into()));
        };
        let mut invalid_tool_inputs = Vec::new();
        let content: Vec<Block> = self
            .blocks
            .into_values()
            .map(|partial| match partial {
                Partial::Text(text) => Block::Text { text },
                Partial::ToolUse { id, name, json } => {
                    let input = if json.trim().is_empty() {
                        Some(json!({}))
                    } else {
                        serde_json::from_str::<Value>(&json).ok().filter(Value::is_object)
                    };
                    let input = input.unwrap_or_else(|| {
                        invalid_tool_inputs.push((id.clone(), json.clone()));
                        json!({})
                    });
                    Block::ToolUse { id, name, input }
                }
                Partial::Raw(value) => Block::Raw { provider: "claude".into(), value },
            })
            .collect();
        Ok(TurnOutput {
            content: sanitize_after_fallback(content),
            stop_reason: StopReason::parse(&stop_reason),
            model: self.model,
            refusal_category: self.refusal_category,
            invalid_tool_inputs,
        })
    }
}

fn append(value: &mut Value, field: &str, piece: &Value) {
    let piece = piece.as_str().unwrap_or_default();
    let current = value[field].as_str().unwrap_or_default().to_string();
    value[field] = Value::String(current + piece);
}

/// After a mid-output model fallback, blocks before the last `fallback` marker that belong to
/// the declined attempt (thinking, tool calls) must not be echoed back; text is kept.
pub fn sanitize_after_fallback(content: Vec<Block>) -> Vec<Block> {
    let is_fallback = |b: &Block| matches!(b, Block::Raw { value, .. } if value["type"] == "fallback");
    let Some(boundary) = content.iter().rposition(is_fallback) else { return content };
    content
        .into_iter()
        .enumerate()
        .filter(|(i, block)| {
            if *i >= boundary {
                return true;
            }
            match block {
                Block::Text { .. } => true,
                Block::ToolUse { .. } => false,
                Block::Raw { value, .. } => value["type"] == "fallback",
                _ => true,
            }
        })
        .map(|(_, block)| block)
        .collect()
}

fn http_error(status: u16, body: &str) -> ProviderError {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| body.chars().take(300).collect());
    match status {
        401 | 403 => ProviderError::Auth(message),
        408 | 429 | 500..=599 => ProviderError::Unavailable(format!("Claude API {status}: {message}")),
        _ => ProviderError::Api { status, message },
    }
}

impl Provider for ClaudeProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Cloud
    }

    fn model(&self) -> String {
        self.settings.model.clone()
    }

    fn turn<'a>(
        &'a self,
        request: TurnRequest<'a>,
        events: UnboundedSender<StreamEvent>,
    ) -> BoxFuture<'a, Result<TurnOutput, ProviderError>> {
        Box::pin(async move {
            let body = self.build_body(&request);
            let mut builder = self
                .http
                .post(format!("{}/v1/messages", self.settings.base_url.trim_end_matches('/')))
                .header("x-api-key", &self.settings.api_key)
                .header("anthropic-version", API_VERSION)
                .header("content-type", "application/json")
                .json(&body);
            if self.settings.fallbacks {
                builder = builder.header("anthropic-beta", FALLBACK_BETA);
            }
            let response = builder.send().await.map_err(|e| transport_error(e, "Claude API"))?;
            let status = response.status().as_u16();
            if status != 200 {
                let text = response.text().await.unwrap_or_default();
                return Err(http_error(status, &text));
            }

            let mut decoder = SseDecoder::new();
            let mut accumulator = StreamAccumulator::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| ProviderError::Protocol(format!("Claude stream interrupted: {e}")))?;
                for event in decoder.push(&chunk) {
                    accumulator.handle(&event, &events);
                }
            }
            if let Some(event) = decoder.finish() {
                accumulator.handle(&event, &events);
            }
            accumulator.finish()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    fn settings() -> ClaudeSettings {
        ClaudeSettings {
            base_url: "https://api.anthropic.com".into(),
            api_key: "test".into(),
            model: "claude-opus-5".into(),
            effort: "medium".into(),
            thinking: true,
            fallbacks: true,
        }
    }

    fn replay(stream: &str) -> (Result<TurnOutput, ProviderError>, Vec<StreamEvent>) {
        let (tx, mut rx) = unbounded_channel();
        let mut decoder = SseDecoder::new();
        let mut accumulator = StreamAccumulator::new();
        for event in decoder.push(stream.as_bytes()) {
            accumulator.handle(&event, &tx);
        }
        if let Some(event) = decoder.finish() {
            accumulator.handle(&event, &tx);
        }
        drop(tx);
        let mut events = Vec::new();
        while let Ok(event) = rx.try_recv() {
            events.push(event);
        }
        (accumulator.finish(), events)
    }

    #[test]
    fn builds_the_request_body() {
        let tools = vec![ToolSpec { name: "set_timer".into(), description: "d".into(), input_schema: json!({"type": "object"}) }];
        let messages = vec![Message::user(vec![Block::text("hi")])];
        let request = TurnRequest { system: "sys", messages: &messages, tools: &tools, max_tokens: 64_000, effort: None };
        let body = build_body(&settings(), &request);
        assert_eq!(body["model"], "claude-opus-5");
        assert_eq!(body["stream"], true);
        assert_eq!(body["thinking"], json!({"type": "adaptive"}));
        assert_eq!(body["output_config"], json!({"effort": "medium"}));
        assert_eq!(body["fallbacks"], "default");
        assert_eq!(body["cache_control"], json!({"type": "ephemeral"}));
        assert_eq!(body["tools"][0]["eager_input_streaming"], true);
        assert_eq!(body["messages"], json!([{"role": "user", "content": [{"type": "text", "text": "hi"}]}]));

        let quick = TurnRequest { system: "sys", messages: &messages, tools: &[], max_tokens: 16_000, effort: Some("low") };
        let body = build_body(&ClaudeSettings { fallbacks: false, thinking: false, ..settings() }, &quick);
        assert!(body.get("tools").is_none());
        assert!(body.get("thinking").is_none());
        assert!(body.get("fallbacks").is_none());
        assert_eq!(body["output_config"]["effort"], "low");
    }

    #[test]
    fn replays_thinking_blocks_verbatim_and_skips_foreign_blocks() {
        let thinking = json!({"type": "thinking", "thinking": "", "signature": "sig=="});
        let messages = vec![
            Message::user(vec![Block::text("q")]),
            Message::assistant(vec![
                Block::Raw { provider: "claude".into(), value: thinking.clone() },
                Block::Raw { provider: "ollama".into(), value: json!({"x": 1}) },
                Block::ToolUse { id: "toolu_1".into(), name: "list_notes".into(), input: json!({}) },
            ]),
            Message::user(vec![Block::ToolResult { tool_use_id: "toolu_1".into(), content: "none".into(), is_error: true }]),
        ];
        let wire = to_claude_messages(&messages);
        assert_eq!(wire[1]["content"][0], thinking);
        assert_eq!(wire[1]["content"].as_array().unwrap().len(), 2);
        assert_eq!(wire[2]["content"][0]["is_error"], true);
    }

    #[test]
    fn accumulates_a_tool_use_stream() {
        let (output, events) = replay(include_str!("../../tests/fixtures/claude_tool_use.sse"));
        let output = output.unwrap();
        assert_eq!(output.model, "claude-opus-5");
        assert_eq!(output.stop_reason, StopReason::ToolUse);
        assert_eq!(output.content.len(), 3);
        assert_eq!(
            output.content[0],
            Block::Raw { provider: "claude".into(), value: json!({"type": "thinking", "thinking": "", "signature": "EqQBCkYIBRgCKkA="}) }
        );
        assert_eq!(output.content[1], Block::text("I'll set a 10 minute timer."));
        assert_eq!(
            output.content[2],
            Block::ToolUse { id: "toolu_01A".into(), name: "set_timer".into(), input: json!({"seconds": 600, "label": "tea"}) }
        );
        let text: String = events
            .iter()
            .filter_map(|e| match e {
                StreamEvent::Text(t) => Some(t.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(text, "I'll set a 10 minute timer.");
    }

    #[test]
    fn reports_invalid_tool_json() {
        let stream = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-opus-5\"}}\n\n",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_X\",\"name\":\"create_note\",\"input\":{}}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"title\\\": \\\"unterminated\"}}\n\n",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"}}\n\n",
        );
        let output = replay(stream).0.unwrap();
        assert_eq!(output.stop_reason, StopReason::MaxTokens);
        assert_eq!(output.invalid_tool_inputs, vec![("toolu_X".to_string(), "{\"title\": \"unterminated".to_string())]);
    }

    #[test]
    fn handles_fallback_and_refusal_markers() {
        let (output, events) = replay(include_str!("../../tests/fixtures/claude_fallback.sse"));
        let output = output.unwrap();
        assert_eq!(output.model, "claude-opus-4-8");
        assert!(events.contains(&StreamEvent::ModelFallback { from: "claude-opus-5".into(), to: "claude-opus-4-8".into() }));
        // The declined attempt's thinking block before the marker is dropped; text survives.
        let kinds: Vec<String> = output
            .content
            .iter()
            .map(|b| match b {
                Block::Raw { value, .. } => value["type"].as_str().unwrap().to_string(),
                Block::Text { .. } => "text".into(),
                other => format!("{other:?}"),
            })
            .collect();
        assert_eq!(kinds, vec!["text", "fallback", "text"]);

        let refusal = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-opus-5\"}}\n\n",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"refusal\",\"stop_details\":{\"type\":\"refusal\",\"category\":\"cyber\"}}}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
        );
        let output = replay(refusal).0.unwrap();
        assert_eq!(output.stop_reason, StopReason::Refusal);
        assert_eq!(output.refusal_category.as_deref(), Some("cyber"));
    }

    #[test]
    fn surfaces_stream_errors() {
        let stream = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n";
        assert_eq!(replay(stream).0.unwrap_err(), ProviderError::Unavailable("Overloaded".into()));
        assert!(matches!(replay("").0.unwrap_err(), ProviderError::Protocol(_)));
    }

    #[test]
    fn classifies_http_errors() {
        assert!(matches!(http_error(401, "{\"error\":{\"message\":\"bad key\"}}"), ProviderError::Auth(m) if m == "bad key"));
        assert!(matches!(http_error(529, "overloaded"), ProviderError::Unavailable(_)));
        assert!(matches!(http_error(400, "{\"error\":{\"message\":\"nope\"}}"), ProviderError::Api { status: 400, .. }));
    }
}

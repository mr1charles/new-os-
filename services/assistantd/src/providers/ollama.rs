//! On-device models through Ollama's HTTP API (`/api/chat` streaming NDJSON, `/api/embed`).

use std::collections::HashMap;
use std::time::Duration;

use futures::StreamExt;
use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;

use super::{
    transport_error, BoxFuture, Provider, ProviderError, ProviderKind, StopReason, StreamEvent, ToolSpec, TurnOutput, TurnRequest,
};
use crate::conversation::{Block, Message, Role};

#[derive(Debug, Clone)]
pub struct OllamaSettings {
    pub base_url: String,
    pub model: String,
    pub embed_model: String,
    pub num_ctx: u32,
}

pub struct OllamaProvider {
    http: reqwest::Client,
    settings: OllamaSettings,
}

impl OllamaProvider {
    pub fn new(http: reqwest::Client, settings: OllamaSettings) -> Self {
        Self { http, settings }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.settings.base_url.trim_end_matches('/'))
    }

    /// Is Ollama running with the configured chat model pulled?
    pub async fn available(&self) -> bool {
        let Ok(response) = self.http.get(self.url("/api/tags")).timeout(Duration::from_millis(1500)).send().await else {
            return false;
        };
        let Ok(tags) = response.json::<Value>().await else { return false };
        has_model(&tags, &self.settings.model)
    }

    pub async fn embed(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, ProviderError> {
        let response = self
            .http
            .post(self.url("/api/embed"))
            .json(&json!({"model": self.settings.embed_model, "input": inputs}))
            .send()
            .await
            .map_err(|e| transport_error(e, "Ollama"))?;
        let status = response.status().as_u16();
        let body: Value = response.json().await.map_err(|e| ProviderError::Protocol(e.to_string()))?;
        if status != 200 {
            return Err(ollama_error(status, &body, &self.settings.embed_model));
        }
        serde_json::from_value(body["embeddings"].clone()).map_err(|e| ProviderError::Protocol(format!("bad embeddings: {e}")))
    }

    pub fn embed_model(&self) -> &str {
        &self.settings.embed_model
    }
}

/// `GET /api/tags` lists models as "name:tag"; "qwen2.5:3b" matches exactly, "llama3.2"
/// matches "llama3.2:latest".
pub fn has_model(tags: &Value, wanted: &str) -> bool {
    let wanted_full = if wanted.contains(':') { wanted.to_string() } else { format!("{wanted}:latest") };
    tags["models"].as_array().is_some_and(|models| {
        models.iter().any(|m| {
            let name = m["name"].as_str().or_else(|| m["model"].as_str()).unwrap_or_default();
            name == wanted || name == wanted_full
        })
    })
}

fn ollama_error(status: u16, body: &Value, model: &str) -> ProviderError {
    let message = body["error"].as_str().unwrap_or("unknown error").to_string();
    if status == 404 || message.contains("not found") {
        return ProviderError::Api { status, message: format!("the model {model} is not installed; run: ollama pull {model}") };
    }
    if status >= 500 {
        return ProviderError::Unavailable(format!("Ollama {status}: {message}"));
    }
    ProviderError::Api { status, message }
}

pub fn build_body(settings: &OllamaSettings, request: &TurnRequest<'_>) -> Value {
    let mut body = json!({
        "model": settings.model,
        "messages": to_ollama_messages(request.system, request.messages),
        "stream": true,
        "options": {"num_ctx": settings.num_ctx, "num_predict": request.max_tokens.min(8192)},
    });
    if !request.tools.is_empty() {
        body["tools"] = Value::Array(request.tools.iter().map(tool_definition).collect());
    }
    body
}

fn tool_definition(tool: &ToolSpec) -> Value {
    json!({
        "type": "function",
        "function": {"name": tool.name, "description": tool.description, "parameters": tool.input_schema},
    })
}

pub fn to_ollama_messages(system: &str, messages: &[Message]) -> Vec<Value> {
    let mut out = vec![json!({"role": "system", "content": system})];
    let mut tool_names: HashMap<&str, &str> = HashMap::new();
    for message in messages {
        match message.role {
            Role::Assistant => {
                let text = message.plain_text();
                let calls: Vec<Value> = message
                    .tool_uses()
                    .map(|(id, name, input)| {
                        tool_names.insert(id, name);
                        json!({"function": {"name": name, "arguments": input}})
                    })
                    .collect();
                if text.is_empty() && calls.is_empty() {
                    continue;
                }
                let mut value = json!({"role": "assistant", "content": text});
                if !calls.is_empty() {
                    value["tool_calls"] = Value::Array(calls);
                }
                out.push(value);
            }
            Role::User => {
                for block in &message.content {
                    if let Block::ToolResult { tool_use_id, content, is_error } = block {
                        let content = if *is_error { format!("Error: {content}") } else { content.clone() };
                        let name = tool_names.get(tool_use_id.as_str()).copied().unwrap_or_default();
                        out.push(json!({"role": "tool", "content": content, "tool_name": name}));
                    }
                }
                let text = message.plain_text();
                if !text.is_empty() {
                    out.push(json!({"role": "user", "content": text}));
                }
            }
        }
    }
    out
}

/// Accumulates Ollama's NDJSON chat stream.
#[derive(Default)]
pub struct ChatAccumulator {
    text: String,
    calls: Vec<(String, Value)>,
    done_reason: Option<String>,
    model: String,
    error: Option<String>,
}

impl ChatAccumulator {
    pub fn handle_line(&mut self, line: &str, events: &UnboundedSender<StreamEvent>) {
        let Ok(chunk) = serde_json::from_str::<Value>(line) else { return };
        if let Some(error) = chunk["error"].as_str() {
            self.error = Some(error.to_string());
            return;
        }
        if let Some(model) = chunk["model"].as_str() {
            self.model = model.to_string();
        }
        if let Some(piece) = chunk["message"]["content"].as_str() {
            if !piece.is_empty() {
                self.text.push_str(piece);
                let _ = events.send(StreamEvent::Text(piece.to_string()));
            }
        }
        if let Some(calls) = chunk["message"]["tool_calls"].as_array() {
            for call in calls {
                let name = call["function"]["name"].as_str().unwrap_or_default().to_string();
                let arguments = match &call["function"]["arguments"] {
                    // Some models return arguments as a JSON string.
                    Value::String(s) => serde_json::from_str(s).unwrap_or(json!({})),
                    Value::Null => json!({}),
                    other => other.clone(),
                };
                self.calls.push((name, arguments));
            }
        }
        if chunk["done"].as_bool() == Some(true) {
            self.done_reason = Some(chunk["done_reason"].as_str().unwrap_or("stop").to_string());
        }
    }

    pub fn finish(self) -> Result<TurnOutput, ProviderError> {
        if let Some(error) = self.error {
            return Err(ProviderError::Api { status: 200, message: error });
        }
        let Some(done_reason) = self.done_reason else {
            return Err(ProviderError::Protocol("Ollama stream ended early".into()));
        };
        let mut content = Vec::new();
        if !self.text.trim().is_empty() {
            content.push(Block::Text { text: self.text });
        }
        let has_calls = !self.calls.is_empty();
        for (n, (name, input)) in self.calls.into_iter().enumerate() {
            let id = format!("call_{}_{}", n, &uuid::Uuid::new_v4().simple().to_string()[..8]);
            content.push(Block::ToolUse { id, name, input });
        }
        let stop_reason = if has_calls {
            StopReason::ToolUse
        } else if done_reason == "length" {
            StopReason::MaxTokens
        } else {
            StopReason::EndTurn
        };
        Ok(TurnOutput { content, stop_reason, model: self.model, refusal_category: None, invalid_tool_inputs: vec![] })
    }
}

impl Provider for OllamaProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Local
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
            let body = build_body(&self.settings, &request);
            let response = self.http.post(self.url("/api/chat")).json(&body).send().await.map_err(|e| transport_error(e, "Ollama"))?;
            let status = response.status().as_u16();
            if status != 200 {
                let body: Value = response.json().await.unwrap_or(Value::Null);
                return Err(ollama_error(status, &body, &self.settings.model));
            }
            let mut accumulator = ChatAccumulator::default();
            let mut buffer = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| ProviderError::Protocol(format!("Ollama stream interrupted: {e}")))?;
                buffer.extend_from_slice(&chunk);
                while let Some(pos) = buffer.iter().position(|b| *b == b'\n') {
                    let line: Vec<u8> = buffer.drain(..=pos).collect();
                    accumulator.handle_line(String::from_utf8_lossy(&line).trim(), &events);
                }
            }
            if !buffer.is_empty() {
                accumulator.handle_line(String::from_utf8_lossy(&buffer).trim(), &events);
            }
            accumulator.finish()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    #[test]
    fn matches_installed_models() {
        let tags = json!({"models": [{"name": "qwen2.5:3b"}, {"name": "llama3.2:latest"}]});
        assert!(has_model(&tags, "qwen2.5:3b"));
        assert!(has_model(&tags, "llama3.2"));
        assert!(!has_model(&tags, "qwen2.5:7b"));
        assert!(!has_model(&json!({}), "qwen2.5:3b"));
    }

    #[test]
    fn converts_tool_turns() {
        let messages = vec![
            Message::user(vec![Block::text("timer 5 min")]),
            Message::assistant(vec![
                Block::Raw { provider: "claude".into(), value: json!({"type": "thinking"}) },
                Block::ToolUse { id: "t1".into(), name: "set_timer".into(), input: json!({"seconds": 300}) },
            ]),
            Message::user(vec![Block::ToolResult { tool_use_id: "t1".into(), content: "Timer set".into(), is_error: false }]),
        ];
        let wire = to_ollama_messages("sys", &messages);
        assert_eq!(wire[0], json!({"role": "system", "content": "sys"}));
        assert_eq!(wire[1], json!({"role": "user", "content": "timer 5 min"}));
        assert_eq!(wire[2]["tool_calls"][0]["function"]["name"], "set_timer");
        assert_eq!(wire[3], json!({"role": "tool", "content": "Timer set", "tool_name": "set_timer"}));
    }

    #[test]
    fn accumulates_text_and_tool_calls() {
        let (tx, mut rx) = unbounded_channel();
        let mut acc = ChatAccumulator::default();
        for line in include_str!("../../tests/fixtures/ollama_chat.ndjson").lines() {
            acc.handle_line(line, &tx);
        }
        let output = acc.finish().unwrap();
        assert_eq!(output.stop_reason, StopReason::ToolUse);
        assert_eq!(output.model, "qwen2.5:3b");
        assert_eq!(output.content[0], Block::text("Setting it now."));
        match &output.content[1] {
            Block::ToolUse { name, input, id } => {
                assert_eq!(name, "set_timer");
                assert_eq!(input, &json!({"seconds": 300, "label": "pasta"}));
                assert!(id.starts_with("call_0_"));
            }
            other => panic!("expected tool use, got {other:?}"),
        }
        assert_eq!(rx.try_recv().unwrap(), StreamEvent::Text("Setting ".into()));
    }

    #[test]
    fn reports_errors_and_truncation() {
        let (tx, _rx) = unbounded_channel();
        let mut acc = ChatAccumulator::default();
        acc.handle_line(r#"{"error":"model \"x\" not found"}"#, &tx);
        assert!(acc.finish().is_err());

        let mut acc = ChatAccumulator::default();
        acc.handle_line(r#"{"model":"m","message":{"role":"assistant","content":"long"},"done":true,"done_reason":"length"}"#, &tx);
        assert_eq!(acc.finish().unwrap().stop_reason, StopReason::MaxTokens);
    }
}

//! Model providers: Claude over the Anthropic Messages API, and Ollama on the device.

pub mod claude;
pub mod ollama;
pub mod sse;

use std::future::Future;
use std::pin::Pin;

use serde::Serialize;
use serde_json::Value;
use tokio::sync::mpsc::UnboundedSender;

use crate::conversation::{Block, Message};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Cloud,
    Local,
}

impl std::fmt::Display for ProviderKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ProviderKind::Cloud => "cloud",
            ProviderKind::Local => "local",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

pub struct TurnRequest<'a> {
    pub system: &'a str,
    pub messages: &'a [Message],
    pub tools: &'a [ToolSpec],
    pub max_tokens: u32,
    /// Overrides the provider's configured effort (used for quick completions).
    pub effort: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopReason {
    EndTurn,
    ToolUse,
    MaxTokens,
    StopSequence,
    PauseTurn,
    Refusal,
    Other(String),
}

impl StopReason {
    pub fn parse(value: &str) -> Self {
        match value {
            "end_turn" => StopReason::EndTurn,
            "tool_use" => StopReason::ToolUse,
            "max_tokens" => StopReason::MaxTokens,
            "stop_sequence" => StopReason::StopSequence,
            "pause_turn" => StopReason::PauseTurn,
            "refusal" => StopReason::Refusal,
            other => StopReason::Other(other.to_string()),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            StopReason::EndTurn => "end_turn",
            StopReason::ToolUse => "tool_use",
            StopReason::MaxTokens => "max_tokens",
            StopReason::StopSequence => "stop_sequence",
            StopReason::PauseTurn => "pause_turn",
            StopReason::Refusal => "refusal",
            StopReason::Other(s) => s,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TurnOutput {
    /// Assistant content, ready to append to the conversation as-is.
    pub content: Vec<Block>,
    pub stop_reason: StopReason,
    /// The model that produced the reply (may differ from the requested one after a fallback).
    pub model: String,
    /// Refusal category from `stop_details`, when the reply was declined.
    pub refusal_category: Option<String>,
    /// Tool calls whose streamed input was not valid JSON: tool_use id -> raw text.
    pub invalid_tool_inputs: Vec<(String, String)>,
}

/// Incremental output while a turn streams.
#[derive(Debug, Clone, PartialEq)]
pub enum StreamEvent {
    Text(String),
    /// Server-side refusal fallback switched models mid-request.
    ModelFallback {
        from: String,
        to: String,
    },
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ProviderError {
    /// Network down, timeouts, overload, rate limits, 5xx: nothing was produced and another
    /// provider may succeed.
    #[error("{0}")]
    Unavailable(String),
    #[error("authentication failed: {0}")]
    Auth(String),
    #[error("API error {status}: {message}")]
    Api { status: u16, message: String },
    #[error("stream error: {0}")]
    Protocol(String),
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait Provider: Send + Sync {
    fn kind(&self) -> ProviderKind;
    fn model(&self) -> String;
    fn turn<'a>(
        &'a self,
        request: TurnRequest<'a>,
        events: UnboundedSender<StreamEvent>,
    ) -> BoxFuture<'a, Result<TurnOutput, ProviderError>>;
}

/// Classify a transport-level reqwest failure.
pub(crate) fn transport_error(error: reqwest::Error, what: &str) -> ProviderError {
    if error.is_connect() || error.is_timeout() || error.is_request() {
        ProviderError::Unavailable(format!("{what} is unreachable: {error}"))
    } else {
        ProviderError::Protocol(format!("{what}: {error}"))
    }
}

//! Local HTTP API, served on a unix socket only the user can open.
//!
//! | Method | Path | What |
//! |---|---|---|
//! | GET | /v1/status | Mode, active provider, availability |
//! | POST | /v1/chat | Run a message through the agent; Server-Sent Events stream |
//! | POST | /v1/complete | One-shot task for apps: summarize, rewrite, classify, reply, ... |
//! | POST | /v1/embed | Embeddings from the on-device model |
//! | POST | /v1/confirm | Answer a tool confirmation (Allow/Deny) |
//! | GET | /v1/events | Daemon events (timers, notifications); SSE |
//! | GET/DELETE | /v1/conversations[/{id}] | Conversation history |
//! | GET/DELETE | /v1/facts[/{id}] | Remembered facts |
//! | GET | /v1/timers | Running timers |

use std::convert::Infallible;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use futures::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio_stream::wrappers::{BroadcastStream, UnboundedReceiverStream};

use crate::agent::{self, ChatInput};
use crate::events::{ChatEvent, EventName};
use crate::prompt::{self, TurnContext};
use crate::router;
use crate::state::AppState;

const MAX_MESSAGE_CHARS: usize = 32_000;
const MAX_COMPLETE_CHARS: usize = 200_000;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/status", get(status))
        .route("/v1/chat", post(chat))
        .route("/v1/complete", post(complete))
        .route("/v1/embed", post(embed))
        .route("/v1/confirm", post(confirm))
        .route("/v1/events", get(events))
        .route("/v1/conversations", get(conversations))
        .route("/v1/conversations/{id}", get(conversation).delete(delete_conversation))
        .route("/v1/facts", get(facts))
        .route("/v1/facts/{id}", delete(delete_fact))
        .route("/v1/timers", get(timers))
        .with_state(state)
}

pub struct ApiError(StatusCode, String);

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, message.into())
    }
}

impl<E: std::fmt::Display> From<E> for ApiError {
    fn from(error: E) -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

#[derive(Serialize)]
struct StatusResponse {
    version: &'static str,
    mode: router::Mode,
    active: String,
    online: bool,
    cloud: CloudStatus,
    local: LocalStatus,
    assistant_name: String,
}

#[derive(Serialize)]
struct CloudStatus {
    configured: bool,
    model: String,
    key_source: Option<&'static str>,
}

#[derive(Serialize)]
struct LocalStatus {
    available: bool,
    model: String,
    url: String,
}

async fn status(State(state): State<Arc<AppState>>) -> Json<StatusResponse> {
    let available = state.probe.probe().await;
    let active = router::choose(state.config.mode, available).map(|k| k.to_string()).unwrap_or_else(|_| "none".into());
    Json(StatusResponse {
        version: env!("CARGO_PKG_VERSION"),
        mode: state.config.mode,
        active,
        online: available.online,
        cloud: CloudStatus {
            configured: available.cloud_configured,
            model: state.config.cloud.model.clone(),
            key_source: state.key_source.map(|s| match s {
                crate::secrets::KeySource::Environment => "environment",
                crate::secrets::KeySource::Keyring => "keyring",
                crate::secrets::KeySource::File => "file",
            }),
        },
        local: LocalStatus {
            available: available.local_available,
            model: state.config.local.model.clone(),
            url: state.config.local.url.clone(),
        },
        assistant_name: state.config.name.clone(),
    })
}

#[derive(Deserialize)]
struct ChatBody {
    message: String,
    #[serde(default)]
    conversation_id: Option<String>,
    #[serde(default)]
    context: Option<ContextBody>,
}

#[derive(Deserialize, Default)]
struct ContextBody {
    app: Option<String>,
    window_title: Option<String>,
    selection: Option<String>,
}

fn sse_event<E: Serialize + EventName>(event: &E) -> Result<Event, Infallible> {
    Ok(Event::default().event(event.event_name()).data(serde_json::to_string(event).unwrap_or_else(|_| "{}".into())))
}

async fn chat(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ChatBody>,
) -> ApiResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    let message = body.message.trim().to_string();
    if message.is_empty() {
        return Err(ApiError::bad_request("message is empty"));
    }
    if message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(ApiError::bad_request("message is too long"));
    }
    let context = body.context.unwrap_or_default();
    let input = ChatInput {
        message,
        conversation_id: body.conversation_id,
        context: TurnContext { app: context.app, window_title: context.window_title, selection: context.selection },
    };
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<ChatEvent>();
    // The agent keeps running if the client disconnects, so history stays consistent.
    tokio::spawn(agent::run_chat(state, input, tx));
    let stream = UnboundedReceiverStream::new(rx).map(|event| sse_event(&event));
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

#[derive(Deserialize)]
struct CompleteBody {
    task: String,
    input: String,
    #[serde(default)]
    options: Map<String, Value>,
}

async fn complete(State(state): State<Arc<AppState>>, Json(body): Json<CompleteBody>) -> ApiResult<Json<Value>> {
    if body.input.trim().is_empty() {
        return Err(ApiError::bad_request("input is empty"));
    }
    if body.input.chars().count() > MAX_COMPLETE_CHARS {
        return Err(ApiError::bad_request("input is too long"));
    }
    let prompt_text = prompt::completion_prompt(&body.task, &body.input, &body.options).map_err(ApiError::bad_request)?;
    let (output, provider, model) =
        agent::complete(&state, prompt_text).await.map_err(|e| ApiError(StatusCode::SERVICE_UNAVAILABLE, e.to_string()))?;
    Ok(Json(json!({"output": output, "provider": provider, "model": model})))
}

#[derive(Deserialize)]
struct EmbedBody {
    input: Vec<String>,
}

async fn embed(State(state): State<Arc<AppState>>, Json(body): Json<EmbedBody>) -> ApiResult<Json<Value>> {
    if body.input.is_empty() || body.input.len() > 256 {
        return Err(ApiError::bad_request("input must hold 1 to 256 strings"));
    }
    let Some(ollama) = state.ollama.clone() else {
        return Err(ApiError(StatusCode::SERVICE_UNAVAILABLE, "embeddings need the on-device model (Ollama)".into()));
    };
    let embeddings = ollama.embed(&body.input).await.map_err(|e| ApiError(StatusCode::SERVICE_UNAVAILABLE, e.to_string()))?;
    Ok(Json(json!({"embeddings": embeddings, "model": ollama.embed_model(), "provider": "local"})))
}

#[derive(Deserialize)]
struct ConfirmBody {
    request_id: String,
    allow: bool,
}

async fn confirm(State(state): State<Arc<AppState>>, Json(body): Json<ConfirmBody>) -> ApiResult<Json<Value>> {
    let sender = state.pending.lock().unwrap().remove(&body.request_id);
    match sender {
        Some(sender) => {
            let _ = sender.send(body.allow);
            Ok(Json(json!({"ok": true})))
        }
        None => Err(ApiError(StatusCode::NOT_FOUND, "no pending confirmation with that id".into())),
    }
}

async fn events(State(state): State<Arc<AppState>>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = BroadcastStream::new(state.events.subscribe()).filter_map(|event| async move { event.ok().map(|e| sse_event(&e)) });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn conversations(State(state): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({"conversations": state.memory.conversations(100)?})))
}

async fn conversation(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    if !state.memory.conversation_exists(&id)? {
        return Err(ApiError(StatusCode::NOT_FOUND, "no such conversation".into()));
    }
    Ok(Json(json!({"id": id, "messages": state.memory.messages(&id)?})))
}

async fn delete_conversation(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({"deleted": state.memory.delete_conversation(&id)?})))
}

async fn facts(State(state): State<Arc<AppState>>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({"facts": state.memory.facts()?})))
}

async fn delete_fact(State(state): State<Arc<AppState>>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({"deleted": state.memory.forget(&id.to_string())?})))
}

async fn timers(State(state): State<Arc<AppState>>) -> Json<Value> {
    let now = chrono::Utc::now().timestamp_millis();
    let running: Vec<_> = state.tool_ctx.timers.lock().unwrap().iter().filter(|t| t.ends_at_ms > now).cloned().collect();
    Json(json!({"timers": running}))
}

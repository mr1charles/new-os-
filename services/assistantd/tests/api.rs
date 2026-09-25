//! End-to-end tests of the HTTP API with scripted model providers and a mock command runner.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use newos_assistantd::config::Config;
use newos_assistantd::conversation::{Block, Message, Role};
use newos_assistantd::events::SystemEvent;
use newos_assistantd::memory::Memory;
use newos_assistantd::providers::{BoxFuture, Provider, ProviderError, ProviderKind, StopReason, StreamEvent, TurnOutput, TurnRequest};
use newos_assistantd::router::Availability;
use newos_assistantd::state::{StateParts, StaticProbe};
use newos_assistantd::{api, AppState};
use newos_syslib::{CommandOutput, MockRunner};
use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;
use tower::ServiceExt;

type Step = Result<TurnOutput, ProviderError>;

/// Plays back scripted turns and records every request it receives.
struct ScriptedProvider {
    kind: ProviderKind,
    steps: Mutex<VecDeque<Step>>,
    seen: Mutex<Vec<Vec<Message>>>,
}

impl ScriptedProvider {
    fn new(kind: ProviderKind, steps: Vec<Step>) -> Arc<Self> {
        Arc::new(Self { kind, steps: Mutex::new(steps.into()), seen: Mutex::new(Vec::new()) })
    }
}

impl Provider for ScriptedProvider {
    fn kind(&self) -> ProviderKind {
        self.kind
    }

    fn model(&self) -> String {
        match self.kind {
            ProviderKind::Cloud => "claude-opus-5".into(),
            ProviderKind::Local => "qwen2.5:3b".into(),
        }
    }

    fn turn<'a>(&'a self, request: TurnRequest<'a>, events: UnboundedSender<StreamEvent>) -> BoxFuture<'a, Step> {
        self.seen.lock().unwrap().push(request.messages.to_vec());
        let step = self.steps.lock().unwrap().pop_front().expect("unexpected model call");
        if let Ok(output) = &step {
            for block in &output.content {
                if let Block::Text { text } = block {
                    let _ = events.send(StreamEvent::Text(text.clone()));
                }
            }
        }
        Box::pin(async move { step })
    }
}

fn reply(content: Vec<Block>, stop: StopReason) -> Step {
    Ok(TurnOutput { content, stop_reason: stop, model: "claude-opus-5".into(), refusal_category: None, invalid_tool_inputs: vec![] })
}

fn tool_call(id: &str, name: &str, input: Value) -> Block {
    Block::ToolUse { id: id.into(), name: name.into(), input }
}

struct Harness {
    state: Arc<AppState>,
    runner: Arc<MockRunner>,
    home: tempfile::TempDir,
}

fn harness(cloud: Option<Arc<ScriptedProvider>>, local: Arc<ScriptedProvider>, available: Availability) -> Harness {
    let home = tempfile::tempdir().unwrap();
    let runner = Arc::new(MockRunner::new());
    let state = AppState::assemble(StateParts {
        config: Config::default(),
        cloud: cloud.map(|c| c as Arc<dyn Provider>),
        local,
        ollama: None,
        probe: Arc::new(StaticProbe(available)),
        runner: runner.clone(),
        memory: Arc::new(Memory::in_memory().unwrap()),
        home: home.path().to_path_buf(),
        app_dirs: vec![],
        power_supply_dir: home.path().join("no-power-supply"),
        key_source: None,
    });
    Harness { state, runner, home }
}

const ONLINE: Availability = Availability { cloud_configured: true, online: true, local_available: true };

async fn request(state: &Arc<AppState>, method: &str, path: &str, body: Option<Value>) -> (StatusCode, String) {
    let builder = Request::builder().method(method).uri(path).header("content-type", "application/json");
    let body = body.map(|b| Body::from(b.to_string())).unwrap_or_else(Body::empty);
    let response = api::router(state.clone()).oneshot(builder.body(body).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8_lossy(&bytes).into_owned())
}

/// Parse an SSE body into (event, data) pairs.
fn sse(body: &str) -> Vec<(String, Value)> {
    body.split("\n\n")
        .filter_map(|chunk| {
            let mut event = None;
            let mut data = None;
            for line in chunk.lines() {
                if let Some(v) = line.strip_prefix("event: ") {
                    event = Some(v.to_string());
                } else if let Some(v) = line.strip_prefix("data: ") {
                    data = serde_json::from_str(v).ok();
                }
            }
            Some((event?, data?))
        })
        .collect()
}

#[tokio::test]
async fn status_reports_the_active_provider() {
    let h = harness(None, ScriptedProvider::new(ProviderKind::Local, vec![]), ONLINE);
    let (status, body) = request(&h.state, "GET", "/v1/status", None).await;
    assert_eq!(status, StatusCode::OK);
    let body: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(body["active"], "cloud");
    assert_eq!(body["mode"], "auto");
    assert_eq!(body["cloud"]["model"], "claude-opus-5");
    assert_eq!(body["local"]["available"], true);
}

#[tokio::test]
async fn chat_runs_tools_and_streams_the_answer() {
    let cloud = ScriptedProvider::new(
        ProviderKind::Cloud,
        vec![
            reply(
                vec![
                    Block::Raw { provider: "claude".into(), value: json!({"type": "thinking", "thinking": "", "signature": "s"}) },
                    Block::text("Setting it."),
                    tool_call("toolu_1", "set_timer", json!({"seconds": 600, "label": "tea"})),
                    tool_call("toolu_2", "set_volume", json!({"percent": 30})),
                ],
                StopReason::ToolUse,
            ),
            reply(vec![Block::text("Done: a 10 minute tea timer, and volume at 30%.")], StopReason::EndTurn),
        ],
    );
    let h = harness(Some(cloud.clone()), ScriptedProvider::new(ProviderKind::Local, vec![]), ONLINE);
    h.runner.respond(CommandOutput::ok("")).respond(CommandOutput::ok("")).respond(CommandOutput::ok("Volume: 0.30"));
    let mut system_events = h.state.events.subscribe();

    let (status, body) = request(
        &h.state,
        "POST",
        "/v1/chat",
        Some(json!({"message": "tea timer 10 min and volume 30", "context": {"app": "firefox", "window_title": "Recipes"}})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let events = sse(&body);
    let names: Vec<&str> = events.iter().map(|(e, _)| e.as_str()).collect();
    assert_eq!(names, vec!["start", "text", "tool_call", "tool_result", "tool_call", "tool_result", "text", "done"]);
    assert_eq!(events[0].1["provider"], "cloud");
    assert_eq!(events[3].1["ok"], true);
    assert_eq!(events[5].1["output"], "Volume is now 30%.");
    assert_eq!(events[7].1["stop_reason"], "end_turn");

    match system_events.try_recv().unwrap() {
        SystemEvent::TimerStarted { label, duration_ms, .. } => {
            assert_eq!(label, "tea");
            assert_eq!(duration_ms, 600_000);
        }
        other => panic!("unexpected {other:?}"),
    }
    assert_eq!(h.runner.calls()[0], ["wpctl", "set-volume", "--limit", "1.0", "@DEFAULT_AUDIO_SINK@", "30%"]);

    // The second model call saw the thinking block unchanged and both results in one message.
    let second = cloud.seen.lock().unwrap()[1].clone();
    assert_eq!(second.len(), 3);
    assert!(matches!(&second[0].content[0], Block::Text { text } if text.contains("Focused window: firefox — \"Recipes\"")));
    assert!(matches!(&second[1].content[0], Block::Raw { .. }));
    assert_eq!(second[2].role, Role::User);
    assert_eq!(second[2].content.len(), 2);

    // The conversation was saved: user, assistant, tool results, assistant.
    let conversation_id = events[0].1["conversation_id"].as_str().unwrap();
    let (_, body) = request(&h.state, "GET", &format!("/v1/conversations/{conversation_id}"), None).await;
    let saved: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(saved["messages"].as_array().unwrap().len(), 4);
}

#[tokio::test]
async fn invalid_tool_input_is_reported_back_to_the_model() {
    let cloud = ScriptedProvider::new(
        ProviderKind::Cloud,
        vec![
            reply(vec![tool_call("toolu_1", "set_volume", json!({"percent": "loud"}))], StopReason::ToolUse),
            reply(vec![Block::text("Sorry.")], StopReason::EndTurn),
        ],
    );
    let h = harness(Some(cloud.clone()), ScriptedProvider::new(ProviderKind::Local, vec![]), ONLINE);
    let (_, body) = request(&h.state, "POST", "/v1/chat", Some(json!({"message": "louder"}))).await;
    let events = sse(&body);
    let result = events.iter().find(|(e, _)| e == "tool_result").unwrap();
    assert_eq!(result.1["ok"], false);
    assert!(result.1["output"].as_str().unwrap().contains("must be a integer"));
    assert!(h.runner.calls().is_empty(), "the tool must not run");
}

#[tokio::test]
async fn confirmation_gates_dangerous_tools() {
    let cloud = ScriptedProvider::new(
        ProviderKind::Cloud,
        vec![
            reply(vec![tool_call("toolu_1", "run_shell", json!({"command": "df -h"}))], StopReason::ToolUse),
            reply(vec![Block::text("Okay, I won't.")], StopReason::EndTurn),
        ],
    );
    let h = harness(Some(cloud), ScriptedProvider::new(ProviderKind::Local, vec![]), ONLINE);
    let state = h.state.clone();
    let chat = tokio::spawn(async move { request(&state, "POST", "/v1/chat", Some(json!({"message": "disk space?"}))).await });

    // Wait for the pending confirmation, then deny it through the API.
    let request_id = loop {
        if let Some(id) = h.state.pending.lock().unwrap().keys().next().cloned() {
            break id;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    };
    let (status, _) = request(&h.state, "POST", "/v1/confirm", Some(json!({"request_id": request_id, "allow": false}))).await;
    assert_eq!(status, StatusCode::OK);

    let (_, body) = chat.await.unwrap();
    let events = sse(&body);
    let confirm = events.iter().find(|(e, _)| e == "confirm").unwrap();
    assert_eq!(confirm.1["summary"], "df -h");
    let result = events.iter().find(|(e, _)| e == "tool_result").unwrap();
    assert_eq!(result.1["output"], "The user declined this action.");
    assert!(h.runner.calls().is_empty(), "denied commands never run");

    let (status, _) = request(&h.state, "POST", "/v1/confirm", Some(json!({"request_id": "nope", "allow": true}))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn falls_back_to_the_local_model_when_the_cloud_is_unreachable() {
    let cloud = ScriptedProvider::new(ProviderKind::Cloud, vec![Err(ProviderError::Unavailable("connection refused".into()))]);
    let local = ScriptedProvider::new(ProviderKind::Local, vec![reply(vec![Block::text("Hi from the laptop.")], StopReason::EndTurn)]);
    let h = harness(Some(cloud), local, ONLINE);
    let (_, body) = request(&h.state, "POST", "/v1/chat", Some(json!({"message": "hello"}))).await;
    let events = sse(&body);
    let fallback = events.iter().find(|(e, _)| e == "fallback").unwrap();
    assert_eq!(fallback.1["from"], "cloud");
    assert_eq!(fallback.1["to"], "local");
    assert!(events.iter().any(|(e, d)| e == "text" && d["delta"] == "Hi from the laptop."));
    assert_eq!(events.last().unwrap().0, "done");
}

#[tokio::test]
async fn uses_the_local_model_offline_and_reports_missing_models() {
    let local = ScriptedProvider::new(ProviderKind::Local, vec![reply(vec![Block::text("Offline answer.")], StopReason::EndTurn)]);
    let offline = Availability { cloud_configured: true, online: false, local_available: true };
    let h = harness(None, local, offline);
    let (_, body) = request(&h.state, "POST", "/v1/chat", Some(json!({"message": "hello"}))).await;
    assert_eq!(sse(&body)[0].1["provider"], "local");

    let none = Availability { cloud_configured: false, online: true, local_available: false };
    let h = harness(None, ScriptedProvider::new(ProviderKind::Local, vec![]), none);
    let (_, body) = request(&h.state, "POST", "/v1/chat", Some(json!({"message": "hello"}))).await;
    let events = sse(&body);
    assert_eq!(events[0].0, "error");
    assert!(events[0].1["message"].as_str().unwrap().contains("No model is set up"));
}

#[tokio::test]
async fn refusals_are_reported_and_not_saved() {
    let cloud = ScriptedProvider::new(
        ProviderKind::Cloud,
        vec![Ok(TurnOutput {
            content: vec![Block::text("Partial")],
            stop_reason: StopReason::Refusal,
            model: "claude-opus-5".into(),
            refusal_category: Some("cyber".into()),
            invalid_tool_inputs: vec![],
        })],
    );
    let h = harness(Some(cloud), ScriptedProvider::new(ProviderKind::Local, vec![]), ONLINE);
    let (_, body) = request(&h.state, "POST", "/v1/chat", Some(json!({"message": "x"}))).await;
    let events = sse(&body);
    let error = events.iter().find(|(e, _)| e == "error").unwrap();
    assert!(error.1["message"].as_str().unwrap().contains("declined"));
    let conversation_id = events[0].1["conversation_id"].as_str().unwrap();
    let messages = h.state.memory.messages(conversation_id).unwrap();
    assert_eq!(messages.len(), 1, "only the user's message is kept");
}

#[tokio::test]
async fn completes_one_shot_tasks() {
    let cloud = ScriptedProvider::new(ProviderKind::Cloud, vec![reply(vec![Block::text("```bash\ndu -sh ~\n```")], StopReason::EndTurn)]);
    let h = harness(Some(cloud.clone()), ScriptedProvider::new(ProviderKind::Local, vec![]), ONLINE);
    let (status, body) =
        request(&h.state, "POST", "/v1/complete", Some(json!({"task": "command", "input": "how big is my home folder"}))).await;
    assert_eq!(status, StatusCode::OK);
    let body: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(body["output"], "du -sh ~");
    assert_eq!(body["provider"], "cloud");

    let (status, _) = request(&h.state, "POST", "/v1/complete", Some(json!({"task": "juggle", "input": "x"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = request(&h.state, "POST", "/v1/embed", Some(json!({"input": ["a"]}))).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn notes_tools_write_markdown_files() {
    let cloud = ScriptedProvider::new(
        ProviderKind::Cloud,
        vec![
            reply(vec![tool_call("toolu_1", "create_note", json!({"title": "Groceries", "body": "- milk\n- eggs"}))], StopReason::ToolUse),
            reply(vec![Block::text("Saved.")], StopReason::EndTurn),
        ],
    );
    let h = harness(Some(cloud), ScriptedProvider::new(ProviderKind::Local, vec![]), ONLINE);
    request(&h.state, "POST", "/v1/chat", Some(json!({"message": "note: milk, eggs"}))).await;
    let note = std::fs::read_to_string(h.home.path().join("Notes/Groceries.md")).unwrap();
    assert_eq!(note, "# Groceries\n\n- milk\n- eggs\n");
}

#[tokio::test]
async fn rejects_empty_messages() {
    let h = harness(None, ScriptedProvider::new(ProviderKind::Local, vec![]), ONLINE);
    let (status, body) = request(&h.state, "POST", "/v1/chat", Some(json!({"message": "   "}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("empty"));
}

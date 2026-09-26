//! The agent loop: send the conversation, stream the reply, run requested tools (asking the
//! user first where needed), feed results back, and repeat until the model is done.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};

use crate::conversation::{Block, Message};
use crate::events::ChatEvent;
use crate::prompt::{self, TurnContext};
use crate::providers::{Provider, ProviderError, ProviderKind, StopReason, StreamEvent, TurnOutput, TurnRequest};
use crate::router;
use crate::state::AppState;
use crate::tools;

/// Upper bound on model calls per user message.
pub const MAX_STEPS: usize = 12;
pub const CONFIRM_TIMEOUT: Duration = Duration::from_secs(120);
pub const TOOL_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_TOOL_RESULT: usize = 16 * 1024;

pub struct ChatInput {
    pub message: String,
    pub conversation_id: Option<String>,
    pub context: TurnContext,
}

type Events = mpsc::UnboundedSender<ChatEvent>;

fn send(tx: &Events, event: ChatEvent) {
    let _ = tx.send(event);
}

/// Run one user message to completion, streaming [`ChatEvent`]s. Never panics; failures
/// become an `error` event.
pub async fn run_chat(state: Arc<AppState>, input: ChatInput, tx: Events) {
    if let Err(error) = run_chat_inner(&state, input, &tx).await {
        send(&tx, ChatEvent::Error { message: error.to_string() });
    }
}

fn max_tokens(state: &AppState, kind: ProviderKind) -> u32 {
    match kind {
        ProviderKind::Cloud => state.config.cloud.max_tokens,
        ProviderKind::Local => 4096,
    }
}

/// One model call with streaming forwarded to `tx`. Returns whether any text was produced,
/// which decides if a failure may be retried on the local model.
async fn call(provider: &dyn Provider, request: TurnRequest<'_>, tx: &Events) -> (Result<TurnOutput, ProviderError>, bool) {
    let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<StreamEvent>();
    let produced = Arc::new(AtomicBool::new(false));
    let forward = {
        let tx = tx.clone();
        let produced = produced.clone();
        let kind = provider.kind();
        tokio::spawn(async move {
            while let Some(event) = stream_rx.recv().await {
                match event {
                    StreamEvent::Text(delta) => {
                        produced.store(true, Ordering::Relaxed);
                        send(&tx, ChatEvent::Text { delta });
                    }
                    StreamEvent::ModelFallback { from, to } => send(
                        &tx,
                        ChatEvent::Fallback {
                            from: kind,
                            to: kind,
                            model: to.clone(),
                            reason: format!("{from} declined the request; {to} answered instead"),
                        },
                    ),
                }
            }
        })
    };
    let result = provider.turn(request, stream_tx).await;
    let _ = forward.await;
    (result, produced.load(Ordering::Relaxed))
}

async fn run_chat_inner(state: &Arc<AppState>, input: ChatInput, tx: &Events) -> anyhow::Result<()> {
    let mode = state.config.mode;
    let mut kind = router::choose(mode, state.probe.probe().await)?;
    let mut provider = state.provider(kind).ok_or_else(|| anyhow::anyhow!("provider unavailable"))?;

    let conversation_id = match input.conversation_id {
        Some(id) if state.memory.conversation_exists(&id)? => id,
        _ => state.memory.create_conversation(&input.message)?,
    };
    let mut history = state.memory.messages(&conversation_id)?;

    let context = if state.config.privacy.share_window_title {
        input.context
    } else {
        TurnContext { selection: input.context.selection, ..Default::default() }
    };
    let facts = state.memory.facts()?;
    let battery = helixos_syslib::power::read_battery(&state.tool_ctx.power_supply_dir).map(|b| (b.percent, b.charging));
    let user = Message::user(vec![
        Block::text(prompt::context_block(chrono::Local::now(), &context, &facts, battery)),
        Block::text(input.message.trim()),
    ]);
    history.push(user.clone());
    let mut new_messages = vec![user];

    let system = prompt::system_prompt(&state.config.name);
    let specs = tools::specs(&state.tools);
    send(tx, ChatEvent::Start { conversation_id: conversation_id.clone(), provider: kind, model: provider.model() });

    let mut stop = String::from("end_turn");
    let mut steps = 0;
    let outcome: anyhow::Result<()> = async {
        loop {
            steps += 1;
            if steps > MAX_STEPS {
                stop = "max_steps".into();
                send(tx, ChatEvent::Error { message: format!("Stopped after {MAX_STEPS} steps without finishing.") });
                return Ok(());
            }
            let request =
                TurnRequest { system: &system, messages: &history, tools: &specs, max_tokens: max_tokens(state, kind), effort: None };
            let (result, produced) = call(provider.as_ref(), request, tx).await;
            let output = match result {
                Ok(output) => output,
                Err(ProviderError::Unavailable(reason))
                    if kind == ProviderKind::Cloud && !produced && router::should_fall_back(mode, state.probe.probe().await) =>
                {
                    kind = ProviderKind::Local;
                    provider = state.local.clone();
                    send(tx, ChatEvent::Fallback { from: ProviderKind::Cloud, to: ProviderKind::Local, model: provider.model(), reason });
                    continue;
                }
                Err(error) => return Err(error.into()),
            };

            let assistant = Message::assistant(output.content.clone());
            match output.stop_reason {
                StopReason::ToolUse => {
                    history.push(assistant.clone());
                    new_messages.push(assistant.clone());
                    let results = run_tools(state, &conversation_id, &assistant, &output.invalid_tool_inputs, tx).await;
                    let results = Message::user(results);
                    history.push(results.clone());
                    new_messages.push(results);
                }
                StopReason::PauseTurn => {
                    history.push(assistant.clone());
                    new_messages.push(assistant);
                }
                StopReason::Refusal => {
                    // Discard the declined partial reply; it isn't a complete answer.
                    stop = "refusal".into();
                    let category = output.refusal_category.map(|c| format!(" ({c})")).unwrap_or_default();
                    send(tx, ChatEvent::Error { message: format!("The model declined this request{category}. Try rephrasing it.") });
                    return Ok(());
                }
                StopReason::MaxTokens => {
                    stop = "max_tokens".into();
                    history.push(assistant.clone());
                    new_messages.push(assistant.clone());
                    // Never run tools from a cut-off reply, but answer them so history stays valid.
                    let unanswered = unanswered_results(&assistant, "Not run: the reply was cut off before the tool call was complete.");
                    if !unanswered.is_empty() {
                        new_messages.push(Message::user(unanswered));
                    }
                    send(tx, ChatEvent::Error { message: "The reply hit the length limit and was cut off.".into() });
                    return Ok(());
                }
                StopReason::EndTurn | StopReason::StopSequence | StopReason::Other(_) => {
                    stop = output.stop_reason.as_str().to_string();
                    history.push(assistant.clone());
                    new_messages.push(assistant);
                    return Ok(());
                }
            }
        }
    }
    .await;

    state.memory.append(&conversation_id, &new_messages)?;
    outcome?;
    send(tx, ChatEvent::Done { stop_reason: stop });
    Ok(())
}

fn unanswered_results(assistant: &Message, reason: &str) -> Vec<Block> {
    assistant
        .tool_uses()
        .map(|(id, _, _)| Block::ToolResult { tool_use_id: id.to_string(), content: reason.to_string(), is_error: true })
        .collect()
}

/// Ask the user through the shell (Dynamic Island Allow/Deny) and wait for the answer.
async fn confirm(state: &AppState, tool: &tools::Tool, input: &Value, tx: &Events) -> bool {
    let request_id = uuid::Uuid::new_v4().to_string();
    let (answer_tx, answer_rx) = oneshot::channel();
    state.pending.lock().unwrap().insert(request_id.clone(), answer_tx);
    send(tx, ChatEvent::Confirm { request_id: request_id.clone(), tool: tool.spec.name.clone(), summary: (tool.describe)(input) });
    let allowed = matches!(tokio::time::timeout(CONFIRM_TIMEOUT, answer_rx).await, Ok(Ok(true)));
    state.pending.lock().unwrap().remove(&request_id);
    allowed
}

fn clip(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut cut = max;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}…", &text[..cut])
}

/// Run every tool call in an assistant message, returning all results for a single user
/// message (the API expects every tool_result for a turn in one message).
async fn run_tools(state: &AppState, conversation_id: &str, assistant: &Message, invalid: &[(String, String)], tx: &Events) -> Vec<Block> {
    let mut results = Vec::new();
    for (id, name, input) in assistant.tool_uses() {
        send(tx, ChatEvent::ToolCall { id: id.to_string(), name: name.to_string(), input: input.clone() });
        let outcome: Result<String, String> = if let Some((_, raw)) = invalid.iter().find(|(bad, _)| bad == id) {
            Err(json!({ "INVALID_JSON": raw }).to_string())
        } else if let Some(tool) = tools::find(&state.tools, name) {
            match tools::validate(&tool.spec.input_schema, input) {
                Err(problem) => Err(format!("Invalid input: {problem}")),
                Ok(()) if tool.confirm && !confirm(state, tool, input, tx).await => Err("The user declined this action.".into()),
                Ok(()) => match tokio::time::timeout(TOOL_TIMEOUT, (tool.handler)(&state.tool_ctx, input.clone())).await {
                    Ok(Ok(output)) => Ok(output),
                    Ok(Err(error)) => Err(error.to_string()),
                    Err(_) => Err("The tool timed out.".into()),
                },
            }
        } else {
            Err(format!("Unknown tool `{name}`."))
        };
        let (ok, output) = match outcome {
            Ok(output) => (true, clip(&output, MAX_TOOL_RESULT)),
            Err(error) => (false, clip(&error, MAX_TOOL_RESULT)),
        };
        if let Err(error) = state.memory.audit(conversation_id, name, input, &output, ok) {
            tracing::warn!("could not record tool call: {error}");
        }
        send(tx, ChatEvent::ToolResult { id: id.to_string(), name: name.to_string(), ok, output: clip(&output, 500) });
        results.push(Block::ToolResult { tool_use_id: id.to_string(), content: output, is_error: !ok });
    }
    results
}

/// One-shot completion for apps (summaries, rewrites, commands). No tools, low effort.
pub async fn complete(state: &AppState, prompt_text: String) -> anyhow::Result<(String, ProviderKind, String)> {
    let mode = state.config.mode;
    let mut kind = router::choose(mode, state.probe.probe().await)?;
    let messages = vec![Message::user(vec![Block::text(prompt_text)])];
    let system = format!(
        "You are {}, the assistant built into HelixOS. Follow the instruction exactly and output only what it asks for.",
        state.config.name
    );
    for _ in 0..2 {
        let provider = state.provider(kind).ok_or_else(|| anyhow::anyhow!("provider unavailable"))?;
        let request = TurnRequest {
            system: &system,
            messages: &messages,
            tools: &[],
            max_tokens: if kind == ProviderKind::Cloud { 16_000 } else { 2048 },
            effort: Some("low"),
        };
        let (tx, _rx) = mpsc::unbounded_channel();
        match provider.turn(request, tx).await {
            Ok(output) if output.stop_reason == StopReason::Refusal => anyhow::bail!("the model declined this request"),
            Ok(output) => {
                let text = Message::assistant(output.content).plain_text().trim().to_string();
                return Ok((strip_fences(&text), kind, output.model));
            }
            Err(ProviderError::Unavailable(_))
                if kind == ProviderKind::Cloud && router::should_fall_back(mode, state.probe.probe().await) =>
            {
                kind = ProviderKind::Local;
            }
            Err(error) => return Err(error.into()),
        }
    }
    anyhow::bail!("no model could complete the request")
}

/// Small models sometimes wrap single commands in code fences despite being told not to.
pub fn strip_fences(text: &str) -> String {
    let trimmed = text.trim();
    if let Some(inner) = trimmed.strip_prefix("```") {
        let inner = inner.split_once('\n').map(|(_, rest)| rest).unwrap_or(inner);
        return inner.trim_end().trim_end_matches("```").trim().to_string();
    }
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_code_fences() {
        assert_eq!(strip_fences("```bash\ndf -h\n```"), "df -h");
        assert_eq!(strip_fences("df -h"), "df -h");
    }

    #[test]
    fn answers_dangling_tool_calls() {
        let assistant =
            Message::assistant(vec![Block::text("x"), Block::ToolUse { id: "a".into(), name: "set_timer".into(), input: json!({}) }]);
        let results = unanswered_results(&assistant, "cut off");
        assert_eq!(results, vec![Block::ToolResult { tool_use_id: "a".into(), content: "cut off".into(), is_error: true }]);
    }
}

//! Prompts. The system prompt is stable (it is part of the cached prefix); everything that
//! changes per request goes in a context block at the start of the user's message.

use crate::memory::Fact;

pub fn system_prompt(name: &str) -> String {
    format!(
        "You are {name}, the assistant built into HelixOS, the desktop operating system on the user's laptop. \
You can see and control the computer through tools: settings (volume, brightness, Wi-Fi, Bluetooth, appearance, Focus), \
apps and windows, files in the user's home folder, notes, timers, and a memory of facts the user asks you to remember.

How to work:
- When the user asks you to do something on the computer, use the tools to do it, then confirm in one short sentence what changed.
- Answer questions directly. Your replies appear in a small panel, so keep them short: a few sentences or a brief list. Use Markdown sparingly.
- Each user message begins with a <context> block giving the time, the focused window, and remembered facts. Use it when it is relevant and never mention the block itself.
- Use tools only when they help with the request. Search for files instead of guessing paths.
- Some actions (running shell commands, moving files to the Trash, putting the computer to sleep) ask the user for permission first. If the user declines, accept it and suggest another way.
- If no tool can do what was asked, say so plainly instead of pretending."
    )
}

#[derive(Debug, Clone, Default)]
pub struct TurnContext {
    pub app: Option<String>,
    pub window_title: Option<String>,
    pub selection: Option<String>,
}

pub fn context_block(now: chrono::DateTime<chrono::Local>, context: &TurnContext, facts: &[Fact], battery: Option<(u32, bool)>) -> String {
    let mut lines = vec![format!("Time: {}", now.format("%A, %B %-d, %Y, %-I:%M %p"))];
    match (&context.app, &context.window_title) {
        (Some(app), Some(title)) if !title.is_empty() => lines.push(format!("Focused window: {app} — \"{title}\"")),
        (Some(app), _) => lines.push(format!("Focused window: {app}")),
        _ => {}
    }
    if let Some((percent, charging)) = battery {
        lines.push(format!("Battery: {percent}%{}", if charging { " (charging)" } else { "" }));
    }
    if let Some(selection) = context.selection.as_deref().filter(|s| !s.trim().is_empty()) {
        let clipped: String = selection.chars().take(2000).collect();
        lines.push(format!("Selected text:\n{clipped}"));
    }
    if !facts.is_empty() {
        lines.push("Remembered about the user:".into());
        lines.extend(facts.iter().take(30).map(|f| format!("- {}", f.text)));
    }
    format!("<context>\n{}\n</context>", lines.join("\n"))
}

/// One-shot tasks for apps (`POST /v1/complete`): Notes, Mail, Terminal, Files, ...
pub fn completion_prompt(task: &str, input: &str, options: &serde_json::Map<String, serde_json::Value>) -> Result<String, String> {
    let option = |key: &str| options.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let list = |key: &str| -> Vec<String> {
        options
            .get(key)
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    };
    let instruction = match task {
        "summarize" => "Summarize the text below in three to five short bullet points. Output only the bullets.".to_string(),
        "rewrite" => {
            let tone = option("tone");
            let tone = if tone.is_empty() { "clearer and more concise".to_string() } else { tone };
            format!("Rewrite the text below to be {tone}. Keep the meaning and the language. Output only the rewritten text.")
        }
        "classify" => {
            let labels = list("labels");
            if labels.is_empty() {
                return Err("classify needs options.labels".into());
            }
            format!("Classify the text below. Answer with exactly one of these labels and nothing else: {}.", labels.join(", "))
        }
        "reply" => {
            let intent = option("intent");
            let guidance = if intent.is_empty() { String::new() } else { format!(" The reply should: {intent}.") };
            format!("Draft a reply to the message below, written as the user.{guidance} Output only the reply body, without a subject line.")
        }
        "explain" => "Explain the text below in plain language, in a short paragraph.".to_string(),
        "command" => "Turn the request below into a single Linux shell command for bash on Arch Linux. Output only the command, with no explanation and no code fences.".to_string(),
        "extract" => {
            let fields = list("fields");
            if fields.is_empty() {
                return Err("extract needs options.fields".into());
            }
            format!("Extract these fields from the text below: {}. Output only a JSON object with exactly those keys, using null when a field is missing.", fields.join(", "))
        }
        "customize" => "You customize the look and behavior of the user's desktop. The text below has their request, the settings you can change with their allowed values, built-in looks, and the current settings. \
Answer with only a JSON object: {\"patch\": {...}, \"summary\": \"...\"}. The patch holds only the settings to change, nested by section (e.g. {\"dock\": {\"style\": \"taskbar\"}}), using only listed settings and allowed values. \
The summary is one short sentence in plain words, e.g. \"Moved the apps to a taskbar and put window buttons on the right.\" If the request can't be done with these settings, return an empty patch and say what isn't possible in the summary.".to_string(),
        "title" => "Write a short title (at most six words) for the text below. Output only the title.".to_string(),
        "continue" => "Continue the text below in the same voice, language, and format: one or two more paragraphs, or more items if it ends in a list. Output only the new text, without repeating what is already there.".to_string(),
        other => return Err(format!("unknown task: {other}")),
    };
    Ok(format!("{instruction}\n\n<text>\n{input}\n</text>"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    #[test]
    fn builds_a_context_block() {
        let now = chrono::Local.with_ymd_and_hms(2026, 9, 24, 23, 5, 0).unwrap();
        let context = TurnContext { app: Some("firefox".into()), window_title: Some("News".into()), selection: None };
        let facts = vec![Fact { id: 1, text: "Prefers metric units".into(), created_at: 0 }];
        let block = context_block(now, &context, &facts, Some((57, false)));
        assert!(block.starts_with("<context>\nTime: Thursday, September 24, 2026, 11:05 PM"));
        assert!(block.contains("Focused window: firefox — \"News\""));
        assert!(block.contains("Battery: 57%\n"));
        assert!(block.contains("- Prefers metric units"));
        assert!(block.ends_with("</context>"));
    }

    #[test]
    fn system_prompt_uses_the_name() {
        assert!(system_prompt("Nova").starts_with("You are Nova, the assistant built into HelixOS"));
    }

    #[test]
    fn builds_completion_prompts() {
        let options = json!({"labels": ["urgent", "later"]});
        let prompt = completion_prompt("classify", "Server down!", options.as_object().unwrap()).unwrap();
        assert!(prompt.contains("urgent, later"));
        assert!(prompt.ends_with("<text>\nServer down!\n</text>"));
        assert!(completion_prompt("classify", "x", &Default::default()).is_err());
        assert!(completion_prompt("dance", "x", &Default::default()).is_err());
        assert!(completion_prompt("summarize", "x", &Default::default()).is_ok());
        assert!(completion_prompt("continue", "Dear Sam,", &Default::default()).unwrap().contains("Continue the text"));
    }
}

//! Provider-neutral conversation model, stored in the memory database and converted to each
//! provider's wire format.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Block {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(default, skip_serializing_if = "is_false")]
        is_error: bool,
    },
    /// A provider-specific block (Claude thinking blocks, fallback markers, ...) kept exactly
    /// as received so it can be replayed to the same provider unchanged. Other providers skip it.
    Raw {
        provider: String,
        value: Value,
    },
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl Block {
    pub fn text(text: impl Into<String>) -> Self {
        Block::Text { text: text.into() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: Vec<Block>,
}

impl Message {
    pub fn user(content: Vec<Block>) -> Self {
        Self { role: Role::User, content }
    }

    pub fn assistant(content: Vec<Block>) -> Self {
        Self { role: Role::Assistant, content }
    }

    /// Concatenated text of the message, for titles and previews.
    pub fn plain_text(&self) -> String {
        self.content
            .iter()
            .filter_map(|b| match b {
                Block::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn tool_uses(&self) -> impl Iterator<Item = (&str, &str, &Value)> {
        self.content.iter().filter_map(|b| match b {
            Block::ToolUse { id, name, input } => Some((id.as_str(), name.as_str(), input)),
            _ => None,
        })
    }
}

/// Short title for a conversation from its first user message.
pub fn title_from(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("New conversation");
    let mut title: String = line.chars().take(60).collect();
    if line.chars().count() > 60 {
        title.push('…');
    }
    title
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_with_type_tags() {
        let message = Message::assistant(vec![
            Block::text("Hi"),
            Block::ToolUse { id: "t1".into(), name: "set_timer".into(), input: json!({"seconds": 60}) },
        ]);
        let value = serde_json::to_value(&message).unwrap();
        assert_eq!(value["content"][0], json!({"type": "text", "text": "Hi"}));
        assert_eq!(value["content"][1]["type"], "tool_use");
        let back: Message = serde_json::from_value(value).unwrap();
        assert_eq!(back, message);
    }

    #[test]
    fn omits_false_error_flags() {
        let block = Block::ToolResult { tool_use_id: "t1".into(), content: "ok".into(), is_error: false };
        assert_eq!(serde_json::to_value(&block).unwrap(), json!({"type": "tool_result", "tool_use_id": "t1", "content": "ok"}));
    }

    #[test]
    fn titles_are_short() {
        assert_eq!(title_from("\n  Set a timer\nplease"), "Set a timer");
        assert_eq!(title_from(&"a".repeat(80)).chars().count(), 61);
        assert_eq!(title_from(""), "New conversation");
    }
}

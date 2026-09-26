//! Settings → Assistant edits `~/.config/helixos/assistant.toml` in place, keeping the user's
//! comments and any keys it does not manage. assistantd reads the file at start, so a change is
//! followed by a restart of its user service.

use std::path::Path;

use serde::Serialize;
use toml_edit::{value, DocumentMut, Item, Table};

use crate::{AppError, Result};

/// Models offered in Settings. The first is assistantd's default.
pub const CLOUD_MODELS: [&str; 5] = ["claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5-1"];
pub const MODES: [&str; 3] = ["auto", "cloud", "local"];
pub const EFFORT_LEVELS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// The subset of assistant.toml that Settings shows, with assistantd's defaults filled in.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AssistantSettings {
    pub mode: String,
    pub name: String,
    pub cloud_model: String,
    pub effort: String,
    pub local_model: String,
    pub share_window_title: bool,
    pub store_history: bool,
    pub allow_shell: bool,
}

impl Default for AssistantSettings {
    fn default() -> Self {
        Self {
            mode: "auto".into(),
            name: "Assistant".into(),
            cloud_model: CLOUD_MODELS[0].into(),
            effort: "medium".into(),
            local_model: "qwen2.5:3b".into(),
            share_window_title: true,
            store_history: true,
            allow_shell: true,
        }
    }
}

/// (section, key) in the TOML file for each settable field.
fn location(field: &str) -> Option<(Option<&'static str>, &'static str)> {
    Some(match field {
        "mode" => (None, "mode"),
        "name" => (None, "name"),
        "cloud_model" => (Some("cloud"), "model"),
        "effort" => (Some("cloud"), "effort"),
        "local_model" => (Some("local"), "model"),
        "share_window_title" => (Some("privacy"), "share_window_title"),
        "store_history" => (Some("privacy"), "store_history"),
        "allow_shell" => (Some("tools"), "allow_shell"),
        _ => return None,
    })
}

fn parse(text: &str) -> Result<DocumentMut> {
    text.parse::<DocumentMut>().map_err(|e| AppError::Invalid(format!("assistant.toml is not valid TOML: {e}")))
}

fn lookup<'a>(doc: &'a DocumentMut, section: Option<&str>, key: &str) -> Option<&'a Item> {
    match section {
        None => doc.get(key),
        Some(section) => doc.get(section)?.as_table_like()?.get(key),
    }
}

pub fn read(path: &Path) -> Result<AssistantSettings> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(AssistantSettings::default()),
        Err(e) => return Err(e.into()),
    };
    let doc = parse(&text)?;
    let mut settings = AssistantSettings::default();
    let str_of = |field: &str| {
        let (section, key) = location(field)?;
        lookup(&doc, section, key)?.as_str().map(str::to_string)
    };
    let bool_of = |field: &str| {
        let (section, key) = location(field)?;
        lookup(&doc, section, key)?.as_bool()
    };
    settings.mode = str_of("mode").unwrap_or(settings.mode);
    settings.name = str_of("name").unwrap_or(settings.name);
    settings.cloud_model = str_of("cloud_model").unwrap_or(settings.cloud_model);
    settings.effort = str_of("effort").unwrap_or(settings.effort);
    settings.local_model = str_of("local_model").unwrap_or(settings.local_model);
    settings.share_window_title = bool_of("share_window_title").unwrap_or(settings.share_window_title);
    settings.store_history = bool_of("store_history").unwrap_or(settings.store_history);
    settings.allow_shell = bool_of("allow_shell").unwrap_or(settings.allow_shell);
    Ok(settings)
}

/// Check a value before it is written, with the same rules assistantd enforces at load (a bad
/// value would stop the daemon from starting).
fn validate(field: &str, new: &serde_json::Value) -> Result<toml_edit::Value> {
    let invalid = |why: &str| AppError::Invalid(format!("{field}: {why}"));
    match field {
        "share_window_title" | "store_history" | "allow_shell" => {
            new.as_bool().map(toml_edit::Value::from).ok_or_else(|| invalid("expected true or false"))
        }
        _ => {
            let text = new.as_str().ok_or_else(|| invalid("expected text"))?.trim();
            let ok = match field {
                "mode" => MODES.contains(&text),
                "effort" => EFFORT_LEVELS.contains(&text),
                "name" => !text.is_empty() && text.chars().count() <= 32 && !text.chars().any(char::is_control),
                // Custom model ids are allowed: new models ship before HelixOS updates its list.
                "cloud_model" => {
                    text.starts_with("claude-")
                        && text.len() <= 64
                        && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
                }
                // Ollama tags: "qwen2.5:3b", "hf.co/org/model:Q4_K_M"
                "local_model" => {
                    !text.is_empty() && text.len() <= 128 && text.chars().all(|c| c.is_ascii_alphanumeric() || "-._:/".contains(c))
                }
                _ => false,
            };
            if ok {
                Ok(toml_edit::Value::from(text))
            } else {
                Err(invalid("not an allowed value"))
            }
        }
    }
}

/// Set one field and return the new settings.
pub fn set(path: &Path, field: &str, new: &serde_json::Value) -> Result<AssistantSettings> {
    let (section, key) = location(field).ok_or_else(|| AppError::Invalid(format!("unknown assistant setting: {field}")))?;
    let new = validate(field, new)?;
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    let mut doc = parse(&text)?;
    match section {
        None => {
            doc[key] = value(new);
        }
        Some(section) => {
            if !doc.contains_table(section) {
                doc.insert(section, Item::Table(Table::new()));
            }
            doc[section][key] = value(new);
        }
    }
    crate::write_atomic(path, doc.to_string().as_bytes())?;
    read(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_file_reads_as_defaults() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(&dir.path().join("none.toml")).unwrap(), AssistantSettings::default());
    }

    #[test]
    fn edits_keep_comments_and_unknown_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("assistant.toml");
        std::fs::write(&path, "# my notes\nmode = \"auto\"\n\n[cloud]\n# keep this\nbase_url = \"https://example\"\n").unwrap();
        let settings = set(&path, "cloud_model", &json!("claude-sonnet-5")).unwrap();
        assert_eq!(settings.cloud_model, "claude-sonnet-5");
        set(&path, "store_history", &json!(false)).unwrap();
        set(&path, "mode", &json!("local")).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("# my notes") && text.contains("# keep this") && text.contains("base_url"));
        let settings = read(&path).unwrap();
        assert_eq!((settings.mode.as_str(), settings.store_history), ("local", false));
    }

    #[test]
    fn rejects_values_assistantd_would_refuse() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("assistant.toml");
        assert!(set(&path, "effort", &json!("extreme")).is_err());
        assert!(set(&path, "mode", &json!("sometimes")).is_err());
        assert!(set(&path, "name", &json!("   ")).is_err());
        assert!(set(&path, "cloud_model", &json!("gpt-5")).is_err());
        assert!(set(&path, "local_model", &json!("qwen2.5:3b; rm")).is_err());
        assert!(set(&path, "api_key_file", &json!("/tmp/x")).is_err());
        assert!(!path.exists(), "nothing is written when validation fails");
    }

    #[test]
    fn offered_models_include_the_daemon_default() {
        let config = include_str!("../../assistantd/src/config.rs");
        assert!(config.contains(&format!("model: \"{}\".into()", CLOUD_MODELS[0])));
    }
}

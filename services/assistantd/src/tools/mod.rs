//! Tools the assistant can call. Each has a JSON Schema, an async handler, and a flag saying
//! whether the user must approve it first (shown as Allow/Deny in the Dynamic Island).

mod apps;
mod files;
mod memory_tools;
mod notes;
mod shell;
mod system;
mod timers;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use newos_syslib::CommandRunner;
use serde_json::{json, Value};
use tokio::sync::broadcast;

pub use timers::TimerInfo;

use crate::events::SystemEvent;
use crate::memory::Memory;
use crate::providers::{BoxFuture, ToolSpec};

pub struct ToolContext {
    pub runner: Arc<dyn CommandRunner>,
    pub home: PathBuf,
    pub notes_dir: PathBuf,
    pub memory: Arc<Memory>,
    pub events: broadcast::Sender<SystemEvent>,
    pub timers: Mutex<Vec<TimerInfo>>,
    pub app_dirs: Vec<PathBuf>,
    pub power_supply_dir: PathBuf,
}

impl ToolContext {
    /// Resolve "~/x", "x" (relative to home) and absolute paths.
    pub fn resolve(&self, raw: &str) -> PathBuf {
        let raw = raw.trim();
        if raw == "~" {
            return self.home.clone();
        }
        if let Some(rest) = raw.strip_prefix("~/") {
            return self.home.join(rest);
        }
        let path = Path::new(raw);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.home.join(path)
        }
    }

    /// Resolve and require the path to exist inside the home folder (no `..` escapes, no
    /// symlinks pointing outside).
    pub fn resolve_in_home(&self, raw: &str) -> anyhow::Result<PathBuf> {
        let path = self.resolve(raw);
        let canonical = path.canonicalize().map_err(|_| anyhow::anyhow!("{} does not exist", path.display()))?;
        let home = self.home.canonicalize().unwrap_or_else(|_| self.home.clone());
        anyhow::ensure!(canonical.starts_with(&home), "only files inside your home folder can be used ({})", canonical.display());
        Ok(canonical)
    }
}

pub type Handler = for<'a> fn(&'a ToolContext, Value) -> BoxFuture<'a, anyhow::Result<String>>;

pub struct Tool {
    pub spec: ToolSpec,
    /// Ask the user before running.
    pub confirm: bool,
    pub handler: Handler,
    /// One line describing what will happen, for the confirmation prompt.
    pub describe: fn(&Value) -> String,
}

fn describe_json(input: &Value) -> String {
    input.to_string()
}

pub(crate) fn tool(name: &str, description: &str, schema: Value, handler: Handler) -> Tool {
    Tool {
        spec: ToolSpec { name: name.into(), description: description.into(), input_schema: schema },
        confirm: false,
        handler,
        describe: describe_json,
    }
}

pub(crate) fn object_schema(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false,
    })
}

pub(crate) fn str_arg<'a>(input: &'a Value, key: &str) -> anyhow::Result<&'a str> {
    input[key].as_str().ok_or_else(|| anyhow::anyhow!("missing `{key}`"))
}

pub(crate) fn opt_str<'a>(input: &'a Value, key: &str) -> Option<&'a str> {
    input[key].as_str().filter(|s| !s.trim().is_empty())
}

pub(crate) fn bool_arg(input: &Value, key: &str) -> anyhow::Result<bool> {
    input[key].as_bool().ok_or_else(|| anyhow::anyhow!("missing `{key}`"))
}

pub(crate) fn int_arg(input: &Value, key: &str) -> anyhow::Result<i64> {
    input[key].as_i64().or_else(|| input[key].as_f64().map(|f| f.round() as i64)).ok_or_else(|| anyhow::anyhow!("missing `{key}`"))
}

/// Every tool, in a stable order (the order is part of the cached prompt prefix).
pub fn all(allow_shell: bool) -> Vec<Tool> {
    let mut tools = Vec::new();
    tools.extend(system::tools());
    tools.extend(apps::tools());
    tools.extend(files::tools());
    tools.extend(notes::tools());
    tools.extend(timers::tools());
    tools.extend(memory_tools::tools());
    if allow_shell {
        tools.extend(shell::tools());
    }
    tools
}

pub fn specs(tools: &[Tool]) -> Vec<ToolSpec> {
    tools.iter().map(|t| t.spec.clone()).collect()
}

pub fn find<'a>(tools: &'a [Tool], name: &str) -> Option<&'a Tool> {
    tools.iter().find(|t| t.spec.name == name)
}

/// Validate tool input against the subset of JSON Schema the tools use: object type,
/// required keys, additionalProperties: false, and per-property type/enum/min/max/maxLength.
/// Tool inputs stream eagerly (unvalidated by the API), so this runs before every call.
pub fn validate(schema: &Value, input: &Value) -> Result<(), String> {
    let Some(object) = input.as_object() else { return Err("input must be a JSON object".into()) };
    let properties = schema["properties"].as_object().cloned().unwrap_or_default();
    for key in schema["required"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        if !object.contains_key(key) {
            return Err(format!("missing required field `{key}`"));
        }
    }
    for (key, value) in object {
        let Some(property) = properties.get(key) else {
            if schema["additionalProperties"] == json!(false) {
                return Err(format!("unknown field `{key}`"));
            }
            continue;
        };
        let expected = property["type"].as_str().unwrap_or("any");
        let type_ok = match expected {
            "string" => value.is_string(),
            "integer" => value.is_i64() || value.is_u64() || value.as_f64().is_some_and(|f| f.fract() == 0.0),
            "number" => value.is_number(),
            "boolean" => value.is_boolean(),
            "array" => value.is_array(),
            "object" => value.is_object(),
            _ => true,
        };
        if !type_ok {
            return Err(format!("`{key}` must be a {expected}"));
        }
        if let Some(options) = property["enum"].as_array() {
            if !options.contains(value) {
                return Err(format!("`{key}` must be one of {}", Value::Array(options.clone())));
            }
        }
        if let Some(n) = value.as_f64() {
            if property["minimum"].as_f64().is_some_and(|min| n < min) || property["maximum"].as_f64().is_some_and(|max| n > max) {
                return Err(format!("`{key}` is out of range"));
            }
        }
        if let (Some(s), Some(max)) = (value.as_str(), property["maxLength"].as_u64()) {
            if s.chars().count() as u64 > max {
                return Err(format!("`{key}` is too long"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema() -> Value {
        object_schema(
            json!({
                "seconds": {"type": "integer", "minimum": 1, "maximum": 86400},
                "label": {"type": "string", "maxLength": 5},
                "mode": {"type": "string", "enum": ["dark", "light"]},
            }),
            &["seconds"],
        )
    }

    #[test]
    fn validates_inputs() {
        assert!(validate(&schema(), &json!({"seconds": 60})).is_ok());
        assert!(validate(&schema(), &json!({"seconds": 60.0, "label": "tea"})).is_ok());
        assert!(validate(&schema(), &json!({})).unwrap_err().contains("seconds"));
        assert!(validate(&schema(), &json!({"seconds": "60"})).unwrap_err().contains("integer"));
        assert!(validate(&schema(), &json!({"seconds": 0})).unwrap_err().contains("range"));
        assert!(validate(&schema(), &json!({"seconds": 1, "mode": "blue"})).unwrap_err().contains("one of"));
        assert!(validate(&schema(), &json!({"seconds": 1, "extra": true})).unwrap_err().contains("unknown"));
        assert!(validate(&schema(), &json!({"seconds": 1, "label": "too long"})).unwrap_err().contains("long"));
        assert!(validate(&schema(), &json!([1])).is_err());
    }

    #[test]
    fn every_tool_schema_is_consistent() {
        let tools = all(true);
        let mut names = std::collections::HashSet::new();
        for tool in &tools {
            assert!(names.insert(tool.spec.name.clone()), "duplicate tool {}", tool.spec.name);
            assert!(tool.spec.name.chars().all(|c| c.is_ascii_lowercase() || c == '_'), "{}", tool.spec.name);
            assert!(tool.spec.description.len() > 20, "{} needs a real description", tool.spec.name);
            let schema = &tool.spec.input_schema;
            assert_eq!(schema["type"], "object", "{}", tool.spec.name);
            assert_eq!(schema["additionalProperties"], false, "{}", tool.spec.name);
            let properties = schema["properties"].as_object().unwrap();
            for required in schema["required"].as_array().unwrap() {
                assert!(properties.contains_key(required.as_str().unwrap()), "{} requires unknown {required}", tool.spec.name);
            }
        }
        assert!(tools.iter().any(|t| t.spec.name == "run_shell" && t.confirm));
        assert!(!all(false).iter().any(|t| t.spec.name == "run_shell"));
        assert!(find(&tools, "move_to_trash").unwrap().confirm);
        assert!(!find(&tools, "set_volume").unwrap().confirm);
    }
}

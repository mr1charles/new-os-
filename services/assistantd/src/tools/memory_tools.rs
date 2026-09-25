use serde_json::{json, Value};

use super::{object_schema, str_arg, tool, Tool, ToolContext};
use crate::providers::BoxFuture;

pub fn tools() -> Vec<Tool> {
    vec![
        tool(
            "remember",
            "Save a lasting fact about the user or their preferences (e.g. \"prefers Celsius\", \"partner's name is Sam\"). Call this only when the user asks you to remember something or clearly states a lasting preference.",
            object_schema(json!({"fact": {"type": "string", "maxLength": 300}}), &["fact"]),
            remember,
        ),
        tool(
            "forget",
            "Forget remembered facts that contain the given text.",
            object_schema(json!({"fact": {"type": "string"}}), &["fact"]),
            forget,
        ),
    ]
}

fn remember<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let fact = ctx.memory.remember(str_arg(&input, "fact")?)?;
        Ok(format!("Remembered: {}", fact.text))
    })
}

fn forget<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let count = ctx.memory.forget(str_arg(&input, "fact")?)?;
        Ok(format!("Forgot {count} fact(s)."))
    })
}

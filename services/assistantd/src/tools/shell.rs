use serde_json::{json, Value};

use super::{object_schema, str_arg, tool, Tool, ToolContext};
use crate::providers::BoxFuture;

const MAX_OUTPUT: usize = 8 * 1024;

pub fn tools() -> Vec<Tool> {
    vec![Tool {
        confirm: true,
        describe: |input| input["command"].as_str().unwrap_or("?").to_string(),
        ..tool(
            "run_shell",
            "Run a bash command as the user and return its output. Every command is shown to the user, who must approve it first. Prefer the dedicated tools when one fits; use this for tasks they don't cover, like checking disk usage or package versions.",
            object_schema(json!({"command": {"type": "string", "maxLength": 2000}}), &["command"]),
            run_shell,
        )
    }]
}

fn run_shell<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let command = str_arg(&input, "command")?;
        let args = vec!["-lc".to_string(), command.to_string()];
        let output = ctx.runner.run("bash", &args).await?;
        let mut text = output.stdout;
        if !output.stderr.trim().is_empty() {
            text.push_str("\n[stderr]\n");
            text.push_str(&output.stderr);
        }
        if text.len() > MAX_OUTPUT {
            let mut cut = MAX_OUTPUT;
            while !text.is_char_boundary(cut) {
                cut -= 1;
            }
            text.truncate(cut);
            text.push_str("\n[output truncated]");
        }
        anyhow::ensure!(output.status == 0, "exit status {}\n{}", output.status, text.trim());
        Ok(if text.trim().is_empty() { "(no output)".into() } else { text })
    })
}

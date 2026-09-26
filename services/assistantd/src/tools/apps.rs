use helixos_syslib::{desktop, hyprland, shell};
use serde_json::{json, Value};

use super::{object_schema, opt_str, str_arg, tool, Tool, ToolContext};
use crate::providers::BoxFuture;

pub fn tools() -> Vec<Tool> {
    vec![
        tool(
            "open_app",
            "Open an installed application by name, e.g. \"Firefox\", \"Files\", \"Terminal\", or a kind of app like \"web browser\". Call this whenever the user asks to open, launch, or start an app.",
            object_schema(json!({"name": {"type": "string", "description": "App name or kind of app"}}), &["name"]),
            open_app,
        ),
        tool(
            "list_apps",
            "List installed applications, optionally filtered by a word. Call this when the user asks what apps they have or when open_app cannot find an app.",
            object_schema(json!({"query": {"type": "string"}}), &[]),
            list_apps,
        ),
        tool(
            "list_windows",
            "List open windows (app, title, address), most recently used first. Call this before focus_window, or when the user asks what is open.",
            object_schema(json!({}), &[]),
            list_windows,
        ),
        tool(
            "focus_window",
            "Bring an open window to the front by its address from list_windows.",
            object_schema(json!({"address": {"type": "string", "description": "Window address such as 0x55d1a2b3c4d0"}}), &["address"]),
            focus_window,
        ),
        tool(
            "open_url",
            "Open a web page (http or https) or a mailto: link in the default app. Call this when the user asks to open or visit a website.",
            object_schema(json!({"url": {"type": "string"}}), &["url"]),
            open_url,
        ),
    ]
}

fn open_app<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let name = str_arg(&input, "name")?;
        let apps = desktop::list_apps(&ctx.app_dirs);
        let Some(app) = desktop::find_app(name, &apps) else {
            anyhow::bail!("no installed app matches \"{name}\"; the App Store can install it");
        };
        shell::launch_app(ctx.runner.as_ref(), &app.id).await?;
        Ok(format!("Opened {}.", app.name))
    })
}

fn list_apps<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let query = opt_str(&input, "query").map(str::to_lowercase);
        let names: Vec<String> = desktop::list_apps(&ctx.app_dirs)
            .into_iter()
            .filter(|a| {
                query.as_ref().is_none_or(|q| {
                    a.name.to_lowercase().contains(q)
                        || a.generic_name.as_deref().unwrap_or_default().to_lowercase().contains(q)
                        || a.keywords.iter().any(|k| k.to_lowercase().contains(q))
                })
            })
            .map(|a| a.name)
            .take(80)
            .collect();
        Ok(if names.is_empty() { "No matching apps.".into() } else { names.join(", ") })
    })
}

fn list_windows<'a>(ctx: &'a ToolContext, _input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let windows = hyprland::list_windows(ctx.runner.as_ref()).await?;
        let list: Vec<Value> =
            windows.iter().map(|w| json!({"app": w.class, "title": w.title, "address": w.address, "desktop": w.workspace.name})).collect();
        Ok(Value::Array(list).to_string())
    })
}

fn focus_window<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        hyprland::focus_window(ctx.runner.as_ref(), str_arg(&input, "address")?).await?;
        Ok("Window focused.".into())
    })
}

fn open_url<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let url = str_arg(&input, "url")?;
        shell::open_url(ctx.runner.as_ref(), url).await?;
        Ok(format!("Opened {url}."))
    })
}

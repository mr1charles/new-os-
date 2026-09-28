//! What every HelixOS app shares on the Tauri side: the settings file and assistant commands,
//! the settings watcher, and the main window with HelixOS chrome. An app adds its own commands
//! with [`with_common_commands`] and calls [`setup`] from its `.setup()` hook.
//!
//! The frontend reaches these through `@helixos/sdk` (`settings`, `assistant`, `island`).

use std::path::PathBuf;
use std::sync::Mutex;

use helixos_syslib::SystemRunner;
use serde_json::Value;
use tauri::ipc::{Channel, Invoke};
use tauri::{App, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

use crate::assistant_client::AssistantClient;
use crate::{assistant_config, keyring, paths, settings, AppError};

/// Emitted with the new contents when `shell.json` changes on disk.
pub const SETTINGS_CHANGED_EVENT: &str = "helixos://settings-changed";

/// State for the shared commands. Register it with `.manage(Common::from_env())`.
pub struct Common {
    pub runner: SystemRunner,
    pub assistant: AssistantClient,
    pub settings_file: PathBuf,
    pub assistant_config: PathBuf,
}

impl Common {
    pub fn from_env() -> Self {
        Self {
            runner: SystemRunner::default(),
            assistant: AssistantClient::from_env(),
            settings_file: paths::settings_file(),
            assistant_config: paths::assistant_config_file(),
        }
    }
}

type Result<T> = std::result::Result<T, AppError>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| AppError::Invalid(e.to_string()))?
}

#[tauri::command]
pub fn settings_read(common: State<'_, Common>) -> Value {
    settings::read(&common.settings_file)
}

#[tauri::command]
pub fn settings_update(common: State<'_, Common>, patch: Value) -> Result<Value> {
    settings::update(&common.settings_file, &patch)
}

#[tauri::command]
pub async fn assistant_request(common: State<'_, Common>, method: String, path: String, body: Option<Value>) -> Result<Value> {
    common.assistant.request(&method, &path, body.as_ref()).await
}

#[tauri::command]
pub async fn assistant_stream(common: State<'_, Common>, path: String, body: Value, on_chunk: Channel<String>) -> Result<()> {
    common
        .assistant
        .stream(&path, &body, |chunk| {
            // A closed channel means the page went away; the stream just ends.
            let _ = on_chunk.send(chunk);
        })
        .await
}

#[tauri::command]
pub fn assistant_settings_read(common: State<'_, Common>) -> Result<assistant_config::AssistantSettings> {
    assistant_config::read(&common.assistant_config)
}

#[tauri::command]
pub fn assistant_settings_set(common: State<'_, Common>, field: String, value: Value) -> Result<assistant_config::AssistantSettings> {
    assistant_config::set(&common.assistant_config, &field, &value)
}

#[tauri::command]
pub async fn assistant_key_status() -> Result<bool> {
    blocking(|| Ok(keyring::has_api_key())).await
}

#[tauri::command]
pub async fn assistant_key_store(key: String) -> Result<()> {
    blocking(move || keyring::store_api_key(&key)).await
}

#[tauri::command]
pub async fn assistant_key_clear() -> Result<()> {
    blocking(keyring::clear_api_key).await
}

#[tauri::command]
pub async fn assistant_restart(common: State<'_, Common>) -> Result<()> {
    crate::assistant_client::restart_daemon(&common.runner).await
}

#[tauri::command]
pub async fn island_show(id: String, activity: crate::island::Activity) -> Result<()> {
    crate::island::show(&id, &activity).await
}

#[tauri::command]
pub async fn island_end(id: String) -> Result<()> {
    crate::island::end(&id).await
}

#[tauri::command]
pub async fn notify(notification: crate::island::Notification) -> Result<u32> {
    crate::island::notify(&notification).await
}

/// The shared commands, by name. Kept in step with the handler below by a test.
pub const COMMANDS: &[&str] = &[
    "settings_read",
    "settings_update",
    "assistant_request",
    "assistant_stream",
    "assistant_settings_read",
    "assistant_settings_set",
    "assistant_key_status",
    "assistant_key_store",
    "assistant_key_clear",
    "assistant_restart",
    "island_show",
    "island_end",
    "notify",
];

fn common_handler<R: Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        settings_read,
        settings_update,
        assistant_request,
        assistant_stream,
        assistant_settings_read,
        assistant_settings_set,
        assistant_key_status,
        assistant_key_store,
        assistant_key_clear,
        assistant_restart,
        island_show,
        island_end,
        notify,
    ]
}

/// One invoke handler for the shared commands plus the app's own (`tauri::generate_handler!`).
pub fn with_common_commands<R: Runtime>(
    app_handler: impl Fn(Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    let common = common_handler::<R>();
    move |invoke| if COMMANDS.contains(&invoke.message.command()) { common(invoke) } else { app_handler(invoke) }
}

/// The main window: no server-side decorations (`@helixos/ui` draws the traffic lights, and
/// Hyprland adds rounding, shadow, and blur), transparent for sidebar vibrancy.
pub struct WindowSpec<'a> {
    pub title: &'a str,
    /// Page URL with an optional query, e.g. "index.html?page=wifi".
    pub url: String,
    pub size: (f64, f64),
    pub min_size: (f64, f64),
    /// Start fullscreen (e.g. the first-run Setup wizard). Set on the builder itself, not with
    /// a `set_fullscreen` call after `build()` — asking a window manager to fullscreen a window
    /// that already mapped at `size` is a request it can silently miss or apply too late, and
    /// under Hyprland it left Setup's window sitting at its initial 1100x720 size, half off the
    /// edge of a smaller real screen, instead of covering it.
    pub fullscreen: bool,
}

/// Open the main window and start reporting `shell.json` changes to the frontend.
pub fn setup<R: Runtime>(app: &mut App<R>, window: WindowSpec<'_>) -> std::result::Result<(), Box<dyn std::error::Error>> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App(window.url.into()))
        .title(window.title)
        .inner_size(window.size.0, window.size.1)
        .min_inner_size(window.min_size.0, window.min_size.1)
        .decorations(false)
        .transparent(true)
        .fullscreen(window.fullscreen)
        .build()?;
    let handle = app.handle().clone();
    let path = app.state::<Common>().settings_file.clone();
    let watcher = settings::watch(path, move |value| {
        let _ = handle.emit(SETTINGS_CHANGED_EVENT, value);
    })?;
    app.manage(Mutex::new(watcher));
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn command_list_matches_the_handler() {
        let source = include_str!("tauri_app.rs");
        let start = source.find("tauri::generate_handler![").unwrap();
        let block = &source[start..start + source[start..].find(']').unwrap()];
        let mut handled: Vec<&str> = block.lines().skip(1).map(|l| l.trim().trim_end_matches(',')).filter(|l| !l.is_empty()).collect();
        let mut listed = super::COMMANDS.to_vec();
        handled.sort();
        listed.sort();
        assert_eq!(handled, listed);
    }
}

//! HelixOS Notes: Markdown notes in ~/Notes, shared with the assistant.

mod commands;

use std::sync::Mutex;

use helixos_appkit::tauri_app::{setup, with_common_commands, Common, WindowSpec};
use tauri::{Emitter, Manager, Runtime};

/// Tells the frontend to reload the list (see `NOTES_CHANGED_EVENT` in @helixos/sdk).
const NOTES_CHANGED_EVENT: &str = "helixos://notes-changed";

/// Register the state and every command (the shared ones from appkit plus Notes' own).
/// Separate from `main` so tests can build the same app on Tauri's mock runtime.
fn with_commands<R: Runtime>(builder: tauri::Builder<R>, common: Common, ctx: commands::Ctx) -> tauri::Builder<R> {
    builder.manage(common).manage(ctx).invoke_handler(with_common_commands(tauri::generate_handler![
        commands::notes_list,
        commands::notes_folders,
        commands::notes_search,
        commands::note_read,
        commands::note_write,
        commands::note_create,
        commands::note_delete,
        commands::note_set_pinned,
        commands::note_move,
        commands::notes_folder_create,
        commands::notes_folder_delete,
    ]))
}

fn main() {
    with_commands(tauri::Builder::default(), Common::from_env(), commands::Ctx::from_env())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            setup(app, WindowSpec { title: "Notes", url: "index.html".into(), size: (1040.0, 680.0), min_size: (640.0, 420.0) })?;
            // Notes written by the assistant or another program show up right away.
            let handle = app.handle().clone();
            let dir = app.state::<commands::Ctx>().notes.dir().to_path_buf();
            let watcher = helixos_appkit::notes::watch(dir, move || {
                let _ = handle.emit(NOTES_CHANGED_EVENT, ());
            })?;
            app.manage(Mutex::new(watcher));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Notes failed to start");
}

#[cfg(test)]
mod ipc_tests {
    //! Notes commands through Tauri's IPC layer, with the JSON the frontend sends.

    use helixos_appkit::notes::Notes;
    use serde_json::{json, Value};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tauri::WebviewWindowBuilder;

    use super::*;

    fn invoke(webview: &tauri::WebviewWindow<tauri::test::MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
        get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|r| r.deserialize::<Value>().unwrap())
    }

    #[test]
    fn notes_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let common = Common {
            runner: helixos_syslib::SystemRunner::default(),
            assistant: helixos_appkit::assistant_client::AssistantClient::new(dir.path().join("none.sock")),
            settings_file: dir.path().join("shell.json"),
            assistant_config: dir.path().join("assistant.toml"),
        };
        let ctx = commands::Ctx { notes: Notes::new(dir.path().join("Notes")), runner: helixos_syslib::SystemRunner::default() };
        let app = with_commands(mock_builder(), common, ctx).build(tauri::generate_context!()).unwrap();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();

        let created = invoke(&webview, "note_create", json!({"folder": "", "text": "# Hello\n\nworld"})).unwrap();
        assert_eq!(created["path"], "Hello.md");
        let saved = invoke(&webview, "note_write", json!({"path": "Hello.md", "text": "# Hi there\n\nworld"})).unwrap();
        assert_eq!(saved["path"], "Hi there.md");
        invoke(&webview, "note_set_pinned", json!({"path": "Hi there.md", "pinned": true})).unwrap();
        let list = invoke(&webview, "notes_list", json!({})).unwrap();
        assert_eq!(list[0]["pinned"], true);
        let hits = invoke(&webview, "notes_search", json!({"query": "world"})).unwrap();
        assert_eq!(hits.as_array().unwrap().len(), 1);
        assert!(invoke(&webview, "note_read", json!({"path": "../escape.md"})).is_err());
    }
}

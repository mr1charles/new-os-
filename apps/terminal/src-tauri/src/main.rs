//! NewOS Terminal.

mod commands;

use newos_appkit::tauri_app::{setup, with_common_commands, Common, WindowSpec};
use tauri::{Manager, Runtime};

/// Register the state and every command (the shared ones from appkit plus the app's own).
/// Separate from `main` so tests can build the same app on Tauri's mock runtime.
fn with_commands<R: Runtime>(builder: tauri::Builder<R>, common: Common) -> tauri::Builder<R> {
    builder.manage(common).manage(newos_appkit::pty::Ptys::default()).invoke_handler(with_common_commands(tauri::generate_handler![
        commands::term_spawn,
        commands::term_write,
        commands::term_resize,
        commands::term_kill,
        commands::term_cwd,
    ]))
}

fn main() {
    with_commands(tauri::Builder::default(), Common::from_env())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| setup(app, WindowSpec { title: "Terminal", url: "index.html".into(), size: (820.0, 520.0), min_size: (420.0, 260.0) }))
        .run(tauri::generate_context!())
        .expect("Terminal failed to start");
}

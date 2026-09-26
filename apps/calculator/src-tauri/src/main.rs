//! HelixOS Calculator.

use helixos_appkit::tauri_app::{setup, with_common_commands, Common, WindowSpec};
use tauri::{Manager, Runtime};

/// Register the state and every command (the shared ones from appkit plus the app's own).
/// Separate from `main` so tests can build the same app on Tauri's mock runtime.
fn with_commands<R: Runtime>(builder: tauri::Builder<R>, common: Common) -> tauri::Builder<R> {
    // The app's own commands go in this list (add a `commands` module when it has some).
    builder.manage(common).invoke_handler(with_common_commands(tauri::generate_handler![]))
}

fn main() {
    with_commands(tauri::Builder::default(), Common::from_env())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            setup(app, WindowSpec { title: "Calculator", url: "index.html".into(), size: (380.0, 580.0), min_size: (360.0, 480.0) })
        })
        .run(tauri::generate_context!())
        .expect("Calculator failed to start");
}

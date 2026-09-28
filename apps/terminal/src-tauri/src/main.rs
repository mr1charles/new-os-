//! HelixOS Terminal.

mod commands;

use helixos_appkit::tauri_app::{setup, with_common_commands, Common, WindowSpec};
use tauri::{Emitter, Manager, Runtime};

/// Tells the frontend to open a tab (which runs the pending command).
const NEW_TAB_EVENT: &str = "helixos://new-tab";

/// Register the state and every command (the shared ones from appkit plus the app's own).
/// Separate from `main` so tests can build the same app on Tauri's mock runtime.
fn with_commands<R: Runtime>(builder: tauri::Builder<R>, common: Common) -> tauri::Builder<R> {
    builder.manage(common).manage(helixos_appkit::pty::Ptys::default()).manage(commands::Pending::default()).invoke_handler(
        with_common_commands(tauri::generate_handler![
            commands::term_spawn,
            commands::term_write,
            commands::term_resize,
            commands::term_kill,
            commands::term_cwd,
        ]),
    )
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let initial = commands::command_arg(&args);
    with_commands(tauri::Builder::default(), Common::from_env())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            // `helixos-terminal -- CMD` while Terminal is open: run it in a new tab.
            if let Some(command) = commands::command_arg(&argv) {
                *app.state::<commands::Pending>().0.lock().unwrap() = Some(command);
                let _ = app.emit(NEW_TAB_EVENT, ());
            }
        }))
        .setup(move |app| {
            *app.state::<commands::Pending>().0.lock().unwrap() = initial;
            setup(app, WindowSpec { title: "Terminal", url: "index.html".into(), size: (820.0, 520.0), min_size: (420.0, 260.0) })
        })
        .run(tauri::generate_context!())
        .expect("Terminal failed to start");
}

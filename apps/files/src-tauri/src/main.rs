//! HelixOS Files.

mod commands;

use helixos_appkit::tauri_app::{setup, with_common_commands, Common, WindowSpec};
use tauri::{Manager, Runtime};

/// Register the state and every command (the shared ones from appkit plus the app's own).
/// Separate from `main` so tests can build the same app on Tauri's mock runtime.
fn with_commands<R: Runtime>(builder: tauri::Builder<R>, common: Common) -> tauri::Builder<R> {
    builder.manage(common).manage(commands::Ctx::from_env()).invoke_handler(with_common_commands(tauri::generate_handler![
        commands::files_places,
        commands::files_list,
        commands::files_info,
        commands::files_drives,
        commands::files_mount,
        commands::files_eject,
        commands::files_create_folder,
        commands::files_rename,
        commands::files_transfer,
        commands::files_trash,
        commands::files_trash_list,
        commands::files_trash_restore,
        commands::files_trash_empty,
        commands::files_open,
        commands::files_preview_text,
        commands::files_document_text,
        commands::files_pdf_thumbnail,
        commands::files_search,
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
        .setup(|app| setup(app, WindowSpec { title: "Files", url: "index.html".into(), size: (1000.0, 640.0), min_size: (560.0, 360.0) }))
        .run(tauri::generate_context!())
        .expect("Files failed to start");
}

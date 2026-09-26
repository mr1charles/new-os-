//! NewOS Settings. `newos-settings --page <id>` opens a page (ids are in
//! `packages/sdk/src/settings-pages.ts`); a second launch focuses the open window and switches
//! to that page instead of starting another copy.

mod commands;

use newos_appkit::tauri_app::{setup, with_common_commands, Common, WindowSpec};
use tauri::{Emitter, Manager, Runtime};

/// Tells the frontend to switch page (see `App.tsx`).
const OPEN_PAGE_EVENT: &str = "newos://open-page";

/// The value after `--page`, if it is a plain page id.
fn page_arg(args: &[String]) -> Option<String> {
    let index = args.iter().position(|a| a == "--page")?;
    let page = args.get(index + 1)?;
    (!page.is_empty() && page.len() < 32 && page.chars().all(|c| c.is_ascii_lowercase() || c == '-')).then(|| page.clone())
}

/// Register the state and every command (the shared ones from appkit plus Settings' own).
/// Separate from `main` so the IPC tests can build the same app on Tauri's mock runtime.
fn with_commands<R: Runtime>(builder: tauri::Builder<R>, common: Common, ctx: commands::Ctx) -> tauri::Builder<R> {
    builder.manage(common).manage(ctx).invoke_handler(with_common_commands(tauri::generate_handler![
        commands::wifi_status,
        commands::wifi_set_enabled,
        commands::wifi_networks,
        commands::wifi_connect,
        commands::wifi_disconnect,
        commands::wifi_forget,
        commands::net_devices,
        commands::airplane_get,
        commands::airplane_set,
        commands::bluetooth_powered,
        commands::bluetooth_set_enabled,
        commands::bluetooth_devices,
        commands::bluetooth_scan,
        commands::bluetooth_pair,
        commands::bluetooth_connect,
        commands::bluetooth_disconnect,
        commands::bluetooth_remove,
        commands::audio_devices,
        commands::audio_set_default,
        commands::audio_set_volume,
        commands::brightness_get,
        commands::brightness_set,
        commands::monitors,
        commands::monitor_apply,
        commands::wallpapers,
        commands::power_profiles,
        commands::power_profile_set,
        commands::battery_details,
        commands::hypr_options,
        commands::hypr_option_set,
        commands::apps,
        commands::about,
        commands::account,
        commands::fingerprints,
        commands::updates,
        commands::update_in_terminal,
        commands::spaces_list,
        commands::spaces_create,
        commands::spaces_delete,
        commands::spaces_rename,
        commands::spaces_set_accent,
        commands::spaces_set_default,
        commands::spaces_set_password,
    ]))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let initial_page = page_arg(&args);

    with_commands(tauri::Builder::default(), Common::from_env(), commands::Ctx::from_env())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if let Some(page) = page_arg(&argv) {
                let _ = app.emit(OPEN_PAGE_EVENT, page);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let url = match &initial_page {
                Some(page) => format!("index.html?page={page}"),
                None => "index.html".into(),
            };
            setup(app, WindowSpec { title: "Settings", url, size: (920.0, 660.0), min_size: (720.0, 480.0) })
        })
        .run(tauri::generate_context!())
        .expect("Settings failed to start");
}

#[cfg(test)]
mod ipc_tests;

#[cfg(test)]
mod tests {
    use super::page_arg;

    #[test]
    fn reads_the_page_argument() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(page_arg(&args(&["newos-settings", "--page", "wifi"])), Some("wifi".into()));
        assert_eq!(page_arg(&args(&["newos-settings"])), None);
        assert_eq!(page_arg(&args(&["newos-settings", "--page"])), None);
        assert_eq!(page_arg(&args(&["newos-settings", "--page", "../x?y"])), None);
    }
}

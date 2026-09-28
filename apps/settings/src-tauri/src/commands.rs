//! The system commands the Settings frontend calls through `@helixos/sdk` (`packages/sdk/src/
//! commands.ts` has the matching types). Each one is a thin wrapper: the logic and its tests
//! live in `helixos-syslib`. The settings file and assistant commands every app shares come from
//! `helixos_appkit::tauri_app`.

use std::path::PathBuf;

use helixos_appkit::{paths, terminal, wallpapers, AppError};
use helixos_syslib::display::{Monitor, MonitorSetup};
use helixos_syslib::{about, audio, bluetooth, desktop, display, hyprconf, network, power, updates, users, SystemRunner};
use tauri::State;

type Result<T> = std::result::Result<T, AppError>;

pub struct Ctx {
    pub runner: SystemRunner,
    pub hypr_settings: PathBuf,
}

impl Ctx {
    pub fn from_env() -> Self {
        Self { runner: SystemRunner::default(), hypr_settings: paths::hyprland_settings_file() }
    }
}

/// Run blocking work (keyring, file scans) off the async runtime.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| AppError::Invalid(e.to_string()))?
}

// Network -------------------------------------------------------------------------------------

#[tauri::command]
pub async fn wifi_status(ctx: State<'_, Ctx>) -> Result<network::WifiStatus> {
    Ok(network::wifi_status(&ctx.runner).await?)
}

#[tauri::command]
pub async fn wifi_set_enabled(ctx: State<'_, Ctx>, enabled: bool) -> Result<()> {
    Ok(network::set_wifi(&ctx.runner, enabled).await?)
}

#[tauri::command]
pub async fn wifi_networks(ctx: State<'_, Ctx>, rescan: bool) -> Result<Vec<network::WifiNetwork>> {
    Ok(network::wifi_networks(&ctx.runner, rescan).await?)
}

#[tauri::command]
pub async fn wifi_connect(ctx: State<'_, Ctx>, ssid: String, password: Option<String>) -> Result<()> {
    Ok(network::connect_wifi(&ctx.runner, &ssid, password.as_deref().filter(|p| !p.is_empty())).await?)
}

#[tauri::command]
pub async fn wifi_disconnect(ctx: State<'_, Ctx>, ssid: String) -> Result<()> {
    Ok(network::disconnect_wifi(&ctx.runner, &ssid).await?)
}

#[tauri::command]
pub async fn wifi_forget(ctx: State<'_, Ctx>, ssid: String) -> Result<()> {
    Ok(network::forget_wifi(&ctx.runner, &ssid).await?)
}

#[tauri::command]
pub async fn net_devices(ctx: State<'_, Ctx>) -> Result<Vec<network::NetDevice>> {
    Ok(network::net_devices(&ctx.runner).await?)
}

#[tauri::command]
pub async fn airplane_get(ctx: State<'_, Ctx>) -> Result<bool> {
    Ok(network::airplane_mode(&ctx.runner).await?)
}

#[tauri::command]
pub async fn airplane_set(ctx: State<'_, Ctx>, enabled: bool) -> Result<()> {
    Ok(network::set_airplane_mode(&ctx.runner, enabled).await?)
}

// Bluetooth -----------------------------------------------------------------------------------

#[tauri::command]
pub async fn bluetooth_powered(ctx: State<'_, Ctx>) -> Result<bool> {
    Ok(network::bluetooth_powered(&ctx.runner).await?)
}

#[tauri::command]
pub async fn bluetooth_set_enabled(ctx: State<'_, Ctx>, enabled: bool) -> Result<()> {
    Ok(network::set_bluetooth(&ctx.runner, enabled).await?)
}

#[tauri::command]
pub async fn bluetooth_devices(ctx: State<'_, Ctx>) -> Result<Vec<bluetooth::BluetoothDevice>> {
    Ok(bluetooth::devices(&ctx.runner).await?)
}

#[tauri::command]
pub async fn bluetooth_scan(ctx: State<'_, Ctx>, seconds: u32) -> Result<Vec<bluetooth::BluetoothDevice>> {
    Ok(bluetooth::scan(&ctx.runner, seconds).await?)
}

#[tauri::command]
pub async fn bluetooth_pair(ctx: State<'_, Ctx>, address: String) -> Result<()> {
    Ok(bluetooth::pair(&ctx.runner, &address).await?)
}

#[tauri::command]
pub async fn bluetooth_connect(ctx: State<'_, Ctx>, address: String) -> Result<()> {
    Ok(bluetooth::connect(&ctx.runner, &address).await?)
}

#[tauri::command]
pub async fn bluetooth_disconnect(ctx: State<'_, Ctx>, address: String) -> Result<()> {
    Ok(bluetooth::disconnect(&ctx.runner, &address).await?)
}

#[tauri::command]
pub async fn bluetooth_remove(ctx: State<'_, Ctx>, address: String) -> Result<()> {
    Ok(bluetooth::remove(&ctx.runner, &address).await?)
}

// Sound ---------------------------------------------------------------------------------------

#[tauri::command]
pub async fn audio_devices(ctx: State<'_, Ctx>) -> Result<audio::AudioDevices> {
    Ok(audio::devices(&ctx.runner).await?)
}

#[tauri::command]
pub async fn audio_set_default(ctx: State<'_, Ctx>, id: u32) -> Result<()> {
    Ok(audio::set_default_device(&ctx.runner, id).await?)
}

#[tauri::command]
pub async fn audio_set_volume(ctx: State<'_, Ctx>, id: u32, level: f64, muted: bool) -> Result<()> {
    Ok(audio::set_device_volume(&ctx.runner, id, level, muted).await?)
}

// Displays ------------------------------------------------------------------------------------

#[tauri::command]
pub async fn brightness_get(ctx: State<'_, Ctx>) -> Result<f64> {
    Ok(display::get_brightness(&ctx.runner).await?)
}

#[tauri::command]
pub async fn brightness_set(ctx: State<'_, Ctx>, level: f64) -> Result<f64> {
    Ok(display::set_brightness(&ctx.runner, level).await?)
}

#[tauri::command]
pub async fn monitors(ctx: State<'_, Ctx>) -> Result<Vec<Monitor>> {
    Ok(display::monitors(&ctx.runner).await?)
}

/// Apply now and keep it for the next login.
#[tauri::command]
pub async fn monitor_apply(ctx: State<'_, Ctx>, setup: MonitorSetup) -> Result<String> {
    let line = display::apply_monitor(&ctx.runner, &setup).await?;
    hyprconf::save_monitor(&ctx.hypr_settings, &setup.name, &line)?;
    Ok(line)
}

#[tauri::command]
pub async fn wallpapers() -> Result<Vec<wallpapers::Wallpaper>> {
    blocking(|| Ok(wallpapers::find(&wallpapers::default_dirs()))).await
}

// Power ---------------------------------------------------------------------------------------

#[tauri::command]
pub async fn power_profiles(ctx: State<'_, Ctx>) -> Result<power::PowerProfiles> {
    Ok(power::power_profiles(&ctx.runner).await?)
}

#[tauri::command]
pub async fn power_profile_set(ctx: State<'_, Ctx>, profile: String) -> Result<()> {
    Ok(power::set_power_profile(&ctx.runner, &profile).await?)
}

#[tauri::command]
pub fn battery_details() -> Option<power::BatteryDetails> {
    power::battery_details()
}

// Keyboard and trackpad -----------------------------------------------------------------------

#[tauri::command]
pub async fn hypr_options(ctx: State<'_, Ctx>) -> Result<std::collections::BTreeMap<String, String>> {
    Ok(hyprconf::get_options(&ctx.runner).await)
}

#[tauri::command]
pub async fn hypr_option_set(ctx: State<'_, Ctx>, key: String, value: String) -> Result<String> {
    Ok(hyprconf::set_option(&ctx.runner, &ctx.hypr_settings, &key, &value).await?)
}

// Apps and system -----------------------------------------------------------------------------

#[tauri::command]
pub async fn apps() -> Result<Vec<desktop::DesktopEntry>> {
    blocking(|| Ok(desktop::list_apps(&desktop::application_dirs()))).await
}

#[tauri::command]
pub async fn about(ctx: State<'_, Ctx>) -> Result<about::AboutInfo> {
    Ok(about::about(&ctx.runner).await)
}

#[tauri::command]
pub async fn account(ctx: State<'_, Ctx>) -> Result<users::Account> {
    Ok(users::current_account(&ctx.runner).await?)
}

#[tauri::command]
pub async fn fingerprints(ctx: State<'_, Ctx>) -> Result<users::Fingerprints> {
    Ok(users::fingerprints(&ctx.runner).await)
}

#[tauri::command]
pub async fn updates(ctx: State<'_, Ctx>) -> Result<Vec<updates::PackageUpdate>> {
    Ok(updates::pending_updates(&ctx.runner).await?)
}

#[tauri::command]
pub async fn update_in_terminal(ctx: State<'_, Ctx>) -> Result<()> {
    terminal::run_in_terminal(&ctx.runner, terminal::UPDATE_SCRIPT).await
}

/// Whether this is a real install, the preview taking over a text console, or the preview
/// nested in a window — Trackpad and Keyboard use this to explain themselves in the preview.
#[tauri::command]
pub fn session_info() -> helixos_appkit::session::SessionInfo {
    helixos_appkit::session::current()
}

// Setup -------------------------------------------------------------------------------------------

/// The language set for this account ("en_US.UTF-8"), or the session's.
#[tauri::command]
pub fn locale_get() -> String {
    helixos_appkit::locale::read(&helixos_appkit::locale::locale_file())
        .or_else(|| std::env::var("LANG").ok())
        .unwrap_or_else(|| "en_US.UTF-8".into())
}

#[tauri::command]
pub fn locale_set(lang: String) -> Result<()> {
    helixos_appkit::locale::write(&helixos_appkit::locale::locale_file(), &lang)
}

/// Install an app from Flathub by id through the Installer (progress shows in the Dynamic
/// Island). Setup already asked, so the Installer does not ask again. `default_browser` makes
/// it the default web browser once installed.
#[tauri::command]
pub async fn setup_install_app(ctx: State<'_, Ctx>, app_id: String, default_browser: bool) -> Result<()> {
    let valid = app_id.split('.').count() >= 3
        && app_id.len() <= 255
        && app_id.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
    if !valid {
        return Err(AppError::Invalid(format!("not an app id: {app_id}")));
    }
    let mut args = vec!["--yes".to_string()];
    if default_browser {
        args.push("--default-browser".into());
    }
    args.push(format!("appstream://{app_id}"));
    use helixos_syslib::CommandRunner;
    ctx.runner
        .spawn_detached("helixos-open", &args)
        .await
        .map_err(|_| AppError::Invalid("The Installer (helixos-open) isn’t installed.".into()))
}

/// Make an installed browser (a desktop id like "firefox") the default.
#[tauri::command]
pub async fn setup_default_browser(ctx: State<'_, Ctx>, desktop_id: String) -> Result<()> {
    let id = desktop_id.trim_end_matches(".desktop");
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
        return Err(AppError::Invalid(format!("not a desktop id: {desktop_id}")));
    }
    helixos_syslib::runner::run_checked(&ctx.runner, "xdg-settings", &["set", "default-web-browser", &format!("{id}.desktop")]).await?;
    Ok(())
}

// Users & Spaces (helixos-spacesd) -----------------------------------------------------------------

use helixos_appkit::spaces::{self, Space};

#[tauri::command]
pub async fn spaces_list() -> Result<Vec<Space>> {
    spaces::list().await
}

#[tauri::command]
pub async fn spaces_create(name: String, password: String, accent: String) -> Result<Space> {
    spaces::create(&name, &password, &accent).await
}

#[tauri::command]
pub async fn spaces_delete(account: String, keep_home: bool) -> Result<()> {
    spaces::delete(&account, keep_home).await
}

#[tauri::command]
pub async fn spaces_rename(account: String, name: String) -> Result<()> {
    spaces::rename(&account, &name).await
}

#[tauri::command]
pub async fn spaces_set_accent(account: String, accent: String) -> Result<()> {
    spaces::set_accent(&account, &accent).await
}

#[tauri::command]
pub async fn spaces_set_default(account: String) -> Result<()> {
    spaces::set_default(&account).await
}

#[tauri::command]
pub async fn spaces_set_password(account: String, password: String) -> Result<()> {
    spaces::set_password(&account, &password).await
}

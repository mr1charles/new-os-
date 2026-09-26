//! The system commands the Settings frontend calls through `@newos/sdk` (`packages/sdk/src/
//! commands.ts` has the matching types). Each one is a thin wrapper: the logic and its tests
//! live in `newos-syslib`. The settings file and assistant commands every app shares come from
//! `newos_appkit::tauri_app`.

use std::path::PathBuf;

use newos_appkit::{paths, terminal, wallpapers, AppError};
use newos_syslib::display::{Monitor, MonitorSetup};
use newos_syslib::{about, audio, bluetooth, desktop, display, hyprconf, network, power, updates, users, SystemRunner};
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

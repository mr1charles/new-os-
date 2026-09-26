//! Print what Settings would show on this machine: `cargo run -p helixos-syslib --example probe`.

use helixos_syslib::{about, audio, bluetooth, display, hyprconf, network, power, SystemRunner};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let runner = SystemRunner::default();
    let show = |label: &str, value: serde_json::Value| println!("{label}: {}", serde_json::to_string_pretty(&value).unwrap());
    show("about", serde_json::to_value(about::about(&runner).await).unwrap());
    show("wifi", serde_json::to_value(network::wifi_networks(&runner, false).await.map_err(|e| e.to_string())).unwrap());
    show("devices", serde_json::to_value(network::net_devices(&runner).await.map_err(|e| e.to_string())).unwrap());
    show("bluetooth", serde_json::to_value(bluetooth::devices(&runner).await.map_err(|e| e.to_string())).unwrap());
    show("audio", serde_json::to_value(audio::devices(&runner).await.map_err(|e| e.to_string())).unwrap());
    show("monitors", serde_json::to_value(display::monitors(&runner).await.map_err(|e| e.to_string())).unwrap());
    show("power", serde_json::to_value(power::power_profiles(&runner).await.map_err(|e| e.to_string())).unwrap());
    show("battery", serde_json::to_value(power::battery_details()).unwrap());
    show("hyprland", serde_json::to_value(hyprconf::get_options(&runner).await).unwrap());
}

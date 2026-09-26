//! Standard HelixOS locations, following the XDG base directory spec.

use std::path::PathBuf;

fn env_dir(var: &str, fallback: impl FnOnce() -> PathBuf) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(fallback)
}

pub fn home() -> PathBuf {
    env_dir("HOME", || PathBuf::from("/tmp"))
}

/// `~/.config/helixos`
pub fn config_dir() -> PathBuf {
    env_dir("XDG_CONFIG_HOME", || home().join(".config")).join("helixos")
}

/// `~/.config/helixos/shell.json`: appearance, Dock, menu bar, island, notifications. Shared by
/// the shell and every app (see `@helixos/sdk`'s settings schema).
pub fn settings_file() -> PathBuf {
    config_dir().join("shell.json")
}

/// `~/.config/helixos/assistant.toml`
pub fn assistant_config_file() -> PathBuf {
    config_dir().join("assistant.toml")
}

/// `~/.config/helixos/hyprland-settings.conf`
pub fn hyprland_settings_file() -> PathBuf {
    config_dir().join("hyprland-settings.conf")
}

/// `$XDG_RUNTIME_DIR/helixos/assistant.sock`
pub fn assistant_socket() -> PathBuf {
    env_dir("XDG_RUNTIME_DIR", std::env::temp_dir).join("helixos").join("assistant.sock")
}

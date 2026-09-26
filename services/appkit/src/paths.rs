//! Standard NewOS locations, following the XDG base directory spec.

use std::path::PathBuf;

fn env_dir(var: &str, fallback: impl FnOnce() -> PathBuf) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(fallback)
}

pub fn home() -> PathBuf {
    env_dir("HOME", || PathBuf::from("/tmp"))
}

/// `~/.config/newos`
pub fn config_dir() -> PathBuf {
    env_dir("XDG_CONFIG_HOME", || home().join(".config")).join("newos")
}

/// `~/.config/newos/shell.json`: appearance, Dock, menu bar, island, notifications. Shared by
/// the shell and every app (see `@newos/sdk`'s settings schema).
pub fn settings_file() -> PathBuf {
    config_dir().join("shell.json")
}

/// `~/.config/newos/assistant.toml`
pub fn assistant_config_file() -> PathBuf {
    config_dir().join("assistant.toml")
}

/// `~/.config/newos/hyprland-settings.conf`
pub fn hyprland_settings_file() -> PathBuf {
    config_dir().join("hyprland-settings.conf")
}

/// `$XDG_RUNTIME_DIR/newos/assistant.sock`
pub fn assistant_socket() -> PathBuf {
    env_dir("XDG_RUNTIME_DIR", std::env::temp_dir).join("newos").join("assistant.sock")
}

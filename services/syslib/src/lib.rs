//! System integration for NewOS.
//!
//! Every action goes through a [`CommandRunner`] so the logic (argument building and output
//! parsing) is unit tested without touching the machine. The real runner calls the standard
//! tools a NewOS install ships: `wpctl` (PipeWire), `brightnessctl`, `nmcli`
//! (NetworkManager), `bluetoothctl`, `loginctl`/`systemctl`, `hyprctl`, `gtk-launch`,
//! `xdg-open`, `gio`, and `ags` for talking to the shell.

pub mod audio;
pub mod desktop;
pub mod display;
pub mod hyprland;
pub mod network;
pub mod power;
pub mod runner;
pub mod shell;

pub use runner::{CommandOutput, CommandRunner, MockRunner, SystemRunner};

/// Errors from system integration.
#[derive(Debug, thiserror::Error)]
pub enum SysError {
    #[error("`{program}` is not installed")]
    NotInstalled { program: String },
    #[error("`{program}` failed: {message}")]
    Failed { program: String, message: String },
    #[error("could not understand the output of `{program}`: {output}")]
    Parse { program: String, output: String },
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, SysError>;

/// Clamp a fraction to 0.0..=1.0 and turn it into a whole percent.
pub fn to_percent(fraction: f64) -> u32 {
    (fraction.clamp(0.0, 1.0) * 100.0).round() as u32
}

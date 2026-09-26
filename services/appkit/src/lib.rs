//! Shared backend for NewOS apps.
//!
//! Everything here is plain Rust with no Tauri dependency, so it is unit tested without a
//! display or webkit. Each app's `src-tauri` crate wraps these functions in `#[tauri::command]`s
//! that `@newos/sdk` calls.

pub mod assistant_client;
pub mod assistant_config;
pub mod files;
pub mod island;
pub mod keyring;
pub mod notes;
pub mod paths;
pub mod pty;
pub mod settings;
pub mod spaces;
#[cfg(feature = "tauri")]
pub mod tauri_app;
pub mod terminal;
pub mod wallpapers;

/// Errors reported to the app's UI. They serialize to their message so the frontend gets a
/// readable string.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Sys(#[from] newos_syslib::SysError),
    #[error("{0}")]
    Invalid(String),
    #[error("the assistant is not running ({0})")]
    AssistantUnavailable(String),
    #[error("the assistant answered {status}: {message}")]
    Assistant { status: u16, message: String },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

/// Write a file through a temporary sibling and a rename, so readers (the shell's file
/// monitor) never see half a file.
pub fn write_atomic(path: &std::path::Path, contents: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, path)
}

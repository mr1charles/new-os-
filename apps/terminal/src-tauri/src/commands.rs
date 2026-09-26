//! Terminal's own commands, over `helixos_appkit::pty` (where the logic and its tests live).

use std::path::PathBuf;

use helixos_appkit::pty::{PtyEvent, Ptys};
use helixos_appkit::AppError;
use tauri::ipc::Channel;
use tauri::State;

type Result<T> = std::result::Result<T, AppError>;

/// Start the user's shell. Output and the exit arrive on `on_event` until the session ends.
#[tauri::command]
pub fn term_spawn(ptys: State<'_, Ptys>, cols: u16, rows: u16, cwd: Option<String>, on_event: Channel<PtyEvent>) -> Result<u32> {
    let cwd = cwd.map(PathBuf::from);
    ptys.spawn(None, cwd.as_deref(), cols, rows, move |event| {
        let _ = on_event.send(event);
    })
}

#[tauri::command]
pub fn term_write(ptys: State<'_, Ptys>, id: u32, data: String) -> Result<()> {
    ptys.write(id, &data)
}

#[tauri::command]
pub fn term_resize(ptys: State<'_, Ptys>, id: u32, cols: u16, rows: u16) -> Result<()> {
    ptys.resize(id, cols, rows)
}

#[tauri::command]
pub fn term_kill(ptys: State<'_, Ptys>, id: u32) -> Result<()> {
    ptys.kill(id)
}

#[tauri::command]
pub fn term_cwd(ptys: State<'_, Ptys>, id: u32) -> Result<String> {
    Ok(ptys.cwd(id)?.to_string_lossy().into_owned())
}

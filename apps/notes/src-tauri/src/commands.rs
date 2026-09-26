//! Notes' own commands, over `helixos_appkit::notes` (where the logic and its tests live). The
//! settings file and assistant commands come from `helixos_appkit::tauri_app`.

use helixos_appkit::notes::{NoteMeta, Notes, SearchHit};
use helixos_appkit::AppError;
use helixos_syslib::SystemRunner;
use tauri::State;

type Result<T> = std::result::Result<T, AppError>;

pub struct Ctx {
    pub notes: Notes,
    pub runner: SystemRunner,
}

impl Ctx {
    pub fn from_env() -> Self {
        Self { notes: Notes::new(helixos_appkit::notes::default_dir()), runner: SystemRunner::default() }
    }
}

#[tauri::command]
pub fn notes_list(ctx: State<'_, Ctx>) -> Vec<NoteMeta> {
    ctx.notes.list()
}

#[tauri::command]
pub fn notes_folders(ctx: State<'_, Ctx>) -> Vec<String> {
    ctx.notes.folders()
}

#[tauri::command]
pub async fn notes_search(ctx: State<'_, Ctx>, query: String) -> Result<Vec<SearchHit>> {
    Ok(ctx.notes.search(&query))
}

#[tauri::command]
pub fn note_read(ctx: State<'_, Ctx>, path: String) -> Result<String> {
    ctx.notes.read(&path)
}

#[tauri::command]
pub fn note_write(ctx: State<'_, Ctx>, path: String, text: String) -> Result<NoteMeta> {
    ctx.notes.write(&path, &text)
}

#[tauri::command]
pub fn note_create(ctx: State<'_, Ctx>, folder: String, text: String) -> Result<NoteMeta> {
    ctx.notes.create(&folder, &text)
}

/// Moves the note to the Trash, so it can be restored from Files.
#[tauri::command]
pub async fn note_delete(ctx: State<'_, Ctx>, path: String) -> Result<()> {
    let abs = ctx.notes.absolute(&path)?;
    helixos_syslib::shell::trash(&ctx.runner, &abs).await?;
    ctx.notes.forget(&path)
}

#[tauri::command]
pub fn note_set_pinned(ctx: State<'_, Ctx>, path: String, pinned: bool) -> Result<()> {
    ctx.notes.set_pinned(&path, pinned)
}

#[tauri::command]
pub fn note_move(ctx: State<'_, Ctx>, path: String, folder: String) -> Result<NoteMeta> {
    ctx.notes.move_to(&path, &folder)
}

#[tauri::command]
pub fn notes_folder_create(ctx: State<'_, Ctx>, name: String) -> Result<String> {
    ctx.notes.create_folder(&name)
}

#[tauri::command]
pub fn notes_folder_delete(ctx: State<'_, Ctx>, name: String) -> Result<()> {
    ctx.notes.delete_folder(&name)
}

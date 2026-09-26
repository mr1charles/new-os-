//! Files' own commands, over `helixos_appkit::files` (where the logic and its tests live).

use std::path::{Path, PathBuf};

use helixos_appkit::files::{self, Drive, FileEntry, Place, SearchQuery, TrashItem};
use helixos_appkit::{island, paths, AppError};
use helixos_syslib::SystemRunner;
use tauri::State;

type Result<T> = std::result::Result<T, AppError>;

pub struct Ctx {
    pub runner: SystemRunner,
    pub home: PathBuf,
    pub trash: PathBuf,
    pub thumbnails: PathBuf,
}

impl Ctx {
    pub fn from_env() -> Self {
        let home = paths::home();
        let cache = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".cache"));
        Self { runner: SystemRunner::default(), trash: files::trash_dir(&home), thumbnails: cache.join("helixos/thumbnails"), home }
    }
}

/// Paths from the frontend must be absolute; everything else is up to file permissions, as in
/// any file manager.
fn absolute(path: &str) -> Result<PathBuf> {
    let p = Path::new(path);
    if p.is_absolute() && !path.contains('\0') {
        Ok(p.to_path_buf())
    } else {
        Err(AppError::Invalid(format!("not an absolute path: {path}")))
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| AppError::Invalid(e.to_string()))?
}

#[tauri::command]
pub fn files_places(ctx: State<'_, Ctx>) -> Vec<Place> {
    files::places(&ctx.home)
}

#[tauri::command]
pub async fn files_list(path: String, show_hidden: bool) -> Result<Vec<FileEntry>> {
    let path = absolute(&path)?;
    blocking(move || files::list_dir(&path, show_hidden)).await
}

#[tauri::command]
pub fn files_info(path: String) -> Result<FileEntry> {
    files::info(&absolute(&path)?)
}

#[tauri::command]
pub async fn files_drives(ctx: State<'_, Ctx>) -> Result<Vec<Drive>> {
    files::drives(&ctx.runner).await
}

#[tauri::command]
pub async fn files_mount(ctx: State<'_, Ctx>, device: String) -> Result<String> {
    files::mount(&ctx.runner, &device).await
}

#[tauri::command]
pub async fn files_eject(ctx: State<'_, Ctx>, device: String, power_off: bool) -> Result<()> {
    files::eject(&ctx.runner, &device, power_off).await
}

#[tauri::command]
pub fn files_create_folder(dir: String, name: String) -> Result<FileEntry> {
    files::create_folder(&absolute(&dir)?, &name)
}

#[tauri::command]
pub fn files_rename(path: String, name: String) -> Result<FileEntry> {
    files::rename(&absolute(&path)?, &name)
}

/// Copy or move off the main thread. Anything slow shows its progress in the Dynamic Island.
#[tauri::command]
pub async fn files_transfer(sources: Vec<String>, dest: String, move_files: bool) -> Result<Vec<String>> {
    let sources = sources.iter().map(|s| absolute(s)).collect::<Result<Vec<_>>>()?;
    let dest = absolute(&dest)?;
    let activity = island::Activity {
        app: "org.helixos.Files".into(),
        icon: "folder".into(),
        title: transfer_title(&sources, move_files),
        subtitle: format!("to {}", dest.file_name().map_or_else(|| dest.display().to_string(), |n| n.to_string_lossy().into_owned())),
        progress: None,
    };
    let (tx, rx) = tokio::sync::watch::channel(None);
    let work = blocking(move || {
        let total = files::total_size(&sources).max(1);
        files::transfer_with_progress(&sources, &dest, move_files, &mut |done| {
            let _ = tx.send(Some(done as f64 / total as f64));
        })
    });
    let id = format!("transfer-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    island::while_working(&id, activity, rx, work).await
}

fn transfer_title(sources: &[PathBuf], move_files: bool) -> String {
    let verb = if move_files { "Moving" } else { "Copying" };
    match sources {
        [one] => format!("{verb} “{}”", one.file_name().unwrap_or_default().to_string_lossy()),
        many => format!("{verb} {} items", many.len()),
    }
}

#[tauri::command]
pub async fn files_trash(ctx: State<'_, Ctx>, paths: Vec<String>) -> Result<()> {
    let paths = paths.iter().map(|s| absolute(s)).collect::<Result<Vec<_>>>()?;
    files::trash(&ctx.runner, &paths).await
}

#[tauri::command]
pub fn files_trash_list(ctx: State<'_, Ctx>) -> Vec<TrashItem> {
    files::trash_list(&ctx.trash)
}

#[tauri::command]
pub fn files_trash_restore(ctx: State<'_, Ctx>, id: String) -> Result<String> {
    files::trash_restore(&ctx.trash, &id)
}

#[tauri::command]
pub async fn files_trash_empty(ctx: State<'_, Ctx>) -> Result<usize> {
    let trash = ctx.trash.clone();
    blocking(move || files::trash_empty(&trash)).await
}

/// Open with the default app (xdg-open).
#[tauri::command]
pub async fn files_open(ctx: State<'_, Ctx>, path: String) -> Result<()> {
    Ok(helixos_syslib::shell::open_path(&ctx.runner, &absolute(&path)?).await?)
}

/// The first 64 KB of a text file for Quick Look (null for binary files).
#[tauri::command]
pub async fn files_preview_text(path: String) -> Result<Option<String>> {
    let path = absolute(&path)?;
    blocking(move || files::read_text(&path, 64 * 1024)).await
}

/// Up to about 60,000 characters of a document, for the assistant to summarize.
#[tauri::command]
pub async fn files_document_text(ctx: State<'_, Ctx>, path: String) -> Result<Option<String>> {
    files::document_text(&ctx.runner, &absolute(&path)?, 60_000).await
}

#[tauri::command]
pub async fn files_pdf_thumbnail(ctx: State<'_, Ctx>, path: String) -> Result<String> {
    files::pdf_thumbnail(&ctx.runner, &absolute(&path)?, &ctx.thumbnails).await
}

#[tauri::command]
pub async fn files_search(root: String, query: SearchQuery, limit: usize) -> Result<Vec<FileEntry>> {
    let root = absolute(&root)?;
    blocking(move || Ok(files::search(&root, &query, limit.clamp(1, 500)))).await
}

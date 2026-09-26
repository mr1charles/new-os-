//! The file system for the Files app: listing folders, the standard places, drives, copying
//! and moving with Finder-style names for conflicts, the freedesktop Trash, previews, and
//! search with filters (which the assistant can fill in from a plain-language request).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, UNIX_EPOCH};

use newos_syslib::runner::run_checked;
use newos_syslib::CommandRunner;
use serde::{Deserialize, Serialize};

use crate::{AppError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Folder,
    Image,
    Video,
    Audio,
    Pdf,
    Document,
    Spreadsheet,
    Presentation,
    Text,
    Code,
    Archive,
    App,
    Other,
}

/// What kind of file a name is, from its extension.
pub fn kind_of(name: &str, is_dir: bool) -> Kind {
    if is_dir {
        return Kind::Folder;
    }
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "heic" | "avif" | "jxl" | "tif" | "tiff" | "ico" => Kind::Image,
        "mp4" | "mkv" | "webm" | "mov" | "avi" | "m4v" => Kind::Video,
        "mp3" | "flac" | "ogg" | "opus" | "wav" | "m4a" | "aac" => Kind::Audio,
        "pdf" => Kind::Pdf,
        "doc" | "docx" | "odt" | "rtf" | "pages" | "epub" => Kind::Document,
        "xls" | "xlsx" | "ods" | "csv" | "numbers" => Kind::Spreadsheet,
        "ppt" | "pptx" | "odp" | "key" => Kind::Presentation,
        "txt" | "md" | "markdown" | "log" | "org" | "tex" => Kind::Text,
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "c" | "h" | "cpp" | "go" | "java" | "sh" | "fish" | "json" | "toml" | "yaml"
        | "yml" | "html" | "css" | "scss" | "xml" | "sql" | "lua" | "rb" | "gd" | "conf" | "ini" => Kind::Code,
        "zip" | "tar" | "gz" | "tgz" | "xz" | "zst" | "7z" | "rar" | "bz2" => Kind::Archive,
        "desktop" | "appimage" | "flatpakref" | "exe" | "msi" | "apk" => Kind::App,
        _ => Kind::Other,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: Kind,
    /// Bytes for files; number of items for folders (None when unreadable).
    pub size: Option<u64>,
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
    pub hidden: bool,
    pub symlink: bool,
}

fn millis(meta: &std::fs::Metadata) -> u64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn entry(path: &Path) -> Option<FileEntry> {
    let link = std::fs::symlink_metadata(path).ok()?;
    // Follow links for what they point to; a broken link shows as a plain file.
    let meta = std::fs::metadata(path).unwrap_or_else(|_| link.clone());
    let name = path.file_name()?.to_string_lossy().into_owned();
    let size = if meta.is_dir() { std::fs::read_dir(path).ok().map(|d| d.count() as u64) } else { Some(meta.len()) };
    Some(FileEntry {
        kind: kind_of(&name, meta.is_dir()),
        hidden: name.starts_with('.'),
        path: path.to_string_lossy().into_owned(),
        name,
        size,
        modified: millis(&meta),
        symlink: link.file_type().is_symlink(),
    })
}

/// The entries of a folder, folders first, then by name (case-insensitive, numbers in order).
pub fn list_dir(dir: &Path, show_hidden: bool) -> Result<Vec<FileEntry>> {
    let mut entries: Vec<FileEntry> =
        std::fs::read_dir(dir)?.flatten().filter_map(|e| entry(&e.path())).filter(|e| show_hidden || !e.hidden).collect();
    entries.sort_by(|a, b| (b.kind == Kind::Folder).cmp(&(a.kind == Kind::Folder)).then_with(|| natural_cmp(&a.name, &b.name)));
    Ok(entries)
}

pub fn info(path: &Path) -> Result<FileEntry> {
    entry(path).ok_or_else(|| AppError::Invalid(format!("{} does not exist", path.display())))
}

/// "file 2" before "file 10", ignoring case.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    let (mut ai, mut bi) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (ai.peek(), bi.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut s = String::new();
                    while let Some(c) = it.peek().filter(|c| c.is_ascii_digit()) {
                        s.push(*c);
                        it.next();
                    }
                    s.trim_start_matches('0').to_string()
                };
                let (na, nb) = (take(&mut ai), take(&mut bi));
                let order = na.len().cmp(&nb.len()).then(na.cmp(&nb));
                if order != std::cmp::Ordering::Equal {
                    return order;
                }
            }
            (Some(x), Some(y)) => {
                let order = x.cmp(y);
                if order != std::cmp::Ordering::Equal {
                    return order;
                }
                ai.next();
                bi.next();
            }
        }
    }
}

// Places ------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Place {
    /// "home", "desktop", "documents", "downloads", "pictures", "music", "videos".
    pub id: String,
    pub name: String,
    pub path: String,
}

/// Parse ~/.config/user-dirs.dirs: `XDG_DOWNLOAD_DIR="$HOME/Downloads"`.
pub fn parse_user_dirs(text: &str, home: &Path) -> Vec<(String, PathBuf)> {
    text.lines()
        .filter_map(|line| {
            let (key, value) = line.trim().split_once('=')?;
            let id = key.strip_prefix("XDG_")?.strip_suffix("_DIR")?.to_lowercase();
            let value = value.trim().trim_matches('"');
            let path = match value.strip_prefix("$HOME") {
                Some(rest) => home.join(rest.trim_start_matches('/')),
                None => PathBuf::from(value),
            };
            Some((id, path))
        })
        .collect()
}

/// Home plus the standard folders that exist, in Finder's order.
pub fn places(home: &Path) -> Vec<Place> {
    let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".config"));
    let user_dirs = std::fs::read_to_string(config.join("user-dirs.dirs")).map(|t| parse_user_dirs(&t, home)).unwrap_or_default();
    let dir_for =
        |id: &str, fallback: &str| user_dirs.iter().find(|(k, _)| k == id).map(|(_, p)| p.clone()).unwrap_or_else(|| home.join(fallback));
    let mut out = vec![Place { id: "home".into(), name: "Home".into(), path: home.to_string_lossy().into_owned() }];
    // (key in user-dirs.dirs, id, name, default folder)
    for (key, id, name, fallback) in [
        ("desktop", "desktop", "Desktop", "Desktop"),
        ("documents", "documents", "Documents", "Documents"),
        ("download", "downloads", "Downloads", "Downloads"),
        ("pictures", "pictures", "Pictures", "Pictures"),
        ("music", "music", "Music", "Music"),
        ("videos", "videos", "Videos", "Videos"),
    ] {
        let path = dir_for(key, fallback);
        if path.is_dir() && path != home {
            out.push(Place { id: id.into(), name: name.into(), path: path.to_string_lossy().into_owned() });
        }
    }
    out
}

// Drives ------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Drive {
    /// "/dev/sda2"
    pub device: String,
    pub name: String,
    pub size: u64,
    pub mount_point: Option<String>,
    pub removable: bool,
    pub filesystem: String,
}

#[derive(Deserialize)]
struct LsblkDevice {
    path: String,
    label: Option<String>,
    size: Option<u64>,
    fstype: Option<String>,
    #[serde(default)]
    mountpoints: Vec<Option<String>>,
    #[serde(default)]
    rm: bool,
    #[serde(default)]
    hotplug: bool,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    children: Vec<LsblkDevice>,
}

/// Filesystems worth showing from `lsblk -J -b -o PATH,LABEL,SIZE,FSTYPE,MOUNTPOINTS,RM,HOTPLUG,TYPE`:
/// removable ones (USB sticks, SD cards) mounted or not, and other partitions mounted under
/// /run/media or /media. The system's own disks (/, /home, /boot) are left out.
pub fn parse_lsblk(json: &str) -> Result<Vec<Drive>> {
    #[derive(Deserialize)]
    struct Root {
        blockdevices: Vec<LsblkDevice>,
    }
    let root: Root = serde_json::from_str(json)?;
    let mut drives = Vec::new();
    fn walk(dev: &LsblkDevice, removable_parent: bool, out: &mut Vec<Drive>) {
        let removable = removable_parent || dev.rm || dev.hotplug;
        let mount = dev.mountpoints.iter().flatten().next().cloned();
        let has_fs = dev.fstype.as_deref().is_some_and(|f| !matches!(f, "swap" | "crypto_LUKS" | "LVM2_member"));
        let user_mount = mount.as_deref().is_some_and(|m| m.starts_with("/run/media/") || m.starts_with("/media/"));
        if has_fs && (dev.kind == "part" || dev.kind == "disk" || dev.kind == "crypt") && (removable || user_mount) {
            let fallback = format!("{} Volume", human_size(dev.size.unwrap_or(0)));
            out.push(Drive {
                device: dev.path.clone(),
                name: dev.label.clone().filter(|l| !l.is_empty()).unwrap_or(fallback),
                size: dev.size.unwrap_or(0),
                mount_point: mount,
                removable,
                filesystem: dev.fstype.clone().unwrap_or_default(),
            });
        }
        for child in &dev.children {
            walk(child, removable, out);
        }
    }
    for dev in &root.blockdevices {
        walk(dev, false, &mut drives);
    }
    Ok(drives)
}

fn human_size(bytes: u64) -> String {
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1000.0 && unit < units.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    format!("{:.0} {}", value, units[unit])
}

pub async fn drives(runner: &dyn CommandRunner) -> Result<Vec<Drive>> {
    let out = run_checked(runner, "lsblk", &["-J", "-b", "-o", "PATH,LABEL,SIZE,FSTYPE,MOUNTPOINTS,RM,HOTPLUG,TYPE"]).await?;
    parse_lsblk(&out)
}

fn check_device(device: &str) -> Result<()> {
    let ok =
        device.starts_with("/dev/") && device.len() < 64 && device[5..].chars().all(|c| c.is_ascii_alphanumeric() || "-_/".contains(c));
    if ok {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("not a drive: {device}")))
    }
}

/// Mount through UDisks (no root needed for removable drives). Returns the mount point.
pub async fn mount(runner: &dyn CommandRunner, device: &str) -> Result<String> {
    check_device(device)?;
    let out = run_checked(runner, "udisksctl", &["mount", "--no-user-interaction", "-b", device]).await?;
    // "Mounted /dev/sdb1 at /run/media/a/USB"
    out.split(" at ").nth(1).map(|s| s.trim().trim_end_matches('.').to_string()).ok_or(AppError::Invalid(out))
}

/// Unmount, and power off the drive when it is removable so it can be pulled out safely.
pub async fn eject(runner: &dyn CommandRunner, device: &str, power_off: bool) -> Result<()> {
    check_device(device)?;
    run_checked(runner, "udisksctl", &["unmount", "--no-user-interaction", "-b", device]).await?;
    if power_off {
        // The whole disk (sdb for sdb1); failure is fine, e.g. for SD card readers.
        let disk: String = device.trim_end_matches(|c: char| c.is_ascii_digit()).trim_end_matches('p').to_string();
        let _ = run_checked(runner, "udisksctl", &["power-off", "--no-user-interaction", "-b", &disk]).await;
    }
    Ok(())
}

// Changing files ----------------------------------------------------------------------------

fn check_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\0') || name.len() > 255 {
        return Err(AppError::Invalid(format!("“{name}” can’t be used as a name.")));
    }
    Ok(name.to_string())
}

/// "Report.pdf" -> "Report 2.pdf", "Report 3.pdf" ... until the name is free in `dir`.
pub fn free_name(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() && std::fs::symlink_metadata(&candidate).is_err() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !name.starts_with('.') => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    // "Report 2.pdf" copied again becomes "Report 3.pdf", not "Report 2 2.pdf".
    let (base, start) = match stem.rsplit_once(' ') {
        Some((b, n)) if n.parse::<u32>().is_ok() => (b.to_string(), n.parse::<u32>().unwrap() + 1),
        _ => (stem, 2),
    };
    (start..).map(|n| dir.join(format!("{base} {n}{ext}"))).find(|p| std::fs::symlink_metadata(p).is_err()).unwrap()
}

pub fn create_folder(dir: &Path, name: &str) -> Result<FileEntry> {
    let path = free_name(dir, &check_name(name)?);
    std::fs::create_dir(&path)?;
    info(&path)
}

pub fn rename(path: &Path, new_name: &str) -> Result<FileEntry> {
    let new_name = check_name(new_name)?;
    let target = path.with_file_name(&new_name);
    if target == path {
        return info(path);
    }
    if std::fs::symlink_metadata(&target).is_ok() && !new_name.eq_ignore_ascii_case(&path.file_name().unwrap_or_default().to_string_lossy())
    {
        return Err(AppError::Invalid(format!("“{new_name}” already exists here.")));
    }
    std::fs::rename(path, &target)?;
    info(&target)
}

fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(from)?;
    if meta.file_type().is_symlink() {
        std::os::unix::fs::symlink(std::fs::read_link(from)?, to)
    } else if meta.is_dir() {
        std::fs::create_dir(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        std::fs::set_permissions(to, meta.permissions())
    } else {
        std::fs::copy(from, to).map(|_| ())
    }
}

/// Copy or move `sources` into `dest`. Names that exist already get " 2", " 3" ... like
/// Finder. Moving within one file system is a rename; across drives it is copy-then-delete.
/// Returns the new paths.
pub fn transfer(sources: &[PathBuf], dest: &Path, move_files: bool) -> Result<Vec<String>> {
    if !dest.is_dir() {
        return Err(AppError::Invalid(format!("{} is not a folder", dest.display())));
    }
    let mut done = Vec::new();
    for source in sources {
        let name = source.file_name().ok_or_else(|| AppError::Invalid("can’t copy the root folder".into()))?;
        if dest.starts_with(source) {
            return Err(AppError::Invalid(format!("Can’t put “{}” inside itself.", name.to_string_lossy())));
        }
        if move_files && source.parent() == Some(dest) {
            done.push(source.to_string_lossy().into_owned());
            continue;
        }
        let target = free_name(dest, &name.to_string_lossy());
        if move_files {
            match std::fs::rename(source, &target) {
                Ok(()) => {}
                // EXDEV: another drive. Copy, then remove the original.
                Err(e) if e.raw_os_error() == Some(18) => {
                    copy_recursive(source, &target)?;
                    if source.is_dir() {
                        std::fs::remove_dir_all(source)?;
                    } else {
                        std::fs::remove_file(source)?;
                    }
                }
                Err(e) => return Err(e.into()),
            }
        } else {
            copy_recursive(source, &target)?;
        }
        done.push(target.to_string_lossy().into_owned());
    }
    Ok(done)
}

pub async fn trash(runner: &dyn CommandRunner, paths: &[PathBuf]) -> Result<()> {
    for path in paths {
        newos_syslib::shell::trash(runner, path).await?;
    }
    Ok(())
}

// Trash --------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TrashItem {
    /// The name inside the Trash (used to restore or delete it).
    pub id: String,
    pub name: String,
    pub original_path: String,
    pub deleted: String,
    pub kind: Kind,
    pub size: Option<u64>,
}

pub fn trash_dir(home: &Path) -> PathBuf {
    std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".local/share")).join("Trash")
}

/// Undo %XX escapes in a .trashinfo Path.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn parse_trashinfo(text: &str) -> Option<(String, String)> {
    let mut path = None;
    let mut date = String::new();
    for line in text.lines() {
        if let Some(p) = line.strip_prefix("Path=") {
            path = Some(percent_decode(p.trim()));
        } else if let Some(d) = line.strip_prefix("DeletionDate=") {
            date = d.trim().to_string();
        }
    }
    Some((path?, date))
}

pub fn trash_list(trash: &Path) -> Vec<TrashItem> {
    let mut items: Vec<TrashItem> = std::fs::read_dir(trash.join("info"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().into_owned();
            let id = file.strip_suffix(".trashinfo")?.to_string();
            let (original_path, deleted) = parse_trashinfo(&std::fs::read_to_string(e.path()).ok()?)?;
            let stored = trash.join("files").join(&id);
            let meta = std::fs::symlink_metadata(&stored).ok()?;
            let name = Path::new(&original_path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| id.clone());
            Some(TrashItem {
                kind: kind_of(&name, meta.is_dir()),
                size: if meta.is_dir() { None } else { Some(meta.len()) },
                name,
                original_path,
                deleted,
                id,
            })
        })
        .collect();
    items.sort_by(|a, b| b.deleted.cmp(&a.deleted));
    items
}

fn check_trash_id(id: &str) -> Result<()> {
    if id.is_empty() || id.contains('/') || id == "." || id == ".." {
        return Err(AppError::Invalid(format!("not a Trash item: {id}")));
    }
    Ok(())
}

/// Put an item back where it came from (or next to it, if that name is taken again).
pub fn trash_restore(trash: &Path, id: &str) -> Result<String> {
    check_trash_id(id)?;
    let info = trash.join("info").join(format!("{id}.trashinfo"));
    let (original, _) = parse_trashinfo(&std::fs::read_to_string(&info)?).ok_or_else(|| AppError::Invalid("damaged Trash entry".into()))?;
    let original = PathBuf::from(original);
    let dir = original.parent().ok_or_else(|| AppError::Invalid("damaged Trash entry".into()))?;
    std::fs::create_dir_all(dir)?;
    let target = free_name(dir, &original.file_name().unwrap_or_default().to_string_lossy());
    std::fs::rename(trash.join("files").join(id), &target)?;
    std::fs::remove_file(info)?;
    Ok(target.to_string_lossy().into_owned())
}

/// Permanently delete everything in the Trash.
pub fn trash_empty(trash: &Path) -> Result<usize> {
    let mut count = 0;
    for sub in ["files", "info", "expunged"] {
        let dir = trash.join(sub);
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if std::fs::symlink_metadata(&path)?.is_dir() {
                std::fs::remove_dir_all(&path)?;
            } else {
                std::fs::remove_file(&path)?;
            }
            if sub == "files" {
                count += 1;
            }
        }
    }
    let _ = std::fs::remove_file(trash.join("directorysizes"));
    Ok(count)
}

// Previews and text ---------------------------------------------------------------------------

/// The start of a text file (at most `max` bytes), or None for binary files.
pub fn read_text(path: &Path, max: usize) -> Result<Option<String>> {
    use std::io::Read;
    let mut buf = vec![0u8; max];
    let n = std::fs::File::open(path)?.read(&mut buf)?;
    buf.truncate(n);
    if buf.contains(&0) {
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
}

/// Text of a document for "Summarize": text files directly, PDFs through `pdftotext`.
pub async fn document_text(runner: &dyn CommandRunner, path: &Path, max: usize) -> Result<Option<String>> {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    match kind_of(&name, path.is_dir()) {
        Kind::Pdf => {
            let p = path.to_string_lossy();
            let text = run_checked(runner, "pdftotext", &["-l", "20", "-layout", &p, "-"]).await?;
            Ok(Some(text.chars().take(max).collect()))
        }
        Kind::Text | Kind::Code | Kind::Other => read_text(path, max),
        _ => Ok(None),
    }
}

/// A PNG of a PDF's first page in the thumbnail cache (`pdftoppm`), made once per file version.
pub async fn pdf_thumbnail(runner: &dyn CommandRunner, path: &Path, cache: &Path) -> Result<String> {
    use std::hash::{Hash, Hasher};
    let meta = std::fs::metadata(path)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (path, meta.len(), millis(&meta)).hash(&mut hasher);
    std::fs::create_dir_all(cache)?;
    let base = cache.join(format!("{:016x}", hasher.finish()));
    let png = base.with_extension("png");
    if !png.exists() {
        let (p, b) = (path.to_string_lossy(), base.to_string_lossy());
        run_checked(runner, "pdftoppm", &["-png", "-singlefile", "-f", "1", "-l", "1", "-scale-to", "512", &p, &b]).await?;
    }
    Ok(png.to_string_lossy().into_owned())
}

// Search -------------------------------------------------------------------------------------

/// What to look for. Every field is optional; the assistant fills these from a request like
/// "the pdf about taxes from March".
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SearchQuery {
    /// Words that must all appear in the name (or, with `contents`, in text files).
    pub words: Vec<String>,
    pub kinds: Vec<Kind>,
    /// Milliseconds since the Unix epoch, inclusive.
    pub modified_after: Option<u64>,
    pub modified_before: Option<u64>,
    /// Also look inside small text files.
    pub contents: bool,
}

/// Walk `root` (skipping hidden folders and build output) for matches, newest first. Stops at
/// `limit` results or after a few seconds so the app stays responsive.
pub fn search(root: &Path, query: &SearchQuery, limit: usize) -> Vec<FileEntry> {
    const SKIP: [&str; 6] = ["node_modules", "target", ".git", "__pycache__", ".cache", "venv"];
    let words: Vec<String> = query.words.iter().map(|w| w.to_lowercase()).filter(|w| !w.is_empty()).collect();
    let kinds: HashSet<Kind> = query.kinds.iter().copied().collect();
    let started = Instant::now();
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if started.elapsed() > Duration::from_secs(4) || found.len() >= limit * 4 {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            let path = e.path();
            if ft.is_dir() && !SKIP.contains(&name.as_str()) {
                stack.push(path.clone());
            }
            let kind = kind_of(&name, ft.is_dir());
            if !kinds.is_empty() && !kinds.contains(&kind) {
                continue;
            }
            let lower = name.to_lowercase();
            let name_match = words.iter().all(|w| lower.contains(w.as_str()));
            let content_match = !name_match
                && query.contents
                && matches!(kind, Kind::Text | Kind::Code)
                && e.metadata().is_ok_and(|m| m.len() < 512 * 1024)
                && read_text(&path, 512 * 1024).ok().flatten().is_some_and(|t| {
                    let t = t.to_lowercase();
                    words.iter().all(|w| t.contains(w.as_str()))
                });
            if !(name_match || content_match) {
                continue;
            }
            let Some(item) = entry(&path) else { continue };
            if query.modified_after.is_some_and(|t| item.modified < t) || query.modified_before.is_some_and(|t| item.modified > t) {
                continue;
            }
            found.push(item);
        }
    }
    found.sort_by_key(|e| std::cmp::Reverse(e.modified));
    found.truncate(limit);
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn kinds_and_natural_order() {
        assert_eq!(kind_of("Taxes.PDF", false), Kind::Pdf);
        assert_eq!(kind_of("photo.heic", false), Kind::Image);
        assert_eq!(kind_of("src", true), Kind::Folder);
        let mut names = vec!["file 10", "File 2", "file 1", "alpha"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, ["alpha", "file 1", "File 2", "file 10"]);
    }

    #[test]
    fn lists_folders_first_and_hides_dotfiles() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("b.txt"), "x");
        touch(&dir.path().join(".secret"), "x");
        std::fs::create_dir(dir.path().join("Zeta")).unwrap();
        let names: Vec<_> = list_dir(dir.path(), false).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["Zeta", "b.txt"]);
        assert_eq!(list_dir(dir.path(), true).unwrap().len(), 3);
    }

    #[test]
    fn reads_user_dirs() {
        let home = Path::new("/home/a");
        let dirs = parse_user_dirs("# comment\nXDG_DOWNLOAD_DIR=\"$HOME/Downloads\"\nXDG_MUSIC_DIR=\"/data/Music\"\n", home);
        assert_eq!(dirs, [("download".to_string(), home.join("Downloads")), ("music".to_string(), PathBuf::from("/data/Music"))]);
    }

    #[test]
    fn finds_removable_and_user_mounted_drives() {
        let json = r#"{"blockdevices":[
          {"path":"/dev/nvme0n1","label":null,"size":256060514304,"fstype":null,"mountpoints":[],"rm":false,"hotplug":false,"type":"disk","children":[
            {"path":"/dev/nvme0n1p1","label":null,"size":2147483648,"fstype":"vfat","mountpoints":["/boot"],"rm":false,"hotplug":false,"type":"part"},
            {"path":"/dev/nvme0n1p2","label":null,"size":253910859776,"fstype":"btrfs","mountpoints":["/home","/"],"rm":false,"hotplug":false,"type":"part"}]},
          {"path":"/dev/sda","label":null,"size":125069950976,"fstype":null,"mountpoints":[],"rm":true,"hotplug":false,"type":"disk","children":[
            {"path":"/dev/sda1","label":"USB STICK","size":629145600,"fstype":"vfat","mountpoints":[],"rm":true,"hotplug":false,"type":"part"},
            {"path":"/dev/sda2","label":null,"size":2147483648,"fstype":"ext4","mountpoints":["/run/media/a/f82f"],"rm":true,"hotplug":false,"type":"part"}]}
        ]}"#;
        let drives = parse_lsblk(json).unwrap();
        assert_eq!(drives.len(), 2, "system partitions are left out");
        assert_eq!(drives[0].name, "USB STICK");
        assert_eq!(drives[0].mount_point, None);
        assert_eq!(drives[1].name, "2 GB Volume");
        assert_eq!(drives[1].mount_point.as_deref(), Some("/run/media/a/f82f"));
        assert!(check_device("/dev/sda1; rm").is_err());
    }

    #[test]
    fn free_names_like_finder() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("Report.pdf"), "");
        assert_eq!(free_name(dir.path(), "Report.pdf"), dir.path().join("Report 2.pdf"));
        touch(&dir.path().join("Report 2.pdf"), "");
        assert_eq!(free_name(dir.path(), "Report 2.pdf"), dir.path().join("Report 3.pdf"));
        assert_eq!(free_name(dir.path(), "New.txt"), dir.path().join("New.txt"));
        touch(&dir.path().join(".bashrc"), "");
        assert_eq!(free_name(dir.path(), ".bashrc"), dir.path().join(".bashrc 2"));
    }

    #[test]
    fn copies_moves_and_renames() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        touch(&a.join("doc.txt"), "hello");
        touch(&a.join("sub/inner.txt"), "deep");
        std::fs::create_dir(&b).unwrap();
        let copied = transfer(&[a.join("doc.txt"), a.join("sub")], &b, false).unwrap();
        assert_eq!(copied.len(), 2);
        assert_eq!(std::fs::read_to_string(b.join("sub/inner.txt")).unwrap(), "deep");
        // Copying again makes "doc 2.txt".
        transfer(&[a.join("doc.txt")], &b, false).unwrap();
        assert!(b.join("doc 2.txt").exists());
        // Moving removes the original.
        transfer(&[a.join("doc.txt")], &b, true).unwrap();
        assert!(!a.join("doc.txt").exists() && b.join("doc 3.txt").exists());
        assert!(transfer(std::slice::from_ref(&a), &a.join("sub"), true).is_err(), "not into itself");
        let renamed = rename(&b.join("doc 3.txt"), "notes.txt").unwrap();
        assert_eq!(renamed.name, "notes.txt");
        assert!(rename(&b.join("notes.txt"), "doc 2.txt").is_err(), "taken");
        assert!(rename(&b.join("notes.txt"), "a/b").is_err());
        assert_eq!(create_folder(&b, "sub").unwrap().name, "sub 2");
    }

    #[test]
    fn trash_list_restore_empty() {
        let home = tempfile::tempdir().unwrap();
        let trash = home.path().join("Trash");
        touch(&trash.join("files/My File.txt"), "bye");
        let original = home.path().join("docs/My File.txt");
        touch(
            &trash.join("info/My File.txt.trashinfo"),
            &format!("[Trash Info]\nPath={}\nDeletionDate=2026-09-25T18:48:23\n", original.to_string_lossy().replace(' ', "%20")),
        );
        let items = trash_list(&trash);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].original_path, original.to_string_lossy());
        assert_eq!(items[0].name, "My File.txt");
        let restored = trash_restore(&trash, "My File.txt").unwrap();
        assert_eq!(restored, original.to_string_lossy());
        assert!(trash_list(&trash).is_empty());
        touch(&trash.join("files/x"), "");
        touch(&trash.join("info/x.trashinfo"), "[Trash Info]\nPath=/tmp/x\n");
        assert_eq!(trash_empty(&trash).unwrap(), 1);
        assert!(trash_restore(&trash, "../escape").is_err());
    }

    #[test]
    fn searches_names_contents_kinds_and_dates() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("Taxes 2026.pdf"), "%PDF");
        touch(&dir.path().join("notes/march.md"), "Taxes are due in April");
        touch(&dir.path().join("node_modules/taxes.js"), "");
        touch(&dir.path().join(".hidden/taxes.txt"), "");
        let q = |words: &[&str]| SearchQuery { words: words.iter().map(|s| s.to_string()).collect(), ..Default::default() };
        let names = |r: Vec<FileEntry>| r.into_iter().map(|e| e.name).collect::<Vec<_>>();
        assert_eq!(names(search(dir.path(), &q(&["taxes"]), 10)), ["Taxes 2026.pdf"]);
        let with_contents = SearchQuery { contents: true, ..q(&["taxes"]) };
        assert_eq!(search(dir.path(), &with_contents, 10).len(), 2);
        let pdfs = SearchQuery { kinds: vec![Kind::Pdf], ..q(&[]) };
        assert_eq!(names(search(dir.path(), &pdfs, 10)), ["Taxes 2026.pdf"]);
        let future = SearchQuery { modified_after: Some(u64::MAX / 2), ..q(&["taxes"]) };
        assert!(search(dir.path(), &future, 10).is_empty());
    }

    #[test]
    fn reads_text_and_skips_binary() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("a.txt"), "hello world");
        std::fs::write(dir.path().join("b.bin"), [0u8, 1, 2]).unwrap();
        assert_eq!(read_text(&dir.path().join("a.txt"), 5).unwrap().as_deref(), Some("hello"));
        assert_eq!(read_text(&dir.path().join("b.bin"), 5).unwrap(), None);
    }
}

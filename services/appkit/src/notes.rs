//! Notes are Markdown files in `~/Notes` (or `tools.notes_dir` in assistant.toml), shared with
//! the assistant's note tools. One level of folders; the file name follows the note's title
//! (its first line), like the assistant names the notes it creates. Pinned notes are listed in
//! `.newos/pinned.json` inside the notes folder.

use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::{AppError, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NoteMeta {
    /// Relative to the notes folder, e.g. "Work/Plan.md".
    pub path: String,
    /// "" for notes at the top level.
    pub folder: String,
    pub title: String,
    /// The start of the body, without Markdown markup.
    pub preview: String,
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SearchHit {
    pub note: NoteMeta,
    /// Text around the first match.
    pub snippet: String,
    pub score: f64,
}

const PINNED_FILE: &str = ".newos/pinned.json";
const UNTITLED: &str = "New Note";

/// `~/Notes`, or the folder set in assistant.toml `[tools] notes_dir`.
pub fn default_dir() -> PathBuf {
    let from_config = std::fs::read_to_string(crate::paths::assistant_config_file())
        .ok()
        .and_then(|text| text.parse::<toml_edit::DocumentMut>().ok())
        .and_then(|doc| doc.get("tools")?.get("notes_dir")?.as_str().map(PathBuf::from))
        .filter(|p| p.is_absolute());
    from_config.unwrap_or_else(|| crate::paths::home().join("Notes"))
}

/// The title of a note: its first non-empty line without heading marks.
pub fn title_of(text: &str) -> String {
    text.lines()
        .map(|l| l.trim().trim_start_matches('#').trim())
        .find(|l| !l.is_empty())
        .map(|l| l.chars().take(120).collect())
        .unwrap_or_else(|| UNTITLED.to_string())
}

/// Strip common Markdown markup for previews and snippets.
fn plain(line: &str) -> String {
    let line = line.trim().trim_start_matches('#').trim_start();
    let line = line
        .strip_prefix("- [ ] ")
        .or_else(|| line.strip_prefix("- [x] "))
        .or_else(|| line.strip_prefix("- "))
        .or_else(|| line.strip_prefix("* "))
        .or_else(|| line.strip_prefix("> "))
        .unwrap_or(line);
    line.replace("**", "").replace('`', "")
}

pub fn preview_of(text: &str) -> String {
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    lines.next(); // the title
    let joined = lines.map(plain).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ");
    joined.chars().take(140).collect()
}

/// File-safe name from a title, the same rule the assistant's `create_note` tool uses.
pub fn file_stem(title: &str) -> String {
    let cleaned: String = title.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' }).collect();
    let stem = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if stem.is_empty() {
        UNTITLED.into()
    } else {
        stem.chars().take(100).collect()
    }
}

fn invalid(what: &str) -> AppError {
    AppError::Invalid(format!("not a valid note {what}"))
}

/// A note path from the frontend: "Title.md" or "Folder/Title.md", nothing hidden or escaping.
fn check_note_path(path: &str) -> Result<PathBuf> {
    let p = Path::new(path);
    let parts: Vec<_> = p.components().collect();
    let ok = (1..=2).contains(&parts.len())
        && parts.iter().all(|c| matches!(c, Component::Normal(s) if !s.to_string_lossy().starts_with('.')))
        && p.extension().and_then(|e| e.to_str()) == Some("md");
    if ok {
        Ok(p.to_path_buf())
    } else {
        Err(invalid("path"))
    }
}

fn check_folder(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(String::new());
    }
    if name.len() > 80 || name.starts_with('.') || name.contains(['/', '\\']) || name.chars().any(char::is_control) {
        return Err(invalid("folder name"));
    }
    Ok(name.to_string())
}

pub struct Notes {
    dir: PathBuf,
}

impl Notes {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn absolute(&self, path: &str) -> Result<PathBuf> {
        Ok(self.dir.join(check_note_path(path)?))
    }

    fn relative(&self, abs: &Path) -> String {
        abs.strip_prefix(&self.dir).unwrap_or(abs).to_string_lossy().into_owned()
    }

    fn pinned(&self) -> Vec<String> {
        std::fs::read_to_string(self.dir.join(PINNED_FILE))
            .ok()
            .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
            .unwrap_or_default()
    }

    fn save_pinned(&self, pinned: &[String]) -> Result<()> {
        crate::write_atomic(&self.dir.join(PINNED_FILE), serde_json::to_string_pretty(pinned)?.as_bytes())?;
        Ok(())
    }

    fn meta(&self, abs: &Path, text: &str, pinned: &[String]) -> NoteMeta {
        let path = self.relative(abs);
        let folder = Path::new(&path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let modified = std::fs::metadata(abs)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        NoteMeta { pinned: pinned.contains(&path), path, folder, title: title_of(text), preview: preview_of(text), modified }
    }

    /// Every note file: top level and one folder deep.
    fn files(&self) -> Vec<PathBuf> {
        let mut files = Vec::new();
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return files };
        for entry in entries.flatten() {
            let path = entry.path();
            let hidden = entry.file_name().to_string_lossy().starts_with('.');
            if hidden {
                continue;
            }
            if path.is_dir() {
                if let Ok(inner) = std::fs::read_dir(&path) {
                    files.extend(inner.flatten().map(|e| e.path()).filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md")));
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                files.push(path);
            }
        }
        files
    }

    /// All notes, pinned first, then most recently edited.
    pub fn list(&self) -> Vec<NoteMeta> {
        let pinned = self.pinned();
        let mut notes: Vec<NoteMeta> =
            self.files().iter().filter_map(|abs| std::fs::read_to_string(abs).ok().map(|text| self.meta(abs, &text, &pinned))).collect();
        notes.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.modified.cmp(&a.modified)).then(a.title.cmp(&b.title)));
        notes
    }

    pub fn folders(&self) -> Vec<String> {
        let mut folders: Vec<String> = std::fs::read_dir(&self.dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !n.starts_with('.'))
            .collect();
        folders.sort_by_key(|f| f.to_lowercase());
        folders
    }

    pub fn read(&self, path: &str) -> Result<String> {
        Ok(std::fs::read_to_string(self.absolute(path)?)?)
    }

    /// A free path for `title` in `folder`: "Title.md", then "Title 2.md", ... `current` is the
    /// note being renamed, which may keep its own name.
    fn free_path(&self, folder: &str, title: &str, current: Option<&Path>) -> PathBuf {
        let base = if folder.is_empty() { self.dir.clone() } else { self.dir.join(folder) };
        let stem = file_stem(title);
        let mut candidate = base.join(format!("{stem}.md"));
        let mut n = 2;
        while candidate.exists() && Some(candidate.as_path()) != current {
            candidate = base.join(format!("{stem} {n}.md"));
            n += 1;
        }
        candidate
    }

    pub fn create(&self, folder: &str, text: &str) -> Result<NoteMeta> {
        let folder = check_folder(folder)?;
        let text = if text.trim().is_empty() { format!("# {UNTITLED}\n\n") } else { text.to_string() };
        let abs = self.free_path(&folder, &title_of(&text), None);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        crate::write_atomic(&abs, text.as_bytes())?;
        Ok(self.meta(&abs, &text, &self.pinned()))
    }

    /// Save a note. When its title changed, the file is renamed to match (and the pin moves
    /// with it). Returns the note as saved, whose `path` may differ from the one passed in.
    pub fn write(&self, path: &str, text: &str) -> Result<NoteMeta> {
        let abs = self.absolute(path)?;
        let folder = Path::new(path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let wanted_stem = file_stem(&title_of(text));
        let current_stem = abs.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        // "Title 2" already belongs to a note titled "Title"; keep it.
        let same_title = current_stem == wanted_stem
            || current_stem.strip_prefix(&wanted_stem).is_some_and(|rest| rest.trim_start().parse::<u32>().is_ok());
        let target = if same_title { abs.clone() } else { self.free_path(&folder, &title_of(text), Some(&abs)) };
        crate::write_atomic(&abs, text.as_bytes())?;
        if target != abs {
            std::fs::rename(&abs, &target)?;
            self.rename_pin(path, &self.relative(&target))?;
        }
        Ok(self.meta(&target, text, &self.pinned()))
    }

    fn rename_pin(&self, from: &str, to: &str) -> Result<()> {
        let mut pinned = self.pinned();
        if let Some(entry) = pinned.iter_mut().find(|p| *p == from) {
            *entry = to.to_string();
            self.save_pinned(&pinned)?;
        }
        Ok(())
    }

    pub fn set_pinned(&self, path: &str, pinned: bool) -> Result<()> {
        check_note_path(path)?;
        let mut list = self.pinned();
        list.retain(|p| p != path);
        if pinned {
            list.push(path.to_string());
        }
        self.save_pinned(&list)
    }

    /// Forget a note that was moved to the Trash (the caller trashes the file).
    pub fn forget(&self, path: &str) -> Result<()> {
        self.set_pinned(path, false)
    }

    pub fn move_to(&self, path: &str, folder: &str) -> Result<NoteMeta> {
        let abs = self.absolute(path)?;
        let folder = check_folder(folder)?;
        let text = std::fs::read_to_string(&abs)?;
        let target = self.free_path(&folder, &title_of(&text), None);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(&abs, &target)?;
        self.rename_pin(path, &self.relative(&target))?;
        Ok(self.meta(&target, &text, &self.pinned()))
    }

    pub fn create_folder(&self, name: &str) -> Result<String> {
        let name = check_folder(name)?;
        if name.is_empty() {
            return Err(invalid("folder name"));
        }
        std::fs::create_dir_all(self.dir.join(&name))?;
        Ok(name)
    }

    /// Remove an empty folder. Folders with notes are refused, so nothing is lost by accident.
    pub fn delete_folder(&self, name: &str) -> Result<()> {
        let name = check_folder(name)?;
        if name.is_empty() {
            return Err(invalid("folder name"));
        }
        std::fs::remove_dir(self.dir.join(&name)).map_err(|e| match e.kind() {
            std::io::ErrorKind::DirectoryNotEmpty => AppError::Invalid(format!("“{name}” still has notes in it.")),
            _ => e.into(),
        })
    }

    /// Notes containing every word of the query. Title matches rank higher, then more matches,
    /// then recent edits.
    pub fn search(&self, query: &str) -> Vec<SearchHit> {
        let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        if words.is_empty() {
            return Vec::new();
        }
        let pinned = self.pinned();
        let mut hits: Vec<SearchHit> = self
            .files()
            .iter()
            .filter_map(|abs| {
                let text = std::fs::read_to_string(abs).ok()?;
                let lower = text.to_lowercase();
                if !words.iter().all(|w| lower.contains(w.as_str())) {
                    return None;
                }
                let note = self.meta(abs, &text, &pinned);
                let title = note.title.to_lowercase();
                let mut score = 0.0;
                for w in &words {
                    if title.contains(w.as_str()) {
                        score += 3.0;
                    }
                    score += (lower.matches(w.as_str()).count() as f64).min(10.0) * 0.2;
                }
                Some(SearchHit { snippet: snippet(&text, &words), note, score })
            })
            .collect();
        hits.sort_by(|a, b| b.score.total_cmp(&a.score).then(b.note.modified.cmp(&a.note.modified)));
        hits
    }
}

/// Watches the notes folder (one level of folders) and calls `on_change` for any edit, from
/// this app, the assistant, or another program. Dropping it stops watching.
pub struct NotesWatcher {
    _watcher: notify::RecommendedWatcher,
}

pub fn watch(dir: PathBuf, on_change: impl Fn() + Send + 'static) -> Result<NotesWatcher> {
    use notify::{RecursiveMode, Watcher};
    std::fs::create_dir_all(&dir)?;
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        // Pins live in .newos/; every other hidden file (editor swap files) is noise.
        let relevant = event.paths.iter().any(|p| {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            name == "pinned.json" || !name.starts_with('.')
        });
        if relevant && !matches!(event.kind, notify::EventKind::Access(_)) {
            on_change();
        }
    })
    .map_err(|e| AppError::Invalid(format!("cannot watch {}: {e}", dir.display())))?;
    watcher.watch(&dir, RecursiveMode::Recursive).map_err(|e| AppError::Invalid(format!("cannot watch {}: {e}", dir.display())))?;
    Ok(NotesWatcher { _watcher: watcher })
}

/// The first body line containing one of `words` (the title is shown anyway), trimmed to about
/// 120 characters around the match.
fn snippet(text: &str, words: &[String]) -> String {
    let body_lines = text.lines().filter(|l| !l.trim().is_empty()).skip(1).map(plain);
    let found =
        body_lines.flat_map(|l| words.iter().map(move |w| (l.clone(), w.clone()))).find(|(l, w)| l.to_lowercase().contains(w.as_str()));
    let Some((line, word)) = found else { return preview_of(text).chars().take(120).collect() };
    let chars: Vec<char> = line.chars().collect();
    let lower: Vec<char> = line.to_lowercase().chars().collect();
    let word_chars: Vec<char> = word.chars().collect();
    let chars = if lower.len() == chars.len() { chars } else { lower.clone() };
    let at = lower.windows(word_chars.len().max(1)).position(|w| w == word_chars.as_slice()).unwrap_or(0);
    let start = at.saturating_sub(50);
    let end = (at + 70).min(chars.len());
    let mut out: String = chars[start..end].iter().collect();
    if start > 0 {
        out.insert(0, '…');
    }
    if end < chars.len() {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Notes) {
        let dir = tempfile::tempdir().unwrap();
        let notes = Notes::new(dir.path());
        (dir, notes)
    }

    #[test]
    fn titles_and_previews() {
        assert_eq!(title_of("\n# Groceries\n- [ ] milk\n- [x] **eggs**\n"), "Groceries");
        assert_eq!(preview_of("# Groceries\n- [ ] milk\n- [x] **eggs**\n"), "milk eggs");
        assert_eq!(title_of("   \n"), "New Note");
        assert_eq!(file_stem("Q3: plans/ideas?"), "Q3 plans ideas");
    }

    #[test]
    fn creates_lists_and_renames_with_the_title() {
        let (_dir, notes) = store();
        let a = notes.create("", "# Trip\n\nPack bags").unwrap();
        assert_eq!(a.path, "Trip.md");
        let b = notes.create("", "# Trip\n\nBook hotel").unwrap();
        assert_eq!(b.path, "Trip 2.md");
        // Editing the body keeps the name; "Trip 2" still belongs to a note titled "Trip".
        assert_eq!(notes.write("Trip 2.md", "# Trip\n\nBook hotel for 3").unwrap().path, "Trip 2.md");
        // A new title renames the file.
        let renamed = notes.write("Trip.md", "# Lisbon trip\n\nPack bags").unwrap();
        assert_eq!(renamed.path, "Lisbon trip.md");
        assert!(!notes.dir().join("Trip.md").exists());
        assert_eq!(notes.list().len(), 2);
    }

    #[test]
    fn pins_follow_renames_and_sort_first() {
        let (_dir, notes) = store();
        notes.create("", "# Old\n").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        notes.create("", "# Newer\n").unwrap();
        notes.set_pinned("Old.md", true).unwrap();
        assert_eq!(notes.list()[0].title, "Old");
        notes.write("Old.md", "# Renamed\n").unwrap();
        let first = &notes.list()[0];
        assert_eq!((first.path.as_str(), first.pinned), ("Renamed.md", true));
    }

    #[test]
    fn folders() {
        let (_dir, notes) = store();
        notes.create_folder("Work").unwrap();
        let note = notes.create("Work", "# Plan\n").unwrap();
        assert_eq!((note.path.as_str(), note.folder.as_str()), ("Work/Plan.md", "Work"));
        assert_eq!(notes.folders(), ["Work"]);
        assert!(notes.delete_folder("Work").is_err(), "not empty");
        let moved = notes.move_to("Work/Plan.md", "").unwrap();
        assert_eq!(moved.path, "Plan.md");
        notes.delete_folder("Work").unwrap();
        assert!(notes.create_folder("../escape").is_err());
        assert!(notes.create_folder(".hidden").is_err());
    }

    #[test]
    fn rejects_paths_outside_the_notes_folder() {
        let (_dir, notes) = store();
        for bad in ["../x.md", "/etc/passwd", "a/b/c.md", ".newos/pinned.json", "note.txt", "Work/.secret.md"] {
            assert!(notes.read(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn reports_changes() {
        let (_dir, notes) = store();
        let (tx, rx) = std::sync::mpsc::channel();
        let _watcher = watch(notes.dir().to_path_buf(), move || {
            let _ = tx.send(());
        })
        .unwrap();
        notes.create("", "# Hello\n").unwrap();
        rx.recv_timeout(std::time::Duration::from_secs(5)).expect("no change event");
    }

    #[test]
    fn searches_titles_and_bodies() {
        let (_dir, notes) = store();
        notes.create("", "# Taxes 2026\n\nSend the forms to the accountant in March.").unwrap();
        notes.create("", "# Recipes\n\nMarch is asparagus season.").unwrap();
        let hits = notes.search("march");
        assert_eq!(hits.len(), 2);
        let hits = notes.search("taxes march");
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.contains("March"));
        assert!(notes.search("nothing-here").is_empty());
        assert!(notes.search("  ").is_empty());
    }
}

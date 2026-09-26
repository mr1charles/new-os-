//! Pictures offered in Settings → Wallpaper: the user's `~/Pictures/Wallpapers`, then the
//! distribution's `/usr/share/backgrounds` and NewOS's own set.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Wallpaper {
    pub path: String,
    /// File name without the extension, for tooltips.
    pub name: String,
}

const EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "svg", "jxl"];
/// Enough for a picker grid; a huge photo library in ~/Pictures/Wallpapers is cut off.
const LIMIT: usize = 200;

pub fn default_dirs() -> Vec<PathBuf> {
    vec![
        crate::paths::home().join("Pictures/Wallpapers"),
        PathBuf::from("/usr/share/newos/wallpapers"),
        PathBuf::from("/usr/share/backgrounds"),
    ]
}

fn is_image(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Images in each directory and one level of subdirectories (distributions group wallpapers
/// in folders), sorted by name within each directory. Missing directories are skipped.
pub fn find(dirs: &[PathBuf]) -> Vec<Wallpaper> {
    let mut found = Vec::new();
    for dir in dirs {
        let mut files = Vec::new();
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Ok(inner) = std::fs::read_dir(&path) {
                    files.extend(inner.flatten().map(|e| e.path()).filter(|p| p.is_file() && is_image(p)));
                }
            } else if is_image(&path) {
                files.push(path);
            }
        }
        files.sort();
        for path in files {
            if found.len() >= LIMIT {
                return found;
            }
            let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            found.push(Wallpaper { path: path.to_string_lossy().into_owned(), name });
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_images_one_level_deep() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("b.png"), "").unwrap();
        std::fs::write(dir.path().join("a.JPG"), "").unwrap();
        std::fs::write(dir.path().join("notes.txt"), "").unwrap();
        std::fs::create_dir_all(dir.path().join("set/deeper")).unwrap();
        std::fs::write(dir.path().join("set/c.svg"), "").unwrap();
        std::fs::write(dir.path().join("set/deeper/d.png"), "").unwrap();
        let names: Vec<_> = find(&[dir.path().to_path_buf(), dir.path().join("missing")]).into_iter().map(|w| w.name).collect();
        assert_eq!(names, ["a", "b", "c"]);
    }
}

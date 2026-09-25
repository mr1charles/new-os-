//! Installed applications from freedesktop `.desktop` files.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DesktopEntry {
    /// Desktop file id, e.g. "firefox.desktop".
    pub id: String,
    pub name: String,
    pub generic_name: Option<String>,
    pub keywords: Vec<String>,
    pub exec: Option<String>,
    pub icon: Option<String>,
}

/// Parse the [Desktop Entry] group. Returns None for hidden/NoDisplay entries and non-apps.
pub fn parse_desktop_entry(id: &str, text: &str) -> Option<DesktopEntry> {
    let mut in_main = false;
    let mut fields = BTreeMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_main = line == "[Desktop Entry]";
            continue;
        }
        if !in_main || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            // Localized keys (Name[de]) are skipped; the unlocalized value is the fallback.
            if !key.contains('[') {
                fields.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
    }
    if fields.get("Type").map(String::as_str) != Some("Application") {
        return None;
    }
    if fields.get("NoDisplay").map(String::as_str) == Some("true") || fields.get("Hidden").map(String::as_str) == Some("true") {
        return None;
    }
    Some(DesktopEntry {
        id: id.to_string(),
        name: fields.get("Name")?.clone(),
        generic_name: fields.get("GenericName").cloned(),
        keywords: fields.get("Keywords").map(|k| k.split(';').filter(|s| !s.is_empty()).map(str::to_string).collect()).unwrap_or_default(),
        exec: fields.get("Exec").cloned(),
        icon: fields.get("Icon").cloned(),
    })
}

/// XDG application directories, highest priority first.
pub fn application_dirs() -> Vec<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    let data_home = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| format!("{home}/.local/share"));
    let data_dirs = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
    let mut dirs = vec![PathBuf::from(&data_home).join("applications")];
    dirs.push(PathBuf::from(&data_home).join("flatpak/exports/share/applications"));
    dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
    dirs.extend(data_dirs.split(':').filter(|d| !d.is_empty()).map(|d| PathBuf::from(d).join("applications")));
    dirs
}

/// All visible apps in `dirs`; the first directory that defines an id wins.
pub fn list_apps(dirs: &[PathBuf]) -> Vec<DesktopEntry> {
    let mut seen = BTreeMap::new();
    for dir in dirs {
        collect(dir, dir, &mut seen);
    }
    let mut apps: Vec<DesktopEntry> = seen.into_values().flatten().collect();
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

fn collect(root: &Path, dir: &Path, seen: &mut BTreeMap<String, Option<DesktopEntry>>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, seen);
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
            continue;
        }
        // Desktop file ids use '-' for subdirectories (kde/foo.desktop -> kde-foo.desktop).
        let id = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('/', "-");
        if seen.contains_key(&id) {
            continue;
        }
        let parsed = std::fs::read_to_string(&path).ok().and_then(|text| parse_desktop_entry(&id, &text));
        seen.insert(id, parsed);
    }
}

/// Best app for a spoken name ("firefox", "the terminal", "web browser").
pub fn find_app<'a>(query: &str, apps: &'a [DesktopEntry]) -> Option<&'a DesktopEntry> {
    let q = query.trim().to_lowercase();
    let q = q.strip_prefix("the ").unwrap_or(&q).trim_end_matches(" app").to_string();
    if q.is_empty() {
        return None;
    }
    let score = |app: &DesktopEntry| -> u32 {
        let name = app.name.to_lowercase();
        let id = app.id.trim_end_matches(".desktop").to_lowercase();
        if name == q || id == q || id.rsplit('.').next() == Some(q.as_str()) {
            100
        } else if name.starts_with(&q) {
            80
        } else if name.contains(&q) || id.contains(&q) {
            60
        } else if app.generic_name.as_deref().map(|g| g.to_lowercase().contains(&q)).unwrap_or(false) {
            50
        } else if app.keywords.iter().any(|k| k.to_lowercase() == q) {
            40
        } else {
            0
        }
    };
    apps.iter().map(|a| (score(a), a)).filter(|(s, _)| *s > 0).max_by_key(|(s, _)| *s).map(|(_, a)| a)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIREFOX: &str = "[Desktop Entry]\nType=Application\nName=Firefox\nName[de]=Feuerfuchs\nGenericName=Web Browser\nKeywords=internet;www;\nExec=firefox %u\nIcon=firefox\n\n[Desktop Action new-window]\nName=New Window\n";

    #[test]
    fn parses_the_main_group_only() {
        let entry = parse_desktop_entry("firefox.desktop", FIREFOX).unwrap();
        assert_eq!(entry.name, "Firefox");
        assert_eq!(entry.generic_name.as_deref(), Some("Web Browser"));
        assert_eq!(entry.keywords, vec!["internet", "www"]);
        assert_eq!(entry.exec.as_deref(), Some("firefox %u"));
    }

    #[test]
    fn skips_hidden_and_non_apps() {
        assert!(parse_desktop_entry("a.desktop", "[Desktop Entry]\nType=Application\nName=A\nNoDisplay=true\n").is_none());
        assert!(parse_desktop_entry("b.desktop", "[Desktop Entry]\nType=Link\nName=B\n").is_none());
    }

    #[test]
    fn lists_and_finds_apps() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("firefox.desktop"), FIREFOX).unwrap();
        std::fs::create_dir(dir.path().join("kde")).unwrap();
        std::fs::write(dir.path().join("kde/konsole.desktop"), "[Desktop Entry]\nType=Application\nName=Konsole\nGenericName=Terminal\n")
            .unwrap();
        let apps = list_apps(&[dir.path().to_path_buf()]);
        assert_eq!(apps.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), vec!["firefox.desktop", "kde-konsole.desktop"]);
        assert_eq!(find_app("firefox", &apps).unwrap().name, "Firefox");
        assert_eq!(find_app("the web browser", &apps).unwrap().name, "Firefox");
        assert_eq!(find_app("terminal", &apps).unwrap().name, "Konsole");
        assert!(find_app("photoshop", &apps).is_none());
    }
}

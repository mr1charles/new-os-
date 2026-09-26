//! The live settings file (`~/.config/newos/shell.json`).
//!
//! The schema and defaults live in TypeScript (`@newos/sdk`), shared by the shell and the apps,
//! so this side treats the file as JSON: read it, deep-merge a patch into it, write it
//! atomically, and report changes made by anyone else.

use std::path::{Path, PathBuf};

use notify::{RecursiveMode, Watcher};
use serde_json::{Map, Value};

use crate::Result;

/// The file's JSON object. A missing, empty, or invalid file reads as `{}` so the frontend
/// falls back to its defaults.
pub fn read(path: &Path) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Map::new()))
}

/// Merge `patch` into `target`: objects merge key by key, anything else (including arrays,
/// such as the Dock's pinned apps) replaces.
pub fn merge(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(target), Value::Object(patch)) => {
            for (key, value) in patch {
                merge(target.entry(key.clone()).or_insert(Value::Null), value);
            }
        }
        (target, patch) => *target = patch.clone(),
    }
}

/// Apply a partial update and return the new contents.
pub fn update(path: &Path, patch: &Value) -> Result<Value> {
    if !patch.is_object() {
        return Err(crate::AppError::Invalid("a settings update must be a JSON object".into()));
    }
    let mut current = read(path);
    merge(&mut current, patch);
    let text = serde_json::to_string_pretty(&current)? + "\n";
    crate::write_atomic(path, text.as_bytes())?;
    Ok(current)
}

/// Watches the settings file. Dropping it stops watching.
pub struct SettingsWatcher {
    _watcher: notify::RecommendedWatcher,
}

/// Call `on_change` with the new contents whenever the file changes. The directory is watched,
/// not the file, because atomic writes replace the file (a new inode) on every save.
pub fn watch(path: PathBuf, on_change: impl Fn(Value) + Send + 'static) -> Result<SettingsWatcher> {
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    std::fs::create_dir_all(&dir)?;
    let file_name = path.file_name().map(|n| n.to_owned());
    let mut last = read(&path);
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if !event.paths.iter().any(|p| p.file_name() == file_name.as_deref()) {
            return;
        }
        let current = read(&path);
        if current != last {
            last = current.clone();
            on_change(current);
        }
    })
    .map_err(|e| crate::AppError::Invalid(format!("cannot watch {}: {e}", dir.display())))?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| crate::AppError::Invalid(format!("cannot watch {}: {e}", dir.display())))?;
    Ok(SettingsWatcher { _watcher: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_or_broken_files_read_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shell.json");
        assert_eq!(read(&path), json!({}));
        std::fs::write(&path, "{ not json").unwrap();
        assert_eq!(read(&path), json!({}));
        std::fs::write(&path, "[1, 2]").unwrap();
        assert_eq!(read(&path), json!({}));
    }

    #[test]
    fn merges_objects_and_replaces_arrays() {
        let mut value = json!({"appearance": {"theme": "dark", "accent": "blue"}, "dock": {"pinned": ["a", "b"]}});
        merge(&mut value, &json!({"appearance": {"accent": "pink"}, "dock": {"pinned": ["c"]}}));
        assert_eq!(value, json!({"appearance": {"theme": "dark", "accent": "pink"}, "dock": {"pinned": ["c"]}}));
    }

    #[test]
    fn updates_keep_unrelated_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("newos/shell.json");
        update(&path, &json!({"bar": {"clock24h": true}})).unwrap();
        let after = update(&path, &json!({"appearance": {"theme": "light"}})).unwrap();
        assert_eq!(after, json!({"bar": {"clock24h": true}, "appearance": {"theme": "light"}}));
        assert_eq!(read(&path), after);
        assert!(update(&path, &json!(3)).is_err());
    }

    #[test]
    fn reports_changes_from_other_writers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shell.json");
        let (tx, rx) = std::sync::mpsc::channel();
        let _watcher = watch(path.clone(), move |value| tx.send(value).unwrap()).unwrap();
        crate::write_atomic(&path, br#"{"bar": {"showSeconds": true}}"#).unwrap();
        let value = rx.recv_timeout(std::time::Duration::from_secs(5)).expect("no change event");
        assert_eq!(value, json!({"bar": {"showSeconds": true}}));
    }
}

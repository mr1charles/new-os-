//! Notes are Markdown files in ~/Notes, shared with the Notes app.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::{object_schema, str_arg, tool, Tool, ToolContext};
use crate::providers::BoxFuture;

pub fn tools() -> Vec<Tool> {
    vec![
        tool(
            "create_note",
            "Create a new note (Markdown) in the Notes app. Call this when the user asks you to write down, jot, save, or make a note or list.",
            object_schema(
                json!({"title": {"type": "string", "maxLength": 120}, "body": {"type": "string", "description": "Markdown content"}}),
                &["title", "body"],
            ),
            create_note,
        ),
        tool(
            "append_note",
            "Add text to the end of an existing note, found by title.",
            object_schema(json!({"title": {"type": "string"}, "text": {"type": "string"}}), &["title", "text"]),
            append_note,
        ),
        tool(
            "list_notes",
            "List the user's notes, most recently edited first.",
            object_schema(json!({}), &[]),
            list_notes,
        ),
        tool(
            "read_note",
            "Read a note by title (or part of its title).",
            object_schema(json!({"title": {"type": "string"}}), &["title"]),
            read_note,
        ),
    ]
}

/// File-safe name from a title: keeps letters, digits, spaces, dashes.
pub fn file_stem(title: &str) -> String {
    let cleaned: String = title.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' }).collect();
    let stem = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if stem.is_empty() {
        "Untitled".into()
    } else {
        stem.chars().take(100).collect()
    }
}

fn note_files(dir: &Path) -> Vec<(PathBuf, std::time::SystemTime)> {
    let mut notes: Vec<_> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
        .map(|e| {
            let modified = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
            (e.path(), modified)
        })
        .collect();
    notes.sort_by(|a, b| b.1.cmp(&a.1));
    notes
}

/// Exact title match first, then the most recent note whose title contains the query.
pub fn find_note(dir: &Path, title: &str) -> Option<PathBuf> {
    let wanted = file_stem(title).to_lowercase();
    let notes = note_files(dir);
    let stem = |p: &Path| p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    notes.iter().find(|(p, _)| stem(p) == wanted).or_else(|| notes.iter().find(|(p, _)| stem(p).contains(&wanted))).map(|(p, _)| p.clone())
}

fn create_note<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let title = str_arg(&input, "title")?;
        let body = str_arg(&input, "body")?;
        std::fs::create_dir_all(&ctx.notes_dir)?;
        let stem = file_stem(title);
        let mut path = ctx.notes_dir.join(format!("{stem}.md"));
        let mut n = 2;
        while path.exists() {
            path = ctx.notes_dir.join(format!("{stem} {n}.md"));
            n += 1;
        }
        std::fs::write(&path, format!("# {}\n\n{}\n", title.trim(), body.trim_end()))?;
        Ok(format!("Created the note \"{}\".", path.file_stem().unwrap_or_default().to_string_lossy()))
    })
}

fn append_note<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let title = str_arg(&input, "title")?;
        let text = str_arg(&input, "text")?;
        let path = find_note(&ctx.notes_dir, title).ok_or_else(|| anyhow::anyhow!("no note titled \"{title}\""))?;
        let mut existing = std::fs::read_to_string(&path)?;
        if !existing.ends_with('\n') {
            existing.push('\n');
        }
        existing.push_str(text.trim_end());
        existing.push('\n');
        std::fs::write(&path, existing)?;
        Ok(format!("Added to \"{}\".", path.file_stem().unwrap_or_default().to_string_lossy()))
    })
}

fn list_notes<'a>(ctx: &'a ToolContext, _input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let titles: Vec<String> = note_files(&ctx.notes_dir)
            .iter()
            .take(100)
            .map(|(p, _)| p.file_stem().unwrap_or_default().to_string_lossy().into_owned())
            .collect();
        Ok(if titles.is_empty() { "No notes yet.".into() } else { titles.join("\n") })
    })
}

fn read_note<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let title = str_arg(&input, "title")?;
        let path = find_note(&ctx.notes_dir, title).ok_or_else(|| anyhow::anyhow!("no note titled \"{title}\""))?;
        let text = std::fs::read_to_string(&path)?;
        Ok(text.chars().take(32_000).collect())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_safe_file_names() {
        assert_eq!(file_stem("Groceries / week 3?"), "Groceries week 3");
        assert_eq!(file_stem("../../etc/passwd"), "etc passwd");
        assert_eq!(file_stem("???"), "Untitled");
    }

    #[test]
    fn finds_notes_by_title() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Groceries.md"), "# Groceries").unwrap();
        std::fs::write(dir.path().join("Trip to Lisbon.md"), "# Trip").unwrap();
        assert!(find_note(dir.path(), "groceries").unwrap().ends_with("Groceries.md"));
        assert!(find_note(dir.path(), "lisbon").unwrap().ends_with("Trip to Lisbon.md"));
        assert!(find_note(dir.path(), "taxes").is_none());
    }
}

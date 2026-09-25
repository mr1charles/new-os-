use std::io::Read;
use std::path::Path;
use std::time::SystemTime;

use newos_syslib::shell;
use serde_json::{json, Value};
use walkdir::{DirEntry, WalkDir};

use super::{int_arg, object_schema, opt_str, str_arg, tool, Tool, ToolContext};
use crate::providers::BoxFuture;

const MAX_READ_BYTES: usize = 64 * 1024;
const MAX_SCANNED: usize = 200_000;
const SKIP_DIRS: [&str; 8] = ["node_modules", "target", ".cache", ".git", "__pycache__", ".venv", ".local", ".var"];

pub fn tools() -> Vec<Tool> {
    vec![
        tool(
            "search_files",
            "Search the user's home folder for files whose names contain all the given words, newest first. Call this whenever the user refers to a file you don't have a path for, e.g. \"my tax PDF\" or \"the photos from yesterday\".",
            object_schema(
                json!({
                    "query": {"type": "string", "description": "Words from the file name; may be empty when kind is set"},
                    "kind": {"type": "string", "enum": ["any", "document", "pdf", "image", "audio", "video", "code", "archive"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                }),
                &["query"],
            ),
            search_files,
        ),
        tool(
            "open_path",
            "Open a file or folder in its default app. Use a path from search_files.",
            object_schema(json!({"path": {"type": "string"}}), &["path"]),
            open_path,
        ),
        tool(
            "read_text_file",
            "Read a text file from the user's home folder (up to 64 KB) so you can summarize or answer questions about it.",
            object_schema(json!({"path": {"type": "string"}}), &["path"]),
            read_text_file,
        ),
        Tool {
            confirm: true,
            describe: |input| format!("Move to Trash: {}", input["path"].as_str().unwrap_or("?")),
            ..tool(
                "move_to_trash",
                "Move a file or folder in the home folder to the Trash (recoverable). The user is asked to confirm first.",
                object_schema(json!({"path": {"type": "string"}}), &["path"]),
                move_to_trash,
            )
        },
    ]
}

fn extensions(kind: &str) -> &'static [&'static str] {
    match kind {
        "pdf" => &["pdf"],
        "document" => {
            &["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "pages", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp", "epub"]
        }
        "image" => &["png", "jpg", "jpeg", "gif", "webp", "heic", "svg", "bmp", "tiff", "avif"],
        "audio" => &["mp3", "flac", "ogg", "opus", "wav", "m4a", "aac"],
        "video" => &["mp4", "mkv", "webm", "mov", "avi", "m4v"],
        "code" => &[
            "rs", "ts", "tsx", "js", "py", "go", "c", "h", "cpp", "java", "kt", "sh", "rb", "php", "cs", "swift", "json", "toml", "yaml",
            "yml",
        ],
        "archive" => &["zip", "tar", "gz", "xz", "zst", "7z", "rar", "iso"],
        _ => &[],
    }
}

fn skip(entry: &DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    entry.depth() > 0 && entry.file_type().is_dir() && (SKIP_DIRS.contains(&name.as_ref()) || (name.starts_with('.') && name != ".config"))
}

/// Pure search over a directory tree, for tests.
pub fn find_files(root: &Path, query: &str, kind: &str, limit: usize) -> Vec<(String, SystemTime)> {
    let words: Vec<String> = query.to_lowercase().split_whitespace().map(str::to_string).collect();
    let wanted = extensions(kind);
    let mut matches = Vec::new();
    for entry in WalkDir::new(root).max_depth(8).into_iter().filter_entry(|e| !skip(e)).flatten().take(MAX_SCANNED) {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if !words.iter().all(|w| name.contains(w.as_str())) {
            continue;
        }
        if !wanted.is_empty() {
            let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or_default();
            if !wanted.contains(&ext) {
                continue;
            }
        }
        let modified = entry.metadata().ok().and_then(|m| m.modified().ok()).unwrap_or(SystemTime::UNIX_EPOCH);
        matches.push((entry.path().to_string_lossy().into_owned(), modified));
    }
    matches.sort_by(|a, b| b.1.cmp(&a.1));
    matches.truncate(limit);
    matches
}

fn search_files<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let query = str_arg(&input, "query")?.to_string();
        let kind = opt_str(&input, "kind").unwrap_or("any").to_string();
        anyhow::ensure!(!query.trim().is_empty() || kind != "any", "give some words from the file name or a kind of file");
        let limit = int_arg(&input, "limit").unwrap_or(15).clamp(1, 50) as usize;
        let home = ctx.home.clone();
        let found = tokio::task::spawn_blocking(move || find_files(&home, &query, &kind, limit)).await?;
        if found.is_empty() {
            return Ok("No matching files.".into());
        }
        let list: Vec<Value> = found
            .into_iter()
            .map(|(path, modified)| {
                let modified = chrono::DateTime::<chrono::Local>::from(modified).format("%Y-%m-%d %H:%M").to_string();
                json!({"path": path, "modified": modified})
            })
            .collect();
        Ok(Value::Array(list).to_string())
    })
}

fn open_path<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let path = ctx.resolve(str_arg(&input, "path")?);
        shell::open_path(ctx.runner.as_ref(), &path).await?;
        Ok(format!("Opened {}.", path.display()))
    })
}

fn read_text_file<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let path = ctx.resolve_in_home(str_arg(&input, "path")?)?;
        anyhow::ensure!(path.is_file(), "{} is not a file", path.display());
        let mut bytes = Vec::new();
        std::fs::File::open(&path)?.take(MAX_READ_BYTES as u64 + 1).read_to_end(&mut bytes)?;
        let truncated = bytes.len() > MAX_READ_BYTES;
        bytes.truncate(MAX_READ_BYTES);
        anyhow::ensure!(!bytes.contains(&0), "{} is not a text file", path.display());
        let mut text = String::from_utf8_lossy(&bytes).into_owned();
        if truncated {
            text.push_str("\n[truncated: only the first 64 KB were read]");
        }
        Ok(text)
    })
}

fn move_to_trash<'a>(ctx: &'a ToolContext, input: Value) -> BoxFuture<'a, anyhow::Result<String>> {
    Box::pin(async move {
        let path = ctx.resolve_in_home(str_arg(&input, "path")?)?;
        let home = ctx.home.canonicalize().unwrap_or_else(|_| ctx.home.clone());
        anyhow::ensure!(path != home, "the home folder itself can't be moved to the Trash");
        shell::trash(ctx.runner.as_ref(), &path).await?;
        Ok(format!("Moved {} to the Trash.", path.display()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_files_by_words_and_kind() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("Documents/Taxes")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        std::fs::write(root.join("Documents/Taxes/Tax Return 2025.pdf"), b"%PDF").unwrap();
        std::fs::write(root.join("Documents/tax-notes.txt"), b"notes").unwrap();
        std::fs::write(root.join("node_modules/pkg/tax.pdf"), b"x").unwrap();
        std::fs::write(root.join(".hidden/tax.pdf"), b"x").unwrap();

        let all = find_files(root, "tax", "any", 10);
        assert_eq!(all.len(), 2);
        let pdfs = find_files(root, "tax return", "pdf", 10);
        assert_eq!(pdfs.len(), 1);
        assert!(pdfs[0].0.ends_with("Tax Return 2025.pdf"));
        assert!(find_files(root, "", "image", 10).is_empty());
    }
}

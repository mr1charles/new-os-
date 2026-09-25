//! Conversation history, remembered facts, and an audit log of tool calls, in SQLite.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::conversation::{title_from, Message};

pub struct Memory {
    db: Mutex<Connection>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Fact {
    pub id: i64,
    pub text: String,
    pub created_at: i64,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    tool TEXT NOT NULL,
    input TEXT NOT NULL,
    output TEXT NOT NULL,
    ok INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
";

impl Memory {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Self::init(Connection::open(path)?)
    }

    /// History that disappears when the daemon stops (privacy.store_history = false).
    pub fn in_memory() -> anyhow::Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> anyhow::Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { db: Mutex::new(conn) })
    }

    fn db(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Create a conversation titled from its first message.
    pub fn create_conversation(&self, first_message: &str) -> anyhow::Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let ts = now();
        self.db().execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![id, title_from(first_message), ts],
        )?;
        Ok(id)
    }

    pub fn conversation_exists(&self, id: &str) -> anyhow::Result<bool> {
        Ok(self.db().query_row("SELECT 1 FROM conversations WHERE id = ?1", [id], |_| Ok(())).optional()?.is_some())
    }

    pub fn append(&self, conversation_id: &str, messages: &[Message]) -> anyhow::Result<()> {
        let mut db = self.db();
        let tx = db.transaction()?;
        let ts = now();
        for message in messages {
            tx.execute(
                "INSERT INTO messages (conversation_id, body, created_at) VALUES (?1, ?2, ?3)",
                params![conversation_id, serde_json::to_string(message)?, ts],
            )?;
        }
        tx.execute("UPDATE conversations SET updated_at = ?2 WHERE id = ?1", params![conversation_id, ts])?;
        tx.commit()?;
        Ok(())
    }

    pub fn messages(&self, conversation_id: &str) -> anyhow::Result<Vec<Message>> {
        let db = self.db();
        let mut stmt = db.prepare("SELECT body FROM messages WHERE conversation_id = ?1 ORDER BY id")?;
        let rows = stmt.query_map([conversation_id], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for body in rows {
            out.push(serde_json::from_str(&body?)?);
        }
        Ok(out)
    }

    pub fn conversations(&self, limit: u32) -> anyhow::Result<Vec<ConversationSummary>> {
        let db = self.db();
        let mut stmt =
            db.prepare("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC, rowid DESC LIMIT ?1")?;
        let rows = stmt.query_map([limit], |row| {
            Ok(ConversationSummary { id: row.get(0)?, title: row.get(1)?, created_at: row.get(2)?, updated_at: row.get(3)? })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn delete_conversation(&self, id: &str) -> anyhow::Result<bool> {
        Ok(self.db().execute("DELETE FROM conversations WHERE id = ?1", [id])? > 0)
    }

    pub fn remember(&self, text: &str) -> anyhow::Result<Fact> {
        let text = text.trim();
        anyhow::ensure!(!text.is_empty(), "nothing to remember");
        let db = self.db();
        db.execute("INSERT OR IGNORE INTO facts (text, created_at) VALUES (?1, ?2)", params![text, now()])?;
        Ok(db.query_row("SELECT id, text, created_at FROM facts WHERE text = ?1", [text], |row| {
            Ok(Fact { id: row.get(0)?, text: row.get(1)?, created_at: row.get(2)? })
        })?)
    }

    pub fn facts(&self) -> anyhow::Result<Vec<Fact>> {
        let db = self.db();
        let mut stmt = db.prepare("SELECT id, text, created_at FROM facts ORDER BY id")?;
        let rows = stmt.query_map([], |row| Ok(Fact { id: row.get(0)?, text: row.get(1)?, created_at: row.get(2)? }))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Forget facts by id, or every fact containing the given text. Returns how many.
    pub fn forget(&self, id_or_text: &str) -> anyhow::Result<usize> {
        let db = self.db();
        if let Ok(id) = id_or_text.trim().parse::<i64>() {
            return Ok(db.execute("DELETE FROM facts WHERE id = ?1", [id])?);
        }
        let pattern = format!("%{}%", id_or_text.trim().replace('%', "\\%").replace('_', "\\_"));
        Ok(db.execute("DELETE FROM facts WHERE text LIKE ?1 ESCAPE '\\'", [pattern])?)
    }

    pub fn audit(&self, conversation_id: &str, tool: &str, input: &serde_json::Value, output: &str, ok: bool) -> anyhow::Result<()> {
        let output: String = output.chars().take(4000).collect();
        self.db().execute(
            "INSERT INTO tool_audit (conversation_id, tool, input, output, ok, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![conversation_id, tool, input.to_string(), output, ok as i32, now()],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::Block;

    #[test]
    fn stores_conversations_in_order() {
        let memory = Memory::in_memory().unwrap();
        let id = memory.create_conversation("Plan my week\nplease").unwrap();
        memory.append(&id, &[Message::user(vec![Block::text("Plan my week")])]).unwrap();
        memory.append(&id, &[Message::assistant(vec![Block::text("Sure.")])]).unwrap();
        let messages = memory.messages(&id).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].plain_text(), "Sure.");
        let list = memory.conversations(10).unwrap();
        assert_eq!(list[0].title, "Plan my week");
        assert!(memory.conversation_exists(&id).unwrap());
        assert!(memory.delete_conversation(&id).unwrap());
        assert!(memory.messages(&id).unwrap().is_empty());
        assert!(!memory.conversation_exists(&id).unwrap());
    }

    #[test]
    fn remembers_and_forgets_facts() {
        let memory = Memory::in_memory().unwrap();
        let fact = memory.remember("My dog is called Pixel").unwrap();
        memory.remember("My dog is called Pixel").unwrap();
        memory.remember("I prefer 24-hour time").unwrap();
        assert_eq!(memory.facts().unwrap().len(), 2);
        assert_eq!(memory.forget("dog").unwrap(), 1);
        assert_eq!(memory.forget(&fact.id.to_string()).unwrap(), 0);
        assert_eq!(memory.facts().unwrap()[0].text, "I prefer 24-hour time");
        assert!(memory.remember("  ").is_err());
    }

    #[test]
    fn persists_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub/assistant.db");
        {
            let memory = Memory::open(&path).unwrap();
            memory.remember("likes tea").unwrap();
            memory.audit("c", "set_timer", &serde_json::json!({"seconds": 1}), "ok", true).unwrap();
        }
        assert_eq!(Memory::open(&path).unwrap().facts().unwrap()[0].text, "likes tea");
    }
}

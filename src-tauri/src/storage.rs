use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};

use anyhow::{Context, Result};
use base64::{engine::general_purpose, Engine as _};
use chrono::{Duration, Utc};
use directories::ProjectDirs;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    crypto,
    models::{
        AppSettings, ClipboardFilters, ClipboardItem, ClipboardKind, NewClipboardItem,
        SearchResponse,
    },
};

pub struct Storage {
    connection: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupPayload {
    version: u32,
    exported_at: String,
    settings: AppSettings,
    items: Vec<BackupItem>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupItem {
    id: String,
    kind: String,
    text: Option<String>,
    ocr_text: Option<String>,
    image_blob: Option<String>,
    thumbnail_blob: Option<String>,
    source_app: Option<String>,
    source_title: Option<String>,
    hash: String,
    created_at: String,
    last_used_at: Option<String>,
    pinned: bool,
    size_bytes: i64,
    expires_at: Option<String>,
    tags: Vec<String>,
}

impl Storage {
    pub fn open() -> Result<Self> {
        let dir = app_data_dir()?;
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("failed to create app data dir {}", dir.display()))?;
        let key = crypto::load_or_create_database_key(&dir.join("clipvault.key"))?;
        let db_path = dir.join("clipvault.db");
        let connection = Connection::open(db_path)?;
        apply_cipher_key(&connection, &key)?;
        let storage = Self {
            connection: Mutex::new(connection),
        };
        storage.migrate()?;
        Ok(storage)
    }

    pub fn settings(&self) -> Result<AppSettings> {
        let conn = self.conn()?;
        self.settings_locked(&conn)
    }

    fn settings_locked(&self, conn: &Connection) -> Result<AppSettings> {
        let raw: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| {
                row.get(0)
            })
            .optional()?;

        raw.map(|value| serde_json::from_str(&value).context("failed to parse settings"))
            .transpose()
            .map(|settings| settings.unwrap_or_default())
    }

    pub fn update_settings(&self, settings: &AppSettings) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO settings(key, value) VALUES('app', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [serde_json::to_string(settings)?],
        )?;
        Ok(())
    }

    pub fn export_backup(&self) -> Result<String> {
        let conn = self.conn()?;
        let settings = self.settings_locked(&conn)?;
        let mut stmt = conn.prepare(
            "SELECT id, kind, text, ocr_text, image_blob, thumbnail_blob, source_app, source_title,
                    hash, created_at, last_used_at, pinned, size_bytes, expires_at
             FROM clipboard_items
             WHERE kind = 'note' OR pinned = 1
             ORDER BY datetime(created_at) DESC",
        )?;
        let items = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let image_blob: Option<Vec<u8>> = row.get(4)?;
                let thumbnail_blob: Option<Vec<u8>> = row.get(5)?;
                Ok(BackupItem {
                    id: id.clone(),
                    kind: row.get(1)?,
                    text: row.get(2)?,
                    ocr_text: row.get(3)?,
                    image_blob: image_blob.map(|bytes| general_purpose::STANDARD.encode(bytes)),
                    thumbnail_blob: thumbnail_blob
                        .map(|bytes| general_purpose::STANDARD.encode(bytes)),
                    source_app: row.get(6)?,
                    source_title: row.get(7)?,
                    hash: row.get(8)?,
                    created_at: row.get(9)?,
                    last_used_at: row.get(10)?,
                    pinned: row.get::<_, i64>(11)? == 1,
                    size_bytes: row.get(12)?,
                    expires_at: row.get(13)?,
                    tags: tags_for_item(&conn, &id)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let payload = BackupPayload {
            version: 1,
            exported_at: Utc::now().to_rfc3339(),
            settings,
            items,
        };
        let protected = crypto::protect(&serde_json::to_vec(&payload)?)?;
        Ok(format!(
            "clipvault-dpapi-v1:{}",
            general_purpose::STANDARD.encode(protected)
        ))
    }

    pub fn import_backup(&self, backup: &str) -> Result<usize> {
        let encoded = backup
            .trim()
            .strip_prefix("clipvault-dpapi-v1:")
            .ok_or_else(|| anyhow::anyhow!("unsupported ClipVault backup format"))?;
        let protected = general_purpose::STANDARD.decode(encoded)?;
        let json = crypto::unprotect(&protected)?;
        let payload: BackupPayload = serde_json::from_slice(&json)?;
        if payload.version != 1 {
            anyhow::bail!("unsupported ClipVault backup version {}", payload.version);
        }

        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO settings(key, value) VALUES('app', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [serde_json::to_string(&payload.settings)?],
        )?;

        let tx = conn.unchecked_transaction()?;
        for item in &payload.items {
            tx.execute(
                "INSERT INTO clipboard_items(
                    id, kind, text, ocr_text, image_blob, thumbnail_blob, source_app, source_title,
                    hash, created_at, last_used_at, pinned, size_bytes, expires_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(id) DO UPDATE SET
                    kind = excluded.kind,
                    text = excluded.text,
                    ocr_text = excluded.ocr_text,
                    image_blob = excluded.image_blob,
                    thumbnail_blob = excluded.thumbnail_blob,
                    source_app = excluded.source_app,
                    source_title = excluded.source_title,
                    hash = excluded.hash,
                    created_at = excluded.created_at,
                    last_used_at = excluded.last_used_at,
                    pinned = excluded.pinned,
                    size_bytes = excluded.size_bytes,
                    expires_at = excluded.expires_at",
                params![
                    &item.id,
                    &item.kind,
                    &item.text,
                    &item.ocr_text,
                    decode_optional_blob(&item.image_blob)?,
                    decode_optional_blob(&item.thumbnail_blob)?,
                    &item.source_app,
                    &item.source_title,
                    &item.hash,
                    &item.created_at,
                    &item.last_used_at,
                    item.pinned as i64,
                    item.size_bytes,
                    &item.expires_at
                ],
            )?;
            tx.execute("DELETE FROM item_tags WHERE item_id = ?1", [&item.id])?;
            for tag in item
                .tags
                .iter()
                .map(|tag| tag.trim().to_lowercase())
                .filter(|tag| !tag.is_empty())
            {
                tx.execute("INSERT OR IGNORE INTO tags(name) VALUES(?1)", [&tag])?;
                tx.execute(
                    "INSERT OR IGNORE INTO item_tags(item_id, tag_name) VALUES(?1, ?2)",
                    params![&item.id, tag],
                )?;
            }
        }
        tx.commit()?;

        for item in &payload.items {
            self.reindex_item(&conn, &item.id)?;
        }
        Ok(payload.items.len())
    }

    pub fn insert_item(&self, item: NewClipboardItem) -> Result<Option<String>> {
        let settings = self.settings()?;
        let conn = self.conn()?;

        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM clipboard_items WHERE hash = ?1",
                [&item.hash],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            conn.execute(
                "UPDATE clipboard_items SET created_at = ?1 WHERE id = ?2",
                params![Utc::now().to_rfc3339(), id],
            )?;
            return Ok(None);
        }

        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now();
        let expires_at = if item.kind == ClipboardKind::Note {
            None
        } else {
            Some((created_at + Duration::days(settings.retention_days.max(1))).to_rfc3339())
        };
        conn.execute(
            "INSERT INTO clipboard_items(
                id, kind, text, image_blob, thumbnail_blob, source_app, source_title, hash,
                created_at, pinned, size_bytes, expires_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11)",
            params![
                id,
                item.kind.as_str(),
                item.text,
                item.image_png,
                item.thumbnail_png,
                item.source_app,
                item.source_title,
                item.hash,
                created_at.to_rfc3339(),
                item.size_bytes,
                expires_at
            ],
        )?;
        self.reindex_item(&conn, &id)?;
        self.prune_expired_locked(&conn, settings.max_storage_mb)?;
        Ok(Some(id))
    }

    pub fn create_note(&self, text: String, tags: Vec<String>) -> Result<ClipboardItem> {
        let normalized = crate::privacy::normalize_text(&text);
        let hash = crate::privacy::hash_bytes(
            "note",
            format!("{}:{}", uuid::Uuid::new_v4(), normalized).as_bytes(),
        );
        let id = self
            .insert_item(NewClipboardItem {
                kind: ClipboardKind::Note,
                text: Some(text),
                image_png: None,
                thumbnail_png: None,
                source_app: Some("ClipVault".to_string()),
                source_title: Some("Note".to_string()),
                hash,
                size_bytes: normalized.len() as i64,
            })?
            .ok_or_else(|| anyhow::anyhow!("failed to create note"))?;
        self.set_tags(&id, tags)?;
        self.get(&id)?
            .ok_or_else(|| anyhow::anyhow!("created note not found"))
    }

    pub fn update_note(&self, id: &str, text: String) -> Result<ClipboardItem> {
        let conn = self.conn()?;
        let size_bytes = text.len() as i64;
        let updated = conn.execute(
            "UPDATE clipboard_items
             SET text = ?1, size_bytes = ?2, source_title = 'Note'
             WHERE id = ?3 AND kind = 'note'",
            params![text, size_bytes, id],
        )?;
        if updated == 0 {
            anyhow::bail!("note not found");
        }
        self.reindex_item(&conn, id)?;
        drop(conn);
        self.get(id)?
            .ok_or_else(|| anyhow::anyhow!("note not found"))
    }

    pub fn search(
        &self,
        query: String,
        filters: ClipboardFilters,
        limit: i64,
        offset: i64,
    ) -> Result<SearchResponse> {
        let conn = self.conn()?;
        let query = query.trim().to_string();
        let ids = if query.is_empty() {
            self.search_ids_without_fts(&conn, &filters, limit, offset)?
        } else {
            self.search_ids_with_fts(&conn, &query, &filters, limit, offset)?
        };

        let total = ids.len() as i64;
        let items = ids
            .into_iter()
            .filter_map(|id| self.get_locked_for_list(&conn, &id).transpose())
            .collect::<Result<Vec<_>>>()?;

        Ok(SearchResponse { items, total })
    }

    pub fn get(&self, id: &str) -> Result<Option<ClipboardItem>> {
        let conn = self.conn()?;
        self.get_locked(&conn, id)
    }

    pub fn image_blob(&self, id: &str) -> Result<Option<Vec<u8>>> {
        let conn = self.conn()?;
        conn.query_row(
            "SELECT image_blob FROM clipboard_items WHERE id = ?1 AND kind = 'image'",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM clipboard_items WHERE id = ?1", [id])?;
        conn.execute("DELETE FROM item_tags WHERE item_id = ?1", [id])?;
        conn.execute("DELETE FROM items_fts WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn pin(&self, id: &str, pinned: bool) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE clipboard_items SET pinned = ?1 WHERE id = ?2",
            params![pinned, id],
        )?;
        Ok(())
    }

    pub fn set_tags(&self, id: &str, tags: Vec<String>) -> Result<()> {
        let conn = self.conn()?;
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM item_tags WHERE item_id = ?1", [id])?;
        for tag in tags
            .into_iter()
            .map(|tag| tag.trim().to_lowercase())
            .filter(|tag| !tag.is_empty())
        {
            tx.execute("INSERT OR IGNORE INTO tags(name) VALUES(?1)", [&tag])?;
            tx.execute(
                "INSERT OR IGNORE INTO item_tags(item_id, tag_name) VALUES(?1, ?2)",
                params![id, tag],
            )?;
        }
        tx.commit()?;
        self.reindex_item(&conn, id)?;
        Ok(())
    }

    pub fn set_ocr_text(&self, id: &str, text: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE clipboard_items SET ocr_text = ?1 WHERE id = ?2",
            params![text, id],
        )?;
        self.reindex_item(&conn, id)?;
        Ok(())
    }

    pub fn mark_used(&self, id: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE clipboard_items SET last_used_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn()?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS clipboard_items (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                text TEXT,
                ocr_text TEXT,
                image_blob BLOB,
                thumbnail_blob BLOB,
                source_app TEXT,
                source_title TEXT,
                hash TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                last_used_at TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                size_bytes INTEGER NOT NULL,
                expires_at TEXT
            );
            CREATE TABLE IF NOT EXISTS tags (
                name TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS item_tags (
                item_id TEXT NOT NULL REFERENCES clipboard_items(id) ON DELETE CASCADE,
                tag_name TEXT NOT NULL REFERENCES tags(name) ON DELETE CASCADE,
                PRIMARY KEY(item_id, tag_name)
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
                id UNINDEXED,
                body,
                tags,
                source
            );
            CREATE INDEX IF NOT EXISTS idx_clipboard_items_created_at ON clipboard_items(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_clipboard_items_kind ON clipboard_items(kind);
            CREATE INDEX IF NOT EXISTS idx_clipboard_items_pinned ON clipboard_items(pinned);
            ",
        )?;

        conn.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES('app', ?1)",
            [serde_json::to_string(&AppSettings::default())?],
        )?;

        Ok(())
    }

    fn get_locked(&self, conn: &Connection, id: &str) -> Result<Option<ClipboardItem>> {
        self.get_locked_with_image(conn, id, false)
    }

    fn get_locked_for_list(&self, conn: &Connection, id: &str) -> Result<Option<ClipboardItem>> {
        self.get_locked_with_image(conn, id, true)
    }

    fn get_locked_with_image(
        &self,
        conn: &Connection,
        id: &str,
        prefer_thumbnail: bool,
    ) -> Result<Option<ClipboardItem>> {
        conn.query_row(
            "SELECT id, kind, text, ocr_text,
                    CASE WHEN ?2 THEN COALESCE(thumbnail_blob, image_blob) ELSE image_blob END,
                    source_app, source_title, created_at,
                    last_used_at, pinned, size_bytes, expires_at
             FROM clipboard_items WHERE id = ?1",
            params![id, prefer_thumbnail],
            |row| {
                let id: String = row.get(0)?;
                let kind_raw: String = row.get(1)?;
                let image_blob: Option<Vec<u8>> = row.get(4)?;
                let tags = tags_for_item(conn, &id)?;
                Ok(ClipboardItem {
                    id,
                    kind: ClipboardKind::try_from(kind_raw.as_str()).unwrap_or(ClipboardKind::Text),
                    text: row.get(2)?,
                    ocr_text: row.get(3)?,
                    image_url: image_blob.map(|bytes| {
                        format!(
                            "data:image/png;base64,{}",
                            general_purpose::STANDARD.encode(bytes)
                        )
                    }),
                    source_app: row.get(5)?,
                    source_title: row.get(6)?,
                    created_at: row.get(7)?,
                    last_used_at: row.get(8)?,
                    pinned: row.get::<_, i64>(9)? == 1,
                    size_bytes: row.get(10)?,
                    expires_at: row.get(11)?,
                    tags,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    fn search_ids_without_fts(
        &self,
        conn: &Connection,
        filters: &ClipboardFilters,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<String>> {
        let (where_clause, mut values) = filter_sql(filters, 1);
        values.push(limit.to_string());
        values.push(offset.to_string());
        let sql = format!(
            "SELECT id FROM clipboard_items
             {where_clause}
             ORDER BY pinned DESC, datetime(created_at) DESC
             LIMIT ?{} OFFSET ?{}",
            values.len() - 1,
            values.len()
        );
        let mut rows = conn.prepare(&sql)?;
        let ids = rows
            .query_map(params_from_iter(values), |row| row.get::<_, String>(0))?
            .filter_map(Result::ok)
            .collect();
        Ok(ids)
    }

    fn search_ids_with_fts(
        &self,
        conn: &Connection,
        query: &str,
        filters: &ClipboardFilters,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<String>> {
        let escaped = query.replace('"', "\"\"");
        let fts_query = format!("\"{escaped}\"*");
        let (filter_clause, filter_values) = filter_sql(filters, 2);
        let filter_clause = if filter_clause.is_empty() {
            String::new()
        } else {
            format!(" AND {}", filter_clause.trim_start_matches("WHERE "))
        };
        let mut values = vec![fts_query];
        values.extend(filter_values);
        values.push(limit.to_string());
        values.push(offset.to_string());
        let sql = format!(
            "SELECT clipboard_items.id
             FROM items_fts
             JOIN clipboard_items ON clipboard_items.id = items_fts.id
             WHERE items_fts MATCH ?1
             {filter_clause}
             ORDER BY clipboard_items.pinned DESC, datetime(clipboard_items.created_at) DESC
             LIMIT ?{} OFFSET ?{}",
            values.len() - 1,
            values.len()
        );
        let mut stmt = conn.prepare(&sql)?;
        let ids = stmt
            .query_map(params_from_iter(values), |row| row.get::<_, String>(0))?
            .filter_map(Result::ok)
            .collect();
        Ok(ids)
    }

    fn reindex_item(&self, conn: &Connection, id: &str) -> Result<()> {
        let Some(item) = self.get_locked(conn, id)? else {
            return Ok(());
        };
        conn.execute("DELETE FROM items_fts WHERE id = ?1", [id])?;
        conn.execute(
            "INSERT INTO items_fts(id, body, tags, source) VALUES(?1, ?2, ?3, ?4)",
            params![
                item.id,
                [
                    item.text.unwrap_or_default(),
                    item.ocr_text.unwrap_or_default()
                ]
                .join(" "),
                item.tags.join(" "),
                [
                    item.source_app.unwrap_or_default(),
                    item.source_title.unwrap_or_default()
                ]
                .join(" ")
            ],
        )?;
        Ok(())
    }

    fn prune_expired_locked(&self, conn: &Connection, max_storage_mb: i64) -> Result<()> {
        let expired_ids = collect_ids(
            conn,
            "SELECT id FROM clipboard_items
             WHERE kind != 'note' AND pinned = 0 AND expires_at IS NOT NULL
               AND datetime(expires_at) < datetime('now')",
        )?;
        delete_items_locked(conn, &expired_ids)?;

        let overflow_ids = collect_ids(
            conn,
            "SELECT id FROM clipboard_items
             WHERE kind != 'note' AND pinned = 0
             ORDER BY datetime(created_at) DESC
             LIMIT -1 OFFSET 10000",
        )?;
        delete_items_locked(conn, &overflow_ids)?;

        let max_bytes = max_storage_mb.max(64) * 1024 * 1024;
        let total_bytes: i64 = conn.query_row(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM clipboard_items",
            [],
            |row| row.get(0),
        )?;
        if total_bytes <= max_bytes {
            return Ok(());
        }

        let mut reclaim = total_bytes - max_bytes;
        let mut stmt = conn.prepare(
            "SELECT id, size_bytes FROM clipboard_items
             WHERE kind != 'note' AND pinned = 0
             ORDER BY datetime(created_at) ASC",
        )?;
        let mut rows = stmt.query([])?;
        let mut ids = Vec::new();
        while reclaim > 0 {
            let Some(row) = rows.next()? else {
                break;
            };
            let id: String = row.get(0)?;
            let size_bytes: i64 = row.get(1)?;
            reclaim -= size_bytes.max(0);
            ids.push(id);
        }
        drop(rows);
        drop(stmt);
        delete_items_locked(conn, &ids)?;
        Ok(())
    }

    fn conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.connection
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))
    }

    #[cfg(test)]
    fn in_memory() -> Result<Self> {
        let storage = Self {
            connection: Mutex::new(Connection::open_in_memory()?),
        };
        storage.migrate()?;
        Ok(storage)
    }
}

fn apply_cipher_key(connection: &Connection, key: &[u8]) -> Result<()> {
    let key_hex = key
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    connection.pragma_update(None, "key", format!("x'{key_hex}'"))?;
    Ok(())
}

fn app_data_dir() -> Result<PathBuf> {
    let dirs = ProjectDirs::from("com", "ClipVault", "ClipVault")
        .context("failed to resolve app data directory")?;
    Ok(dirs.data_local_dir().to_path_buf())
}

fn tags_for_item(conn: &Connection, id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT tag_name FROM item_tags WHERE item_id = ?1 ORDER BY tag_name")?;
    let tags = stmt
        .query_map([id], |row| row.get::<_, String>(0))?
        .collect();
    tags
}

fn filter_sql(filters: &ClipboardFilters, first_placeholder: usize) -> (String, Vec<String>) {
    let mut clauses = Vec::new();
    let mut values = Vec::new();

    if let Some(kind) = &filters.kind {
        if kind != "all" {
            clauses.push(format!("kind = ?{}", first_placeholder + values.len()));
            values.push(kind.to_string());
        }
    }

    if filters.pinned.unwrap_or(false) {
        clauses.push(format!("pinned = ?{}", first_placeholder + values.len()));
        values.push("1".to_string());
    }

    if let Some(tag) = filters.tag.as_deref().filter(|tag| !tag.trim().is_empty()) {
        clauses.push(format!(
            "EXISTS (
                SELECT 1 FROM item_tags
                WHERE item_tags.item_id = clipboard_items.id
                  AND item_tags.tag_name = ?{}
            )",
            first_placeholder + values.len()
        ));
        values.push(tag.trim().to_lowercase());
    }

    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };

    (where_clause, values)
}

fn collect_ids(conn: &Connection, sql: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(sql)?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

fn delete_items_locked(conn: &Connection, ids: &[String]) -> Result<()> {
    for id in ids {
        conn.execute("DELETE FROM item_tags WHERE item_id = ?1", [id])?;
        conn.execute("DELETE FROM items_fts WHERE id = ?1", [id])?;
        conn.execute("DELETE FROM clipboard_items WHERE id = ?1", [id])?;
    }
    Ok(())
}

fn decode_optional_blob(value: &Option<String>) -> Result<Option<Vec<u8>>> {
    value
        .as_deref()
        .map(|encoded| {
            general_purpose::STANDARD
                .decode(encoded)
                .map_err(Into::into)
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_edits_and_searches_notes() {
        let storage = Storage::in_memory().expect("storage");
        let note = storage
            .create_note("first note body".to_string(), vec!["ideas".to_string()])
            .expect("create note");

        assert_eq!(note.kind, ClipboardKind::Note);
        assert_eq!(note.text.as_deref(), Some("first note body"));
        assert_eq!(note.expires_at, None);
        assert_eq!(note.tags, vec!["ideas".to_string()]);

        let updated = storage
            .update_note(&note.id, "updated note body".to_string())
            .expect("update note");
        assert_eq!(updated.text.as_deref(), Some("updated note body"));

        let response = storage
            .search(
                "updated".to_string(),
                ClipboardFilters {
                    kind: Some("note".to_string()),
                    pinned: None,
                    tag: None,
                },
                10,
                0,
            )
            .expect("search notes");

        assert_eq!(response.items.len(), 1);
        assert_eq!(response.items[0].id, note.id);
    }

    #[test]
    fn retention_prune_does_not_delete_notes() {
        let storage = Storage::in_memory().expect("storage");
        let note = storage
            .create_note("keep me".to_string(), vec![])
            .expect("create note");

        {
            let conn = storage.conn().expect("conn");
            conn.execute(
                "UPDATE clipboard_items SET expires_at = '2000-01-01T00:00:00Z', pinned = 0 WHERE id = ?1",
                [&note.id],
            )
            .expect("force old expiry");
            storage.prune_expired_locked(&conn, 512).expect("prune");
        }

        assert!(storage.get(&note.id).expect("get").is_some());
    }

    #[test]
    fn storage_cap_prune_removes_old_unpinned_clip_data_and_indexes() {
        let storage = Storage::in_memory().expect("storage");
        let conn = storage.conn().expect("conn");
        let old_id = "old";
        let pinned_id = "pinned";
        conn.execute(
            "INSERT INTO clipboard_items(
                id, kind, text, source_app, source_title, hash, created_at, pinned, size_bytes, expires_at
             ) VALUES
                (?1, 'text', 'old clip', 'app', 'old', 'old-hash', '2026-01-01T00:00:00Z', 0, 73400320, NULL),
                (?2, 'text', 'pinned clip', 'app', 'pinned', 'pinned-hash', '2026-01-02T00:00:00Z', 1, 73400320, NULL)",
            params![old_id, pinned_id],
        )
        .expect("insert clips");
        conn.execute("INSERT INTO tags(name) VALUES('work')", [])
            .expect("insert tag");
        conn.execute(
            "INSERT INTO item_tags(item_id, tag_name) VALUES(?1, 'work')",
            [old_id],
        )
        .expect("insert item tag");
        storage.reindex_item(&conn, old_id).expect("index old");
        storage
            .reindex_item(&conn, pinned_id)
            .expect("index pinned");

        storage.prune_expired_locked(&conn, 64).expect("prune");

        assert!(storage.get_locked(&conn, old_id).expect("old").is_none());
        assert!(storage
            .get_locked(&conn, pinned_id)
            .expect("pinned")
            .is_some());
        let old_fts_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM items_fts WHERE id = ?1",
                [old_id],
                |row| row.get(0),
            )
            .expect("fts count");
        let old_tag_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM item_tags WHERE item_id = ?1",
                [old_id],
                |row| row.get(0),
            )
            .expect("tag count");
        assert_eq!(old_fts_count, 0);
        assert_eq!(old_tag_count, 0);
    }

    #[test]
    fn filtered_search_applies_kind_before_limit() {
        let storage = Storage::in_memory().expect("storage");
        let conn = storage.conn().expect("conn");
        for index in 0..5 {
            conn.execute(
                "INSERT INTO clipboard_items(
                    id, kind, text, source_app, source_title, hash, created_at, pinned, size_bytes, expires_at
                 ) VALUES (?1, 'text', ?2, 'app', 'text', ?3, ?4, 0, 10, NULL)",
                params![
                    format!("text-{index}"),
                    format!("text {index}"),
                    format!("text-hash-{index}"),
                    format!("2026-01-0{}T00:00:00Z", index + 2)
                ],
            )
            .expect("insert text");
        }
        conn.execute(
            "INSERT INTO clipboard_items(
                id, kind, image_blob, thumbnail_blob, source_app, source_title, hash, created_at, pinned, size_bytes, expires_at
             ) VALUES ('image-1', 'image', X'01020304', X'05', 'app', 'image', 'image-hash', '2026-01-01T00:00:00Z', 0, 4, NULL)",
            [],
        )
        .expect("insert image");
        drop(conn);

        let response = storage
            .search(
                String::new(),
                ClipboardFilters {
                    kind: Some("image".to_string()),
                    pinned: None,
                    tag: None,
                },
                2,
                0,
            )
            .expect("search images");

        assert_eq!(response.items.len(), 1);
        assert_eq!(response.items[0].id, "image-1");
        assert_eq!(
            response.items[0].image_url.as_deref(),
            Some("data:image/png;base64,BQ==")
        );
        assert_eq!(
            storage
                .get("image-1")
                .expect("get image")
                .and_then(|item| item.image_url),
            Some("data:image/png;base64,AQIDBA==".to_string())
        );
    }
}

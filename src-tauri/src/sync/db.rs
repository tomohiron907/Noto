use anyhow::{anyhow, Result};
use rusqlite::{params, Connection};
use std::time::{SystemTime, UNIX_EPOCH};

use super::types::{FolderMetadata, LocalFolder, LocalNote, NoteMetadata, TreeResponse};

pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS notes (
            local_id          TEXT PRIMARY KEY,
            drive_id          TEXT UNIQUE,
            title             TEXT NOT NULL,
            content           TEXT NOT NULL DEFAULT '',
            parent_local_id   TEXT,
            parent_drive_id   TEXT,
            modified_at       INTEGER NOT NULL,
            drive_modified_at TEXT,
            content_fetched   INTEGER NOT NULL DEFAULT 0,
            dirty             INTEGER NOT NULL DEFAULT 0,
            deleted           INTEGER NOT NULL DEFAULT 0,
            synced_at         INTEGER
        );
        CREATE TABLE IF NOT EXISTS folders (
            local_id        TEXT PRIMARY KEY,
            drive_id        TEXT UNIQUE,
            name            TEXT NOT NULL,
            parent_local_id TEXT,
            parent_drive_id TEXT,
            deleted         INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sync_state (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// ── sync_state helpers ────────────────────────────────────────────────────────

pub fn get_sync_state(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM sync_state WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    Ok(rows.next()?.map(|r| r.get::<_, String>(0)).transpose()?)
}

pub fn set_sync_state(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

// ── folder helpers ────────────────────────────────────────────────────────────

pub fn upsert_folder_by_drive_id(
    conn: &Connection,
    drive_id: &str,
    name: &str,
    parent_drive_id: Option<&str>,
) -> Result<String> {
    // Check if folder with this drive_id already exists
    let existing: Option<String> = conn
        .query_row(
            "SELECT local_id FROM folders WHERE drive_id = ?1",
            params![drive_id],
            |r| r.get(0),
        )
        .ok();

    if let Some(local_id) = existing {
        conn.execute(
            "UPDATE folders SET name=?1, parent_drive_id=?2 WHERE local_id=?3",
            params![name, parent_drive_id, local_id],
        )?;
        return Ok(local_id);
    }

    let local_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO folders (local_id, drive_id, name, parent_drive_id, deleted)
         VALUES (?1, ?2, ?3, ?4, 0)",
        params![local_id, drive_id, name, parent_drive_id],
    )?;
    Ok(local_id)
}

pub fn resolve_folder_parent_local_ids(conn: &Connection) -> Result<()> {
    // For each folder that has parent_drive_id but no parent_local_id, resolve it
    let pairs: Vec<(String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT local_id, parent_drive_id FROM folders
             WHERE parent_drive_id IS NOT NULL AND parent_local_id IS NULL",
        )?;
        let result = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        result
    };
    for (local_id, parent_drive_id) in pairs {
        let parent_local: Option<String> = conn
            .query_row(
                "SELECT local_id FROM folders WHERE drive_id = ?1",
                params![parent_drive_id],
                |r| r.get(0),
            )
            .ok();
        if let Some(pli) = parent_local {
            conn.execute(
                "UPDATE folders SET parent_local_id = ?1 WHERE local_id = ?2",
                params![pli, local_id],
            )?;
        }
    }
    Ok(())
}

pub fn get_folder_local_id_by_drive_id(conn: &Connection, drive_id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT local_id FROM folders WHERE drive_id = ?1",
            params![drive_id],
            |r| r.get(0),
        )
        .ok())
}

pub fn get_all_folders(conn: &Connection) -> Result<Vec<LocalFolder>> {
    let mut stmt = conn.prepare(
        "SELECT local_id, drive_id, name, parent_local_id, parent_drive_id, deleted
         FROM folders WHERE deleted = 0",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(LocalFolder {
            local_id: r.get(0)?,
            drive_id: r.get(1)?,
            name: r.get(2)?,
            parent_local_id: r.get(3)?,
            parent_drive_id: r.get(4)?,
            deleted: r.get::<_, i64>(5)? != 0,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

// ── note helpers ──────────────────────────────────────────────────────────────

/// Returns `(local_id, was_content_reset)`.
/// `was_content_reset` is true when an existing note was updated from Drive
/// (content_fetched reset to 0), indicating the frontend should refresh it.
pub fn upsert_note_by_drive_id(
    conn: &Connection,
    drive_id: &str,
    title: &str,
    parent_drive_id: Option<&str>,
    drive_modified_at: &str,
) -> Result<(String, bool)> {
    let existing: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT local_id, drive_modified_at FROM notes WHERE drive_id = ?1",
            params![drive_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();

    if let Some((local_id, existing_modified)) = existing {
        // Only update if Drive has a newer version and note is not dirty
        let dirty: i64 = conn.query_row(
            "SELECT dirty FROM notes WHERE local_id = ?1",
            params![local_id],
            |r| r.get(0),
        )?;
        let should_update = dirty == 0
            && existing_modified
                .as_deref()
                .map(|e| e < drive_modified_at)
                .unwrap_or(true);
        if should_update {
            conn.execute(
                "UPDATE notes SET title=?1, parent_drive_id=?2, drive_modified_at=?3,
                  content_fetched=0 WHERE local_id=?4",
                params![title, parent_drive_id, drive_modified_at, local_id],
            )?;
        }
        return Ok((local_id, should_update));
    }

    let local_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO notes
         (local_id, drive_id, title, content, parent_drive_id, modified_at,
          drive_modified_at, content_fetched, dirty, deleted)
         VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, 0, 0, 0)",
        params![
            local_id,
            drive_id,
            title,
            parent_drive_id,
            now_ms(),
            drive_modified_at
        ],
    )?;
    Ok((local_id, false))
}

pub fn resolve_note_parent_local_ids(conn: &Connection) -> Result<()> {
    let pairs: Vec<(String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT local_id, parent_drive_id FROM notes
             WHERE parent_drive_id IS NOT NULL AND parent_local_id IS NULL",
        )?;
        let result = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        result
    };
    for (local_id, parent_drive_id) in pairs {
        let parent_local: Option<String> = conn
            .query_row(
                "SELECT local_id FROM folders WHERE drive_id = ?1",
                params![parent_drive_id],
                |r| r.get(0),
            )
            .ok();
        if let Some(pli) = parent_local {
            conn.execute(
                "UPDATE notes SET parent_local_id = ?1 WHERE local_id = ?2",
                params![pli, local_id],
            )?;
        }
    }
    Ok(())
}

pub fn get_all_notes(conn: &Connection) -> Result<Vec<LocalNote>> {
    let mut stmt = conn.prepare(
        "SELECT local_id, drive_id, title, parent_local_id, parent_drive_id,
                modified_at, drive_modified_at, content_fetched, dirty, deleted
         FROM notes WHERE deleted = 0",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(LocalNote {
            local_id: r.get(0)?,
            drive_id: r.get(1)?,
            title: r.get(2)?,
            parent_local_id: r.get(3)?,
            parent_drive_id: r.get(4)?,
            modified_at: r.get(5)?,
            drive_modified_at: r.get(6)?,
            content_fetched: r.get::<_, i64>(7)? != 0,
            dirty: r.get::<_, i64>(8)? != 0,
            deleted: r.get::<_, i64>(9)? != 0,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get_note_content(conn: &Connection, local_id: &str) -> Result<Option<(String, bool)>> {
    conn.query_row(
        "SELECT content, content_fetched FROM notes WHERE local_id = ?1 AND deleted = 0",
        params![local_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(anyhow!(other)),
    })
}

pub fn set_note_content(conn: &Connection, local_id: &str, content: &str) -> Result<()> {
    conn.execute(
        "UPDATE notes SET content = ?1, content_fetched = 1 WHERE local_id = ?2",
        params![content, local_id],
    )?;
    Ok(())
}

pub fn write_note(conn: &Connection, local_id: &str, title: &str, content: &str) -> Result<i64> {
    let ts = now_ms();
    conn.execute(
        "UPDATE notes SET title=?1, content=?2, modified_at=?3, dirty=1, content_fetched=1
         WHERE local_id=?4",
        params![title, content, ts, local_id],
    )?;
    Ok(ts)
}

pub fn create_note(
    conn: &Connection,
    title: &str,
    parent_local_id: Option<&str>,
    parent_drive_id: Option<&str>,
) -> Result<String> {
    let local_id = uuid::Uuid::new_v4().to_string();
    let ts = now_ms();
    conn.execute(
        "INSERT INTO notes
         (local_id, drive_id, title, content, parent_local_id, parent_drive_id,
          modified_at, content_fetched, dirty, deleted)
         VALUES (?1, NULL, ?2, '', ?3, ?4, ?5, 1, 1, 0)",
        params![local_id, title, parent_local_id, parent_drive_id, ts],
    )?;
    Ok(local_id)
}

pub fn soft_delete_note(conn: &Connection, local_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE notes SET deleted = 1, dirty = 1 WHERE local_id = ?1",
        params![local_id],
    )?;
    Ok(())
}

pub fn create_folder_local(
    conn: &Connection,
    name: &str,
    parent_local_id: Option<&str>,
    parent_drive_id: Option<&str>,
) -> Result<String> {
    let local_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO folders
         (local_id, drive_id, name, parent_local_id, parent_drive_id, deleted)
         VALUES (?1, NULL, ?2, ?3, ?4, 0)",
        params![local_id, name, parent_local_id, parent_drive_id],
    )?;
    Ok(local_id)
}

pub fn set_folder_drive_id(conn: &Connection, local_id: &str, drive_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE folders SET drive_id = ?1 WHERE local_id = ?2",
        params![drive_id, local_id],
    )?;
    Ok(())
}

pub fn soft_delete_folder(conn: &Connection, local_id: &str) -> Result<()> {
    // Recursively collect all descendant folder local_ids
    let mut to_delete = vec![local_id.to_string()];
    let mut i = 0;
    while i < to_delete.len() {
        let current = to_delete[i].clone();
        let children: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT local_id FROM folders WHERE parent_local_id = ?1 AND deleted = 0",
            )?;
            let result = stmt.query_map(params![current], |r| r.get(0))?
                .collect::<std::result::Result<_, _>>()?;
            result
        };
        to_delete.extend(children);
        i += 1;
    }

    for fid in &to_delete {
        conn.execute("UPDATE folders SET deleted = 1 WHERE local_id = ?1", params![fid])?;
        conn.execute(
            "UPDATE notes SET deleted = 1 WHERE parent_local_id = ?1",
            params![fid],
        )?;
    }
    Ok(())
}

pub fn move_note(conn: &Connection, local_id: &str, new_parent_local_id: &str) -> Result<()> {
    // Look up drive_id of the new parent folder
    let new_parent_drive_id: Option<String> = conn
        .query_row(
            "SELECT drive_id FROM folders WHERE local_id = ?1",
            params![new_parent_local_id],
            |r| r.get(0),
        )
        .ok();

    conn.execute(
        "UPDATE notes SET parent_local_id=?1, parent_drive_id=?2, dirty=1 WHERE local_id=?3",
        params![new_parent_local_id, new_parent_drive_id, local_id],
    )?;
    Ok(())
}

// ── tree ──────────────────────────────────────────────────────────────────────

pub fn get_tree(conn: &Connection, root_local_id: &str) -> Result<TreeResponse> {
    let folders = get_all_folders(conn)?;
    let notes = get_all_notes(conn)?;

    let folder_metas: Vec<FolderMetadata> = folders
        .iter()
        .filter(|f| f.local_id != root_local_id)
        .map(|f| FolderMetadata {
            id: f.local_id.clone(),
            name: f.name.clone(),
            parent_id: f
                .parent_local_id
                .clone()
                .unwrap_or_else(|| root_local_id.to_string()),
        })
        .collect();

    let note_metas: Vec<NoteMetadata> = notes
        .iter()
        .map(|n| NoteMetadata {
            id: n.local_id.clone(),
            title: n.title.clone(),
            modified_time: n
                .drive_modified_at
                .clone()
                .unwrap_or_else(|| n.modified_at.to_string()),
            parent_id: n
                .parent_local_id
                .clone()
                .unwrap_or_else(|| root_local_id.to_string()),
        })
        .collect();

    Ok(TreeResponse {
        root_id: root_local_id.to_string(),
        folders: folder_metas,
        notes: note_metas,
    })
}

// ── sync engine helpers ───────────────────────────────────────────────────────

pub fn get_dirty_notes(conn: &Connection) -> Result<Vec<LocalNote>> {
    let mut stmt = conn.prepare(
        "SELECT local_id, drive_id, title, parent_local_id, parent_drive_id,
                modified_at, drive_modified_at, content_fetched, dirty, deleted
         FROM notes WHERE dirty = 1",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(LocalNote {
            local_id: r.get(0)?,
            drive_id: r.get(1)?,
            title: r.get(2)?,
            parent_local_id: r.get(3)?,
            parent_drive_id: r.get(4)?,
            modified_at: r.get(5)?,
            drive_modified_at: r.get(6)?,
            content_fetched: r.get::<_, i64>(7)? != 0,
            dirty: r.get::<_, i64>(8)? != 0,
            deleted: r.get::<_, i64>(9)? != 0,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn mark_note_synced(
    conn: &Connection,
    local_id: &str,
    drive_id: &str,
    drive_modified_at: &str,
) -> Result<()> {
    let ts = now_ms();
    conn.execute(
        "UPDATE notes SET drive_id=?1, drive_modified_at=?2, dirty=0, synced_at=?3
         WHERE local_id=?4",
        params![drive_id, drive_modified_at, ts, local_id],
    )?;
    Ok(())
}

pub fn get_note_drive_id(conn: &Connection, local_id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT drive_id FROM notes WHERE local_id = ?1",
            params![local_id],
            |r| r.get(0),
        )
        .ok()
        .flatten())
}

pub fn get_note_for_push(conn: &Connection, local_id: &str) -> Result<Option<(String, String)>> {
    conn.query_row(
        "SELECT title, content FROM notes WHERE local_id = ?1 AND deleted = 0",
        params![local_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(anyhow!(other)),
    })
}

pub fn mark_note_deleted_synced(conn: &Connection, local_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE notes SET dirty=0 WHERE local_id=?1",
        params![local_id],
    )?;
    Ok(())
}

pub fn get_folder_drive_id(conn: &Connection, local_id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT drive_id FROM folders WHERE local_id = ?1",
            params![local_id],
            |r| r.get(0),
        )
        .ok()
        .flatten())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn test_create_and_read_note() {
        let conn = in_memory();
        let local_id = create_note(&conn, "Hello", None, None).unwrap();
        let (content, fetched) = get_note_content(&conn, &local_id).unwrap().unwrap();
        assert_eq!(content, "");
        assert!(fetched);
        write_note(&conn, &local_id, "Hello", "world content").unwrap();
        let (content2, _) = get_note_content(&conn, &local_id).unwrap().unwrap();
        assert_eq!(content2, "world content");
    }

    #[test]
    fn test_soft_delete_note() {
        let conn = in_memory();
        let id = create_note(&conn, "Temp", None, None).unwrap();
        soft_delete_note(&conn, &id).unwrap();
        let notes = get_all_notes(&conn).unwrap();
        assert!(notes.is_empty());
    }

    #[test]
    fn test_folder_upsert() {
        let conn = in_memory();
        let lid = upsert_folder_by_drive_id(&conn, "drive-abc", "Folder A", None).unwrap();
        let lid2 = upsert_folder_by_drive_id(&conn, "drive-abc", "Folder A renamed", None).unwrap();
        assert_eq!(lid, lid2);
    }
}

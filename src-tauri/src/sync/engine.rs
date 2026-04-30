use anyhow::Result;
use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::{AppHandle, Emitter};

use crate::drive::client::DriveClient;
use super::db;

const DRIVE_FILES_API: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API: &str = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_CHANGES_API: &str = "https://www.googleapis.com/drive/v3/changes";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
const MD_MIME: &str = "text/markdown";
const TEXT_PLAIN_MIME: &str = "text/plain";
const NOTO_MIME: &str = "application/json";
const FIELDS: &str = "id,name,modifiedTime,parents,mimeType";

fn is_md_file(mime: &str, name: &str) -> bool {
    mime == MD_MIME || (mime == TEXT_PLAIN_MIME && name.ends_with(".md"))
}

fn is_noto_file(mime: &str, name: &str) -> bool {
    mime == NOTO_MIME && name.ends_with(".noto")
}

fn is_note_file(mime: &str, name: &str) -> bool {
    is_md_file(mime, name) || is_noto_file(mime, name)
}

fn note_type_for(mime: &str, name: &str) -> &'static str {
    if is_noto_file(mime, name) { "ink" } else { "md" }
}

pub struct SyncDb {
    pub conn: Mutex<rusqlite::Connection>,
    pub syncing: AtomicBool,
    pub http: reqwest::Client,
}

struct SyncGuard<'a>(&'a AtomicBool);
impl<'a> Drop for SyncGuard<'a> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

// ── Full initial import ───────────────────────────────────────────────────────

pub async fn initial_import(app: &AppHandle, db_state: &SyncDb) -> Result<()> {
    let client = DriveClient::with_http(db_state.http.clone(), app).await?;
    let root_drive_id = ensure_root_folder(&client).await?;

    // Insert root folder first so note parent resolution works correctly
    {
        let conn = db_state.conn.lock().unwrap();
        let root_local_id =
            db::get_folder_local_id_by_drive_id(&conn, &root_drive_id)?.unwrap_or_else(|| {
                db::upsert_folder_by_drive_id(&conn, &root_drive_id, "Noto", None)
                    .unwrap_or_default()
            });
        db::set_sync_state(&conn, "root_local_id", &root_local_id)?;
        db::set_sync_state(&conn, "root_drive_id", &root_drive_id)?;
    }

    // Import all folders recursively
    import_folders(&client, &root_drive_id, db_state).await?;

    // Resolve parent local IDs for folders
    {
        let conn = db_state.conn.lock().unwrap();
        db::resolve_folder_parent_local_ids(&conn)?;
    }

    // Import all notes metadata (content fetched lazily on open)
    import_notes_metadata(&client, &root_drive_id, db_state).await?;

    // Resolve note parent local IDs
    {
        let conn = db_state.conn.lock().unwrap();
        db::resolve_note_parent_local_ids(&conn)?;
    }

    // Get initial Changes page token for future incremental syncs
    acquire_start_page_token(&client, db_state).await?;

    Ok(())
}

async fn import_folders(
    client: &DriveClient,
    root_drive_id: &str,
    db_state: &SyncDb,
) -> Result<()> {
    let mut queue = vec![root_drive_id.to_string()];

    while !queue.is_empty() {
        let batch: Vec<String> = queue.drain(..).collect();
        let parent_clauses = batch
            .iter()
            .map(|id| format!("'{}' in parents", id))
            .collect::<Vec<_>>()
            .join(" or ");
        let query = format!(
            "mimeType='{}' and ({}) and trashed=false",
            FOLDER_MIME, parent_clauses
        );
        let url = format!(
            "{}?q={}&fields=files(id,name,parents)&orderBy=name",
            DRIVE_FILES_API,
            urlencoding::encode(&query)
        );

        #[derive(Deserialize)]
        struct FolderList {
            files: Vec<FolderEntry>,
        }
        #[derive(Deserialize)]
        struct FolderEntry {
            id: String,
            name: String,
            parents: Option<Vec<String>>,
        }

        let resp: FolderList = client.get(&url).await?.json().await?;
        let conn = db_state.conn.lock().unwrap();
        for f in resp.files {
            let parent_drive_id = f.parents.as_ref().and_then(|p| p.first()).map(|s| s.as_str());
            db::upsert_folder_by_drive_id(&conn, &f.id, &f.name, parent_drive_id)?;
            queue.push(f.id);
        }
    }
    Ok(())
}

async fn import_notes_metadata(
    client: &DriveClient,
    root_drive_id: &str,
    db_state: &SyncDb,
) -> Result<()> {
    // Collect all folder drive IDs
    let folder_drive_ids: Vec<String> = {
        let conn = db_state.conn.lock().unwrap();
        let folders = db::get_all_folders(&conn)?;
        let mut ids: Vec<String> = folders.into_iter().filter_map(|f| f.drive_id).collect();
        ids.push(root_drive_id.to_string());
        ids
    };

    #[derive(Deserialize)]
    struct FileList {
        files: Vec<FileEntry>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FileEntry {
        id: String,
        name: String,
        mime_type: String,
        modified_time: String,
        parents: Option<Vec<String>>,
    }

    for chunk in folder_drive_ids.chunks(60) {
        let parent_clauses = chunk
            .iter()
            .map(|id| format!("'{}' in parents", id))
            .collect::<Vec<_>>()
            .join(" or ");
        let query = format!(
            "(mimeType='{}' or mimeType='{}' or mimeType='{}') and ({}) and trashed=false",
            MD_MIME, TEXT_PLAIN_MIME, NOTO_MIME, parent_clauses
        );
        let url = format!(
            "{}?q={}&fields=files({})&orderBy=modifiedTime desc",
            DRIVE_FILES_API,
            urlencoding::encode(&query),
            FIELDS
        );

        let resp: FileList = client.get(&url).await?.json().await?;
        let conn = db_state.conn.lock().unwrap();
        for f in resp.files {
            if !is_note_file(&f.mime_type, &f.name) {
                continue;
            }
            let parent_drive_id = f.parents.as_ref().and_then(|p| p.first()).map(|s| s.as_str());
            let note_type = note_type_for(&f.mime_type, &f.name);
            let title = if note_type == "ink" {
                f.name.trim_end_matches(".noto")
            } else {
                f.name.trim_end_matches(".md")
            };
            db::upsert_note_by_drive_id(&conn, &f.id, title, parent_drive_id, &f.modified_time, note_type).map(|_| ())?;
        }
    }
    Ok(())
}

async fn ensure_root_folder(client: &DriveClient) -> Result<String> {
    #[derive(Deserialize)]
    struct FolderList {
        files: Vec<FolderItem>,
    }
    #[derive(Deserialize)]
    struct FolderItem {
        id: String,
    }

    let query = format!("mimeType='{}' and name='Noto' and trashed=false", FOLDER_MIME);
    let url = format!(
        "{}?q={}&fields=files(id)",
        DRIVE_FILES_API,
        urlencoding::encode(&query)
    );
    let resp: FolderList = client.get(&url).await?.json().await?;
    if let Some(f) = resp.files.into_iter().next() {
        return Ok(f.id);
    }

    #[derive(Deserialize)]
    struct Created {
        id: String,
    }
    let body = json!({ "name": "Noto", "mimeType": FOLDER_MIME });
    let created: Created = client
        .post_json(&format!("{}?fields=id", DRIVE_FILES_API), &body)
        .await?
        .json()
        .await?;
    Ok(created.id)
}

async fn acquire_start_page_token(client: &DriveClient, db_state: &SyncDb) -> Result<()> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TokenResp {
        start_page_token: String,
    }
    let resp: TokenResp = client
        .get(&format!("{}/startPageToken", DRIVE_CHANGES_API))
        .await?
        .json()
        .await?;
    let conn = db_state.conn.lock().unwrap();
    db::set_sync_state(&conn, "changes_page_token", &resp.start_page_token)?;
    Ok(())
}

// ── Push dirty notes to Drive ─────────────────────────────────────────────────

pub async fn push_dirty(client: &DriveClient, db_state: &SyncDb) -> Result<usize> {
    let dirty_notes = {
        let conn = db_state.conn.lock().unwrap();
        db::get_dirty_notes(&conn)?
    };

    if dirty_notes.is_empty() {
        return Ok(0);
    }

    let mut pushed = 0;

    for note in dirty_notes {
        if note.deleted {
            if let Some(drive_id) = &note.drive_id {
                let body = json!({ "trashed": true });
                let url = format!("{}/{}?fields=id", DRIVE_FILES_API, drive_id);
                if let Err(e) = client.patch_json(&url, &body).await {
                    log::warn!("[push] delete note {} failed: {}", note.local_id, e);
                    continue;
                }
            }
            let conn = db_state.conn.lock().unwrap();
            db::mark_note_deleted_synced(&conn, &note.local_id)?;
            pushed += 1;
            continue;
        }

        let Some((title, content, note_type)) = (|| -> Result<Option<_>> {
            let conn = db_state.conn.lock().unwrap();
            db::get_note_for_push(&conn, &note.local_id)
        })()? else {
            continue;
        };

        let (file_name, mime) = if note_type == "ink" {
            (format!("{}.noto", title), NOTO_MIME)
        } else {
            (format!("{}.md", title), MD_MIME)
        };

        let result = if let Some(drive_id) = &note.drive_id {
            // Update existing
            let metadata = json!({ "name": file_name });
            let url = format!(
                "{}/{}?uploadType=multipart&fields=id,modifiedTime",
                DRIVE_UPLOAD_API, drive_id
            );
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct UpdatedFile {
                id: String,
                modified_time: String,
            }
            client
                .multipart_upload(Method::PATCH, &url, &metadata.to_string(), &content, mime)
                .await
                .map_err(|e| e)?
                .json::<UpdatedFile>()
                .await
                .map(|f| (f.id, f.modified_time))
                .map_err(|e| anyhow::anyhow!(e))
        } else {
            // Create new — need parent drive id
            let parent_drive_id = {
                let conn = db_state.conn.lock().unwrap();
                let root_drive_id =
                    db::get_sync_state(&conn, "root_drive_id")?.unwrap_or_default();
                note.parent_drive_id
                    .clone()
                    .or_else(|| {
                        note.parent_local_id.as_ref().and_then(|lid| {
                            db::get_folder_drive_id(&conn, lid).ok().flatten()
                        })
                    })
                    .unwrap_or(root_drive_id)
            };

            let metadata = json!({ "name": file_name, "parents": [parent_drive_id] });
            let url = format!("{}?uploadType=multipart&fields=id,modifiedTime", DRIVE_UPLOAD_API);
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct CreatedFile {
                id: String,
                modified_time: String,
            }
            client
                .multipart_upload(Method::POST, &url, &metadata.to_string(), &content, mime)
                .await
                .map_err(|e| e)?
                .json::<CreatedFile>()
                .await
                .map(|f| (f.id, f.modified_time))
                .map_err(|e| anyhow::anyhow!(e))
        };

        match result {
            Ok((drive_id, drive_modified_at)) => {
                let conn = db_state.conn.lock().unwrap();
                db::mark_note_synced(&conn, &note.local_id, &drive_id, &drive_modified_at)?;
                pushed += 1;
            }
            Err(e) => {
                log::warn!("[push] note {} failed: {}", note.local_id, e);
            }
        }
    }

    Ok(pushed)
}

// ── Pull changes from Drive ───────────────────────────────────────────────────

pub async fn pull_changes(client: &DriveClient, db_state: &SyncDb) -> Result<(bool, Vec<String>)> {
    let page_token = {
        let conn = db_state.conn.lock().unwrap();
        db::get_sync_state(&conn, "changes_page_token")?
    };

    let Some(mut token) = page_token else {
        return Ok((false, vec![]));
    };

    let root_drive_id = {
        let conn = db_state.conn.lock().unwrap();
        db::get_sync_state(&conn, "root_drive_id")?.unwrap_or_default()
    };

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ChangesResp {
        next_page_token: Option<String>,
        new_start_page_token: Option<String>,
        changes: Vec<Change>,
    }
    #[derive(Deserialize)]
    struct Change {
        removed: Option<bool>,
        file: Option<ChangeFile>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ChangeFile {
        id: String,
        name: Option<String>,
        mime_type: Option<String>,
        modified_time: Option<String>,
        parents: Option<Vec<String>>,
        trashed: Option<bool>,
    }

    let mut had_changes = false;
    let mut updated_note_ids: Vec<String> = Vec::new();

    loop {
        let url = format!(
            "{}?pageToken={}&fields=nextPageToken,newStartPageToken,changes(removed,file({}))",
            DRIVE_CHANGES_API,
            token,
            FIELDS
        );
        let resp: ChangesResp = client.get(&url).await?.json().await?;
        log::info!("[pull_changes] page token={token}, changes_count={}", resp.changes.len());

        for change in resp.changes {
            let Some(file) = change.file else { continue };

            let removed = change.removed.unwrap_or(false) || file.trashed.unwrap_or(false);
            let mime = file.mime_type.as_deref().unwrap_or("");
            log::info!("[pull_changes] change: id={} name={:?} mime={} removed={}", file.id, file.name, mime, removed);

            if mime == FOLDER_MIME {
                // Folder change
                if removed {
                    // Soft delete folder in local DB if it exists
                    let conn = db_state.conn.lock().unwrap();
                    if let Some(lid) =
                        db::get_folder_local_id_by_drive_id(&conn, &file.id)?
                    {
                        db::soft_delete_folder(&conn, &lid)?;
                        had_changes = true;
                    }
                } else if let Some(name) = &file.name {
                    let parent_drive_id =
                        file.parents.as_ref().and_then(|p| p.first()).map(|s| s.as_str());
                    let conn = db_state.conn.lock().unwrap();
                    db::upsert_folder_by_drive_id(&conn, &file.id, name, parent_drive_id)?;
                    db::resolve_folder_parent_local_ids(&conn)?;
                    had_changes = true;
                }
            } else if is_note_file(mime, file.name.as_deref().unwrap_or("")) {
                // Note change
                if removed {
                    // Find by drive_id and soft delete
                    let conn = db_state.conn.lock().unwrap();
                    let local_id: Option<String> = conn
                        .query_row(
                            "SELECT local_id FROM notes WHERE drive_id = ?1 AND dirty = 0",
                            rusqlite::params![file.id],
                            |r| r.get(0),
                        )
                        .ok();
                    if let Some(lid) = local_id {
                        db::soft_delete_note(&conn, &lid)?;
                        had_changes = true;
                    }
                } else if let (Some(name), Some(modified_time)) =
                    (file.name.as_deref(), file.modified_time.as_deref())
                {
                    // Check it's within our Noto folder
                    let is_ours = file
                        .parents
                        .as_ref()
                        .map(|parents| {
                            parents.iter().any(|p| {
                                p == &root_drive_id || {
                                    let conn = db_state.conn.lock().unwrap();
                                    db::get_folder_local_id_by_drive_id(&conn, p)
                                        .ok()
                                        .flatten()
                                        .is_some()
                                }
                            })
                        })
                        .unwrap_or(false);

                    log::info!("[pull_changes] note {} is_ours={}", file.id, is_ours);
                    if is_ours {
                        let parent_drive_id =
                            file.parents.as_ref().and_then(|p| p.first()).map(|s| s.as_str());
                        let note_type = note_type_for(mime, name);
                        let title = if note_type == "ink" {
                            name.trim_end_matches(".noto")
                        } else {
                            name.trim_end_matches(".md")
                        };
                        let (local_id, was_updated) = {
                            let conn = db_state.conn.lock().unwrap();
                            let result = db::upsert_note_by_drive_id(
                                &conn,
                                &file.id,
                                title,
                                parent_drive_id,
                                modified_time,
                                note_type,
                            )?;
                            db::resolve_note_parent_local_ids(&conn)?;
                            result
                        };
                        had_changes = true;
                        log::info!("[pull_changes] upsert note drive_id={} local_id={} was_updated={}", file.id, local_id, was_updated);
                        if was_updated {
                            // Pre-fetch content now so refreshActiveNote returns from DB cache instantly
                            let content_url = format!("{}/{}?alt=media", DRIVE_FILES_API, file.id);
                            match client.get(&content_url).await {
                                Ok(resp) => match resp.text().await {
                                    Ok(content) => {
                                        let conn = db_state.conn.lock().unwrap();
                                        let _ = db::set_note_content(&conn, &local_id, &content);
                                        log::info!("[pull_changes] pre-cached content for local_id={}", local_id);
                                    }
                                    Err(e) => log::warn!("[pull_changes] pre-fetch text failed for {}: {}", local_id, e),
                                },
                                Err(e) => log::warn!("[pull_changes] pre-fetch request failed for {}: {}", local_id, e),
                            }
                            updated_note_ids.push(local_id);
                        }
                    }
                }
            }
        }

        if let Some(next) = resp.next_page_token {
            token = next;
        } else {
            if let Some(new_token) = resp.new_start_page_token {
                let conn = db_state.conn.lock().unwrap();
                db::set_sync_state(&conn, "changes_page_token", &new_token)?;
            }
            break;
        }
    }

    Ok((had_changes, updated_note_ids))
}

// ── Fetch note content from Drive ─────────────────────────────────────────────

pub async fn fetch_note_content(
    app: &AppHandle,
    db_state: &SyncDb,
    local_id: &str,
    drive_id: &str,
) -> Result<String> {
    let client = DriveClient::with_http(db_state.http.clone(), app).await?;
    let url = format!("{}/{}?alt=media", DRIVE_FILES_API, drive_id);
    let content = client.get(&url).await?.text().await?;
    let conn = db_state.conn.lock().unwrap();
    db::set_note_content(&conn, local_id, &content)?;
    Ok(content)
}

// ── Create folder on Drive ────────────────────────────────────────────────────

pub async fn create_folder_on_drive(
    app: &AppHandle,
    db_state: &SyncDb,
    local_id: &str,
    name: &str,
    parent_drive_id: &str,
) -> Result<String> {
    let client = DriveClient::with_http(db_state.http.clone(), app).await?;
    let body = json!({
        "name": name,
        "mimeType": FOLDER_MIME,
        "parents": [parent_drive_id]
    });
    #[derive(Deserialize)]
    struct Created {
        id: String,
    }
    let created: Created = client
        .post_json(&format!("{}?fields=id", DRIVE_FILES_API), &body)
        .await?
        .json()
        .await?;
    let conn = db_state.conn.lock().unwrap();
    db::set_folder_drive_id(&conn, local_id, &created.id)?;
    Ok(created.id)
}

// ── Move note on Drive ────────────────────────────────────────────────────────

pub async fn move_note_on_drive(
    app: &AppHandle,
    http: reqwest::Client,
    note_drive_id: &str,
    old_parent_drive_id: &str,
    new_parent_drive_id: &str,
) -> Result<()> {
    let client = DriveClient::with_http(http, app).await?;
    let url = format!(
        "{}/{}?addParents={}&removeParents={}&fields=id",
        DRIVE_FILES_API, note_drive_id, new_parent_drive_id, old_parent_drive_id
    );
    client.patch_json(&url, &json!({})).await?;
    Ok(())
}

// ── Background sync loop ──────────────────────────────────────────────────────

pub async fn run_sync_cycle(app: AppHandle, db_state: std::sync::Arc<SyncDb>) {
    if db_state.syncing.swap(true, Ordering::SeqCst) {
        return;
    }
    let _guard = SyncGuard(&db_state.syncing);

    let _ = app.emit("sync:start", ());

    let client = match DriveClient::with_http(db_state.http.clone(), &app).await {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[sync] auth failed: {}", e);
            let _ = app.emit("sync:error", e.to_string());
            return;
        }
    };

    let push_result = push_dirty(&client, &db_state).await;
    if let Err(e) = &push_result {
        log::warn!("[sync] push failed: {}", e);
    }

    match pull_changes(&client, &db_state).await {
        Ok((had_changes, updated_note_ids)) => {
            {
                let conn = db_state.conn.lock().unwrap();
                let ts = db::now_ms();
                let _ = db::set_sync_state(&conn, "last_sync_at", &ts.to_string());
            }
            log::info!("[sync] pull done: had_changes={} updated_note_ids={:?}", had_changes, updated_note_ids);
            if !updated_note_ids.is_empty() {
                log::info!("[sync] emitting sync:notes_updated with {:?}", updated_note_ids);
                let _ = app.emit("sync:notes_updated", updated_note_ids);
            }
            if had_changes || push_result.map(|n| n > 0).unwrap_or(false) {
                let _ = app.emit("sync:updated", ());
            }
            let _ = app.emit("sync:complete", ());
        }
        Err(e) => {
            log::warn!("[sync] pull failed: {}", e);
            let _ = app.emit("sync:error", e.to_string());
        }
    }
}

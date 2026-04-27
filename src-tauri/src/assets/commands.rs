use base64::{engine::general_purpose, Engine as _};
use reqwest::Method;
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use crate::drive::client::DriveClient;
use crate::sync::engine::SyncDb;

const DRIVE_FILES_API: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API: &str = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";

async fn find_or_create_folder(
    client: &DriveClient,
    name: &str,
    parent_id: &str,
) -> anyhow::Result<String> {
    #[derive(serde::Deserialize)]
    struct FolderList {
        files: Vec<FolderItem>,
    }
    #[derive(serde::Deserialize)]
    struct FolderItem {
        id: String,
    }
    #[derive(serde::Deserialize)]
    struct CreatedFile {
        id: String,
    }

    let query = format!(
        "mimeType='{}' and name='{}' and '{}' in parents and trashed=false",
        FOLDER_MIME, name, parent_id
    );
    let url = format!(
        "{}?q={}&fields=files(id)",
        DRIVE_FILES_API,
        urlencoding::encode(&query)
    );

    let resp: FolderList = client.get(&url).await?.json().await?;
    if let Some(folder) = resp.files.into_iter().next() {
        return Ok(folder.id);
    }

    let body = json!({
        "name": name,
        "mimeType": FOLDER_MIME,
        "parents": [parent_id]
    });
    let created: CreatedFile = client
        .post_json(&format!("{}?fields=id", DRIVE_FILES_API), &body)
        .await?
        .json()
        .await?;

    Ok(created.id)
}

// Returns the Drive ID of Noto/.noto/assets/, creating folders as needed.
async fn ensure_assets_folder(client: &DriveClient, root_drive_id: &str) -> anyhow::Result<String> {
    let noto_internal_id = find_or_create_folder(client, ".noto", root_drive_id).await?;
    let assets_id = find_or_create_folder(client, "assets", &noto_internal_id).await?;
    Ok(assets_id)
}

#[tauri::command]
pub async fn asset_upload(
    app: AppHandle,
    state: State<'_, Arc<SyncDb>>,
    base64_data: String,
    mime_type: String,
    file_name: String,
) -> Result<String, String> {
    let client = DriveClient::with_http(state.http.clone(), &app)
        .await
        .map_err(|e| e.to_string())?;

    let root_drive_id = {
        let conn = state.conn.lock().unwrap();
        crate::sync::db::get_sync_state(&conn, "root_drive_id")
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Not synced yet — root_drive_id missing".to_string())?
    };

    let assets_folder_id = ensure_assets_folder(&client, &root_drive_id)
        .await
        .map_err(|e| e.to_string())?;

    let bytes = general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| e.to_string())?;

    let metadata_json = json!({
        "name": file_name,
        "parents": [assets_folder_id]
    })
    .to_string();

    let url = format!("{}?uploadType=multipart&fields=id", DRIVE_UPLOAD_API);

    #[derive(serde::Deserialize)]
    struct UploadedFile {
        id: String,
    }

    let uploaded: UploadedFile = client
        .multipart_upload_bytes(Method::POST, &url, &metadata_json, bytes.clone(), &mime_type)
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let drive_id = uploaded.id;

    // Cache locally
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("asset_cache");
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| e.to_string())?;
    let cache_path = cache_dir.join(&drive_id);
    tokio::fs::write(&cache_path, &bytes)
        .await
        .map_err(|e| e.to_string())?;

    // Record in DB
    {
        let conn = state.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO asset_cache (drive_id, mime_type, local_path, cached_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                drive_id,
                mime_type,
                cache_path.to_string_lossy().as_ref(),
                crate::sync::db::now_ms()
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(drive_id)
}

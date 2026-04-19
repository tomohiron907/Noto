use reqwest::Method;
use serde_json::json;
use tauri::AppHandle;

use super::{
    client::DriveClient,
    types::{FileListResponse, NoteMetadata},
};

const DRIVE_FILES_API: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API: &str = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
const MD_MIME: &str = "text/markdown";
const FIELDS: &str = "id,name,modifiedTime";

#[tauri::command]
pub async fn drive_ensure_folder(app: AppHandle) -> Result<String, String> {
    let client = DriveClient::new(&app).await.map_err(|e| e.to_string())?;
    drive_ensure_folder_inner(&client).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn drive_list_notes(app: AppHandle) -> Result<Vec<NoteMetadata>, String> {
    let client = DriveClient::new(&app).await.map_err(|e| e.to_string())?;
    let folder_id = drive_ensure_folder_inner(&client).await.map_err(|e| e.to_string())?;

    let query = format!(
        "mimeType='{}' and '{}' in parents and trashed=false",
        MD_MIME, folder_id
    );
    let url = format!(
        "{}?q={}&fields=files({})&orderBy=modifiedTime desc",
        DRIVE_FILES_API,
        urlencoding::encode(&query),
        FIELDS,
    );

    let resp: FileListResponse = client
        .get(&url)
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(resp
        .files
        .into_iter()
        .map(|f| NoteMetadata {
            id: f.id,
            title: f.name.trim_end_matches(".md").to_string(),
            modified_time: f.modified_time,
        })
        .collect())
}

#[tauri::command]
pub async fn drive_read_note(app: AppHandle, file_id: String) -> Result<String, String> {
    let client = DriveClient::new(&app).await.map_err(|e| e.to_string())?;
    let url = format!("{}/{}?alt=media", DRIVE_FILES_API, file_id);
    let text = client
        .get(&url)
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    Ok(text)
}

#[tauri::command]
pub async fn drive_write_note(
    app: AppHandle,
    file_id: Option<String>,
    title: String,
    content: String,
) -> Result<NoteMetadata, String> {
    let client = DriveClient::new(&app).await.map_err(|e| e.to_string())?;
    let file_name = format!("{}.md", title);

    if let Some(id) = file_id {
        let metadata = json!({ "name": file_name });
        let url = format!(
            "{}/{}?uploadType=multipart&fields={}",
            DRIVE_UPLOAD_API, id, FIELDS
        );

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct UpdatedFile {
            id: String,
            name: String,
            modified_time: String,
        }

        let updated: UpdatedFile = client
            .multipart_upload(Method::PATCH, &url, &metadata.to_string(), &content, MD_MIME)
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        Ok(NoteMetadata {
            id: updated.id,
            title: updated.name.trim_end_matches(".md").to_string(),
            modified_time: updated.modified_time,
        })
    } else {
        let folder_id = drive_ensure_folder_inner(&client).await.map_err(|e| e.to_string())?;
        let metadata = json!({ "name": file_name, "parents": [folder_id] });
        let url = format!("{}?uploadType=multipart&fields={}", DRIVE_UPLOAD_API, FIELDS);

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct CreatedFile {
            id: String,
            name: String,
            modified_time: String,
        }

        let created: CreatedFile = client
            .multipart_upload(Method::POST, &url, &metadata.to_string(), &content, MD_MIME)
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        Ok(NoteMetadata {
            id: created.id,
            title: created.name.trim_end_matches(".md").to_string(),
            modified_time: created.modified_time,
        })
    }
}

#[tauri::command]
pub async fn drive_delete_note(app: AppHandle, file_id: String) -> Result<(), String> {
    let client = DriveClient::new(&app).await.map_err(|e| e.to_string())?;
    let body = json!({ "trashed": true });
    client
        .patch_json(&format!("{}/{}?fields=id", DRIVE_FILES_API, file_id), &body)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn drive_ensure_folder_inner(client: &DriveClient) -> anyhow::Result<String> {
    #[derive(serde::Deserialize)]
    struct FolderList {
        files: Vec<FolderItem>,
    }
    #[derive(serde::Deserialize)]
    struct FolderItem {
        id: String,
    }

    let query = format!(
        "mimeType='{}' and name='Noto' and trashed=false",
        FOLDER_MIME
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

    let body = json!({ "name": "Noto", "mimeType": FOLDER_MIME });

    #[derive(serde::Deserialize)]
    struct CreatedFile {
        id: String,
    }

    let created: CreatedFile = client
        .post_json(&format!("{}?fields=id", DRIVE_FILES_API), &body)
        .await?
        .json()
        .await?;

    Ok(created.id)
}

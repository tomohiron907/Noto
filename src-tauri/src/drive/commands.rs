use reqwest::Method;
use serde_json::json;
use tauri::AppHandle;

use super::{
    client::DriveClient,
    types::{FileListResponse, FolderMetadata, NoteMetadata, TreeResponse},
};

const DRIVE_FILES_API: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API: &str = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
const MD_MIME: &str = "text/markdown";
const FIELDS: &str = "id,name,modifiedTime,parents";

#[tauri::command]
pub async fn drive_ensure_folder(app: AppHandle) -> Result<String, String> {
    let client = DriveClient::new(&app).await.map_err(|e| e.to_string())?;
    drive_ensure_folder_inner(&client)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn drive_list_notes(app: AppHandle) -> Result<Vec<NoteMetadata>, String> {
    let client = DriveClient::new(&app).await.map_err(|e| e.to_string())?;
    let folder_id = drive_ensure_folder_inner(&client)
        .await
        .map_err(|e| e.to_string())?;

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
            parent_id: f.parents
                .as_ref()
                .and_then(|p| p.first())
                .cloned()
                .unwrap_or_else(|| folder_id.clone()),
            id: f.id,
            title: f.name.trim_end_matches(".md").to_string(),
            modified_time: f.modified_time,
        })
        .collect())
}

#[tauri::command]
pub async fn drive_list_tree(app: AppHandle) -> Result<TreeResponse, String> {
    let client = DriveClient::new(&app).await.map_err(|e| e.to_string())?;
    let root_id = drive_ensure_folder_inner(&client)
        .await
        .map_err(|e| e.to_string())?;

    let folders = collect_all_folders_inner(&client, &root_id)
        .await
        .map_err(|e| e.to_string())?;

    // Build list of all parent IDs to query (root + all subfolders)
    let mut all_parent_ids: Vec<String> = vec![root_id.clone()];
    for f in &folders {
        all_parent_ids.push(f.id.clone());
    }

    // Query .md files in chunks of 60 to stay within URL length limits
    let mut notes: Vec<NoteMetadata> = Vec::new();
    for chunk in all_parent_ids.chunks(60) {
        let parent_clauses = chunk
            .iter()
            .map(|id| format!("'{}' in parents", id))
            .collect::<Vec<_>>()
            .join(" or ");
        let query = format!(
            "mimeType='{}' and ({}) and trashed=false",
            MD_MIME, parent_clauses
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

        for f in resp.files {
            let parent_id = f
                .parents
                .as_ref()
                .and_then(|p| p.first())
                .cloned()
                .unwrap_or_else(|| root_id.clone());
            notes.push(NoteMetadata {
                id: f.id,
                title: f.name.trim_end_matches(".md").to_string(),
                modified_time: f.modified_time,
                parent_id,
            });
        }
    }

    // Sort notes by modified_time descending
    notes.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));

    Ok(TreeResponse {
        root_id,
        folders,
        notes,
    })
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
    parent_id: Option<String>,
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
            parents: Option<Vec<String>>,
        }

        let updated: UpdatedFile = client
            .multipart_upload(
                Method::PATCH,
                &url,
                &metadata.to_string(),
                &content,
                MD_MIME,
            )
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        Ok(NoteMetadata {
            parent_id: updated
                .parents
                .as_ref()
                .and_then(|p| p.first())
                .cloned()
                .unwrap_or_default(),
            id: updated.id,
            title: updated.name.trim_end_matches(".md").to_string(),
            modified_time: updated.modified_time,
        })
    } else {
        let folder_id = drive_ensure_folder_inner(&client)
            .await
            .map_err(|e| e.to_string())?;
        let actual_parent = parent_id.as_deref().unwrap_or(&folder_id);
        let metadata = json!({ "name": file_name, "parents": [actual_parent] });
        let url = format!(
            "{}?uploadType=multipart&fields={}",
            DRIVE_UPLOAD_API, FIELDS
        );

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct CreatedFile {
            id: String,
            name: String,
            modified_time: String,
            parents: Option<Vec<String>>,
        }

        let created: CreatedFile = client
            .multipart_upload(Method::POST, &url, &metadata.to_string(), &content, MD_MIME)
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        Ok(NoteMetadata {
            parent_id: created
                .parents
                .as_ref()
                .and_then(|p| p.first())
                .cloned()
                .unwrap_or_else(|| actual_parent.to_string()),
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

#[tauri::command]
pub async fn drive_create_folder(
    app: AppHandle,
    name: String,
    parent_id: Option<String>,
) -> Result<FolderMetadata, String> {
    let client = DriveClient::new(&app).await.map_err(|e| e.to_string())?;
    let root_id = drive_ensure_folder_inner(&client)
        .await
        .map_err(|e| e.to_string())?;
    let actual_parent = parent_id.as_deref().unwrap_or(&root_id);
    let body = json!({
        "name": name,
        "mimeType": FOLDER_MIME,
        "parents": [actual_parent]
    });

    #[derive(serde::Deserialize)]
    struct CreatedFolder {
        id: String,
    }

    let created: CreatedFolder = client
        .post_json(&format!("{}?fields=id", DRIVE_FILES_API), &body)
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(FolderMetadata {
        id: created.id,
        name,
        parent_id: actual_parent.to_string(),
    })
}

#[tauri::command]
pub async fn drive_move_note(
    app: AppHandle,
    file_id: String,
    old_parent_id: String,
    new_parent_id: String,
) -> Result<(), String> {
    let client = DriveClient::new(&app).await.map_err(|e| e.to_string())?;
    let url = format!(
        "{}/{}?addParents={}&removeParents={}&fields=id",
        DRIVE_FILES_API, file_id, new_parent_id, old_parent_id
    );
    client
        .patch_json(&url, &json!({}))
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

async fn collect_all_folders_inner(
    client: &DriveClient,
    root_id: &str,
) -> anyhow::Result<Vec<FolderMetadata>> {
    // Folder listing doesn't need modifiedTime, so use a minimal local struct
    #[derive(serde::Deserialize)]
    struct FolderList {
        files: Vec<FolderEntry>,
    }
    #[derive(serde::Deserialize)]
    struct FolderEntry {
        id: String,
        name: String,
        parents: Option<Vec<String>>,
    }

    let mut all_folders: Vec<FolderMetadata> = Vec::new();
    let mut queue: Vec<String> = vec![root_id.to_string()];

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
        let resp: FolderList = client.get(&url).await?.json().await?;
        for f in resp.files {
            let pid = f
                .parents
                .as_ref()
                .and_then(|p| p.first())
                .cloned()
                .unwrap_or_else(|| root_id.to_string());
            queue.push(f.id.clone());
            all_folders.push(FolderMetadata {
                id: f.id,
                name: f.name,
                parent_id: pid,
            });
        }
    }
    Ok(all_folders)
}

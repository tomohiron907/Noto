use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalNote {
    pub local_id: String,
    pub drive_id: Option<String>,
    pub title: String,
    pub parent_local_id: Option<String>,
    pub parent_drive_id: Option<String>,
    pub modified_at: i64,
    pub drive_modified_at: Option<String>,
    pub content_fetched: bool,
    pub dirty: bool,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalFolder {
    pub local_id: String,
    pub drive_id: Option<String>,
    pub name: String,
    pub parent_local_id: Option<String>,
    pub parent_drive_id: Option<String>,
    pub deleted: bool,
}

/// Frontend-facing types (mirror drive/types.rs but with local_id as id)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMetadata {
    pub id: String,        // local_id
    pub title: String,
    pub modified_time: String,
    pub parent_id: String, // parent local_id
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderMetadata {
    pub id: String,        // local_id
    pub name: String,
    pub parent_id: String, // parent local_id
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeResponse {
    pub root_id: String,   // root folder local_id
    pub folders: Vec<FolderMetadata>,
    pub notes: Vec<NoteMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SyncPhase {
    Idle,
    Syncing,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub phase: SyncPhase,
    pub last_sync_at: Option<i64>,
}

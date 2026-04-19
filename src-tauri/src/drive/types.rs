use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMetadata {
    pub id: String,
    pub title: String,
    pub modified_time: String,
}

/// Subset of the Drive Files resource we care about
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    pub modified_time: String,
}

#[derive(Debug, Deserialize)]
pub struct FileListResponse {
    pub files: Vec<DriveFile>,
}

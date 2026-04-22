use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMetadata {
    pub id: String,
    pub title: String,
    pub modified_time: String,
    pub parent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    pub modified_time: String,
    pub parents: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct FileListResponse {
    pub files: Vec<DriveFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderMetadata {
    pub id: String,
    pub name: String,
    pub parent_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeResponse {
    pub root_id: String,
    pub folders: Vec<FolderMetadata>,
    pub notes: Vec<NoteMetadata>,
}

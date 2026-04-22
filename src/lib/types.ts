export interface UserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface NoteMetadata {
  id: string;
  title: string;
  modified_time: string;
  parent_id: string;
}

export interface FolderMetadata {
  id: string;
  name: string;
  parent_id: string;
}

export interface TreeResponse {
  root_id: string;
  folders: FolderMetadata[];
  notes: NoteMetadata[];
}

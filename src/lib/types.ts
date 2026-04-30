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
  note_type: "md" | "ink";
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

export type SyncPhase = "idle" | "syncing" | { error: string };

export interface SyncStatus {
  phase: SyncPhase;
  last_sync_at: number | null;
}

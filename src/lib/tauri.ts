import { invoke } from "@tauri-apps/api/core";
import type {
  UserInfo,
  NoteMetadata,
  FolderMetadata,
  TreeResponse,
  SyncStatus,
} from "./types";

export const tauriAuth = {
  start: () => invoke<UserInfo>("auth_start"),
  restore: () => invoke<UserInfo | null>("auth_restore"),
  signOut: () => invoke<void>("auth_sign_out"),
};

export const tauriSync = {
  listTree: () => invoke<TreeResponse>("sync_list_tree"),
  readNote: (localId: string) =>
    invoke<string>("sync_read_note", { localId }),
  writeNote: (localId: string, title: string, content: string) =>
    invoke<NoteMetadata>("sync_write_note", { localId, title, content }),
  createNote: (parentLocalId?: string, title?: string) =>
    invoke<NoteMetadata>("sync_create_note", {
      parentLocalId: parentLocalId ?? null,
      title: title ?? "Untitled",
    }),
  deleteNote: (localId: string) =>
    invoke<void>("sync_delete_note", { localId }),
  createFolder: (name: string, parentLocalId?: string) =>
    invoke<FolderMetadata>("sync_create_folder", {
      name,
      parentLocalId: parentLocalId ?? null,
    }),
  deleteFolder: (localId: string) =>
    invoke<void>("sync_delete_folder", { localId }),
  moveNote: (localId: string, newParentLocalId: string) =>
    invoke<void>("sync_move_note", { localId, newParentLocalId }),
  trigger: () => invoke<void>("sync_trigger"),
  getStatus: () => invoke<SyncStatus>("sync_get_status"),
};

export const tauriWindow = {
  openNoteWindow: (noteId: string, noteTitle: string) =>
    invoke<void>("open_note_window", { noteId, noteTitle }),
  setWindowNote: (noteId: string) =>
    invoke<void>("set_window_note", { noteId }),
};

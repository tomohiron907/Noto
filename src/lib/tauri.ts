import { invoke } from "@tauri-apps/api/core";
import type { UserInfo, NoteMetadata, FolderMetadata, TreeResponse } from "./types";

export const tauriAuth = {
  start: () => invoke<UserInfo>("auth_start"),
  restore: () => invoke<UserInfo | null>("auth_restore"),
  signOut: () => invoke<void>("auth_sign_out"),
};

export const tauriDrive = {
  ensureFolder: () => invoke<string>("drive_ensure_folder"),
  listNotes: () => invoke<NoteMetadata[]>("drive_list_notes"),
  listTree: () => invoke<TreeResponse>("drive_list_tree"),
  readNote: (fileId: string) => invoke<string>("drive_read_note", { fileId }),
  writeNote: (
    fileId: string | null,
    title: string,
    content: string,
    parentId?: string,
  ) =>
    invoke<NoteMetadata>("drive_write_note", {
      fileId,
      title,
      content,
      parentId: parentId ?? null,
    }),
  deleteNote: (fileId: string) => invoke<void>("drive_delete_note", { fileId }),
  createFolder: (name: string, parentId?: string) =>
    invoke<FolderMetadata>("drive_create_folder", {
      name,
      parentId: parentId ?? null,
    }),
  moveNote: (fileId: string, oldParentId: string, newParentId: string) =>
    invoke<void>("drive_move_note", { fileId, oldParentId, newParentId }),
  uploadImage: (fileName: string, data: number[]) =>
    invoke<string>("drive_upload_image", { fileName, data }),
};

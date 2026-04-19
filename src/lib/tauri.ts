import { invoke } from "@tauri-apps/api/core";
import type { UserInfo, NoteMetadata } from "./types";

export const tauriAuth = {
  start: () => invoke<UserInfo>("auth_start"),
  restore: () => invoke<UserInfo | null>("auth_restore"),
  signOut: () => invoke<void>("auth_sign_out"),
};

export const tauriDrive = {
  ensureFolder: () => invoke<string>("drive_ensure_folder"),
  listNotes: () => invoke<NoteMetadata[]>("drive_list_notes"),
  readNote: (fileId: string) => invoke<string>("drive_read_note", { fileId }),
  writeNote: (fileId: string | null, title: string, content: string) =>
    invoke<NoteMetadata>("drive_write_note", { fileId, title, content }),
  deleteNote: (fileId: string) => invoke<void>("drive_delete_note", { fileId }),
  uploadImage: (fileName: string, data: number[]) =>
    invoke<string>("drive_upload_image", { fileName, data }),
};

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { tauriDrive } from "../lib/tauri";
import type { FolderMetadata, NoteMetadata } from "../lib/types";

interface NotesState {
  notes: NoteMetadata[];
  folders: FolderMetadata[];
  rootFolderId: string | null;
  activeId: string | null;
  activeContent: string;
  activeTitle: string;
  dirty: boolean;
  syncing: boolean;
  loading: boolean;
  error: string | null;
  contentCache: Record<string, string>;
  cacheVersions: Record<string, string>;

  loadTree: () => Promise<void>;
  loadNotes: () => Promise<void>;
  openNote: (id: string) => Promise<void>;
  createNote: (parentId?: string, initialTitle?: string) => Promise<void>;
  saveNote: (content: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  createFolder: (name: string, parentId?: string) => Promise<void>;
  moveNote: (noteId: string, oldParentId: string, newParentId: string) => Promise<void>;
  markDirty: (content: string) => void;
  setActiveTitle: (title: string) => void;
}

export const useNotesStore = create<NotesState>()(
  immer((set, get) => ({
    notes: [],
    folders: [],
    rootFolderId: null,
    activeId: null,
    activeContent: "",
    activeTitle: "",
    dirty: false,
    syncing: false,
    loading: false,
    error: null,
    contentCache: {},
    cacheVersions: {},

    loadTree: async () => {
      set((s) => { s.loading = true; });
      try {
        const tree = await tauriDrive.listTree();
        set((s) => {
          s.notes = tree.notes;
          s.folders = tree.folders;
          s.rootFolderId = tree.root_id;
          s.loading = false;
          s.error = null;
        });
      } catch (e) {
        console.error("[loadTree]", e);
        set((s) => { s.error = String(e); s.loading = false; });
      }
    },

    loadNotes: async () => {
      try {
        const notes = await tauriDrive.listNotes();
        set((s) => { s.notes = notes; });
      } catch (e) {
        console.error("[loadNotes]", e);
        set((s) => { s.error = String(e); });
      }
    },

    openNote: async (id: string) => {
      const { contentCache, cacheVersions, notes } = get();
      const note = notes.find((n) => n.id === id);
      const cached = contentCache[id];
      const isUpToDate =
        cached !== undefined &&
        note !== undefined &&
        cacheVersions[id] === note.modified_time;

      set((s) => {
        s.activeId = id;
        s.activeContent = cached ?? "";
        s.activeTitle = note?.title ?? "Untitled";
        s.dirty = false;
        s.loading = !isUpToDate;
      });

      if (isUpToDate) return;

      try {
        const content = await tauriDrive.readNote(id);
        set((s) => {
          if (s.activeId !== id) return;
          s.activeContent = content;
          s.contentCache[id] = content;
          s.cacheVersions[id] = note?.modified_time ?? "";
          s.loading = false;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.loading = false;
        });
      }
    },

    createNote: async (parentId?: string, initialTitle?: string) => {
      const title = initialTitle?.trim() || "Untitled";
      set((s) => { s.syncing = true; });
      try {
        const meta = await tauriDrive.writeNote(null, title, "", parentId);
        set((s) => {
          s.notes.unshift(meta);
          s.activeId = meta.id;
          s.activeContent = "";
          s.activeTitle = title;
          s.dirty = false;
          s.syncing = false;
        });
      } catch (e) {
        console.error("[createNote]", e);
        set((s) => { s.error = String(e); s.syncing = false; });
      }
    },

    saveNote: async (content: string) => {
      const { activeId, notes, activeTitle } = get();
      if (!activeId) return;
      const note = notes.find((n) => n.id === activeId);
      if (!note) return;

      const title = activeTitle.trim() || "Untitled";

      set((s) => {
        s.syncing = true;
        s.dirty = false;
      });
      try {
        const updated = await tauriDrive.writeNote(activeId, title, content);
        set((s) => {
          s.syncing = false;
          const idx = s.notes.findIndex((n) => n.id === activeId);
          if (idx !== -1) s.notes[idx] = updated;
          s.contentCache[activeId] = content;
          s.cacheVersions[activeId] = updated.modified_time;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
          s.syncing = false;
        });
      }
    },

    deleteNote: async (id: string) => {
      await tauriDrive.deleteNote(id);
      set((s) => {
        s.notes = s.notes.filter((n) => n.id !== id);
        if (s.activeId === id) {
          s.activeId = s.notes[0]?.id ?? null;
          s.activeContent = "";
        }
      });
    },

    deleteFolder: async (id: string) => {
      await tauriDrive.deleteNote(id);
      set((s) => {
        // Remove folder and any descendant folders from state
        const removedIds = new Set<string>();
        const toRemove = [id];
        while (toRemove.length > 0) {
          const current = toRemove.pop()!;
          removedIds.add(current);
          s.folders.filter((f) => f.parent_id === current).forEach((f) => toRemove.push(f.id));
        }
        s.folders = s.folders.filter((f) => !removedIds.has(f.id));
        s.notes = s.notes.filter((n) => !removedIds.has(n.parent_id));
      });
    },

    createFolder: async (name: string, parentId?: string) => {
      set((s) => { s.syncing = true; });
      try {
        const folder = await tauriDrive.createFolder(name, parentId);
        set((s) => {
          s.folders.push(folder);
          s.folders.sort((a, b) => a.name.localeCompare(b.name));
          s.syncing = false;
        });
      } catch (e) {
        set((s) => { s.error = String(e); s.syncing = false; });
      }
    },

    moveNote: async (noteId: string, oldParentId: string, newParentId: string) => {
      console.log("[DnD] moveNote called noteId=", noteId, "oldParentId=", oldParentId, "newParentId=", newParentId);
      if (oldParentId === newParentId) return;
      set((s) => { s.syncing = true; });
      try {
        await tauriDrive.moveNote(noteId, oldParentId, newParentId);
        set((s) => {
          const idx = s.notes.findIndex((n) => n.id === noteId);
          if (idx !== -1) s.notes[idx].parent_id = newParentId;
          s.syncing = false;
        });
      } catch (e) {
        set((s) => { s.error = String(e); s.syncing = false; });
      }
    },

    markDirty: (content: string) => {
      set((s) => {
        s.activeContent = content;
        s.dirty = true;
      });
    },

    setActiveTitle: (title: string) => {
      set((s) => {
        s.activeTitle = title;
        s.dirty = true;
      });
    },
  }))
);

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { tauriDrive } from "../lib/tauri";
import type { NoteMetadata } from "../lib/types";

interface NotesState {
  notes: NoteMetadata[];
  activeId: string | null;
  activeContent: string;
  dirty: boolean;
  syncing: boolean;
  error: string | null;

  loadNotes: () => Promise<void>;
  openNote: (id: string) => Promise<void>;
  createNote: () => Promise<void>;
  saveNote: (content: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  markDirty: (content: string) => void;
}

export const useNotesStore = create<NotesState>()(
  immer((set, get) => ({
    notes: [],
    activeId: null,
    activeContent: "",
    dirty: false,
    syncing: false,
    error: null,

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
      set((s) => {
        s.activeId = id;
        s.activeContent = "";
        s.dirty = false;
      });
      try {
        const content = await tauriDrive.readNote(id);
        set((s) => {
          s.activeContent = content;
        });
      } catch (e) {
        set((s) => {
          s.error = String(e);
        });
      }
    },

    createNote: async () => {
      set((s) => { s.syncing = true; });
      try {
        const meta = await tauriDrive.writeNote(null, "Untitled", "");
        set((s) => {
          s.notes.unshift(meta);
          s.activeId = meta.id;
          s.activeContent = "";
          s.dirty = false;
          s.syncing = false;
        });
      } catch (e) {
        console.error("[createNote]", e);
        set((s) => { s.error = String(e); s.syncing = false; });
      }
    },

    saveNote: async (content: string) => {
      const { activeId, notes } = get();
      if (!activeId) return;
      const note = notes.find((n) => n.id === activeId);
      if (!note) return;

      // Extract title from first line (strip Markdown heading #)
      const firstLine = content.split("\n")[0] ?? "";
      const title = firstLine.replace(/^#+\s*/, "").trim() || "Untitled";

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

    markDirty: (content: string) => {
      set((s) => {
        s.activeContent = content;
        s.dirty = true;
      });
    },
  }))
);

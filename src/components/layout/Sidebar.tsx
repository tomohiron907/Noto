import { useEffect, useState } from "react";
import { Plus, LogOut, Search, X } from "lucide-react";
import { useNotesStore } from "../../stores/notesStore";
import { useAuthStore } from "../../stores/authStore";
import NoteCard from "../ui/NoteCard";

const LAST_NOTE_KEY = "noto_last_note_id";

interface SidebarProps {
  onClose?: () => void;
}

export default function Sidebar({ onClose }: SidebarProps) {
  const { notes, activeId, loadNotes, openNote, createNote, deleteNote, syncing, error } =
    useNotesStore();
  const { user, signOut } = useAuthStore();
  const [query, setQuery] = useState("");

  useEffect(() => {
    loadNotes().then(() => {
      // Restore last opened note
      const lastId = localStorage.getItem(LAST_NOTE_KEY);
      if (lastId) {
        const exists = useNotesStore.getState().notes.find((n) => n.id === lastId);
        if (exists) openNote(lastId);
      }
    });
  }, [loadNotes, openNote]);

  // Persist last opened note
  useEffect(() => {
    if (activeId) localStorage.setItem(LAST_NOTE_KEY, activeId);
  }, [activeId]);

  const filtered = notes.filter((n) =>
    n.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <aside
      className="flex flex-col h-full bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700"
      style={{ width: "var(--sidebar-width)", flexShrink: 0 }}
    >
      {/* Drag region + title (overlaid by macOS traffic lights) */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 border-b border-neutral-200 dark:border-neutral-700 relative z-10"
        style={{ height: "calc(var(--titlebar-height) + 20px)", paddingTop: "var(--titlebar-height)" }}
      >
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 select-none pl-16">
          {syncing ? "Saving…" : "Notes"}
        </span>
        <div className="flex items-center gap-1 z-20">
          <button
            onClick={() => { createNote(); onClose?.(); }}
            disabled={syncing}
            className="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-gray-500 dark:text-gray-400 transition-colors disabled:opacity-40"
            aria-label="New note (⌘N)"
            title="New note (⌘N)"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-gray-500 dark:text-gray-400 transition-colors"
            aria-label="Close notes menu"
            title="Close menu"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-2">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600">
          <Search size={13} className="text-gray-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="flex-1 text-xs bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-2 mb-1 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-xs text-red-600 dark:text-red-400 break-all">
          {error}
        </div>
      )}

      {/* Note list */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-2">
        {filtered.length === 0 && (
          <p className="text-xs text-center text-gray-400 mt-8">
            {query ? "No results." : "No notes yet.\nClick + to create one."}
          </p>
        )}
        {filtered.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            active={note.id === activeId}
            onClick={() => {
              openNote(note.id);
              onClose?.();
            }}
            onDelete={() => deleteNote(note.id)}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-neutral-200 dark:border-neutral-700 flex items-center gap-2">
        {user?.picture && (
          <img src={user.picture} alt={user.name} className="w-6 h-6 rounded-full shrink-0" />
        )}
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1">
          {user?.email}
        </span>
        <button
          onClick={signOut}
          className="p-1 rounded hover:text-red-500 text-gray-400 transition-colors"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );
}

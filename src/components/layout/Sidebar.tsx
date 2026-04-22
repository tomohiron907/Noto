import { useEffect, useRef, useState } from "react";
import {
  FilePlus,
  FileText,
  FolderPlus,
  LogOut,
  Search,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useNotesStore } from "../../stores/notesStore";
import { useAuthStore } from "../../stores/authStore";
import FileTreeItem from "../ui/FileTreeItem";
import FolderTreeItem, {
  InlineCreateInput,
  type CreatingState,
} from "../ui/FolderTreeItem";

const LAST_NOTE_KEY = "noto_last_note_id";
const isDesktop = !("ontouchstart" in window || navigator.maxTouchPoints > 0);

interface SidebarProps {
  onClose?: () => void;
}

export default function Sidebar({ onClose }: SidebarProps) {
  const {
    notes,
    folders,
    rootFolderId,
    activeId,
    loadTree,
    openNote,
    createNote,
    createFolder,
    deleteNote,
    deleteFolder,
    syncing,
    error,
  } = useNotesStore();
  const { user, signOut } = useAuthStore();

  const [query, setQuery] = useState("");
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreatingState>(null);
  const [creatingName, setCreatingName] = useState("");

  // Pointer drag state
  const pointerDragRef = useRef<{
    noteId: string;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; title: string } | null>(null);
  const [hoverFolderId, setHoverFolderId] = useState<string | null>(null);
  const [hoverRoot, setHoverRoot] = useState(false);

  const cancelledRef = useRef(false);

  useEffect(() => {
    loadTree().then(() => {
      const lastId = localStorage.getItem(LAST_NOTE_KEY);
      if (lastId) {
        const exists = useNotesStore.getState().notes.find((n) => n.id === lastId);
        if (exists) openNote(lastId);
      }
    });
  }, [loadTree, openNote]);

  useEffect(() => {
    if (activeId) localStorage.setItem(LAST_NOTE_KEY, activeId);
  }, [activeId]);

  // ── Global pointer event listeners ────────────────────────────────────────

  useEffect(() => {
    if (!isDesktop) return;

    const onPointerMove = (e: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (!drag.dragging) {
        if (Math.hypot(dx, dy) < 5) return;
        drag.dragging = true;
        setIsDragging(true);
        const note = useNotesStore.getState().notes.find((n) => n.id === drag.noteId);
        setDragGhost({ x: e.clientX, y: e.clientY, title: note?.title ?? "Note" });
      } else {
        setDragGhost((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
      }

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const folderEl = el?.closest("[data-folder-id]");
      const rootEl = el?.closest("[data-root-drop]");
      setHoverFolderId(folderEl?.getAttribute("data-folder-id") ?? null);
      setHoverRoot(!!rootEl);
    };

    const onPointerUp = (e: PointerEvent) => {
      const drag = pointerDragRef.current;
      pointerDragRef.current = null;
      setIsDragging(false);
      setDragGhost(null);
      setHoverFolderId(null);
      setHoverRoot(false);

      if (!drag?.dragging) return;

      const { notes: currentNotes, rootFolderId: rootId, moveNote } = useNotesStore.getState();
      const note = currentNotes.find((n) => n.id === drag.noteId);
      if (!note) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) {
        const folderEl = el.closest("[data-folder-id]");
        if (folderEl) {
          const folderId = folderEl.getAttribute("data-folder-id");
          if (folderId && folderId !== note.parent_id) {
            moveNote(drag.noteId, note.parent_id, folderId);
          }
          return;
        }
        const rootEl = el.closest("[data-root-drop]");
        if (rootEl && rootId && note.parent_id !== rootId) {
          moveNote(drag.noteId, note.parent_id, rootId);
        }
      }
    };

    const onPointerCancel = () => {
      pointerDragRef.current = null;
      setIsDragging(false);
      setDragGhost(null);
      setHoverFolderId(null);
      setHoverRoot(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  // ── Note pointer down ─────────────────────────────────────────────────────

  const handleNotePointerDown = (noteId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointerDragRef.current = {
      noteId,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
    };
  };

  // ── Creation helpers ──────────────────────────────────────────────────────

  const startCreating = (type: "file" | "folder", parentId: string | null) => {
    if (!parentId) return;
    setCreating({ type, parentId });
    setCreatingName("");
    cancelledRef.current = false;
  };

  const confirmCreate = async () => {
    if (cancelledRef.current) return;
    const name = creatingName.trim();
    const current = creating;
    setCreating(null);
    setCreatingName("");
    if (!name || !current) return;

    if (current.type === "folder") {
      const parentArg =
        current.parentId === rootFolderId ? undefined : current.parentId;
      await createFolder(name, parentArg);
    } else {
      const parentArg =
        current.parentId === rootFolderId ? undefined : current.parentId;
      await createNote(parentArg, name);
      onClose?.();
    }
  };

  const cancelCreate = () => {
    cancelledRef.current = true;
    setCreating(null);
    setCreatingName("");
  };

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = notes.filter((n) =>
    n.title.toLowerCase().includes(query.toLowerCase())
  );

  const rootFolders = folders.filter((f) => f.parent_id === rootFolderId);
  const rootNotes = notes.filter((n) => n.parent_id === rootFolderId);

  const sharedFolderProps = {
    allFolders: folders,
    allNotes: notes,
    activeNoteId: activeId,
    activeFolderId,
    creating,
    creatingName,
    onNoteClick: (id: string) => { openNote(id); onClose?.(); },
    onNoteDelete: (id: string) => deleteNote(id),
    onFolderDelete: (id: string) => deleteFolder(id),
    onFolderActivate: (id: string) => setActiveFolderId(id),
    onStartCreating: startCreating,
    onConfirmCreate: confirmCreate,
    onCancelCreate: cancelCreate,
    onCreatingNameChange: setCreatingName,
    onNotePointerDown: isDesktop ? handleNotePointerDown : undefined,
    dragOverFolderId: hoverFolderId,
  };

  const targetFolderForNew = activeFolderId ?? rootFolderId;

  return (
    <aside
      className="flex flex-col h-full bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700"
      style={{ width: "var(--sidebar-width)", flexShrink: 0 }}
      onClick={() => setActiveFolderId(null)}
    >
      {/* Drag region + title */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-3 border-b border-neutral-200 dark:border-neutral-700 relative z-10"
        style={{
          height: "calc(var(--titlebar-height) + 20px)",
          paddingTop: "var(--titlebar-height)",
        }}
      >
        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 select-none pl-16">
          {syncing ? "Saving…" : "Notes"}
        </span>

        <div className="flex items-center gap-0.5 z-20">
          <button
            onClick={(e) => {
              e.stopPropagation();
              startCreating("file", targetFolderForNew);
            }}
            disabled={syncing}
            className="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-gray-500 dark:text-gray-400 transition-colors disabled:opacity-40"
            aria-label="New file"
            title="New file (⌘N)"
          >
            <FilePlus size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              startCreating("folder", targetFolderForNew);
            }}
            disabled={syncing}
            className="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-gray-500 dark:text-gray-400 transition-colors disabled:opacity-40"
            aria-label="New folder"
            title="New folder"
          >
            <FolderPlus size={15} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-gray-500 dark:text-gray-400 transition-colors"
            aria-label="Close sidebar"
            title="Close"
          >
            <X size={15} />
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
            className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-2 mb-1 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-xs text-red-600 dark:text-red-400 break-all">
          {error}
        </div>
      )}

      {/* Tree / list */}
      <div
        className="flex-1 overflow-y-auto px-1 pb-2"
        onClick={(e) => e.stopPropagation()}
      >
        {query ? (
          <>
            {filtered.length === 0 && (
              <p className="text-xs text-center text-gray-400 mt-8">No results.</p>
            )}
            {filtered.map((note) => (
              <FileTreeItem
                key={note.id}
                note={note}
                active={note.id === activeId}
                level={0}
                onClick={() => { openNote(note.id); onClose?.(); }}
                onDelete={() => deleteNote(note.id)}
              />
            ))}
          </>
        ) : (
          <>
            {rootFolders.length === 0 && rootNotes.length === 0 && !creating && (
              <p className="text-xs text-center text-gray-400 mt-8">
                No notes yet. Click + to create one.
              </p>
            )}

            {creating?.parentId === rootFolderId && (
              <InlineCreateInput
                type={creating.type}
                level={0}
                value={creatingName}
                onChange={setCreatingName}
                onConfirm={confirmCreate}
                onCancel={cancelCreate}
              />
            )}

            {rootFolders.map((folder) => (
              <FolderTreeItem
                key={folder.id}
                folder={folder}
                level={0}
                {...sharedFolderProps}
              />
            ))}

            {rootNotes.map((note) => (
              <FileTreeItem
                key={note.id}
                note={note}
                active={note.id === activeId}
                level={0}
                onClick={() => { openNote(note.id); onClose?.(); }}
                onDelete={() => deleteNote(note.id)}
                onPointerDown={isDesktop ? handleNotePointerDown : undefined}
              />
            ))}

            {isDragging && (
              <div
                data-root-drop
                className={clsx(
                  "mx-1 mt-1 rounded border-2 border-dashed text-xs text-center py-1.5 transition-colors select-none",
                  hoverRoot
                    ? "border-neutral-400 bg-neutral-100 dark:bg-neutral-700/50 text-neutral-500 dark:text-neutral-400"
                    : "border-neutral-300 dark:border-neutral-600 text-gray-400"
                )}
              >
                Move to root
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-neutral-200 dark:border-neutral-700 flex items-center gap-2">
        {user?.picture && (
          <img
            src={user.picture}
            alt={user.name}
            className="w-6 h-6 rounded-full shrink-0"
          />
        )}
        <span className="text-sm text-gray-500 dark:text-gray-400 truncate flex-1">
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

      {/* Drag ghost */}
      {dragGhost && (
        <div
          style={{
            position: "fixed",
            left: dragGhost.x + 12,
            top: dragGhost.y + 4,
            pointerEvents: "none",
            zIndex: 9999,
          }}
          className="flex items-center gap-1.5 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded px-2 py-1 text-xs shadow-lg opacity-90 max-w-48"
        >
          <FileText size={12} className="shrink-0 text-gray-400" />
          <span className="truncate">{dragGhost.title}</span>
        </div>
      )}
    </aside>
  );
}

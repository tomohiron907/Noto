import { useEffect, useRef, useState } from "react";
import {
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  LogOut,
  PenLine,
  Search,
  X,
} from "lucide-react";
import clsx from "clsx";
import { Tree } from "react-arborist";
import type { MoveHandler } from "react-arborist";
import { TouchBackend } from "react-dnd-touch-backend";
import { useNotesStore } from "../../stores/notesStore";
import { useAuthStore } from "../../stores/authStore";
import { tauriWindow } from "../../lib/tauri";
import ArboristNode, { type TreeNode, TREE_INDENT } from "../ui/ArboristNode";
import type { FolderMetadata, NoteMetadata } from "../../lib/types";

const LAST_NOTE_KEY = "noto_last_note_id";
const isDesktop = !("ontouchstart" in window || navigator.maxTouchPoints > 0);
const isNoteWindow = !!new URLSearchParams(window.location.search).get("noteId");

// Tauri WKWebView では HTML5 DnD (dragover.preventDefault) が機能しないため
// pointer/mouse イベントベースの TouchBackend を使う
const PointerBackend = (manager: Parameters<typeof TouchBackend>[0], context: Parameters<typeof TouchBackend>[1]) =>
  TouchBackend(manager, context, { enableMouseEvents: true, delayTouchStart: 50 });

type CreatingState = { type: "file" | "folder" | "ink"; parentId: string } | null;

function buildArboristTree(
  folders: FolderMetadata[],
  notes: NoteMetadata[],
  parentId: string
): TreeNode[] {
  const childFolders = folders.filter(
    (f) => f.parent_id === parentId && f.name !== ".noto"
  );
  const childNotes = notes.filter((n) => n.parent_id === parentId);
  return [
    ...childFolders.map((f) => ({
      id: `f:${f.id}`,
      name: f.name,
      children: buildArboristTree(folders, notes, f.id),
    })),
    ...childNotes.map((n) => ({
      id: `n:${n.id}`,
      name: n.title || "Untitled",
    })),
  ];
}

function InlineCreateInput({
  type,
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  type: "file" | "folder" | "ink";
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <div className="flex items-center gap-1.5 py-0.5 px-2 mb-1">
      {type === "folder" ? (
        <Folder size={13} className="shrink-0 text-gray-400" />
      ) : type === "ink" ? (
        <PenLine size={13} className="shrink-0 text-gray-400" />
      ) : (
        <FileText size={13} className="shrink-0 text-gray-400" />
      )}
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        onBlur={onConfirm}
        className="flex-1 text-sm bg-transparent outline-none border-b border-neutral-400 text-gray-700 dark:text-gray-200 min-w-0"
        placeholder={type === "folder" ? "Folder name…" : type === "ink" ? "Ink note name…" : "Note name…"}
      />
    </div>
  );
}

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
    moveNote,
    moveFolder,
    syncing,
    error,
  } = useNotesStore();
  const { user, signOut } = useAuthStore();

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<CreatingState>(null);
  const [creatingName, setCreatingName] = useState("");
  const cancelledRef = useRef(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [treeDims, setTreeDims] = useState({ width: 200, height: 400 });

  useEffect(() => {
    loadTree().then(() => {
      if (isNoteWindow) return;
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

  useEffect(() => {
    const el = treeContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setTreeDims({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const startCreating = (type: "file" | "folder" | "ink", parentId: string) => {
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
      const parentArg = current.parentId === rootFolderId ? undefined : current.parentId;
      await createFolder(name, parentArg);
    } else {
      const parentArg = current.parentId === rootFolderId ? undefined : current.parentId;
      const noteType = current.type === "ink" ? "ink" : "md";
      await createNote(parentArg, name, noteType);
      onClose?.();
    }
  };

  const cancelCreate = () => {
    cancelledRef.current = true;
    setCreating(null);
    setCreatingName("");
  };

  const handleMove: MoveHandler<TreeNode> = ({ dragIds, parentId }) => {
    const newParentLocalId = parentId ? parentId.slice(2) : rootFolderId!;
    for (const dragId of dragIds) {
      const localId = dragId.slice(2);
      if (dragId.startsWith("f:")) {
        moveFolder(localId, newParentLocalId);
      } else {
        moveNote(localId, "", newParentLocalId);
      }
    }
  };

  const treeData = rootFolderId
    ? buildArboristTree(folders, notes, rootFolderId)
    : [];

  const filtered = notes.filter((n) =>
    n.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <aside
      className="flex flex-col h-full bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700"
      style={{ width: "var(--sidebar-width)", flexShrink: 0 }}
    >
      {/* Drag region + title */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-3 border-b border-neutral-200 dark:border-neutral-700 relative z-10"
        style={{
          paddingTop: "max(var(--titlebar-height), env(safe-area-inset-top, 0px))",
          minHeight: "calc(max(var(--titlebar-height), env(safe-area-inset-top, 0px)) + 20px)",
        }}
      >
        <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 select-none pl-16">
          {syncing ? "Saving…" : "Notes"}
        </span>

        <div className="flex items-center gap-0.5 z-20">
          <button
            onClick={(e) => {
              e.stopPropagation();
              startCreating("file", rootFolderId ?? "");
            }}
            disabled={syncing || !rootFolderId}
            className="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-gray-500 dark:text-gray-400 transition-colors disabled:opacity-40"
            aria-label="New file"
            title="New file (⌘N)"
          >
            <FilePlus size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              startCreating("ink", rootFolderId ?? "");
            }}
            disabled={syncing || !rootFolderId}
            className="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-gray-500 dark:text-gray-400 transition-colors disabled:opacity-40"
            aria-label="New ink note"
            title="New ink note"
          >
            <PenLine size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              startCreating("folder", rootFolderId ?? "");
            }}
            disabled={syncing || !rootFolderId}
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
      <div className="flex-1 overflow-hidden px-1 pb-2 flex flex-col">
        {query ? (
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-xs text-center text-gray-400 mt-8">No results.</p>
            )}
            {filtered.map((note) => (
              <div
                key={note.id}
                onClick={() => { openNote(note.id); onClose?.(); }}
                className={clsx(
                  "flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer select-none text-sm",
                  note.id === activeId
                    ? "bg-neutral-200/80 dark:bg-white/10 text-gray-900 dark:text-gray-100"
                    : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/60"
                )}
              >
                <FileText size={13} className="shrink-0 text-gray-400" />
                <span className="truncate">{note.title || "Untitled"}</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            {creating && (
              <InlineCreateInput
                type={creating.type}
                value={creatingName}
                onChange={setCreatingName}
                onConfirm={confirmCreate}
                onCancel={cancelCreate}
              />
            )}
            {treeData.length === 0 && !creating && (
              <p className="text-xs text-center text-gray-400 mt-8">
                No notes yet. Click + to create one.
              </p>
            )}
            <div ref={treeContainerRef} className="flex-1">
              <Tree<TreeNode>
                data={treeData}
                onMove={handleMove}
                dndBackend={isDesktop ? PointerBackend : undefined}
                disableDrop={!isDesktop}
                disableDrag={!isDesktop}
                rowHeight={30}
                indent={TREE_INDENT}
                openByDefault={false}
                width={treeDims.width}
                height={treeDims.height}
              >
                {(props) => (
                  <ArboristNode
                    {...props}
                    activeNoteId={activeId}
                    isDesktop={isDesktop}
                    onNoteClick={(id) => { openNote(id); onClose?.(); }}
                    onNoteDelete={deleteNote}
                    onFolderDelete={deleteFolder}
                    onStartCreating={startCreating}
                    onNoteOpenInWindow={
                      isDesktop
                        ? (id) => {
                            const note = notes.find((n) => n.id === id);
                            tauriWindow.openNoteWindow(id, note?.title ?? "").catch(() => {});
                          }
                        : undefined
                    }
                  />
                )}
              </Tree>
            </div>
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
    </aside>
  );
}

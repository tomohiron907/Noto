import { useState, useEffect } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Trash2,
  FileText,
} from "lucide-react";
import clsx from "clsx";
import type { FolderMetadata, NoteMetadata } from "../../lib/types";
import FileTreeItem from "./FileTreeItem";

export type CreatingState = {
  type: "file" | "folder";
  parentId: string;
} | null;

interface InlineInputProps {
  type: "file" | "folder";
  level: number;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function InlineCreateInput({
  type,
  level,
  value,
  onChange,
  onConfirm,
  onCancel,
}: InlineInputProps) {
  return (
    <div
      style={{ paddingLeft: level * 12 + 20 }}
      className="flex items-center gap-1.5 pr-2 py-0.5"
    >
      {type === "folder" ? (
        <Folder size={13} className="shrink-0 text-gray-400" />
      ) : (
        <FileText size={13} className="shrink-0 text-gray-400" />
      )}
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={onConfirm}
        placeholder={type === "folder" ? "folder name" : "file name"}
        className="flex-1 text-xs bg-transparent border-b border-blue-400 outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400 min-w-0"
      />
    </div>
  );
}

interface Props {
  folder: FolderMetadata;
  allFolders: FolderMetadata[];
  allNotes: NoteMetadata[];
  activeNoteId: string | null;
  activeFolderId: string | null;
  level: number;
  creating: CreatingState;
  creatingName: string;
  onNoteClick: (id: string) => void;
  onNoteDelete: (id: string) => void;
  onFolderDelete: (id: string) => void;
  onFolderActivate: (id: string) => void;
  onStartCreating: (type: "file" | "folder", parentId: string) => void;
  onConfirmCreate: () => void;
  onCancelCreate: () => void;
  onCreatingNameChange: (v: string) => void;
  onNotePointerDown?: (noteId: string, e: React.PointerEvent) => void;
  dragOverFolderId?: string | null;
}

export default function FolderTreeItem({
  folder,
  allFolders,
  allNotes,
  activeNoteId,
  activeFolderId,
  level,
  creating,
  creatingName,
  onNoteClick,
  onNoteDelete,
  onFolderDelete,
  onFolderActivate,
  onStartCreating,
  onConfirmCreate,
  onCancelCreate,
  onCreatingNameChange,
  onNotePointerDown,
  dragOverFolderId,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  const childFolders = allFolders.filter((f) => f.parent_id === folder.id);
  const childNotes = allNotes.filter((n) => n.parent_id === folder.id);
  const isActive = activeFolderId === folder.id;
  const isDragOver = dragOverFolderId === folder.id;

  // Auto-expand collapsed folder when dragging over it
  useEffect(() => {
    if (!isDragOver || expanded) return;
    const timer = setTimeout(() => setExpanded(true), 600);
    return () => clearTimeout(timer);
  }, [isDragOver, expanded]);

  const sharedProps = {
    allFolders,
    allNotes,
    activeNoteId,
    activeFolderId,
    creating,
    creatingName,
    onNoteClick,
    onNoteDelete,
    onFolderDelete,
    onFolderActivate,
    onStartCreating,
    onConfirmCreate,
    onCancelCreate,
    onCreatingNameChange,
    onNotePointerDown,
    dragOverFolderId,
  };

  return (
    <div data-folder-id={folder.id}>
      {/* Folder row */}
      <div
        style={{ paddingLeft: level * 12 + 4 }}
        className={clsx(
          "group flex items-center gap-0.5 pr-1 py-0.5 rounded cursor-pointer select-none",
          isActive
            ? "bg-neutral-200/80 dark:bg-white/10 text-gray-900 dark:text-gray-100"
            : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/60",
          isDragOver && "ring-1 ring-inset ring-blue-400 bg-blue-50/50 dark:bg-blue-900/20"
        )}
      >
        {/* Chevron — toggle expand */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((x) => !x);
          }}
          className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 shrink-0"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <ChevronRight
            size={12}
            className={clsx(
              "transition-transform duration-150",
              expanded && "rotate-90"
            )}
          />
        </button>

        {/* Folder icon + name */}
        <div
          className="flex items-center gap-1 flex-1 min-w-0"
          onClick={() => {
            setExpanded((x) => !x);
            onFolderActivate(folder.id);
          }}
        >
          {expanded ? (
            <FolderOpen size={13} className="shrink-0 text-gray-400 dark:text-gray-500" />
          ) : (
            <Folder size={13} className="shrink-0 text-gray-400 dark:text-gray-500" />
          )}
          <span className="text-xs truncate min-w-0">{folder.name}</span>
        </div>

        {/* Hover action buttons */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartCreating("file", folder.id);
              setExpanded(true);
            }}
            className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="New File"
          >
            <FilePlus size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartCreating("folder", folder.id);
              setExpanded(true);
            }}
            className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="New Folder"
          >
            <FolderPlus size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFolderDelete(folder.id);
            }}
            className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 text-gray-400 hover:text-red-500"
            title="Delete Folder"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Expanded contents */}
      {expanded && (
        <div>
          {creating?.parentId === folder.id && (
            <InlineCreateInput
              type={creating.type}
              level={level + 1}
              value={creatingName}
              onChange={onCreatingNameChange}
              onConfirm={onConfirmCreate}
              onCancel={onCancelCreate}
            />
          )}

          {childFolders.map((child) => (
            <FolderTreeItem
              key={child.id}
              folder={child}
              level={level + 1}
              {...sharedProps}
            />
          ))}

          {childNotes.map((note) => (
            <FileTreeItem
              key={note.id}
              note={note}
              active={note.id === activeNoteId}
              level={level + 1}
              onClick={() => onNoteClick(note.id)}
              onDelete={() => onNoteDelete(note.id)}
              onPointerDown={onNotePointerDown}
            />
          ))}
        </div>
      )}
    </div>
  );
}

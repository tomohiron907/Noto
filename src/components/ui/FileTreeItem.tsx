import { FileText, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { NoteMetadata } from "../../lib/types";

interface Props {
  note: NoteMetadata;
  active: boolean;
  level: number;
  onClick: () => void;
  onDelete: () => void;
  onPointerDown?: (noteId: string, e: React.PointerEvent) => void;
}

export default function FileTreeItem({
  note,
  active,
  level,
  onClick,
  onDelete,
  onPointerDown,
}: Props) {
  return (
    <div
      onPointerDown={onPointerDown ? (e) => onPointerDown(note.id, e) : undefined}
      onClick={onClick}
      style={{ paddingLeft: level * 12 + 20 }}
      className={clsx(
        "group flex items-center gap-1.5 pr-1 py-0.5 rounded select-none",
        onPointerDown ? "cursor-grab" : "cursor-pointer",
        active
          ? "bg-neutral-200/80 dark:bg-white/10 text-gray-900 dark:text-gray-100"
          : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/60"
      )}
    >
      <FileText
        size={13}
        className={clsx(
          "shrink-0",
          active ? "text-gray-500 dark:text-gray-400" : "text-gray-400 dark:text-gray-500"
        )}
      />
      <span className="flex-1 text-xs truncate min-w-0">{note.title || "Untitled"}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:text-red-500 text-gray-400 transition-opacity"
        aria-label="Delete note"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

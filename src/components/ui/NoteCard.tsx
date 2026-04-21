import { formatDistanceToNow } from "date-fns";
import { Trash2 } from "lucide-react";
import clsx from "clsx";
import type { NoteMetadata } from "../../lib/types";

interface Props {
  note: NoteMetadata;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}

export default function NoteCard({ note, active, onClick, onDelete }: Props) {
  const ago = formatDistanceToNow(new Date(note.modified_time), {
    addSuffix: true,
  });

  return (
    <div
      onClick={onClick}
      className={clsx(
        "group flex items-start justify-between gap-2 px-3 py-2.5 rounded-lg cursor-pointer select-none",
        active
          ? "bg-gray-200/70 dark:bg-white/10"
          : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
      )}
    >
      <div className="min-w-0">
        <p
          className={clsx(
            "text-sm font-medium truncate",
            active
              ? "text-gray-900 dark:text-gray-100"
              : "text-neutral-800 dark:text-neutral-200"
          )}
        >
          {note.title || "Untitled"}
        </p>
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">{ago}</p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded hover:text-red-500 text-gray-400 transition-opacity"
        aria-label="Delete note"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

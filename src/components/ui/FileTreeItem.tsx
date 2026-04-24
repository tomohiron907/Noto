import { useState, useEffect } from "react";
import { FileText, Trash2, ExternalLink } from "lucide-react";
import clsx from "clsx";
import type { NoteMetadata } from "../../lib/types";

interface Props {
  note: NoteMetadata;
  active: boolean;
  level: number;
  onClick: () => void;
  onDelete: () => void;
  onPointerDown?: (noteId: string, e: React.PointerEvent) => void;
  onOpenInWindow?: () => void;
}

export default function FileTreeItem({
  note,
  active,
  level,
  onClick,
  onDelete,
  onPointerDown,
  onOpenInWindow,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onOpenInWindow) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("contextmenu", close);
    document.addEventListener("sidebar:closed", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
      document.removeEventListener("sidebar:closed", close);
    };
  }, [menu]);

  return (
    <>
      <div
        onPointerDown={onPointerDown ? (e) => onPointerDown(note.id, e) : undefined}
        onClick={onClick}
        onContextMenu={handleContextMenu}
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
        <span className="flex-1 text-sm truncate min-w-0">{note.title || "Untitled"}</span>
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

      {menu && (
        <div
          style={{ position: "fixed", left: menu.x, top: menu.y }}
          className="z-[9999] bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-600 rounded-lg shadow-lg py-1 min-w-[180px]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { onOpenInWindow?.(); setMenu(null); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 text-left"
          >
            <ExternalLink size={13} className="shrink-0 text-gray-400" />
            Open in New Window
          </button>
        </div>
      )}
    </>
  );
}

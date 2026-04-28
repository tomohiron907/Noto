import { useEffect, useState } from "react";
import type { NodeRendererProps } from "react-arborist";
import {
  ChevronRight,
  FileText,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Trash2,
  ExternalLink,
} from "lucide-react";
import clsx from "clsx";

export const TREE_INDENT = 16;

export interface TreeNode {
  id: string; // "f:<localId>" | "n:<localId>"
  name: string;
  children?: TreeNode[];
}

interface NodeCallbacks {
  activeNoteId: string | null;
  isDesktop: boolean;
  onNoteClick: (id: string) => void;
  onNoteDelete: (id: string) => void;
  onFolderDelete: (id: string) => void;
  onStartCreating: (type: "file" | "folder", parentId: string) => void;
  onNoteOpenInWindow?: (id: string) => void;
}

type Props = NodeRendererProps<TreeNode> & NodeCallbacks;

export default function ArboristNode({
  node,
  style,
  dragHandle,
  activeNoteId,
  isDesktop,
  onNoteClick,
  onNoteDelete,
  onFolderDelete,
  onStartCreating,
  onNoteOpenInWindow,
}: Props) {
  const isFolder = node.data.id.startsWith("f:");
  const localId = node.data.id.slice(2);
  const isActive = !isFolder && localId === activeNoteId;
  const isDragOver = node.state.willReceiveDrop;

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("contextmenu", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  if (isFolder) {
    return (
      <div
        style={style}
        ref={dragHandle}
        className={clsx(
          "group relative flex items-center gap-0.5 pr-1 py-1 rounded cursor-pointer select-none",
          isActive
            ? "bg-neutral-200/80 dark:bg-white/10 text-gray-900 dark:text-gray-100"
            : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/60",
          isDragOver &&
            "ring-1 ring-inset ring-neutral-400 bg-neutral-200/60 dark:ring-neutral-500 dark:bg-neutral-600/40"
        )}
      >
        {Array.from({ length: node.level }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-neutral-200 dark:bg-neutral-700/60"
            style={{ left: i * TREE_INDENT + TREE_INDENT / 2 }}
          />
        ))}
        <button
          onClick={(e) => {
            e.stopPropagation();
            node.toggle();
          }}
          className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 shrink-0"
          aria-label={node.isOpen ? "Collapse" : "Expand"}
        >
          <ChevronRight
            size={12}
            className={clsx(
              "transition-transform duration-150",
              node.isOpen && "rotate-90"
            )}
          />
        </button>

        <div
          className="flex items-center gap-1 flex-1 min-w-0"
          onClick={() => node.toggle()}
        >
          {node.isOpen ? (
            <FolderOpen size={13} className="shrink-0 text-gray-400 dark:text-gray-500" />
          ) : (
            <Folder size={13} className="shrink-0 text-gray-400 dark:text-gray-500" />
          )}
          <span className="text-sm truncate min-w-0 font-medium">{node.data.name}</span>
        </div>

        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartCreating("file", localId);
              node.open();
            }}
            className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="New File"
          >
            <FilePlus size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartCreating("folder", localId);
              node.open();
            }}
            className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="New Folder"
          >
            <FolderPlus size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFolderDelete(localId);
            }}
            className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 text-gray-400 hover:text-red-500"
            title="Delete Folder"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  }

  // Note node
  return (
    <>
      <div
        style={style}
        ref={dragHandle}
        onClick={() => onNoteClick(localId)}
        onContextMenu={
          isDesktop && onNoteOpenInWindow
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY });
              }
            : undefined
        }
        className={clsx(
          "group relative flex items-center gap-1.5 pr-1 py-1 rounded select-none",
          isDesktop ? "cursor-grab" : "cursor-pointer",
          isActive
            ? "bg-neutral-200/80 dark:bg-white/10 text-gray-900 dark:text-gray-100"
            : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/60"
        )}
      >
        {Array.from({ length: node.level }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-neutral-200 dark:bg-neutral-700/60"
            style={{ left: i * TREE_INDENT + TREE_INDENT / 2 }}
          />
        ))}
        <FileText
          size={13}
          className={clsx(
            "shrink-0",
            isActive ? "text-gray-500 dark:text-gray-400" : "text-gray-400 dark:text-gray-500"
          )}
        />
        <span className="flex-1 text-sm truncate min-w-0">{node.data.name}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNoteDelete(localId);
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
            onClick={() => {
              onNoteOpenInWindow?.(localId);
              setMenu(null);
            }}
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

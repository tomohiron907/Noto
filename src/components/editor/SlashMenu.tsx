import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare, Code2, Table as TableIcon, Minus,
} from "lucide-react";
import clsx from "clsx";

interface SlashItem {
  label: string;
  description: string;
  icon: React.ReactNode;
  action: (editor: Editor) => void;
}

const ITEMS: SlashItem[] = [
  { label: "Heading 1", description: "Large heading", icon: <Heading1 size={15} />, action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: "Heading 2", description: "Medium heading", icon: <Heading2 size={15} />, action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "Heading 3", description: "Small heading", icon: <Heading3 size={15} />, action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: "Bullet List", description: "Unordered list", icon: <List size={15} />, action: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "Numbered List", description: "Ordered list", icon: <ListOrdered size={15} />, action: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "Task List", description: "Checkboxes", icon: <CheckSquare size={15} />, action: (e) => e.chain().focus().toggleTaskList().run() },
  { label: "Code Block", description: "Syntax-highlighted code", icon: <Code2 size={15} />, action: (e) => e.chain().focus().toggleCodeBlock().run() },
  { label: "Table", description: "3×3 table", icon: <TableIcon size={15} />, action: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: "Divider", description: "Horizontal rule", icon: <Minus size={15} />, action: (e) => e.chain().focus().setHorizontalRule().run() },
];

interface Props {
  editor: Editor;
}

export default function SlashMenu({ editor }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerFrom = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!open) {
        if (e.key === "/") {
          // Only open if cursor is at start of empty paragraph
          const { $from } = editor.state.selection;
          if ($from.parent.textContent === "") {
            const rect = editor.view.coordsAtPos($from.pos);
            setPos({ top: rect.bottom + window.scrollY + 4, left: rect.left });
            triggerFrom.current = $from.pos;
            setOpen(true);
            setQuery("");
            setCursor(0);
          }
        }
        return;
      }

      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "Backspace") {
        if (query.length > 0) { setQuery((q) => q.slice(0, -1)); }
        else { setOpen(false); }
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
      if (e.key === "Enter") { e.preventDefault(); confirmItem(filtered[cursor]); return; }
      if (e.key.length === 1) { setQuery((q) => q + e.key); }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const filtered = ITEMS.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase())
  );

  function confirmItem(item?: SlashItem) {
    if (!item || triggerFrom.current == null) return;
    setOpen(false);
    // Delete the "/" and any typed query
    const from = triggerFrom.current;
    const to = editor.state.selection.from;
    editor.chain().focus().deleteRange({ from, to }).run();
    item.action(editor);
  }

  if (!open || filtered.length === 0) return null;

  return (
    <div
      ref={containerRef}
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 50 }}
      className="w-60 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden py-1"
    >
      {filtered.map((item, i) => (
        <button
          key={item.label}
          onMouseDown={(e) => { e.preventDefault(); confirmItem(item); }}
          className={clsx(
            "flex items-center gap-3 w-full px-3 py-2 text-left transition-colors",
            i === cursor
              ? "bg-blue-50 dark:bg-blue-900/30"
              : "hover:bg-gray-50 dark:hover:bg-gray-700"
          )}
        >
          <span className="text-gray-500 dark:text-gray-400 shrink-0">{item.icon}</span>
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.label}</p>
            <p className="text-xs text-gray-400">{item.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare, Code2, Table as TableIcon, Minus,
  Text, ImageIcon,
} from "lucide-react";
import clsx from "clsx";
import { tauriAssets } from "../../lib/tauri";

interface SlashItem {
  label: string;
  description: string;
  icon: React.ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: (editor: Editor) => any;
}

const ITEMS: SlashItem[] = [
  { label: "Text", description: "Plain paragraph", icon: <Text size={15} />, action: (e) => e.chain().focus().setParagraph().run() },
  { label: "Heading 1", description: "Large heading", icon: <Heading1 size={15} />, action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: "Heading 2", description: "Medium heading", icon: <Heading2 size={15} />, action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "Heading 3", description: "Small heading", icon: <Heading3 size={15} />, action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: "Bullet List", description: "Unordered list", icon: <List size={15} />, action: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "Numbered List", description: "Ordered list", icon: <ListOrdered size={15} />, action: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "To-do List", description: "Checkboxes", icon: <CheckSquare size={15} />, action: (e) => e.chain().focus().toggleTaskList().run() },
  { label: "Code Block", description: "Syntax-highlighted code", icon: <Code2 size={15} />, action: (e) => e.chain().focus().toggleCodeBlock().run() },
  { label: "Table", description: "3×3 table", icon: <TableIcon size={15} />, action: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: "Divider", description: "Horizontal rule", icon: <Minus size={15} />, action: (e) => e.chain().focus().setHorizontalRule().run() },
  {
    label: "Image",
    description: "Insert image from file",
    icon: <ImageIcon size={15} />,
    action: (editor) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;

        const blobUrl = URL.createObjectURL(file);
        const uploadId = `upload-${Date.now()}`;
        const insertPos = editor.state.selection.from;

        // Insert immediately with blob URL so the image shows right away
        const node = editor.state.schema.nodes.image?.create({
          src: blobUrl,
          uploadId,
        });
        if (node) {
          editor.view.dispatch(editor.state.tr.insert(insertPos, node));
        }

        // Upload in background, then swap src to noto-asset://
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          if (!base64) return;
          try {
            const driveId = await tauriAssets.upload(base64, file.type, file.name);
            // Find the node by uploadId and update its src
            editor.state.doc.descendants((n, pos) => {
              if (n.type.name === "image" && n.attrs.uploadId === uploadId) {
                editor.view.dispatch(
                  editor.state.tr.setNodeMarkup(pos, undefined, {
                    ...n.attrs,
                    src: `noto-asset://${driveId}`,
                    uploadId: null,
                  }),
                );
                return false;
              }
            });
            URL.revokeObjectURL(blobUrl);
          } catch (e) {
            console.error("Image upload failed", e);
          }
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },
  },
];

interface Props {
  editor: Editor;
}

export default function SlashMenu({ editor }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!open) {
        if (e.key === "/") {
          const { $from } = editor.state.selection;
          const coords = editor.view.coordsAtPos($from.pos);
          setPos({ top: coords.bottom + 4, left: coords.left });
          setOpen(true);
          setQuery("");
          setCursor(0);
        }
        return;
      }

      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "Backspace") {
        if (query.length > 0) { setQuery((q) => q.slice(0, -1)); }
        else { setOpen(false); }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
        return;
      }
      if (e.key === "Enter") { e.preventDefault(); confirmItem(filtered[cursor]); return; }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { setQuery((q) => q + e.key); }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const filtered = ITEMS.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase())
  );

  // Auto-close if no matches
  useEffect(() => {
    if (open && filtered.length === 0) setOpen(false);
  }, [open, filtered.length]);

  // Reset cursor when filter changes
  useEffect(() => {
    setCursor(0);
  }, [query]);

  function confirmItem(item?: SlashItem) {
    if (!item) return;
    setOpen(false);

    const { from: to } = editor.state.selection;
    // "/" (1文字) + queryの長さ分だけカーソルの前を削除
    const from = to - query.length - 1;

    editor
      .chain()
      .focus()
      .deleteRange({ from: Math.max(0, from), to })
      .run();

    item.action(editor);
  }

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 50 }}
      className="w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden py-1.5"
    >
      {query && (
        <p className="px-3 pt-0.5 pb-1 text-xs text-gray-400">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{query}"
        </p>
      )}
      {filtered.map((item, i) => (
        <button
          key={item.label}
          onMouseDown={(e) => { e.preventDefault(); confirmItem(item); }}
          className={clsx(
            "flex items-center gap-3 w-full px-3 py-2 text-left transition-colors",
            i === cursor
              ? "bg-blue-50 dark:bg-blue-900/30"
              : "hover:bg-gray-50 dark:hover:bg-gray-800"
          )}
        >
          <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 shrink-0">
            {item.icon}
          </span>
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-tight">{item.label}</p>
            <p className="text-xs text-gray-400 leading-tight">{item.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

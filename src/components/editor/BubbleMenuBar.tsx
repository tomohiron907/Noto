import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline, Strikethrough, Highlighter, Code, Link,
  Heading1, Heading2, Heading3,
} from "lucide-react";
import clsx from "clsx";

interface Props {
  editor: Editor;
}

export default function BubbleMenuBar({ editor }: Props) {
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const { selection } = editor.state;
      if (selection.empty || !editor.isEditable) {
        setVisible(false);
        return;
      }

      const { from, to } = selection;
      const startCoords = editor.view.coordsAtPos(from);
      const endCoords = editor.view.coordsAtPos(to);

      const midX = (startCoords.left + endCoords.right) / 2;
      const topY = Math.min(startCoords.top, endCoords.top);

      setStyle({
        position: "fixed",
        top: topY - 48,
        left: midX,
        transform: "translateX(-50%)",
        zIndex: 50,
      });
      setVisible(true);
    };

    const hide = () => setVisible(false);

    editor.on("selectionUpdate", update);
    editor.on("blur", hide);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("blur", hide);
    };
  }, [editor]);

  const btn = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    active: boolean
  ) => (
    <button
      key={label}
      onMouseDown={(e) => { e.preventDefault(); action(); }}
      aria-label={label}
      title={label}
      className={clsx(
        "p-1.5 rounded transition-colors",
        active
          ? "bg-gray-100 dark:bg-gray-700 text-blue-500 dark:text-blue-400"
          : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
      )}
    >
      {icon}
    </button>
  );

  if (!visible) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={style}
      className="flex items-center gap-0.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-1"
    >
      {btn("Bold", <Bold size={14} />, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
      {btn("Italic", <Italic size={14} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
      {btn("Underline", <Underline size={14} />, () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"))}
      {btn("Strikethrough", <Strikethrough size={14} />, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}

      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5" />

      {btn("Highlight", <Highlighter size={14} />, () => editor.chain().focus().toggleHighlight().run(), editor.isActive("highlight"))}
      {btn("Code", <Code size={14} />, () => editor.chain().focus().toggleCode().run(), editor.isActive("code"))}
      {btn("Link", <Link size={14} />, () => {
        const url = window.prompt("URL");
        if (url) editor.chain().focus().setLink({ href: url }).run();
      }, editor.isActive("link"))}

      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5" />

      {btn("H1", <Heading1 size={14} />, () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }))}
      {btn("H2", <Heading2 size={14} />, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
      {btn("H3", <Heading3 size={14} />, () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}
    </div>,
    document.body
  );
}

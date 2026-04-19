import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline, Highlighter, Link, Code,
  Heading1, Heading2, Heading3, List, ListOrdered,
  CheckSquare, Code2, Table, Minus,
} from "lucide-react";
import clsx from "clsx";

interface Props {
  editor: Editor;
}

export default function EditorToolbar({ editor }: Props) {
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
          ? "bg-gray-100 dark:bg-gray-700 text-blue-600 dark:text-blue-400"
          : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
      )}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-gray-100 dark:border-gray-800 flex-wrap">
      {btn("Heading 1", <Heading1 size={15} />, () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }))}
      {btn("Heading 2", <Heading2 size={15} />, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
      {btn("Heading 3", <Heading3 size={15} />, () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}

      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />

      {btn("Bold", <Bold size={15} />, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
      {btn("Italic", <Italic size={15} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
      {btn("Underline", <Underline size={15} />, () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"))}
      {btn("Highlight", <Highlighter size={15} />, () => editor.chain().focus().toggleHighlight().run(), editor.isActive("highlight"))}
      {btn("Inline Code", <Code size={15} />, () => editor.chain().focus().toggleCode().run(), editor.isActive("code"))}
      {btn("Link", <Link size={15} />, () => {
        const url = window.prompt("URL");
        if (url) editor.chain().focus().setLink({ href: url }).run();
      }, editor.isActive("link"))}

      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />

      {btn("Bullet List", <List size={15} />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
      {btn("Numbered List", <ListOrdered size={15} />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
      {btn("Task List", <CheckSquare size={15} />, () => editor.chain().focus().toggleTaskList().run(), editor.isActive("taskList"))}

      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />

      {btn("Code Block", <Code2 size={15} />, () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
      {btn("Table", <Table size={15} />, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), false)}
      {btn("Divider", <Minus size={15} />, () => editor.chain().focus().setHorizontalRule().run(), false)}
    </div>
  );
}

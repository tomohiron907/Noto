import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { useNotesStore } from "../../stores/notesStore";
import { useAutoSave } from "../../hooks/useAutoSave";
import { extensions } from "./extensions";
import BubbleMenuBar from "./BubbleMenuBar";
import SlashMenu from "./SlashMenu";

function getMarkdown(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return "";
  const storage = editor.storage as Record<string, any>;
  return storage?.markdown?.getMarkdown?.() ?? editor.getText();
}

export default function NoteEditor() {
  const { activeId, activeContent, activeTitle, markDirty, setActiveTitle, syncing, dirty, loading } =
    useNotesStore();
  useAutoSave();

  const suppressUpdate = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const editor = useEditor({
    extensions,
    content: "",
    onUpdate: ({ editor }) => {
      if (suppressUpdate.current) return;
      markDirty(getMarkdown(editor));
    },
    editorProps: {
      attributes: {
        class: "notion-editor focus:outline-none min-h-[60vh]",
      },
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = getMarkdown(editor);
    if (current === activeContent) return;

    suppressUpdate.current = true;
    editor.commands.setContent(activeContent || "");
    suppressUpdate.current = false;
  }, [activeId, activeContent, editor]);

  // Auto-resize title textarea
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [activeTitle]);

  const wordCount = editor
    ? (editor.storage as Record<string, any>)?.characterCount?.words?.() ?? 0
    : 0;

  const statusText = syncing ? "Saving…" : dirty ? "Unsaved" : "Saved";

  if (!editor) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <BubbleMenuBar editor={editor} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-16 py-10">
          {/* Note title */}
          <textarea
            ref={titleRef}
            value={activeTitle}
            onChange={(e) => {
              setActiveTitle(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editor.commands.focus("start");
              }
            }}
            placeholder="Untitled"
            rows={1}
            className="w-full resize-none overflow-hidden bg-transparent text-4xl font-bold text-gray-900 dark:text-gray-100 outline-none mb-4 leading-tight placeholder-gray-300 dark:placeholder-gray-600"
          />

          {/* Editor body */}
          <SlashMenu editor={editor} />
          {loading && !activeContent ? (
            <div className="animate-pulse space-y-3 mt-4">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
            </div>
          ) : (
            <EditorContent editor={editor} />
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="shrink-0 flex items-center justify-end gap-4 px-6 py-1.5 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400">
        <span>{wordCount} words</span>
        <span className={syncing ? "text-blue-500" : dirty ? "text-amber-500" : ""}>
          {statusText}
        </span>
      </div>
    </div>
  );
}

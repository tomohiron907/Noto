import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { useNotesStore } from "../../stores/notesStore";
import { useAutoSave } from "../../hooks/useAutoSave";
import { extensions } from "./extensions";
import EditorToolbar from "./EditorToolbar";
import SlashMenu from "./SlashMenu";

function getMarkdown(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return "";
  const storage = editor.storage as Record<string, any>;
  return storage?.markdown?.getMarkdown?.() ?? editor.getText();
}

export default function NoteEditor() {
  const { activeId, activeContent, markDirty, syncing, dirty } = useNotesStore();
  useAutoSave();

  const suppressUpdate = useRef(false);

  const editor = useEditor({
    extensions,
    content: "",
    onUpdate: ({ editor }) => {
      if (suppressUpdate.current) return;
      markDirty(getMarkdown(editor));
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-gray dark:prose-invert max-w-none focus:outline-none px-16 py-10 min-h-full",
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

  const wordCount = editor
    ? (editor.storage as Record<string, any>)?.characterCount?.words?.() ?? 0
    : 0;

  const statusText = syncing ? "Saving…" : dirty ? "Unsaved" : "Saved";

  if (!editor) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <EditorToolbar editor={editor} />
      <div className="flex-1 overflow-y-auto relative">
        <SlashMenu editor={editor} />
        <EditorContent editor={editor} className="h-full" />
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

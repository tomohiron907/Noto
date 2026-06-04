import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Cloud, CloudOff, CloudUpload, CheckCircle2 } from "lucide-react";
import { useNotesStore } from "../../stores/notesStore";
import { useAutoSave } from "../../hooks/useAutoSave";
import { extensions } from "./extensions";
import BubbleMenuBar from "./BubbleMenuBar";
import SlashMenu from "./SlashMenu";
import RevisionHistoryPanel from "./RevisionHistoryPanel";

function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function getMarkdown(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return "";
  const storage = editor.storage as Record<string, any>;
  return storage?.markdown?.getMarkdown?.() ?? editor.getText();
}

export default function NoteEditor() {
  const { activeId, activeContent, activeTitle, markDirty, setActiveTitle,
          syncing, dirty, loading, driveSync, driveSyncError, lastSyncAt, hasPendingDrive } =
    useNotesStore();
  useAutoSave();

  const suppressUpdate = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const statusBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!historyOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (statusBarRef.current && !statusBarRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [historyOpen]);

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

  // Derive combined Drive sync status
  const driveStatus = (() => {
    if (dirty || syncing) return { label: syncing ? "Saving…" : "Editing", color: dirty ? "text-amber-500" : "text-blue-500", icon: null };
    if (driveSync === 'syncing') return { label: "Syncing…", color: "text-blue-500", icon: <CloudUpload size={12} className="shrink-0" /> };
    if (driveSync === 'error') return { label: driveSyncError ?? "Drive sync failed", color: "text-red-500", icon: <CloudOff size={12} className="shrink-0" /> };
    if (hasPendingDrive) return { label: "Saved · Pending", color: "text-amber-500", icon: <Cloud size={12} className="shrink-0" /> };
    return {
      label: lastSyncAt ? `Synced · ${formatRelativeTime(lastSyncAt)}` : "Synced",
      color: "text-green-500",
      icon: <CheckCircle2 size={12} className="shrink-0" />,
    };
  })();

  if (!editor) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <BubbleMenuBar editor={editor} />

      <div className="flex-1 overflow-y-auto">
        <div className="w-full sm:max-w-[720px] mx-auto px-8 sm:px-16 py-6 sm:py-10">
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
      <div
        ref={statusBarRef}
        className="relative shrink-0 flex items-center justify-end gap-4 px-6 py-1.5 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400"
      >
        {historyOpen && activeId && (
          <RevisionHistoryPanel activeId={activeId} onClose={() => setHistoryOpen(false)} />
        )}
        <span>{wordCount} words</span>
        <button
          onClick={() => activeId && setHistoryOpen((v) => !v)}
          disabled={!activeId}
          className={`flex items-center gap-1 ${driveStatus.color} ${activeId ? "cursor-pointer hover:opacity-70 transition-opacity" : "cursor-default"}`}
        >
          {driveStatus.icon}
          {driveStatus.label}
        </button>
      </div>
    </div>
  );
}

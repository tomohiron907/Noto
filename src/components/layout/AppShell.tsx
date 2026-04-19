import Sidebar from "./Sidebar";
import NoteEditor from "../editor/NoteEditor";
import { useNotesStore } from "../../stores/notesStore";

export default function AppShell() {
  const { activeId } = useNotesStore();

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-950">
      <Sidebar />
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {/* Drag region across the top of the editor pane */}
        <div
          data-tauri-drag-region
          className="shrink-0 bg-white dark:bg-gray-950"
          style={{ height: "var(--titlebar-height)" }}
        />
        {activeId ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            <NoteEditor />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm select-none">
            Select a note or press ⌘N to create one
          </div>
        )}
      </main>
    </div>
  );
}

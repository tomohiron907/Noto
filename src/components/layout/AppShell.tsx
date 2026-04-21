import { useState } from "react";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";
import NoteEditor from "../editor/NoteEditor";
import { useNotesStore } from "../../stores/notesStore";

export default function AppShell() {
  const { activeId } = useNotesStore();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-transparent relative border border-white/20 rounded-[10px] box-border">
      {/* Overlay when sidebar is open */}
      {isSidebarOpen && (
        <div 
          className="absolute inset-0 bg-black/20 dark:bg-black/40 z-40 transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar Drawer */}
      <div 
        className={`absolute inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onClose={() => setIsSidebarOpen(false)} />
      </div>

      <main className="flex-1 overflow-hidden flex flex-col min-w-0 bg-transparent">
        {/* Header containing Drag region and Menu button */}
        <header 
          className="shrink-0 relative w-full bg-transparent border-b border-gray-200/40 dark:border-gray-800/40 flex items-center z-30"
          style={{ 
            paddingTop: "env(safe-area-inset-top, 0px)",
            minHeight: "calc(env(safe-area-inset-top, 0px) + 48px)"
          }}
        >
          {/* Menu button */}
          <div className="pl-4 md:pl-[80px] flex items-center h-[48px] z-20">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors focus:outline-none"
              aria-label="Open notes menu"
            >
              <Menu size={20} />
            </button>
          </div>
          {/* Drag region across the top of the editor pane */}
          <div
            data-tauri-drag-region
            className="absolute inset-0 z-10"
          />
        </header>

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

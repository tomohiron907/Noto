import { useState, useEffect, useRef } from "react";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";
import NoteEditor from "../editor/NoteEditor";
import { useNotesStore } from "../../stores/notesStore";
import { invoke } from "@tauri-apps/api/core";

const SIDEBAR_WIDTH = 240;
const HOVER_EDGE_PX = 10;
const HOVER_CLOSE_PX = SIDEBAR_WIDTH + 20;
const SWIPE_EDGE_PX = 30;

const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

const setTrafficLightsVisible = (visible: boolean) => {
  invoke("set_traffic_lights", { visible }).catch(() => {});
};

export default function AppShell() {
  const { activeId } = useNotesStore();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarTrigger, setSidebarTrigger] = useState<"none" | "hover" | "click">("none");

  const sidebarRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const isDraggingFromEdge = useRef(false);
  const lastDragOffset = useRef(0);
  // Keep a ref to isSidebarOpen so touch handlers don't capture stale state
  const isSidebarOpenRef = useRef(false);

  useEffect(() => {
    setTrafficLightsVisible(false);
  }, []);

  useEffect(() => {
    isSidebarOpenRef.current = isSidebarOpen;
  }, [isSidebarOpen]);

  const openSidebar = (trigger: "hover" | "click" = "click") => {
    setTrafficLightsVisible(true);
    setIsSidebarOpen(true);
    setSidebarTrigger(trigger);
  };

  const closeSidebar = () => {
    setIsSidebarOpen(false);
    setSidebarTrigger("none");
    setTimeout(() => setTrafficLightsVisible(false), 200);
  };

  // Mac: open on left-edge hover, close when mouse returns to editor
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isTouchDevice) return;
    if (!isSidebarOpen && e.clientX < HOVER_EDGE_PX) {
      openSidebar("hover");
    } else if (isSidebarOpen && sidebarTrigger === "hover" && e.clientX > HOVER_CLOSE_PX) {
      closeSidebar();
    }
  };

  // iOS: swipe-from-left-edge gesture using native touch listeners
  useEffect(() => {
    if (!isTouchDevice) return;

    const el = document.documentElement;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch.clientX > SWIPE_EDGE_PX && !isSidebarOpenRef.current) return;
      isDraggingFromEdge.current = true;
      touchStartX.current = touch.clientX;
      lastDragOffset.current = isSidebarOpenRef.current ? SIDEBAR_WIDTH : 0;
      if (sidebarRef.current) {
        sidebarRef.current.style.transition = "none";
        const startOffset = isSidebarOpenRef.current ? 0 : -SIDEBAR_WIDTH;
        sidebarRef.current.style.transform = `translateX(${startOffset}px)`;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingFromEdge.current || touchStartX.current === null) return;
      e.preventDefault();
      const touch = e.touches[0];
      const base = isSidebarOpenRef.current ? SIDEBAR_WIDTH : 0;
      const raw = base + (touch.clientX - touchStartX.current);
      const delta = Math.max(0, Math.min(SIDEBAR_WIDTH, raw));
      lastDragOffset.current = delta;
      if (sidebarRef.current) {
        sidebarRef.current.style.transform = `translateX(${delta - SIDEBAR_WIDTH}px)`;
      }
    };

    const onTouchEnd = () => {
      if (!isDraggingFromEdge.current) return;
      isDraggingFromEdge.current = false;
      touchStartX.current = null;

      if (sidebarRef.current) {
        sidebarRef.current.style.transition = "";
        sidebarRef.current.style.transform = "";
      }

      if (lastDragOffset.current > SIDEBAR_WIDTH / 2) {
        openSidebar("click");
      } else {
        closeSidebar();
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  return (
    <div
      className="flex h-screen overflow-hidden bg-transparent relative border border-white/20 rounded-[10px] box-border"
      onMouseMove={handleMouseMove}
    >
      {/* Overlay when sidebar is opened by click/hamburger */}
      {isSidebarOpen && sidebarTrigger === "click" && (
        <div
          className="absolute inset-0 bg-black/20 dark:bg-black/40 z-40 transition-opacity"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar Drawer */}
      <div
        ref={sidebarRef}
        className={`absolute inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onClose={closeSidebar} />
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
          <div className="pl-4 flex items-center h-[48px] z-20">
            <button
              onClick={() => openSidebar("click")}
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

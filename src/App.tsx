import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAuthStore } from "./stores/authStore";
import { useNotesStore } from "./stores/notesStore";
import AuthScreen from "./components/auth/AuthScreen";
import AppShell from "./components/layout/AppShell";

const NOTE_WINDOW_ID = new URLSearchParams(window.location.search).get("noteId");

export default function App() {
  const { user, loading, restoreSession } = useAuthStore();
  const { createNote, activeId, activeTitle, deleteNote, loadTree, refreshActiveNote } = useNotesStore();

  // Respect system dark/light mode
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (dark: boolean) =>
      document.documentElement.classList.toggle("dark", dark);
    apply(mq.matches);
    mq.addEventListener("change", (e) => apply(e.matches));
    return () => mq.removeEventListener("change", () => {});
  }, []);

  // Mark iOS so CSS can apply solid backgrounds (no native window transparency on iOS)
  useEffect(() => {
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (isTouch) {
      document.documentElement.classList.add("ios");
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "n") { e.preventDefault(); createNote(); }
      if (e.key === "Backspace" && e.shiftKey && activeId) {
        e.preventDefault();
        if (confirm("Delete this note?")) deleteNote(activeId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createNote, activeId, deleteNote]);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // note window: URLパラメータのノートを認証後に自動で開く
  useEffect(() => {
    if (!user || !NOTE_WINDOW_ID) return;
    const { notes, loadTree: load, openNote } = useNotesStore.getState();
    (async () => {
      if (notes.length === 0) await load();
      await openNote(NOTE_WINDOW_ID);
    })();
  }, [user]);

  // note window: アクティブなノートタイトルに合わせてウィンドウタイトルを更新
  useEffect(() => {
    if (!NOTE_WINDOW_ID || !activeTitle) return;
    getCurrentWindow().setTitle(activeTitle).catch(() => {});
  }, [activeTitle]);

  // Trigger immediate sync when window regains focus or becomes visible
  useEffect(() => {
    const handler = () => invoke("sync_trigger").catch(() => {});
    const visibilityHandler = () => { if (!document.hidden) handler(); };
    window.addEventListener("focus", handler);
    document.addEventListener("visibilitychange", visibilityHandler);
    return () => {
      window.removeEventListener("focus", handler);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, []);

  // Refresh tree when background sync delivers new data
  useEffect(() => {
    const unlisten = listen("sync:updated", () => {
      console.log("[sync] sync:updated received");
      loadTree();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [loadTree]);

  // Refresh active note content when another device edits it
  useEffect(() => {
    const unlisten = listen<string[]>("sync:notes_updated", (event) => {
      const { activeId: id, dirty } = useNotesStore.getState();
      console.log("[sync] sync:notes_updated received", event.payload, "activeId=", id, "dirty=", dirty);
      if (id && !dirty && event.payload.includes(id)) {
        console.log("[sync] calling refreshActiveNote for", id);
        refreshActiveNote();
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [refreshActiveNote]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-950">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <AuthScreen />;
  return <AppShell />;
}

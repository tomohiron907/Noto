import { useEffect } from "react";
import { useAuthStore } from "./stores/authStore";
import { useNotesStore } from "./stores/notesStore";
import AuthScreen from "./components/auth/AuthScreen";
import AppShell from "./components/layout/AppShell";

export default function App() {
  const { user, loading, restoreSession } = useAuthStore();
  const { createNote, activeId, deleteNote } = useNotesStore();

  // Respect system dark/light mode
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (dark: boolean) =>
      document.documentElement.classList.toggle("dark", dark);
    apply(mq.matches);
    mq.addEventListener("change", (e) => apply(e.matches));
    return () => mq.removeEventListener("change", () => {});
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

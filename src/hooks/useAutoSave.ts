import { useEffect, useRef } from "react";
import { useNotesStore } from "../stores/notesStore";

export function useAutoSave() {
  const { dirty, activeContent, saveNote } = useNotesStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveNote(activeContent);
    }, 1500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dirty, activeContent, saveNote]);
}

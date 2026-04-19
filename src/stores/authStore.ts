import { create } from "zustand";
import { tauriAuth } from "../lib/tauri";
import type { UserInfo } from "../lib/types";

interface AuthState {
  user: UserInfo | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  error: null,

  signIn: async () => {
    set({ loading: true, error: null });
    try {
      const user = await tauriAuth.start();
      set({ user, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  signOut: async () => {
    await tauriAuth.signOut();
    set({ user: null });
  },

  restoreSession: async () => {
    set({ loading: true });
    try {
      const user = await tauriAuth.restore();
      set({ user: user ?? null, loading: false });
    } catch {
      set({ loading: false });
    }
  },
}));

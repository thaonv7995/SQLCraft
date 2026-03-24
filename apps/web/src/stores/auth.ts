import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthTokens, User } from '@/lib/api';

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  setAuth: (user: User, tokens: AuthTokens) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
  updateUser: (patch: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      tokens: null,

      setAuth: (user, tokens) => set({ user, tokens }),

      clearAuth: () => set({ user: null, tokens: null }),

      isAuthenticated: () => !!get().tokens?.accessToken,

      updateUser: (patch) => {
        const current = get().user;
        if (current) {
          set({ user: { ...current, ...patch } });
        }
      },
    }),
    {
      name: 'sqlcraft-auth',
      partialize: (state) => ({ user: state.user, tokens: state.tokens }),
    }
  )
);

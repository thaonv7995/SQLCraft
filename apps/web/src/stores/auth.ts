import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthTokens, User } from '@/lib/api';
import { authApi } from '@/lib/api';

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  setAuth: (user: User, tokens: AuthTokens) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
  updateUser: (patch: Partial<User>) => void;
  /** Re-fetch profile (incl. stats) from GET /auth/me — keeps dashboard stats fresh without re-login */
  refreshProfile: () => Promise<void>;
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

      refreshProfile: async () => {
        if (!get().tokens?.accessToken) return;
        try {
          const user = await authApi.me();
          set({ user });
        } catch {
          // 401 → axios interceptor clears storage & redirects
        }
      },
    }),
    {
      name: 'sqlcraft-auth',
      partialize: (state) => ({ user: state.user, tokens: state.tokens }),
    }
  )
);

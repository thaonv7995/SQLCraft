'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

const VISIBILITY_REFETCH_MS = 20_000;

/**
 * Keeps `user.stats` (and the rest of /auth/me) in sync with the server:
 * once on mount, when visiting dashboard/profile, when the tab becomes visible again (throttled),
 * and after explicit calls (e.g. end session).
 */
export function AuthProfileSync() {
  const pathname = usePathname();
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const lastVisibilityRefetchAt = useRef(0);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    if (pathname === '/dashboard' || pathname === '/profile') {
      void refreshProfile();
    }
  }, [pathname, refreshProfile]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastVisibilityRefetchAt.current < VISIBILITY_REFETCH_MS) return;
      lastVisibilityRefetchAt.current = now;
      void refreshProfile();
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refreshProfile]);

  return null;
}

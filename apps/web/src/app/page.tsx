'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMounted } from '@/hooks/use-mounted';
import { useAuthStore } from '@/stores/auth';

export default function RootPage() {
  const router = useRouter();
  const mounted = useMounted();
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authReady = hasHydrated || isAuthenticated();

  useEffect(() => {
    if (!mounted || !authReady) {
      return;
    }

    router.replace(isAuthenticated() ? '/dashboard' : '/login');
  }, [authReady, isAuthenticated, mounted, router]);

  return null;
}

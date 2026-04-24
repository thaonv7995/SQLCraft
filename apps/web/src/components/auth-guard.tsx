'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMounted } from '@/hooks/use-mounted';
import { useAuthStore } from '@/stores/auth';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const mounted = useMounted();
  const [hydrationFallbackReady, setHydrationFallbackReady] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const authReady = hasHydrated || isAuthenticated() || hydrationFallbackReady;

  useEffect(() => {
    if (!mounted || hasHydrated || isAuthenticated()) return;
    const id = window.setTimeout(() => setHydrationFallbackReady(true), 100);
    return () => window.clearTimeout(id);
  }, [hasHydrated, isAuthenticated, mounted]);

  useEffect(() => {
    if (mounted && authReady && !isAuthenticated()) {
      router.replace('/login');
    }
  }, [authReady, isAuthenticated, mounted, router]);

  if (!mounted || !authReady || !isAuthenticated()) return null;

  return <>{children}</>;
}

function isAdminUser(user: { role?: string; roles?: string[] } | null): boolean {
  if (!user) return false;
  return user.role === 'admin' || (user.roles?.includes('admin') ?? false);
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const mounted = useMounted();
  const [hydrationFallbackReady, setHydrationFallbackReady] = useState(false);
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const authReady = hasHydrated || isAuthenticated() || hydrationFallbackReady;

  useEffect(() => {
    if (!mounted || hasHydrated || isAuthenticated()) return;
    const id = window.setTimeout(() => setHydrationFallbackReady(true), 100);
    return () => window.clearTimeout(id);
  }, [hasHydrated, isAuthenticated, mounted]);

  useEffect(() => {
    if (!mounted || !authReady) {
      return;
    }

    if (!isAuthenticated()) {
      router.replace('/login');
    } else if (user && !isAdminUser(user)) {
      router.replace('/dashboard');
    }
  }, [authReady, isAuthenticated, mounted, user, router]);

  if (!mounted || !authReady || !isAuthenticated() || !isAdminUser(user)) return null;

  return <>{children}</>;
}

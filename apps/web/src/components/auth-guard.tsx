'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMounted } from '@/hooks/use-mounted';
import { useAuthStore } from '@/stores/auth';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const mounted = useMounted();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (mounted && !isAuthenticated()) {
      router.replace('/login');
    }
  }, [isAuthenticated, mounted, router]);

  if (!mounted || !isAuthenticated()) return null;

  return <>{children}</>;
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const mounted = useMounted();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    if (!isAuthenticated()) {
      router.replace('/login');
    } else if (user && user.role !== 'admin') {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, mounted, user, router]);

  if (!mounted || !isAuthenticated() || user?.role !== 'admin') return null;

  return <>{children}</>;
}

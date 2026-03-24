'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useMounted } from '@/hooks/use-mounted';
import { useAuthStore } from '@/stores/auth';
import { generateInitials } from '@/lib/utils';

export default function SettingsPage() {
  const router = useRouter();
  const { user, clearAuth, isAuthenticated } = useAuthStore();
  const mounted = useMounted();
  const authed = mounted && isAuthenticated();

  if (!mounted) {
    return (
      <div className="page-shell-narrow page-stack" aria-busy="true">
        <div className="h-9 w-40 rounded bg-surface-container-highest/40 animate-pulse" />
        <div className="mt-4 h-4 w-full max-w-md rounded bg-surface-container-highest/30 animate-pulse" />
      </div>
    );
  }

  if (!authed || !user) {
    return (
      <div className="page-shell-narrow page-stack">
        <h1 className="page-title-lg">Settings</h1>
        <p className="page-lead">Sign in to manage your account.</p>
        <Link href="/login">
          <Button variant="primary">Sign In</Button>
        </Link>
      </div>
    );
  }

  const initials = generateInitials(user.displayName ?? user.username);

  return (
    <div className="page-shell-narrow page-stack">
      <div>
        <h1 className="page-title-lg">Settings</h1>
        <p className="page-lead mt-2">Account details and app preferences.</p>
      </div>

      <section className="section-card card-padding">
        <h2 className="page-section-title">Profile</h2>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-16 w-16 rounded-full border border-outline-variant object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-lg font-bold text-on-surface">
              {initials}
            </div>
          )}
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-on-surface">{user.displayName ?? user.username}</p>
            <p className="text-sm text-on-surface-variant">{user.email}</p>
            <p className="text-xs text-on-surface-variant">@{user.username} · {user.role}</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-on-surface-variant">
          Full profile editing will be available once the user update API is connected. For now,
          use the account menu for sign out and quick links.
        </p>
      </section>

      <section className="section-card card-padding">
        <h2 className="page-section-title">Notifications</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          Email and push preferences are in progress. In-app toasts are currently supported.
        </p>
      </section>

      <section className="section-card border-error/20 bg-error/5 card-padding">
        <h2 className="page-section-title text-error">Session</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          Sign out from this device. You will need to sign in again to continue.
        </p>
        <Button
          variant="ghost"
          className="mt-4 text-error hover:bg-error/10"
          onClick={() => {
            clearAuth();
            router.push('/login');
          }}
        >
          Sign Out
        </Button>
      </section>

      <p className="text-center text-xs text-on-surface-variant">
        <Link href="/docs" className="underline-offset-2 hover:underline">
          Documentation
        </Link>
        {' · '}
        <Link href="/dashboard" className="underline-offset-2 hover:underline">
          Back to Dashboard
        </Link>
      </p>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useMounted } from '@/hooks/use-mounted';
import { useAuthStore } from '@/stores/auth';
import { generateInitials } from '@/lib/utils';

export default function ProfilePage() {
  const { user, isAuthenticated } = useAuthStore();
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
        <h1 className="page-title-lg">Profile</h1>
        <p className="page-lead">Sign in to view your profile.</p>
        <Link href="/login">
          <Button variant="primary">Sign In</Button>
        </Link>
      </div>
    );
  }

  const initials = generateInitials(user.displayName ?? user.username);
  const stats = user.stats;

  return (
    <div className="page-shell-narrow page-stack">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title-lg">Profile</h1>
          <p className="page-lead mt-2">Your public identity and account activity.</p>
        </div>
        <Link href="/settings">
          <Button variant="secondary" size="sm">
            Account settings
          </Button>
        </Link>
      </div>

      <section className="section-card card-padding">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {user.avatarUrl ? (
            // External avatar URLs; next/image would require remotePatterns for arbitrary hosts
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              className="h-20 w-20 rounded-full border border-outline-variant object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-2xl font-bold text-on-surface">
              {initials}
            </div>
          )}
          <div className="min-w-0 space-y-1">
            <p className="text-lg font-semibold text-on-surface">{user.displayName ?? user.username}</p>
            <p className="text-sm text-on-surface-variant">{user.email}</p>
            <p className="text-xs text-on-surface-variant">
              @{user.username} · <span className="capitalize">{user.role}</span>
            </p>
          </div>
        </div>
        {user.bio ? (
          <p className="mt-4 text-sm text-on-surface leading-relaxed">{user.bio}</p>
        ) : (
          <p className="mt-4 text-sm text-on-surface-variant">
            No bio yet. Profile editing will be available when the user update API is connected.
          </p>
        )}
      </section>

      {stats && (
        <section className="section-card card-padding">
          <h2 className="page-section-title">Activity</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Queries run" value={stats.queriesRun} />
            <Stat label="Challenges done" value={stats.completedChallenges} />
            <Stat label="Total points" value={stats.totalPoints} />
            <Stat label="Current streak" value={stats.currentStreak} />
            <Stat label="Active sessions" value={stats.activeSessions} />
          </dl>
        </section>
      )}

      <p className="text-center text-xs text-on-surface-variant">
        <Link href="/dashboard" className="underline-offset-2 hover:underline">
          Back to Dashboard
        </Link>
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-center">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-on-surface-variant">
        {label}
      </dt>
      <dd className="mt-1 font-headline text-lg font-semibold text-on-surface tabular-nums">
        {value}
      </dd>
    </div>
  );
}

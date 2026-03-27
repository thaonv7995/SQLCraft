'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { databasesApi, queryApi } from '@/lib/api';
import type { UserStats } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { StatCard } from '@/components/ui/card';
import { StatusBadge, DifficultyBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { databaseScaleDisplayLabelFromRowCount } from '@/lib/database-catalog';
import { formatRelativeTime, formatRows, truncateSql } from '@/lib/utils';
import { useAppPageProps } from '@/lib/next-app-page';

// ─── Fallback stats while user data loads ─────────────────────────────────────
const EMPTY_STATS: UserStats = {
  activeSessions: 0,
  completedChallenges: 0,
  queriesRun: 0,
  currentStreak: 0,
  totalPoints: 0,
};

function leadCopy(stats: UserStats): string {
  if (stats.currentStreak > 0) {
    return `${stats.currentStreak}-day streak — keep the momentum.`;
  }
  if (stats.queriesRun > 0) {
    return 'Your SQL work is active. Open the Lab to continue.';
  }
  return 'Open the Lab to run SQL and see your activity here.';
}

export default function DashboardPage(props: PageProps<'/dashboard'>) {
  useAppPageProps(props);
  const { user } = useAuthStore();

  const {
    data: databaseCatalog,
    isLoading: databasesLoading,
    isError: databasesError,
    error: databasesErrorDetail,
    refetch: refetchDatabases,
  } = useQuery({
    queryKey: ['dashboard-databases'],
    queryFn: () => databasesApi.list(),
    staleTime: 60_000,
  });

  const { data: queryHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['query-history', 'recent'],
    queryFn: () => queryApi.history(undefined, { limit: 5 }),
    staleTime: 30_000,
  });

  const displayName = user?.displayName ?? user?.username ?? 'Developer';
  const stats = user?.stats ?? EMPTY_STATS;
  const recentQueries = queryHistory?.items ?? [];
  const featuredDatabases = (databaseCatalog?.items ?? []).slice(0, 3);

  const statsAreEmpty =
    stats.activeSessions === 0 &&
    stats.completedChallenges === 0 &&
    stats.queriesRun === 0 &&
    stats.currentStreak === 0;

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page-shell page-stack">
      {/* Hero */}
      <section aria-label="Welcome" className="space-y-1">
        <div className="min-w-0">
          <p className="text-sm text-on-surface-variant font-body mb-1">{greeting},</p>
          <h1 className="font-headline text-2xl font-bold text-on-surface sm:text-3xl">
            {displayName}
          </h1>
          <p className="text-sm text-on-surface-variant mt-2 max-w-xl leading-relaxed">
            {leadCopy(stats)}
          </p>
        </div>
      </section>

      {/* Stats — no fake deltas; optional empty hint */}
      <section aria-label="Your stats" className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label="Sessions"
            value={stats.activeSessions}
            accent="tertiary"
            icon={<span className="material-symbols-outlined">dns</span>}
          />
          <StatCard
            label="Challenges"
            value={stats.completedChallenges}
            accent="secondary"
            icon={<span className="material-symbols-outlined">emoji_events</span>}
          />
          <StatCard
            label="Queries (last 7 days)"
            value={stats.queriesRun.toLocaleString()}
            accent="primary"
            icon={<span className="material-symbols-outlined">query_stats</span>}
          />
          <StatCard
            label="Streak"
            value={stats.currentStreak > 0 ? `${stats.currentStreak} days` : '0 days'}
            accent="error"
            icon={<span className="material-symbols-outlined">local_fire_department</span>}
          />
        </div>
        {statsAreEmpty && (
          <p className="rounded-lg border border-outline-variant/15 bg-surface-container-low/80 px-3 py-2.5 text-xs text-on-surface-variant leading-relaxed">
            No activity yet — start in the Lab or pick a database below. Stats update as you run
            queries and complete challenges.
          </p>
        )}
      </section>

      {/* Explore Databases — before recent queries */}
      <section aria-label="Explore databases">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-headline text-base font-semibold text-on-surface">Explore Databases</h2>
          <Link href="/explore">
            <Button variant="ghost" size="sm" className="self-start sm:self-auto">
              Open explorer
            </Button>
          </Link>
        </div>

        {databasesLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-surface-container-low" />
            ))}
          </div>
        ) : databasesError ? (
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-5 py-8 text-center">
            <span className="material-symbols-outlined mb-2 block text-2xl text-outline">
              error
            </span>
            <p className="text-sm font-medium text-on-surface">Database catalog unavailable</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {databasesErrorDetail instanceof Error
                ? databasesErrorDetail.message
                : 'Dashboard could not load database recommendations.'}
            </p>
            <button
              type="button"
              onClick={() => void refetchDatabases()}
              className="mt-4 rounded-lg border border-outline-variant/20 bg-surface-container-high px-4 py-2 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container-highest"
            >
              Retry
            </button>
          </div>
        ) : featuredDatabases.length === 0 ? (
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-5 py-8 text-center">
            <span className="material-symbols-outlined mb-2 block text-2xl text-outline">
              dns
            </span>
            <p className="text-sm font-medium text-on-surface">No published databases yet</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              The explorer will show databases here after catalog items are published.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {featuredDatabases.map((database) => (
              <Link key={database.id} href={`/explore/${database.id}`}>
                <div className="group flex h-full cursor-pointer flex-col rounded-xl bg-surface-container-low p-5 transition-colors hover:bg-surface-container">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <DifficultyBadge difficulty={database.difficulty} />
                    <span className="text-xs text-on-surface-variant">{database.engine}</span>
                  </div>
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-tertiary">
                      <span
                        className="material-symbols-outlined text-xl"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        {database.domainIcon}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-headline text-base font-semibold text-on-surface transition-colors group-hover:text-primary">
                        {database.name}
                      </h3>
                      <p className="text-xs uppercase tracking-[0.18em] text-outline">
                        {databaseScaleDisplayLabelFromRowCount(database.rowCount)}
                      </p>
                    </div>
                  </div>
                  <p className="mb-4 line-clamp-2 text-xs text-on-surface-variant">{database.description}</p>
                  <div className="mt-auto flex items-center justify-between border-t border-outline-variant/10 pt-3 text-xs text-on-surface-variant">
                    <span>{formatRows(database.rowCount)} rows</span>
                    <span>{database.tableCount} tables</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Recent Queries */}
      <section
        aria-label="Recent queries"
        className="border-t border-outline-variant/10 pt-8 lg:pt-10"
      >
        <div className="overflow-hidden rounded-xl bg-surface-container-low">
          <div className="flex items-center justify-between border-b border-outline-variant/10 px-5 py-4">
            <h2 className="font-headline text-base font-semibold text-on-surface">Recent Queries</h2>
            <Link href="/history">
              <Button variant="ghost" size="sm">
                All
              </Button>
            </Link>
          </div>
          <div className="flex flex-col">
            {historyLoading ? (
              <div className="flex items-center justify-center px-5 py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              </div>
            ) : recentQueries.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <span className="material-symbols-outlined mb-2 block text-2xl text-outline">
                  history
                </span>
                <p className="text-xs text-on-surface-variant">No queries yet. Run your first SQL!</p>
              </div>
            ) : (
              recentQueries.map((q) => (
                <div
                  key={q.id}
                  className="border-b border-outline-variant/5 px-5 py-3 last:border-b-0 hover:bg-surface-container/60 transition-colors"
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <StatusBadge status={q.status} />
                    <span className="ml-auto text-xs text-on-surface-variant">
                      {formatRelativeTime(q.createdAt)}
                    </span>
                  </div>
                  <code className="block truncate font-mono text-xs text-on-surface-variant">
                    {truncateSql(q.sql, 55)}
                  </code>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-outline">
                    {q.durationMs != null && q.durationMs > 0 && <span>{q.durationMs}ms</span>}
                    {(q.rowCount ?? 0) > 0 && <span>{q.rowCount} rows</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

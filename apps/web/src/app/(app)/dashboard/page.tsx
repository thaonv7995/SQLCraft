'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { sessionsApi, databasesApi, queryApi } from '@/lib/api';
import type { UserStats } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { StatCard } from '@/components/ui/card';
import { StatusBadge, DifficultyBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  TableSkeleton,
} from '@/components/ui/table';
import { DATABASE_SCALE_LABELS, PLACEHOLDER_DATABASES } from '@/lib/database-catalog';
import { formatRelativeTime, formatRows, truncateSql } from '@/lib/utils';

// ─── Fallback stats while user data loads ─────────────────────────────────────
const EMPTY_STATS: UserStats = {
  activeSessions: 0,
  completedChallenges: 0,
  queriesRun: 0,
  currentStreak: 0,
  totalPoints: 0,
};

export default function DashboardPage() {
  const { user } = useAuthStore();

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionsApi.list,
    staleTime: 30_000,
  });

  const { data: databaseCatalog, isLoading: databasesLoading } = useQuery({
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
  const recentSessions = sessions?.slice(0, 5) ?? [];
  const recentQueries = queryHistory?.items ?? [];
  const featuredDatabases = (databaseCatalog?.items ?? PLACEHOLDER_DATABASES).slice(0, 3);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-on-surface-variant font-body mb-1">{greeting},</p>
          <h1 className="font-headline text-2xl font-bold text-on-surface">
            {displayName}
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Your SQL journey continues. Keep the streak going!
          </p>
        </div>
        <Link href="/lab">
          <Button
            variant="primary"
            leftIcon={<span className="material-symbols-outlined text-sm">terminal</span>}
          >
            Open Lab
          </Button>
        </Link>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Sessions"
          value={stats.activeSessions}
          accent="tertiary"
          icon={<span className="material-symbols-outlined">dns</span>}
        />
        <StatCard
          label="Completed Challenges"
          value={stats.completedChallenges}
          delta="3 this week"
          deltaPositive
          accent="secondary"
          icon={<span className="material-symbols-outlined">emoji_events</span>}
        />
        <StatCard
          label="Queries Run"
          value={stats.queriesRun.toLocaleString()}
          delta="47 today"
          deltaPositive
          accent="primary"
          icon={<span className="material-symbols-outlined">query_stats</span>}
        />
        <StatCard
          label="Current Streak"
          value={`${stats.currentStreak} days`}
          delta="Personal best!"
          deltaPositive
          accent="error"
          icon={<span className="material-symbols-outlined">local_fire_department</span>}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent Sessions */}
        <div className="xl:col-span-2 bg-surface-container-low rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="font-headline text-base font-semibold text-on-surface">
              Recent Sessions
            </h2>
            <Link href="/dashboard/sessions">
              <Button variant="ghost" size="sm">
                View all
              </Button>
            </Link>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sandbox</TableHead>
                <TableHead>Last Active</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessionsLoading ? (
                <TableSkeleton rows={4} cols={4} />
              ) : recentSessions.length === 0 ? (
                <TableEmpty
                  message="No active sessions. Launch a sandbox from the database explorer to begin."
                  colSpan={5}
                />
              ) : (
                recentSessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <p className="text-sm font-medium text-on-surface">
                        {s.lessonTitle ?? 'Lesson Session'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.sandboxStatus ?? 'pending'} />
                    </TableCell>
                    <TableCell className="text-on-surface-variant text-xs">
                      {s.lastActivityAt ? formatRelativeTime(s.lastActivityAt) : formatRelativeTime(s.startedAt)}
                    </TableCell>
                    <TableCell>
                      <Link href={`/lab/${s.id}`}>
                        <Button variant="ghost" size="sm">
                          Open
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Recent Query History */}
        <div className="bg-surface-container-low rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="font-headline text-base font-semibold text-on-surface">
              Recent Queries
            </h2>
            <Link href="/history">
              <Button variant="ghost" size="sm">All</Button>
            </Link>
          </div>
          <div className="flex flex-col">
            {historyLoading ? (
              <div className="px-5 py-8 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : recentQueries.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <span className="material-symbols-outlined text-2xl text-outline mb-2 block">history</span>
                <p className="text-xs text-on-surface-variant">No queries yet. Run your first SQL!</p>
              </div>
            ) : (
              recentQueries.map((q) => (
                <div key={q.id} className="px-5 py-3 hover:bg-surface-container transition-colors">
                  <div className="flex items-center gap-2 mb-1.5">
                    <StatusBadge status={q.status} />
                    <span className="text-xs text-on-surface-variant ml-auto">
                      {formatRelativeTime(q.createdAt)}
                    </span>
                  </div>
                  <code className="text-xs font-mono text-on-surface-variant block truncate">
                    {truncateSql(q.sql, 55)}
                  </code>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-outline">
                    {q.durationMs && <span>{q.durationMs}ms</span>}
                    {(q.rowCount ?? 0) > 0 && <span>{q.rowCount} rows</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Explore Databases */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-headline text-lg font-semibold text-on-surface">
            Explore Databases
          </h2>
          <Link href="/explore">
            <Button variant="ghost" size="sm">
              Open explorer
            </Button>
          </Link>
        </div>

        {databasesLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-40 bg-surface-container-low rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {featuredDatabases.map((database) => (
              <Link key={database.id} href={`/explore/${database.id}`}>
                <div className="bg-surface-container-low rounded-xl p-5 hover:bg-surface-container transition-colors cursor-pointer group h-full">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <DifficultyBadge difficulty={database.difficulty} />
                    <span className="text-xs text-on-surface-variant">
                      {database.engine}
                    </span>
                  </div>
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container-high text-tertiary">
                      <span
                        className="material-symbols-outlined text-xl"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        {database.domainIcon}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-headline text-base font-semibold text-on-surface group-hover:text-primary transition-colors">
                        {database.name}
                      </h3>
                      <p className="text-xs uppercase tracking-[0.18em] text-outline">
                        {DATABASE_SCALE_LABELS[database.scale] ?? database.scale}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface-variant line-clamp-2 mb-4">
                    {database.description}
                  </p>
                  <div className="mt-auto flex items-center justify-between border-t border-outline-variant/10 pt-3 text-xs text-on-surface-variant">
                    <span>{formatRows(database.rowCount)} rows</span>
                    <span>{database.tableCount} tables</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

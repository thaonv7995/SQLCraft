'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { sessionsApi, tracksApi, queryApi } from '@/lib/api';
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
import { formatRelativeTime, truncateSql } from '@/lib/utils';

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

  const { data: tracks, isLoading: tracksLoading } = useQuery({
    queryKey: ['tracks'],
    queryFn: () => tracksApi.list({ limit: 3 }),
    staleTime: 60_000,
  });

  const { data: queryHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['query-history', 'recent'],
    queryFn: () => queryApi.history(undefined, { limit: 5 }),
    staleTime: 30_000,
  });

  const displayName = user?.displayName ?? user?.username ?? 'Developer';
  const stats = user?.stats ?? EMPTY_STATS;
  const statsLoading = !user;
  const recentSessions = sessions?.slice(0, 5) ?? [];
  const recentQueries = queryHistory?.items ?? [];

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
                <TableHead>Dataset</TableHead>
                <TableHead>Last Active</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessionsLoading ? (
                <TableSkeleton rows={4} cols={5} />
              ) : recentSessions.length === 0 ? (
                <TableEmpty message="No active sessions. Start a track to begin." colSpan={5} />
              ) : (
                recentSessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-on-surface">
                          {s.lesson?.title ?? s.track?.title ?? 'Free Session'}
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          {s.track?.title ?? 'No track'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono bg-surface-container-high px-2 py-0.5 rounded text-on-surface-variant capitalize">
                        {s.datasetSize}
                      </span>
                    </TableCell>
                    <TableCell className="text-on-surface-variant text-xs">
                      {formatRelativeTime(s.lastActivityAt)}
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

      {/* Continue Learning */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-headline text-lg font-semibold text-on-surface">
            Continue Learning
          </h2>
          <Link href="/tracks">
            <Button variant="ghost" size="sm">
              Browse all tracks
            </Button>
          </Link>
        </div>

        {tracksLoading ? (
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
            {(tracks?.items ?? []).map((track) => (
              <Link key={track.id} href={`/tracks/${track.id}`}>
                <div className="bg-surface-container-low rounded-xl p-5 hover:bg-surface-container transition-colors cursor-pointer group h-full">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <DifficultyBadge difficulty={track.difficulty} />
                    <span className="text-xs text-on-surface-variant">
                      {track.lessonCount} lessons
                    </span>
                  </div>
                  <h3 className="font-headline text-base font-semibold text-on-surface group-hover:text-primary transition-colors mb-2">
                    {track.title}
                  </h3>
                  <p className="text-xs text-on-surface-variant line-clamp-2 mb-4">
                    {track.description}
                  </p>

                  {track.userProgress && (
                    <div className="mt-auto">
                      <div className="flex justify-between text-xs text-on-surface-variant mb-1.5">
                        <span>Progress</span>
                        <span>
                          {track.userProgress.completedLessons}/{track.lessonCount}
                        </span>
                      </div>
                      <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-[#4453a7] rounded-full transition-all"
                          style={{
                            width: `${Math.round(
                              (track.userProgress.completedLessons / track.lessonCount) * 100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            ))}

            {/* Placeholder cards if not enough data */}
            {(tracks?.items?.length ?? 0) === 0 && [
              { title: 'SQL Fundamentals', difficulty: 'Beginner', lessons: 12 },
              { title: 'Advanced Queries', difficulty: 'Intermediate', lessons: 18 },
              { title: 'Query Optimization', difficulty: 'Advanced', lessons: 10 },
            ].map((t, i) => (
              <Link key={i} href="/tracks">
                <div className="bg-surface-container-low rounded-xl p-5 hover:bg-surface-container transition-colors cursor-pointer group">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <DifficultyBadge difficulty={t.difficulty.toLowerCase()} />
                    <span className="text-xs text-on-surface-variant">{t.lessons} lessons</span>
                  </div>
                  <h3 className="font-headline text-base font-semibold text-on-surface group-hover:text-primary transition-colors mb-2">
                    {t.title}
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    Master SQL concepts through hands-on exercises and real-world challenges.
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

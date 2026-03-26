'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, challengesApi } from '@/lib/api';
import { StatusBadge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@/components/ui/table';
import { generateInitials } from '@/lib/utils';

type RankingsTab = 'global' | 'challenge' | 'rules';
type LeaderboardPeriod = 'weekly' | 'monthly' | 'alltime';

const TAB_OPTIONS: Array<{ id: RankingsTab; label: string; icon: string }> = [
  { id: 'global', label: 'Global Ranking', icon: 'public' },
  { id: 'challenge', label: 'Challenge Rankings', icon: 'emoji_events' },
  { id: 'rules', label: 'Point Rules', icon: 'rule' },
];

const PERIOD_OPTIONS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'alltime', label: 'All Time' },
];

const EMPTY_CHALLENGES: Awaited<ReturnType<typeof challengesApi.listPublished>> = [];
const EMPTY_GLOBAL: Awaited<ReturnType<typeof adminApi.globalLeaderboard>> = [];
const EMPTY_CHALLENGE_LEADERS: Awaited<ReturnType<typeof challengesApi.getLeaderboard>> = [];

export default function AdminRankingsPage() {
  const [activeTab, setActiveTab] = useState<RankingsTab>('global');
  const [period, setPeriod] = useState<LeaderboardPeriod>('alltime');
  const [manualSelectedChallengeId, setManualSelectedChallengeId] = useState<string | null>(null);

  const globalQuery = useQuery({
    queryKey: ['admin-global-ranking', period],
    queryFn: () => adminApi.globalLeaderboard(period, 25),
    staleTime: 30_000,
  });

  const challengesQuery = useQuery({
    queryKey: ['admin-ranked-challenges'],
    queryFn: challengesApi.listPublished,
    staleTime: 60_000,
  });

  const configQuery = useQuery({
    queryKey: ['admin-config'],
    queryFn: adminApi.getConfig,
    staleTime: 30_000,
  });

  const challenges = challengesQuery.data ?? EMPTY_CHALLENGES;
  const selectedChallengeId = manualSelectedChallengeId ?? challenges[0]?.id ?? null;

  const selectedChallenge = useMemo(
    () => challenges.find((challenge) => challenge.id === selectedChallengeId) ?? null,
    [challenges, selectedChallengeId],
  );

  const challengeLeaderboardQuery = useQuery({
    queryKey: ['admin-challenge-ranking', selectedChallenge?.publishedVersionId],
    enabled: !!selectedChallenge?.publishedVersionId,
    queryFn: () => challengesApi.getLeaderboard(selectedChallenge!.publishedVersionId!, 25),
    staleTime: 30_000,
  });

  const globalLeaders = globalQuery.data ?? EMPTY_GLOBAL;
  const challengeLeaders = challengeLeaderboardQuery.data ?? EMPTY_CHALLENGE_LEADERS;
  const rankingConfig = configQuery.data?.config.rankings ?? null;
  const platformConfig = configQuery.data?.config.platform ?? null;
  const moderationConfig = configQuery.data?.config.moderation ?? null;
  const featureFlags = configQuery.data?.config.flags ?? null;

  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Rankings</p>
          <h1 className="mt-2 page-title-lg">Ranking Control</h1>
          <p className="page-lead mt-2 max-w-3xl">
            Operate global and challenge-specific leaderboards for SQL practice and competition.
            This screen is focused on ranking surfaces only.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Global Entries</p>
            <p className="mt-2 text-xl font-semibold text-on-surface">{globalLeaders.length}</p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Ranked Challenges</p>
            <p className="mt-2 text-xl font-semibold text-on-surface">{challenges.length}</p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Scoring Rules</p>
            <p className="mt-2 text-xl font-semibold text-on-surface">
              {rankingConfig ? rankingConfig.tieBreaker : 'Loading'}
            </p>
          </div>
        </div>
      </div>

      <div className="section-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-surface-container-high text-on-surface'
                  : 'bg-surface text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-sm">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'global' ? (
        <section className="section-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-outline-variant/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="page-section-title">Global Ranking</h2>
              <p className="text-xs text-on-surface-variant">
                Uses the existing `/leaderboard` API via `adminApi.globalLeaderboard`.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPeriod(option.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    period === option.id
                      ? 'bg-surface-container-high text-on-surface'
                      : 'bg-surface text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Points</TableHead>
                <TableHead>Challenges</TableHead>
                <TableHead>Streak</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {globalQuery.isLoading ? (
                <TableSkeleton rows={8} cols={5} />
              ) : globalQuery.isError ? (
                <TableEmpty
                  message="Global ranking API is not available in this environment yet."
                  colSpan={5}
                />
              ) : globalLeaders.length === 0 ? (
                <TableEmpty message="No global ranking entries yet." colSpan={5} />
              ) : (
                globalLeaders.map((entry) => (
                  <TableRow key={entry.userId}>
                    <TableCell className="font-mono text-xs text-on-surface-variant">
                      #{entry.rank}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-high text-xs font-semibold text-on-surface">
                          {generateInitials(entry.displayName)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-on-surface">
                            {entry.displayName}
                          </p>
                          <p className="truncate text-xs text-on-surface-variant">@{entry.username}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-secondary">
                      {entry.points.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs text-on-surface-variant">
                      {entry.challengesCompleted}
                    </TableCell>
                    <TableCell className="text-xs text-on-surface-variant">
                      {entry.streak} days
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {activeTab === 'challenge' ? (
        <section className="section-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-outline-variant/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="page-section-title">Challenge Rankings</h2>
              <p className="text-xs text-on-surface-variant">
                Uses published challenges and per-version leaderboard entries.
              </p>
            </div>
            <div className="min-w-0 lg:w-[360px]">
              <select
                value={selectedChallengeId ?? ''}
                onChange={(event) => setManualSelectedChallengeId(event.target.value)}
                className="w-full rounded-xl border border-outline-variant/10 bg-surface px-3 py-2 text-sm text-on-surface"
              >
                {challenges.length === 0 ? (
                  <option value="">No published challenge available</option>
                ) : (
                  challenges.map((challenge) => (
                    <option key={challenge.id} value={challenge.id}>
                      {challenge.title}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="border-b border-outline-variant/10 px-5 py-3 text-xs text-on-surface-variant">
            {selectedChallenge ? (
              <span>
                {selectedChallenge.trackTitle} / {selectedChallenge.lessonTitle} / v
                {selectedChallenge.latestVersionNo ?? 1}
              </span>
            ) : (
              <span>Select a challenge to inspect its ranking.</span>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Best Run</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {challengesQuery.isLoading || challengeLeaderboardQuery.isLoading ? (
                <TableSkeleton rows={8} cols={5} />
              ) : challengesQuery.isError ? (
                <TableEmpty
                  message="Challenge catalog is not available right now."
                  colSpan={5}
                />
              ) : challengeLeaderboardQuery.isError ? (
                <TableEmpty
                  message="Challenge ranking data is not available for this challenge yet."
                  colSpan={5}
                />
              ) : challengeLeaders.length === 0 ? (
                <TableEmpty message="No challenge ranking entries yet." colSpan={5} />
              ) : (
                challengeLeaders.map((entry) => (
                  <TableRow key={entry.userId}>
                    <TableCell className="font-mono text-xs text-on-surface-variant">
                      #{entry.rank}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-high text-xs font-semibold text-on-surface">
                          {generateInitials(entry.displayName)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-on-surface">
                            {entry.displayName}
                          </p>
                          <p className="truncate text-xs text-on-surface-variant">@{entry.username}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-secondary">
                      <div>{entry.bestDurationMs != null ? `${entry.bestDurationMs} ms` : '—'}</div>
                      <div className="text-xs text-on-surface-variant">
                        cost {entry.bestTotalCost != null ? Math.round(entry.bestTotalCost) : '—'}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-on-surface-variant">
                      {entry.attemptsCount}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={entry.passedAttempts > 0 ? 'completed' : 'pending'}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {activeTab === 'rules' ? (
        <section className="section-card p-5">
          <h2 className="page-section-title">Point Rules</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            This view reflects the persisted admin config that backs ranking and scoring behavior.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Base Points</p>
              <p className="mt-2 text-sm text-on-surface">
                {platformConfig
                  ? `New challenges default to ${platformConfig.defaultChallengePoints} points.`
                  : 'Loading persisted platform defaults.'}
              </p>
            </div>
            <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Pass Condition</p>
              <p className="mt-2 text-sm text-on-surface">
                {moderationConfig
                  ? moderationConfig.requireDraftValidation
                    ? 'Draft validation is required before review and publish.'
                    : 'Draft validation is currently optional in admin config.'
                  : 'Loading moderation policy.'}
              </p>
            </div>
            <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Config Surface</p>
              <p className="mt-2 text-sm text-on-surface">
                {rankingConfig
                  ? `${rankingConfig.globalWindow} window, ${rankingConfig.refreshInterval} refresh, tie-break by ${rankingConfig.tieBreaker}.`
                  : 'Loading ranking config.'}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-outline-variant/10 bg-surface px-4 py-3 text-xs text-on-surface-variant">
              Global rows: {rankingConfig?.globalLeaderboardSize ?? '—'}
            </div>
            <div className="rounded-xl border border-outline-variant/10 bg-surface px-4 py-3 text-xs text-on-surface-variant">
              Challenge rows: {rankingConfig?.challengeLeaderboardSize ?? '—'}
            </div>
            <div className="rounded-xl border border-outline-variant/10 bg-surface px-4 py-3 text-xs text-on-surface-variant">
              Ranking surfaces:{' '}
              {featureFlags
                ? featureFlags.globalRankings && featureFlags.challengeRankings
                  ? 'enabled'
                  : 'partially disabled'
                : 'loading'}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/admin/system?tab=config"
              className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-sm text-on-surface hover:bg-surface-container"
            >
              <span className="material-symbols-outlined text-sm">tune</span>
              Open persisted config
            </Link>
            {configQuery.isError ? (
              <span className="rounded-full bg-error/10 px-2 py-1 text-xs text-error">
                config endpoint unavailable
              </span>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

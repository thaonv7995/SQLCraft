'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { DifficultyBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { challengesApi, leaderboardApi, type ChallengeCatalogItem } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import type { ClientPageProps } from '@/lib/page-props';

type HubChallenge = ChallengeCatalogItem & { isYours: boolean };

type LeaderboardPeriod = 'weekly' | 'monthly' | 'alltime';

const PERIOD_OPTIONS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'alltime', label: 'All Time' },
];

function formatPoints(points: number) {
  return `${points.toLocaleString()} pts`;
}

type ChallengeCompletionFilter = 'not_done' | 'done';
type ChallengeSourceFilter = 'all' | 'yours';

function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  size = 'sm',
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ id: T; label: string }>;
  size?: 'sm' | 'xs';
}) {
  const pad = size === 'xs' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs';
  return (
    <div
      role="group"
      className="inline-flex rounded-lg border border-outline-variant/20 bg-surface p-0.5 shadow-sm"
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            'rounded-md font-medium transition-colors whitespace-nowrap',
            pad,
            value === opt.id
              ? 'bg-surface-container-high text-on-surface shadow-sm'
              : 'text-on-surface-variant hover:text-on-surface',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function LeaderboardPage(_props: ClientPageProps) {
  const [period, setPeriod] = useState<LeaderboardPeriod>('alltime');
  const { user } = useAuthStore();
  const userId = user?.id ?? null;

  const [sourceFilter, setSourceFilter] = useState<ChallengeSourceFilter>('all');
  const [completionFilter, setCompletionFilter] = useState<ChallengeCompletionFilter>('not_done');
  const [completionPage, setCompletionPage] = useState(0);
  const completionPageSize = 6;

  const router = useRouter();

  const mineQuery = useQuery({
    queryKey: ['my-challenges'],
    queryFn: () => challengesApi.listMine(),
    staleTime: 30_000,
  });

  const challengesQuery = useQuery({
    queryKey: ['published-challenges'],
    queryFn: () => challengesApi.listPublished(),
    staleTime: 60_000,
  });

  const leaderboardQuery = useQuery({
    queryKey: ['global-leaderboard', period],
    queryFn: () => leaderboardApi.get(period, 100),
    staleTime: 30_000,
  });

  const publishedChallenges = useMemo(() => challengesQuery.data ?? [], [challengesQuery.data]);
  const mineChallenges = useMemo(() => mineQuery.data ?? [], [mineQuery.data]);

  const mergedHubChallenges = useMemo((): HubChallenge[] => {
    const yoursIds = new Set(mineChallenges.map((c) => c.id));
    const byId = new Map<string, HubChallenge>();
    for (const c of publishedChallenges) {
      byId.set(c.id, { ...c, isYours: yoursIds.has(c.id) });
    }
    for (const c of mineChallenges) {
      if (!byId.has(c.id)) {
        byId.set(c.id, { ...c, isYours: true });
      }
    }
    return Array.from(byId.values());
  }, [publishedChallenges, mineChallenges]);

  const publishedWithVersion = useMemo(
    () => mergedHubChallenges.filter((ch) => Boolean(ch.publishedVersionId)),
    [mergedHubChallenges],
  );

  const globalPayload = leaderboardQuery.data;
  const globalLeaders = useMemo(() => globalPayload?.entries ?? [], [globalPayload?.entries]);

  const hubEntry = useMemo(() => {
    if (!userId) return null;
    return globalPayload?.viewer ?? globalLeaders.find((entry) => entry.userId === userId) ?? null;
  }, [globalPayload?.viewer, globalLeaders, userId]);

  const desiredCompletionScanLimit = useMemo(() => {
    if (publishedWithVersion.length === 0) {
      return 8;
    }
    return Math.min(
      publishedWithVersion.length,
      Math.max(8, (completionPage + 1) * completionPageSize),
    );
  }, [publishedWithVersion.length, completionPage, completionPageSize]);

  const [completionScanLimit, setCompletionScanLimit] = useState(8);
  if (publishedWithVersion.length > 0) {
    const nextLimit = Math.max(completionScanLimit, desiredCompletionScanLimit);
    if (nextLimit !== completionScanLimit) {
      setCompletionScanLimit(nextLimit);
    }
  }

  const completionScanChallenges = useMemo(() => {
    const sliced = publishedWithVersion.slice(0, completionScanLimit);
    return sliced.filter((ch) => Boolean(ch.publishedVersionId));
  }, [publishedWithVersion, completionScanLimit]);

  const passedChallengeIdsQuery = useQuery({
    queryKey: ['my-passed-challenges', userId, completionScanLimit],
    enabled: Boolean(userId && completionScanChallenges.length > 0),
    queryFn: async () => {
      const passedIds: string[] = [];

      // Keep requests bounded to reduce burst load.
      const chunkSize = 4;
      for (let i = 0; i < completionScanChallenges.length; i += chunkSize) {
        const chunk = completionScanChallenges.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(
          chunk.map(async (challenge) => {
            if (!challenge.publishedVersionId) return { id: challenge.id, passed: false };

            const attempts = await challengesApi.listAttempts(challenge.publishedVersionId);
            const passed = attempts.some((a) => a.status === 'passed');
            return { id: challenge.id, passed };
          }),
        );

        passedIds.push(...chunkResults.filter((r) => r.passed).map((r) => r.id));
      }

      return passedIds;
    },
    staleTime: 15_000,
  });

  const passedChallengeIdsSet = useMemo(() => new Set(passedChallengeIdsQuery.data ?? []), [
    passedChallengeIdsQuery.data,
  ]);

  const scannedChallengeIdsSet = useMemo(
    () => new Set(completionScanChallenges.map((ch) => ch.id)),
    [completionScanChallenges],
  );

  const effectiveSourceFilter: ChallengeSourceFilter = userId ? sourceFilter : 'all';

  const completionChallengesForList = useMemo(() => {
    const sorted = mergedHubChallenges
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    return sorted.filter((ch) => {
      if (effectiveSourceFilter === 'yours' && !ch.isYours) {
        return false;
      }
      if (!ch.publishedVersionId) {
        return completionFilter === 'not_done';
      }
      const passed = passedChallengeIdsSet.has(ch.id);
      return completionFilter === 'done' ? passed : !passed;
    });
  }, [mergedHubChallenges, completionFilter, passedChallengeIdsSet, effectiveSourceFilter]);

  const completionTotalPages = Math.max(
    1,
    Math.ceil(completionChallengesForList.length / completionPageSize),
  );

  const completionSafePage = Math.min(completionPage, completionTotalPages - 1);

  const completionPageChallenges = useMemo(() => {
    const start = completionSafePage * completionPageSize;
    const end = start + completionPageSize;
    return completionChallengesForList.slice(start, end);
  }, [completionChallengesForList, completionSafePage, completionPageSize]);

  const openChallengeDetailPage = (challengeId: string) => {
    router.push(`/challenges/${challengeId}`);
  };

  const catalogLoading = challengesQuery.isLoading || mineQuery.isLoading;

  return (
    <div className="page-shell page-stack">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="space-y-2 min-w-0">
            <p className="text-xs uppercase tracking-[0.24em] text-outline">Challenge hub</p>
            <div className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-outline-variant/15 bg-surface-container-low px-3 py-2 text-xs">
              <span className="text-on-surface-variant">
                Points{' '}
                <span className="font-semibold text-on-surface">
                  {hubEntry ? formatPoints(hubEntry.points) : '—'}
                </span>
              </span>
              <span className="text-outline hidden sm:inline">•</span>
              <span className="text-on-surface-variant">
                Pass{' '}
                <span className="font-semibold text-on-surface">
                  {hubEntry ? hubEntry.challengesCompleted : '—'}
                </span>
              </span>
              <span className="text-outline hidden sm:inline">•</span>
              <span className="text-on-surface-variant">
                Streak{' '}
                <span className="font-semibold text-on-surface">
                  {hubEntry ? `${hubEntry.streak}d` : '—'}
                </span>
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1 sm:items-end shrink-0">
            <p className="text-[10px] uppercase tracking-wider text-outline">Leaderboard period</p>
            <SegmentedToggle
              value={period}
              onChange={setPeriod}
              size="xs"
              options={PERIOD_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            />
          </div>
        </div>
      </section>

      <section id="challenge-catalog" className="scroll-mt-4">
        <div className="mb-6 rounded-xl border border-outline-variant/15 bg-surface-container-low/40 p-3 sm:p-4 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-headline text-lg sm:text-xl font-medium flex items-center gap-2 min-w-0">
              <span className="w-1 h-5 sm:h-6 bg-tertiary rounded-full shrink-0" />
              <span className="truncate">Available Challenges</span>
              <span className="text-sm font-normal text-outline tabular-nums shrink-0">
                ({completionChallengesForList.length})
              </span>
            </h2>
            <Button
              type="button"
              size="sm"
              variant="primary"
              leftIcon={<span className="material-symbols-outlined text-base leading-none">add</span>}
              onClick={() => router.push('/challenges/new')}
              className="shrink-0 w-full sm:w-auto"
            >
              Create challenge
            </Button>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-2 pt-0.5 border-t border-outline-variant/10">
            {userId ? (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-outline w-14 shrink-0">
                  Source
                </span>
                <SegmentedToggle
                  value={effectiveSourceFilter}
                  onChange={(next) => {
                    setSourceFilter(next);
                    setCompletionPage(0);
                  }}
                  size="xs"
                  options={[
                    { id: 'all', label: 'All' },
                    { id: 'yours', label: 'Yours' },
                  ]}
                />
              </div>
            ) : null}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-outline w-14 shrink-0">
                Progress
              </span>
              <SegmentedToggle
                value={completionFilter}
                onChange={(next) => {
                  setCompletionFilter(next);
                  setCompletionPage(0);
                }}
                size="xs"
                options={[
                  { id: 'not_done', label: 'Not started' },
                  { id: 'done', label: 'Done' },
                ]}
              />
            </div>
          </div>
        </div>

        {catalogLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-surface-container-low rounded-xl p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="w-12 h-12 bg-surface-container-high rounded-lg animate-pulse" />
                  <div className="w-16 h-5 bg-surface-container-high rounded animate-pulse" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 w-3/4 bg-surface-container-high rounded animate-pulse" />
                  <div className="h-3 w-full bg-surface-container-high rounded animate-pulse" />
                  <div className="h-3 w-5/6 bg-surface-container-high rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : challengesQuery.isError ? (
          <div className="bg-surface-container-low rounded-xl p-16 flex flex-col items-center text-center">
            <span className="material-symbols-outlined text-4xl text-outline mb-3">error</span>
            <p className="text-sm font-medium text-on-surface mb-1">Challenge catalog unavailable</p>
            <p className="text-xs text-on-surface-variant">Could not load the challenge list.</p>
          </div>
        ) : completionChallengesForList.length === 0 ? (
          <div className="bg-surface-container-low rounded-xl p-16 flex flex-col items-center text-center">
            <span className="material-symbols-outlined text-4xl text-outline mb-3">search_off</span>
            <p className="text-sm font-medium text-on-surface mb-1">No challenges found</p>
            <p className="text-xs text-on-surface-variant">
              Try changing the progress filter{userId ? ', source (All / Yours)' : ''}, or create a challenge.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {completionPageChallenges.map((challenge) => {
                const scanned = scannedChallengeIdsSet.has(challenge.id);
                const passed = passedChallengeIdsSet.has(challenge.id);
                const isDraftCard = !challenge.publishedVersionId;

                return (
                  <div
                    key={challenge.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openChallengeDetailPage(challenge.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openChallengeDetailPage(challenge.id);
                      }
                    }}
                    aria-label={`View details for ${challenge.title}`}
                    className="group bg-surface-container-low rounded-xl p-6 relative overflow-hidden border border-transparent hover:border-outline-variant/20 transition-all duration-200 hover:bg-surface-container cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <div className="flex items-start justify-between gap-2 mb-4">
                      <div className="w-12 h-12 rounded-lg bg-surface-container-highest flex items-center justify-center shrink-0">
                        <span
                          className={cn(
                            'material-symbols-outlined text-2xl',
                            passed
                              ? 'text-success'
                              : scanned
                                ? 'text-outline'
                                : 'text-tertiary',
                          )}
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          {passed ? 'check_circle' : scanned ? 'radio_button_unchecked' : 'quiz'}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 min-w-0">
                        <div className="flex flex-wrap justify-end gap-1">
                          {challenge.isYours ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-primary/20 text-primary px-2 py-0.5">
                              Yours
                            </span>
                          ) : null}
                          {isDraftCard ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-amber-500/20 text-amber-200 px-2 py-0.5">
                              Draft
                            </span>
                          ) : null}
                        </div>
                        <DifficultyBadge difficulty={challenge.difficulty} />
                      </div>
                    </div>

                    <h3 className="font-headline text-base font-bold text-on-surface group-hover:text-primary transition-colors mb-1.5">
                      {challenge.title}
                    </h3>

                    <p className="text-xs text-outline leading-relaxed line-clamp-2 mb-4">
                      {challenge.description}
                    </p>

                    <div className="border-t border-outline-variant/10 pt-4 grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-outline mb-1">
                          Points
                        </p>
                        <p className="text-sm font-mono font-bold text-on-surface">
                          {challenge.points} pts
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-outline mb-1">
                          Database
                        </p>
                        <p className="text-sm font-mono font-bold text-tertiary line-clamp-1">
                          {challenge.databaseName ?? 'N/A'}
                        </p>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <p className="text-xs text-on-surface-variant">
                Page {completionSafePage + 1}/{completionTotalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={completionSafePage <= 0}
                  onClick={() => setCompletionPage((p) => Math.max(0, p - 1))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    completionSafePage <= 0
                      ? 'border-outline-variant/10 bg-surface-container-low text-on-surface-variant/60 cursor-not-allowed'
                      : 'border-outline-variant/20 bg-surface-container-high text-on-surface hover:bg-surface-container-highest',
                  )}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={completionSafePage >= completionTotalPages - 1}
                  onClick={() => setCompletionPage((p) => Math.min(completionTotalPages - 1, p + 1))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    completionSafePage >= completionTotalPages - 1
                      ? 'border-outline-variant/10 bg-surface-container-low text-on-surface-variant/60 cursor-not-allowed'
                      : 'border-outline-variant/20 bg-surface-container-high text-on-surface hover:bg-surface-container-highest',
                  )}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

    </div>
  );
}

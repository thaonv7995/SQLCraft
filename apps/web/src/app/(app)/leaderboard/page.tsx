'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { DifficultyBadge } from '@/components/ui/badge';
import { challengesApi, leaderboardApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

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

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('alltime');
  const { user } = useAuthStore();
  const userId = user?.id ?? null;

  const [completionFilter, setCompletionFilter] = useState<ChallengeCompletionFilter>('not_done');
  const [completionPage, setCompletionPage] = useState(0);
  const completionPageSize = 6;

  const router = useRouter();

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
  const globalLeaders = useMemo(() => leaderboardQuery.data ?? [], [leaderboardQuery.data]);

  const desiredCompletionScanLimit = useMemo(() => {
    if (publishedChallenges.length === 0) {
      return 8;
    }
    return Math.min(
      publishedChallenges.length,
      Math.max(8, (completionPage + 1) * completionPageSize),
    );
  }, [publishedChallenges.length, completionPage, completionPageSize]);

  const [completionScanLimit, setCompletionScanLimit] = useState(8);
  if (publishedChallenges.length > 0) {
    const nextLimit = Math.max(completionScanLimit, desiredCompletionScanLimit);
    if (nextLimit !== completionScanLimit) {
      setCompletionScanLimit(nextLimit);
    }
  }

  const meEntry = useMemo(() => {
    if (!userId) return null;
    return globalLeaders.find((entry) => entry.userId === userId) ?? null;
  }, [globalLeaders, userId]);

  const completionScanChallenges = useMemo(() => {
    const sliced = publishedChallenges.slice(0, completionScanLimit);
    // Skip challenges without a published version to query attempts.
    return sliced.filter((ch) => Boolean(ch.publishedVersionId));
  }, [publishedChallenges, completionScanLimit]);

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

  const completionChallengesForList = useMemo(() => {
    const sorted = publishedChallenges
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    return sorted.filter((ch) => {
      const passed = passedChallengeIdsSet.has(ch.id);
      return completionFilter === 'done' ? passed : !passed;
    });
  }, [publishedChallenges, completionFilter, passedChallengeIdsSet]);

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

  return (
    <div className="page-shell page-stack">
      <section className="space-y-2">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.24em] text-outline">Challenge hub</p>
        </div>

        <div className="inline-flex max-w-full items-center gap-3 rounded-xl border border-outline-variant/15 bg-surface-container-low px-3 py-2 text-xs">
          <span className="text-on-surface-variant">
            Điểm <span className="font-semibold text-on-surface">{meEntry ? formatPoints(meEntry.points) : '—'}</span>
          </span>
          <span className="text-outline">•</span>
          <span className="text-on-surface-variant">
            Pass <span className="font-semibold text-on-surface">{meEntry ? meEntry.challengesCompleted : '—'}</span>
          </span>
          <span className="text-outline">•</span>
          <span className="text-on-surface-variant">
            Streak <span className="font-semibold text-on-surface">{meEntry ? `${meEntry.streak}d` : '—'}</span>
          </span>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="font-headline text-xl font-medium flex items-center gap-2">
            <span className="w-1.5 h-6 bg-tertiary rounded-full shrink-0" />
            Available Challenges
            <span className="text-sm font-normal text-outline ml-1">({completionChallengesForList.length})</span>
          </h2>

          <div className="flex items-center gap-2">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPeriod(option.id)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  period === option.id
                    ? 'bg-surface-container-high text-on-surface'
                    : 'bg-surface text-on-surface-variant hover:text-on-surface',
                )}
              >
                {option.label}
              </button>
            ))}
            {(
              [
                { id: 'not_done', label: 'Chưa làm' },
                { id: 'done', label: 'Đã làm' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setCompletionFilter(t.id);
                  setCompletionPage(0);
                }}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  completionFilter === t.id
                    ? 'bg-surface-container-high text-on-surface'
                    : 'bg-surface text-on-surface-variant hover:text-on-surface',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {challengesQuery.isLoading ? (
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
            <p className="text-xs text-on-surface-variant">Không thể tải danh sách challenge.</p>
          </div>
        ) : completionChallengesForList.length === 0 ? (
          <div className="bg-surface-container-low rounded-xl p-16 flex flex-col items-center text-center">
            <span className="material-symbols-outlined text-4xl text-outline mb-3">search_off</span>
            <p className="text-sm font-medium text-on-surface mb-1">No challenges found</p>
            <p className="text-xs text-on-surface-variant">Thử đổi filter trạng thái hoặc kỳ leaderboard.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {completionPageChallenges.map((challenge) => {
                const scanned = scannedChallengeIdsSet.has(challenge.id);
                const passed = passedChallengeIdsSet.has(challenge.id);

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
                    aria-label={`Xem chi tiết ${challenge.title}`}
                    className="group bg-surface-container-low rounded-xl p-6 relative overflow-hidden border border-transparent hover:border-outline-variant/20 transition-all duration-200 hover:bg-surface-container cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-lg bg-surface-container-highest flex items-center justify-center">
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
                      <DifficultyBadge difficulty={challenge.difficulty} />
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
                Trang {completionSafePage + 1}/{completionTotalPages}
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
                  Trước
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
                  Sau
                </button>
              </div>
            </div>
          </>
        )}
      </section>

    </div>
  );
}

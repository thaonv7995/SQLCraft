'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DifficultyBadge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { challengesApi, leaderboardApi } from '@/lib/api';
import { cn, generateInitials } from '@/lib/utils';

type LeaderboardPeriod = 'weekly' | 'monthly' | 'alltime';

const PERIOD_OPTIONS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'alltime', label: 'All Time' },
];

function formatPoints(points: number) {
  return `${points.toLocaleString()} pts`;
}

function getPodiumTone(rank: number) {
  if (rank === 1) {
    return 'border-secondary/20 bg-secondary/10';
  }

  if (rank === 2) {
    return 'border-primary/20 bg-primary/10';
  }

  return 'border-tertiary/20 bg-tertiary/10';
}

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('alltime');

  const challengesQuery = useQuery({
    queryKey: ['published-challenges'],
    queryFn: () => challengesApi.listPublished(),
    staleTime: 60_000,
  });

  const leaderboardQuery = useQuery({
    queryKey: ['global-leaderboard', period],
    queryFn: () => leaderboardApi.get(period, 25),
    staleTime: 30_000,
  });

  const publishedChallenges = useMemo(() => challengesQuery.data ?? [], [challengesQuery.data]);
  const globalLeaders = useMemo(() => leaderboardQuery.data ?? [], [leaderboardQuery.data]);
  const podiumLeaders = useMemo(() => globalLeaders.slice(0, 3), [globalLeaders]);
  const remainingLeaders = useMemo(() => globalLeaders.slice(3), [globalLeaders]);
  const rewardPool = useMemo(
    () => publishedChallenges.reduce((sum, challenge) => sum + challenge.points, 0),
    [publishedChallenges],
  );

  return (
    <div className="page-shell page-stack">
      <section className="space-y-5 rounded-[28px] border border-outline-variant/10 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(245,158,11,0.15),transparent_36%),var(--surface-container-low)] px-6 py-6">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.24em] text-outline">Challenge hub</p>
          <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface">
            Challenges
          </h1>
          <p className="max-w-3xl text-base leading-7 text-on-surface-variant">
            Pick a challenge, add a submission, and compare against the top users by point. Each
            challenge opens into the full problem statement, your submission timeline, and the
            local top users board.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-outline-variant/10 bg-surface/80 px-4 py-4 backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Top users tracked</p>
            <p className="mt-2 text-2xl font-semibold text-on-surface">{globalLeaders.length}</p>
            <p className="mt-1 text-sm text-on-surface-variant">
              Current snapshot for the selected period.
            </p>
          </div>
          <div className="rounded-2xl border border-outline-variant/10 bg-surface/80 px-4 py-4 backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Published challenges</p>
            <p className="mt-2 text-2xl font-semibold text-on-surface">
              {publishedChallenges.length}
            </p>
            <p className="mt-1 text-sm text-on-surface-variant">
              Each one opens with the problem statement and a local top users board.
            </p>
          </div>
          <div className="rounded-2xl border border-outline-variant/10 bg-surface/80 px-4 py-4 backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Reward pool</p>
            <p className="mt-2 text-2xl font-semibold text-on-surface">{formatPoints(rewardPool)}</p>
            <p className="mt-1 text-sm text-on-surface-variant">
              Fixed challenge rewards unlocked only after a valid pass.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <Card className="rounded-[28px] border border-outline-variant/10">
          <CardHeader className="flex-col gap-4 px-6 py-5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>Top users</CardTitle>
                <CardDescription className="mt-1 max-w-2xl">
                  Total points decide the global order. Switch period to see who is leading this
                  week, month, or all time before jumping into a specific challenge.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
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
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {leaderboardQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((index) => (
                  <div key={index} className="h-20 animate-pulse rounded-2xl bg-surface-container-low" />
                ))}
              </div>
            ) : leaderboardQuery.isError ? (
              <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                Global leaderboard is unavailable right now.
              </div>
            ) : globalLeaders.length === 0 ? (
              <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                No ranked players yet for this period.
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  {podiumLeaders.map((entry) => (
                    <div
                      key={entry.userId}
                      className={cn(
                        'rounded-2xl border px-4 py-4',
                        getPodiumTone(entry.rank),
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-sm font-bold text-on-surface">
                            {generateInitials(entry.displayName)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-on-surface">
                              {entry.displayName}
                            </p>
                            <p className="truncate text-xs text-on-surface-variant">
                              @{entry.username}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-full bg-surface/80 px-2 py-0.5 text-xs font-semibold text-on-surface">
                          #{entry.rank}
                        </span>
                      </div>

                      <div className="mt-4 space-y-1">
                        <p className="text-lg font-semibold text-on-surface">
                          {formatPoints(entry.points)}
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          {entry.challengesCompleted} challenges passed
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          {entry.streak} day streak
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  {remainingLeaders.map((entry) => (
                    <div
                      key={entry.userId}
                      className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-3"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          <div className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-on-surface-variant">
                            #{entry.rank}
                          </div>
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-high text-xs font-bold text-on-surface">
                            {generateInitials(entry.displayName)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-on-surface">{entry.displayName}</p>
                            <p className="truncate text-xs text-on-surface-variant">
                              @{entry.username}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-2 text-left text-sm text-on-surface-variant sm:grid-cols-3 sm:text-right">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">
                              Points
                            </p>
                            <p className="mt-1 font-mono text-secondary">
                              {entry.points.toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">
                              Passed
                            </p>
                            <p className="mt-1">{entry.challengesCompleted}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">
                              Streak
                            </p>
                            <p className="mt-1">{entry.streak} days</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-[28px] border border-outline-variant/10">
            <CardHeader className="px-6 py-5">
              <CardTitle>Challenge flow</CardTitle>
              <CardDescription className="mt-1">
                Ranking and submission are now one surface per challenge, not two separate pages.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-6 pb-6 pt-0">
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-outline">1 page</p>
                <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                  Read the rules, inspect your best validated run, submit the latest execution, and
                  watch rank movement without leaving the arena.
                </p>
              </div>
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Tie-break</p>
                <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                  Arena boards sort by lower runtime first, then lower cost, then earlier pass.
                </p>
              </div>
              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Reward</p>
                <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                  Points are fixed per challenge. Passing unlocks the reward once; rank only decides
                  bragging rights inside the arena.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border border-outline-variant/10">
            <CardHeader className="px-6 py-5">
              <CardTitle>Challenge list</CardTitle>
              <CardDescription className="mt-1">
                Open a challenge to read the problem, add a submission, and compare against the
                local top users.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-6 pb-6 pt-0">
              {challengesQuery.isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((index) => (
                    <div key={index} className="h-32 animate-pulse rounded-2xl bg-surface-container-low" />
                  ))}
                </div>
              ) : challengesQuery.isError ? (
                <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                  Challenge discovery is unavailable right now.
                </div>
              ) : publishedChallenges.length === 0 ? (
                <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                  No published challenges yet.
                </div>
              ) : (
                publishedChallenges.map((challenge) => (
                  <div
                    key={challenge.id}
                    className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-4"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-on-surface">{challenge.title}</h3>
                        <DifficultyBadge difficulty={challenge.difficulty} />
                        <span className="rounded-full bg-secondary/10 px-2 py-0.5 text-xs text-secondary">
                          {challenge.points} pts
                        </span>
                      </div>

                      <p className="text-sm leading-6 text-on-surface-variant">
                        {challenge.description}
                      </p>

                      <div className="grid gap-2 text-sm text-on-surface-variant sm:grid-cols-2">
                        <p>
                          <span className="text-on-surface">Track:</span> {challenge.trackTitle}
                        </p>
                        <p>
                          <span className="text-on-surface">Lesson:</span> {challenge.lessonTitle}
                        </p>
                        <p>
                          <span className="text-on-surface">Validator:</span>{' '}
                          {challenge.validatorType ?? 'result_set'}
                        </p>
                        <p>
                          <span className="text-on-surface">Version:</span> v
                          {challenge.latestVersionNo ?? 1}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/10 bg-surface px-3 py-3">
                        <p className="text-xs text-on-surface-variant">
                          Open the challenge to review the prompt, add a submission, and see the
                          local top users board.
                        </p>
                        <Link
                          href={`/tracks/${challenge.trackId}/lessons/${challenge.lessonId}/challenges/${challenge.id}`}
                          aria-label={`Add submission for ${challenge.title}`}
                          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition hover:brightness-105"
                        >
                          Add submission
                          <span className="material-symbols-outlined text-sm">arrow_forward</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DifficultyBadge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { challengesApi } from '@/lib/api';
import { cn, generateInitials } from '@/lib/utils';

export default function LeaderboardPage() {
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);

  const challengesQuery = useQuery({
    queryKey: ['published-challenges'],
    queryFn: () => challengesApi.listPublished(),
    staleTime: 60_000,
  });

  const publishedChallenges = challengesQuery.data ?? [];

  useEffect(() => {
    if (!selectedChallengeId && publishedChallenges.length > 0) {
      setSelectedChallengeId(publishedChallenges[0].id);
    }
  }, [publishedChallenges, selectedChallengeId]);

  const selectedChallenge = useMemo(
    () => publishedChallenges.find((challenge) => challenge.id === selectedChallengeId) ?? null,
    [publishedChallenges, selectedChallengeId],
  );

  const leaderboardQuery = useQuery({
    queryKey: ['challenge-leaderboard', selectedChallenge?.publishedVersionId],
    enabled: !!selectedChallenge?.publishedVersionId,
    queryFn: () => challengesApi.getLeaderboard(selectedChallenge!.publishedVersionId!, 10),
    staleTime: 30_000,
  });

  const leaderboard = leaderboardQuery.data ?? [];

  return (
    <div className="page-shell page-stack">
      <section className="space-y-3 rounded-[28px] border border-outline-variant/10 bg-surface-container-low px-6 py-6">
        <p className="text-xs uppercase tracking-[0.24em] text-outline">Challenge engine</p>
        <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface">
          Challenge Leaderboard
        </h1>
        <p className="max-w-3xl text-base leading-7 text-on-surface-variant">
          Browse live challenge missions, then inspect the best submitted scores for each published
          version.
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card className="rounded-[28px] border border-outline-variant/10">
          <CardHeader className="flex-col items-start gap-2 px-6 py-5">
            <div>
              <CardTitle>Published Challenges</CardTitle>
              <CardDescription className="mt-1">
                Select a mission to inspect its current leaderboard and scoring surface.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-6 pb-6 pt-0">
            {challengesQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((index) => (
                  <div key={index} className="h-28 animate-pulse rounded-2xl bg-surface-container-low" />
                ))}
              </div>
            ) : publishedChallenges.length === 0 ? (
              <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                No published challenges yet.
              </div>
            ) : (
              publishedChallenges.map((challenge) => {
                const isSelected = challenge.id === selectedChallengeId;

                return (
                  <button
                    key={challenge.id}
                    type="button"
                    onClick={() => setSelectedChallengeId(challenge.id)}
                    className={cn(
                      'w-full rounded-2xl border px-5 py-4 text-left transition-all',
                      isSelected
                        ? 'border-primary bg-primary/10'
                        : 'border-outline-variant/10 bg-surface-container-low hover:bg-surface-container',
                    )}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-on-surface">{challenge.title}</h3>
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
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border border-outline-variant/10">
          <CardHeader className="flex-col items-start gap-2 px-6 py-5">
            <div>
              <CardTitle>{selectedChallenge?.title ?? 'Leaderboard'}</CardTitle>
              <CardDescription className="mt-1">
                {selectedChallenge
                  ? `${selectedChallenge.trackTitle} / ${selectedChallenge.lessonTitle}`
                  : 'Select a challenge to view leaderboard entries.'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-6 pb-6 pt-0">
            {leaderboardQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((index) => (
                  <div key={index} className="h-16 animate-pulse rounded-2xl bg-surface-container-low" />
                ))}
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                No leaderboard entries yet for this challenge.
              </div>
            ) : (
              leaderboard.map((entry) => (
                <div
                  key={entry.userId}
                  className="flex items-center justify-between rounded-2xl bg-surface-container-low px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-high text-xs font-bold text-on-surface">
                      {generateInitials(entry.displayName)}
                    </div>
                    <div>
                      <p className="font-medium text-on-surface">{entry.displayName}</p>
                      <p className="text-xs text-on-surface-variant">@{entry.username}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="font-mono text-sm text-secondary">{entry.bestScore} pts</p>
                    <p className="text-xs text-on-surface-variant">#{entry.rank}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

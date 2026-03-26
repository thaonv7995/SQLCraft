'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Badge, DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { challengesApi, lessonsApi, sessionsApi, type ChallengeVersionDetail } from '@/lib/api';
import { saveLabBootstrap } from '@/lib/lab-bootstrap';
import { formatMinutes, formatRelativeTime, truncateSql } from '@/lib/utils';

function ChallengePageSkeleton() {
  return (
    <div className="page-shell-narrow page-stack">
      <div className="h-8 w-48 animate-pulse rounded bg-surface-container-low" />
      <div className="h-72 animate-pulse rounded-2xl bg-surface-container-low" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div className="space-y-4">
          <div className="h-72 animate-pulse rounded-2xl bg-surface-container-low" />
          <div className="h-64 animate-pulse rounded-2xl bg-surface-container-low" />
        </div>
        <div className="space-y-4">
          <div className="h-64 animate-pulse rounded-2xl bg-surface-container-low" />
          <div className="h-72 animate-pulse rounded-2xl bg-surface-container-low" />
        </div>
      </div>
    </div>
  );
}

function normalizeMetric(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareNullableAscending(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function AttemptStatusBadge({ status }: { status: string }) {
  if (status === 'passed') {
    return <Badge variant="success" dot>Passed</Badge>;
  }

  if (status === 'failed' || status === 'error') {
    return <Badge variant="error" dot>{status === 'failed' ? 'Failed' : 'Error'}</Badge>;
  }

  return <StatusBadge status={status} />;
}

function resolveChallengeRules(detail: ChallengeVersionDetail) {
  const config =
    detail.validatorConfig && typeof detail.validatorConfig === 'object'
      ? detail.validatorConfig
      : {};
  const baselineDurationMs =
    typeof config.baselineDurationMs === 'number' ? config.baselineDurationMs : null;
  const requiresIndexOptimization = config.requiresIndexOptimization === true;
  const totalPoints = Math.max(0, detail.points ?? 100);

  return {
    rewardPoints: totalPoints,
    baselineDurationMs,
    requiresIndexOptimization,
  };
}

function ChallengeRuleCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-xl bg-surface-container-high p-4">
      <p className="font-medium text-on-surface">{label}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-outline">{value}</p>
      <p className="mt-2 text-sm leading-6 text-on-surface-variant">{description}</p>
    </div>
  );
}

function ArenaMetricCard({
  label,
  value,
  supporting,
  tone = 'default',
  children,
}: {
  label: string;
  value: string;
  supporting: string;
  tone?: 'default' | 'success' | 'warning';
  children?: ReactNode;
}) {
  const toneClasses =
    tone === 'success'
      ? 'border-secondary/20 bg-secondary/10'
      : tone === 'warning'
        ? 'border-tertiary/20 bg-tertiary/10'
        : 'border-outline-variant/10 bg-surface';

  return (
    <div className={`rounded-2xl border px-4 py-4 ${toneClasses}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">{label}</p>
      <p className="mt-2 text-xl font-semibold text-on-surface">{value}</p>
      <p className="mt-1 text-sm leading-6 text-on-surface-variant">{supporting}</p>
      {children}
    </div>
  );
}

function AttemptEvaluationSummary({
  evaluation,
}: {
  evaluation: {
    passesChallenge?: boolean;
    score?: number;
    pointsPossible?: number;
    baselineDurationMs?: number | null;
    latestDurationMs?: number | null;
    meetsPerformanceTarget?: boolean | null;
    requiresIndexOptimization?: boolean;
    usedIndexing?: boolean;
  } | null | undefined;
}) {
  if (!evaluation) {
    return null;
  }

  const items = [
    typeof evaluation.score === 'number' && typeof evaluation.pointsPossible === 'number'
      ? {
          label: evaluation.passesChallenge ? 'Reward unlocked' : 'Reward locked',
          value: evaluation.passesChallenge
            ? `${evaluation.score}/${evaluation.pointsPossible} pts`
            : `0/${evaluation.pointsPossible} pts`,
        }
      : null,
    evaluation.baselineDurationMs != null
      ? {
          label: 'Runtime target',
          value:
            evaluation.meetsPerformanceTarget === false
              ? `${evaluation.latestDurationMs ?? 'unknown'} ms vs ${evaluation.baselineDurationMs} ms`
              : `${evaluation.baselineDurationMs} ms`,
        }
      : null,
    evaluation.latestDurationMs != null
      ? {
          label: 'Recorded run',
          value: `${evaluation.latestDurationMs} ms`,
        }
      : null,
    evaluation.requiresIndexOptimization
      ? {
          label: 'Index evidence',
          value: evaluation.usedIndexing ? 'Confirmed' : 'Missing',
        }
      : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-on-surface-variant">
        {items.map((item) => (
          <span
            key={item.label}
            className="rounded-full bg-surface-container-high px-2 py-1"
          >
            {item.label}: {item.value}
          </span>
        ))}
    </div>
  );
}

export default function ChallengePage() {
  const params = useParams<{
    trackId: string;
    lessonId: string;
    challengeId: string;
  }>();
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  const { data: lesson, isLoading: lessonLoading } = useQuery({
    queryKey: ['lesson', params.lessonId],
    queryFn: () => lessonsApi.get(params.lessonId),
    staleTime: 60_000,
  });

  const {
    data: lessonVersion,
    isLoading: versionLoading,
    error: versionError,
    refetch: refetchVersion,
  } = useQuery({
    queryKey: ['lesson-version-for-challenge', lesson?.publishedVersionId],
    queryFn: () => lessonsApi.getVersion(lesson!.publishedVersionId!),
    enabled: Boolean(lesson?.publishedVersionId),
    staleTime: 60_000,
  });

  const challengeSummary =
    lessonVersion?.challenges.find((item) => item.id === params.challengeId) ?? null;

  const {
    data: challengeVersion,
    isLoading: challengeLoading,
    error: challengeError,
    refetch: refetchChallenge,
  } = useQuery({
    queryKey: ['challenge-version-detail', challengeSummary?.publishedVersionId],
    queryFn: () => challengesApi.getVersion(challengeSummary!.publishedVersionId!),
    enabled: Boolean(challengeSummary?.publishedVersionId),
    staleTime: 60_000,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['challenge-page-sessions'],
    queryFn: () => sessionsApi.list(),
    staleTime: 30_000,
  });

  const { data: attempts = [] } = useQuery({
    queryKey: ['challenge-attempts', challengeSummary?.publishedVersionId],
    queryFn: () => challengesApi.listAttempts(challengeSummary!.publishedVersionId!),
    enabled: Boolean(challengeSummary?.publishedVersionId),
    staleTime: 15_000,
  });

  const { data: leaderboard = [] } = useQuery({
    queryKey: ['challenge-leaderboard', challengeSummary?.publishedVersionId],
    queryFn: () => challengesApi.getLeaderboard(challengeSummary!.publishedVersionId!, 8),
    enabled: Boolean(challengeSummary?.publishedVersionId),
    staleTime: 30_000,
  });

  const resumableSession =
    lessonVersion && challengeSummary?.publishedVersionId
      ? sessions.find(
          (session) =>
            session.lessonVersionId === lessonVersion.id &&
            session.challengeVersionId === challengeSummary.publishedVersionId &&
            (session.status === 'active' ||
              session.status === 'paused' ||
              session.status === 'provisioning'),
        ) ?? null
      : null;

  const bestAttempt = attempts
    .filter((attempt) => attempt.status === 'passed')
    .reduce<(typeof attempts)[number] | null>((best, attempt) => {
      if (!best) {
        return attempt;
      }

      const durationComparison = compareNullableAscending(
        normalizeMetric(attempt.queryExecution.durationMs),
        normalizeMetric(best.queryExecution.durationMs),
      );
      if (durationComparison < 0) {
        return attempt;
      }
      if (durationComparison > 0) {
        return best;
      }

      const costComparison = compareNullableAscending(
        normalizeMetric(attempt.queryExecution.totalCost),
        normalizeMetric(best.queryExecution.totalCost),
      );
      if (costComparison < 0) {
        return attempt;
      }
      if (costComparison > 0) {
        return best;
      }

      return new Date(attempt.submittedAt) < new Date(best.submittedAt) ? attempt : best;
    }, null);
  const latestAttempt = attempts[0] ?? null;

  const handleStartChallengeLab = async () => {
    if (!lessonVersion || !challengeSummary?.publishedVersionId) {
      toast.error('This challenge is not available yet');
      return;
    }

    setStarting(true);

    try {
      const session = await sessionsApi.create({
        lessonVersionId: lessonVersion.id,
        challengeVersionId: challengeSummary.publishedVersionId,
      });

      saveLabBootstrap(session.id, {
        mode: 'challenge',
        lessonPath: `/tracks/${params.trackId}/lessons/${params.lessonId}`,
        lessonTitle: lessonVersion.lesson?.title ?? lesson?.title ?? 'Lesson',
        challengePath: `/tracks/${params.trackId}/lessons/${params.lessonId}/challenges/${params.challengeId}`,
        challengeTitle: challengeSummary.title,
        starterQuery: lessonVersion.starterQuery ?? null,
        starterQueryConsumed: false,
      });

      router.push(`/lab/${session.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start challenge lab');
      setStarting(false);
    }
  };

  const handleContinueChallengeLab = () => {
    if (!resumableSession) {
      return;
    }

    saveLabBootstrap(resumableSession.id, {
      mode: 'challenge',
      lessonPath: `/tracks/${params.trackId}/lessons/${params.lessonId}`,
      lessonTitle: lessonVersion?.lesson?.title ?? lesson?.title ?? 'Lesson',
      challengePath: `/tracks/${params.trackId}/lessons/${params.lessonId}/challenges/${params.challengeId}`,
      challengeTitle: challengeSummary?.title ?? 'Challenge',
      starterQuery: lessonVersion?.starterQuery ?? null,
      starterQueryConsumed: true,
    });
    router.push(`/lab/${resumableSession.id}`);
  };

  if (
    lessonLoading ||
    (Boolean(lesson?.publishedVersionId) && versionLoading) ||
    (Boolean(challengeSummary?.publishedVersionId) && challengeLoading)
  ) {
    return <ChallengePageSkeleton />;
  }

  if (
    !lesson ||
    !lessonVersion ||
    !challengeSummary ||
    !challengeSummary.publishedVersionId ||
    !challengeVersion ||
    versionError ||
    challengeError
  ) {
    return (
      <div className="page-shell-narrow page-stack">
        <Link
          href={`/tracks/${params.trackId}/lessons/${params.lessonId}`}
          className="inline-flex w-fit items-center gap-2 text-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Back to lesson
        </Link>

        <Card className="rounded-2xl">
          <CardContent className="flex flex-col gap-4 py-8">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-3xl text-outline">target</span>
              <div>
                <CardTitle>Challenge unavailable</CardTitle>
                <CardDescription className="mt-1">
                  {challengeError instanceof Error
                    ? challengeError.message
                    : versionError instanceof Error
                      ? versionError.message
                      : 'This challenge could not be loaded from the published lesson version.'}
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  void refetchVersion();
                  void refetchChallenge();
                }}
              >
                Try again
              </Button>
              <Button
                variant="secondary"
                onClick={() => router.push(`/tracks/${params.trackId}/lessons/${params.lessonId}`)}
              >
                Back to lesson
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const latestFeedback =
    latestAttempt?.evaluation?.feedbackText ??
    (latestAttempt?.status === 'passed'
      ? 'Latest attempt passed all challenge requirements.'
      : latestAttempt?.status === 'failed'
        ? 'Latest attempt did not satisfy the challenge requirements yet.'
        : null);
  const challengeRules = resolveChallengeRules(challengeVersion);
  const arenaLeader = leaderboard[0] ?? null;

  return (
    <div className="page-shell-narrow page-stack">
      <Link
        href={`/tracks/${params.trackId}/lessons/${params.lessonId}`}
        className="inline-flex w-fit items-center gap-2 text-sm text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Back to lesson
      </Link>

      <Card className="overflow-hidden rounded-[1.75rem] border border-outline-variant/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0.01))]">
        <CardContent className="px-6 py-7 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge variant="published">Published challenge</Badge>
                <DifficultyBadge difficulty={challengeSummary.difficulty} />
                <Badge variant="default">{challengeVersion.validatorType.replace('_', ' ')} validator</Badge>
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                  Based on {formatMinutes(lessonVersion.lesson?.estimatedMinutes ?? lesson.estimatedMinutes)}
                </span>
              </div>

              <h1 className="font-headline text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
                {challengeSummary.title}
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-on-surface-variant">
                {challengeSummary.description}
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                    Reward
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-secondary">
                    {challengeRules.rewardPoints} pts
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Unlocks once a run satisfies every challenge requirement.
                  </p>
                </div>

                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                    Best validated run
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-on-surface">
                    {bestAttempt?.queryExecution.durationMs != null
                      ? `${bestAttempt.queryExecution.durationMs} ms`
                      : '—'}
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {bestAttempt
                      ? `cost ${bestAttempt.queryExecution.totalCost != null ? Math.round(bestAttempt.queryExecution.totalCost) : '—'} • attempt #${bestAttempt.attemptNo}`
                      : 'Pass the challenge to establish your benchmark run.'}
                  </p>
                </div>

                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                    Attempts
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-on-surface">
                    {attempts.length}
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {latestAttempt
                      ? `Last run ${formatRelativeTime(latestAttempt.submittedAt)}`
                      : 'Start a lab to submit the first solution.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto">
              {resumableSession ? (
                <>
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={handleContinueChallengeLab}
                    leftIcon={<span className="material-symbols-outlined text-lg">play_circle</span>}
                  >
                    Continue Challenge Lab
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    loading={starting}
                    onClick={handleStartChallengeLab}
                    leftIcon={<span className="material-symbols-outlined text-lg">add_circle</span>}
                  >
                    Start Fresh Lab
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  loading={starting}
                  onClick={handleStartChallengeLab}
                  leftIcon={<span className="material-symbols-outlined text-lg">flag</span>}
                >
                  Start Challenge Lab
                </Button>
              )}
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => router.push(`/tracks/${params.trackId}/lessons/${params.lessonId}`)}
              >
                Return to lesson
              </Button>
              <p className="max-w-72 text-xs leading-5 text-on-surface-variant">
                Run SQL inside the lab, then submit your latest successful execution for challenge evaluation.
                Challenge sessions keep lesson starter SQL and challenge context together.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div className="space-y-4">
          <Card className="rounded-2xl border border-outline-variant/10">
            <CardHeader>
              <CardTitle>Problem Statement</CardTitle>
              <CardDescription>
                Solve this in the SQL lab and submit the execution that best satisfies the validator.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl bg-surface-container-low px-4 py-4 text-sm leading-7 text-on-surface whitespace-pre-wrap">
                {challengeVersion.problemStatement}
              </div>

              {challengeVersion.hintText ? (
                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                    Hint
                  </p>
                  <p className="mt-2 text-sm leading-6 text-on-surface-variant whitespace-pre-wrap">
                    {challengeVersion.hintText}
                  </p>
                </div>
              ) : null}

              {challengeVersion.expectedResultColumns.length ? (
                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                    Expected result columns
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {challengeVersion.expectedResultColumns.map((column) => (
                      <code
                        key={column}
                        className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs text-on-surface"
                      >
                        {column}
                      </code>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-outline-variant/10">
            <CardHeader>
              <CardTitle>Pass Conditions</CardTitle>
              <CardDescription>
                Pass unlocks fixed challenge points. Passed runs are ranked by lower runtime first, then
                lower plan cost.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-on-surface-variant">
              <ChallengeRuleCard
                label="Reward"
                value={`${challengeRules.rewardPoints} pts`}
                description="A submitted run either unlocks the full reward or no reward at all. There is no partial scoring inside a challenge."
              />

              {challengeRules.baselineDurationMs != null ? (
                <ChallengeRuleCard
                  label="Runtime target"
                  value={`<= ${challengeRules.baselineDurationMs} ms`}
                  description="A correct result set still fails the challenge when the submitted execution is slower than the configured runtime ceiling."
                />
              ) : null}

              {challengeRules.requiresIndexOptimization ? (
                <ChallengeRuleCard
                  label="Index evidence"
                  value="Required"
                  description="The challenge only passes when session history and EXPLAIN ANALYZE together confirm that the winning run used the expected index strategy."
                />
              ) : null}

              <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                  Ranking rule
                </p>
                <p className="mt-2 text-lg font-semibold text-on-surface">
                  Lower time, then lower cost
                </p>
                <p className="mt-1 text-sm leading-6 text-on-surface-variant">
                  Safe optimization workflows in the lab include keeping query history, comparing query variants, creating or dropping indexes, inspecting schema drift, and resetting the sandbox back to base before the final run.
                </p>
              </div>

            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="rounded-2xl border border-outline-variant/10">
            <CardHeader>
              <CardTitle>Challenge Arena</CardTitle>
              <CardDescription>
                Submission result and ranking now live in one arena. Submit in the lab, then use this
                board to compare your latest validated run against the live field.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 lg:grid-cols-3">
                <ArenaMetricCard
                  label="Latest submission"
                  value={
                    latestAttempt
                      ? latestAttempt.status === 'passed'
                        ? 'Passed'
                        : latestAttempt.status === 'failed'
                          ? 'Not passed'
                          : latestAttempt.status
                      : 'No run yet'
                  }
                  supporting={
                    latestAttempt
                      ? `Attempt #${latestAttempt.attemptNo} • ${formatRelativeTime(latestAttempt.submittedAt)}`
                      : 'Start a challenge lab and submit the first execution.'
                  }
                  tone={latestAttempt?.status === 'passed' ? 'success' : latestAttempt ? 'warning' : 'default'}
                >
                  {latestFeedback ? (
                    <>
                      <p className="mt-3 text-sm leading-6 text-on-surface-variant">{latestFeedback}</p>
                      <AttemptEvaluationSummary evaluation={latestAttempt?.evaluation} />
                    </>
                  ) : null}
                </ArenaMetricCard>

                <ArenaMetricCard
                  label="Your benchmark"
                  value={
                    bestAttempt?.queryExecution.durationMs != null
                      ? `${bestAttempt.queryExecution.durationMs} ms`
                      : 'Awaiting pass'
                  }
                  supporting={
                    bestAttempt
                      ? `cost ${bestAttempt.queryExecution.totalCost != null ? Math.round(bestAttempt.queryExecution.totalCost) : '—'} • reward unlocked`
                      : 'Your best passed run becomes the benchmark used to compare later submissions.'
                  }
                />

                <ArenaMetricCard
                  label="Arena leader"
                  value={
                    arenaLeader?.bestDurationMs != null
                      ? `${arenaLeader.bestDurationMs} ms`
                      : 'Open board'
                  }
                  supporting={
                    arenaLeader
                      ? `#${arenaLeader.rank} ${arenaLeader.displayName} • cost ${arenaLeader.bestTotalCost != null ? Math.round(arenaLeader.bestTotalCost) : '—'}`
                      : 'No ranked entry yet. The first validated pass becomes the pace setter.'
                  }
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-headline text-base font-semibold tracking-tight text-on-surface">
                        Your submission timeline
                      </h3>
                      <p className="mt-1 text-sm text-on-surface-variant">
                        Newest attempts first across all your sessions on this challenge version.
                      </p>
                    </div>
                    <div className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-on-surface-variant">
                      {attempts.length} runs
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {attempts.length ? (
                      attempts.map((attempt) => (
                        <div
                          key={attempt.id}
                          className="rounded-2xl border border-outline-variant/10 bg-surface px-4 py-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <AttemptStatusBadge status={attempt.status} />
                            <span className="text-sm font-semibold text-on-surface">
                              {attempt.status === 'passed'
                                ? `+${challengeRules.rewardPoints} pts`
                                : 'Reward locked'}
                            </span>
                            <span className="text-xs text-outline">Attempt #{attempt.attemptNo}</span>
                            <span className="ml-auto text-xs text-outline">
                              {formatRelativeTime(attempt.submittedAt)}
                            </span>
                          </div>

                          <p className="mt-3 text-xs font-mono text-on-surface-variant">
                            {truncateSql(attempt.queryExecution.sqlText, 140)}
                          </p>

                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-on-surface-variant">
                            <span className="rounded-full bg-surface-container-high px-2 py-1">
                              Query {attempt.queryExecution.status}
                            </span>
                            {attempt.queryExecution.rowsReturned != null ? (
                              <span className="rounded-full bg-surface-container-high px-2 py-1">
                                {attempt.queryExecution.rowsReturned} rows
                              </span>
                            ) : null}
                            {attempt.queryExecution.durationMs != null ? (
                              <span className="rounded-full bg-surface-container-high px-2 py-1">
                                {attempt.queryExecution.durationMs} ms
                              </span>
                            ) : null}
                            {attempt.queryExecution.totalCost != null ? (
                              <span className="rounded-full bg-surface-container-high px-2 py-1">
                                cost {Math.round(attempt.queryExecution.totalCost)}
                              </span>
                            ) : null}
                          </div>

                          {attempt.evaluation?.feedbackText ? (
                            <>
                              <p className="mt-3 text-sm leading-6 text-on-surface-variant">
                                {attempt.evaluation.feedbackText}
                              </p>
                              <AttemptEvaluationSummary evaluation={attempt.evaluation} />
                            </>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-outline-variant/20 bg-surface px-4 py-6 text-sm text-on-surface-variant">
                        No submitted attempts yet. Start the challenge lab, run a query, then submit the
                        latest successful execution.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-headline text-base font-semibold tracking-tight text-on-surface">
                        Top users
                      </h3>
                      <p className="mt-1 text-sm text-on-surface-variant">
                        Fastest validated run wins this challenge. Runtime breaks ties before plan
                        cost.
                      </p>
                    </div>
                    <div className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-on-surface-variant">
                      {leaderboard.length} ranked
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {leaderboard.length ? (
                      leaderboard.map((entry) => (
                        <div
                          key={entry.userId}
                          className="flex items-center gap-3 rounded-2xl border border-outline-variant/10 bg-surface px-4 py-3"
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-high text-sm font-semibold text-on-surface">
                            #{entry.rank}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-on-surface">
                              {entry.displayName}
                            </p>
                            <p className="text-xs text-on-surface-variant">
                              {entry.attemptsCount} attempts • {entry.passedAttempts} passed
                            </p>
                            <p className="mt-2 truncate font-mono text-[11px] text-on-surface-variant">
                              {entry.sqlText}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-secondary">
                              {entry.bestDurationMs != null ? `${entry.bestDurationMs} ms` : '—'}
                            </p>
                            <p className="text-[11px] text-outline">
                              cost {entry.bestTotalCost != null ? Math.round(entry.bestTotalCost) : '—'} •{' '}
                              {formatRelativeTime(entry.lastSubmittedAt)}
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-outline-variant/20 bg-surface px-4 py-6 text-sm text-on-surface-variant">
                        No leaderboard entries yet. The board fills in automatically once attempts are
                        submitted.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

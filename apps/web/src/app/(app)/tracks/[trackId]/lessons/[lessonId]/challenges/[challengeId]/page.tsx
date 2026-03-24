'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { DifficultyBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { lessonsApi, sessionsApi } from '@/lib/api';
import { saveLabBootstrap } from '@/lib/lab-bootstrap';
import { formatMinutes } from '@/lib/utils';

function ChallengePageSkeleton() {
  return (
    <div className="page-shell-narrow page-stack">
      <div className="h-8 w-48 animate-pulse rounded bg-surface-container-low" />
      <div className="h-72 animate-pulse rounded-2xl bg-surface-container-low" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-56 animate-pulse rounded-2xl bg-surface-container-low" />
        <div className="h-56 animate-pulse rounded-2xl bg-surface-container-low" />
      </div>
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
    error,
    refetch,
  } = useQuery({
    queryKey: ['lesson-version-for-challenge', lesson?.publishedVersionId],
    queryFn: () => lessonsApi.getVersion(lesson!.publishedVersionId!),
    enabled: Boolean(lesson?.publishedVersionId),
    staleTime: 60_000,
  });

  if (lessonLoading || (Boolean(lesson?.publishedVersionId) && versionLoading)) {
    return <ChallengePageSkeleton />;
  }

  const challenge = lessonVersion?.challenges.find((item) => item.id === params.challengeId) ?? null;

  const handleStartChallengeLab = async () => {
    if (!lessonVersion || !challenge?.publishedVersionId) {
      toast.error('This challenge is not available yet');
      return;
    }

    setStarting(true);

    try {
      const session = await sessionsApi.create({
        lessonVersionId: lessonVersion.id,
        challengeVersionId: challenge.publishedVersionId,
      });

      saveLabBootstrap(session.id, {
        mode: 'challenge',
        lessonPath: `/tracks/${params.trackId}/lessons/${params.lessonId}`,
        lessonTitle: lessonVersion.lesson?.title ?? lesson?.title ?? 'Lesson',
        challengePath: `/tracks/${params.trackId}/lessons/${params.lessonId}/challenges/${params.challengeId}`,
        challengeTitle: challenge.title,
        starterQuery: lessonVersion.starterQuery ?? null,
        starterQueryConsumed: false,
      });

      router.push(`/lab/${session.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start challenge lab');
      setStarting(false);
    }
  };

  if (!lesson || !lessonVersion || !challenge || error) {
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
                  {error instanceof Error ? error.message : 'This challenge summary could not be loaded from the lesson version.'}
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void refetch()}>
                Try again
              </Button>
              <Button variant="secondary" onClick={() => router.push(`/tracks/${params.trackId}/lessons/${params.lessonId}`)}>
                Back to lesson
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                  Challenge placeholder
                </span>
                <DifficultyBadge difficulty={challenge.difficulty} />
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                  Based on {formatMinutes(lessonVersion.lesson?.estimatedMinutes ?? lesson.estimatedMinutes)}
                </span>
              </div>

              <h1 className="font-headline text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
                {challenge.title}
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-on-surface-variant">
                {challenge.description}
              </p>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-outline">
                Challenge authoring, validation, scoring, leaderboard, and optimization benchmarks land in feature 4.
                This route exists now so the lesson-first information architecture stays stable.
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto">
              <Button
                variant="primary"
                size="lg"
                loading={starting}
                onClick={handleStartChallengeLab}
                leftIcon={<span className="material-symbols-outlined text-lg">flag</span>}
              >
                Start Challenge Lab
              </Button>
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => router.push(`/tracks/${params.trackId}/lessons/${params.lessonId}`)}
              >
                Return to lesson
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl border border-outline-variant/10">
          <CardHeader>
            <CardTitle>Available now</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-on-surface-variant">
            <div className="rounded-xl bg-surface-container-high p-3">
              Open a dedicated challenge route nested under the lesson.
            </div>
            <div className="rounded-xl bg-surface-container-high p-3">
              Launch a session in challenge mode with `challengeVersionId`.
            </div>
            <div className="rounded-xl bg-surface-container-high p-3">
              Keep starter SQL and back-navigation context inside the lab.
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-outline-variant/10">
          <CardHeader>
            <CardTitle>Coming next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-on-surface-variant">
            <div className="rounded-xl bg-surface-container-high p-3">
              Result-set validation and pass/fail feedback.
            </div>
            <div className="rounded-xl bg-surface-container-high p-3">
              Points, benchmarks, and leaderboard comparison.
            </div>
            <div className="rounded-xl bg-surface-container-high p-3">
              Optimization and index-specific scoring.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

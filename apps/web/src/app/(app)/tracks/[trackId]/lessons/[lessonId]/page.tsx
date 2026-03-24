'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { LessonMarkdown } from '@/components/lesson/lesson-markdown';
import { DifficultyBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { lessonsApi, sessionsApi, tracksApi } from '@/lib/api';
import { saveLabBootstrap } from '@/lib/lab-bootstrap';
import { formatMinutes } from '@/lib/utils';

function LessonPageSkeleton() {
  return (
    <div className="page-shell-narrow page-stack">
      <div className="h-8 w-44 animate-pulse rounded bg-surface-container-low" />
      <div className="h-56 animate-pulse rounded-2xl bg-surface-container-low" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="h-[36rem] animate-pulse rounded-2xl bg-surface-container-low" />
        <div className="h-80 animate-pulse rounded-2xl bg-surface-container-low" />
      </div>
    </div>
  );
}

export default function LessonPage() {
  const params = useParams<{ trackId: string; lessonId: string }>();
  const router = useRouter();
  const [startingLab, setStartingLab] = useState(false);

  const { data: track, isLoading: trackLoading } = useQuery({
    queryKey: ['track', params.trackId],
    queryFn: () => tracksApi.get(params.trackId),
    staleTime: 60_000,
  });

  const {
    data: lesson,
    isLoading: lessonLoading,
    error: lessonError,
    refetch: refetchLesson,
  } = useQuery({
    queryKey: ['lesson', params.lessonId],
    queryFn: () => lessonsApi.get(params.lessonId),
    staleTime: 60_000,
  });

  const {
    data: lessonVersion,
    isLoading: versionLoading,
    error: versionError,
    refetch: refetchLessonVersion,
  } = useQuery({
    queryKey: ['lesson-version', lesson?.publishedVersionId],
    queryFn: () => lessonsApi.getVersion(lesson!.publishedVersionId!),
    enabled: Boolean(lesson?.publishedVersionId),
    staleTime: 60_000,
  });

  const isLoading = trackLoading || lessonLoading || (Boolean(lesson?.publishedVersionId) && versionLoading);
  const error = lessonError ?? versionError;

  const lessonTitle = lessonVersion?.lesson?.title ?? lesson?.title ?? 'Lesson';
  const estimatedMinutes = lessonVersion?.lesson?.estimatedMinutes ?? lesson?.estimatedMinutes ?? 0;
  const challengeCount = lessonVersion?.challenges.length ?? 0;

  const handleStartLab = async () => {
    if (!lessonVersion) {
      toast.error('This lesson is not published yet');
      return;
    }

    setStartingLab(true);

    try {
      const session = await sessionsApi.create({ lessonVersionId: lessonVersion.id });

      saveLabBootstrap(session.id, {
        lessonPath: `/tracks/${params.trackId}/lessons/${params.lessonId}`,
        lessonTitle,
        starterQuery: lessonVersion.starterQuery ?? null,
        starterQueryConsumed: false,
      });

      router.push(`/lab/${session.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start lab');
      setStartingLab(false);
    }
  };

  if (isLoading) {
    return <LessonPageSkeleton />;
  }

  if (error || !lesson) {
    return (
      <div className="page-shell-narrow page-stack">
        <Link
          href={`/tracks/${params.trackId}`}
          className="inline-flex w-fit items-center gap-2 text-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Back to track
        </Link>

        <Card className="rounded-2xl">
          <CardContent className="flex flex-col gap-4 py-8">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-3xl text-outline">menu_book</span>
              <div>
                <CardTitle>Lesson unavailable</CardTitle>
                <CardDescription className="mt-1">
                  {error instanceof Error ? error.message : 'This lesson could not be loaded.'}
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => { void refetchLesson(); void refetchLessonVersion(); }}>
                Try again
              </Button>
              <Button variant="secondary" onClick={() => router.push(`/tracks/${params.trackId}`)}>
                Back to track
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
        href={`/tracks/${params.trackId}`}
        className="inline-flex w-fit items-center gap-2 text-sm text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        {track?.title ? `Back to ${track.title}` : 'Back to track'}
      </Link>

      <Card className="overflow-hidden rounded-[1.75rem] border border-outline-variant/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0.01))]">
        <CardContent className="px-6 py-7 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <DifficultyBadge difficulty={lesson.difficulty} />
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                  {formatMinutes(estimatedMinutes)}
                </span>
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                  {challengeCount > 0 ? `${challengeCount} optional challenges` : 'Guided lesson'}
                </span>
              </div>
              <h1 className="font-headline text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
                {lessonTitle}
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-on-surface-variant">
                {lesson.description || 'Read the concept guide, study the SQL examples, then launch the practice lab with the starter query preloaded.'}
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto">
              <Button
                variant="primary"
                size="lg"
                loading={startingLab}
                onClick={handleStartLab}
                leftIcon={<span className="material-symbols-outlined text-lg">play_arrow</span>}
              >
                Start Lab
              </Button>
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => router.push(`/tracks/${params.trackId}`)}
              >
                View all lessons
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="rounded-2xl border border-outline-variant/10">
          <CardContent className="px-6 py-7 sm:px-8">
            {lessonVersion ? (
              <LessonMarkdown content={lessonVersion.content} />
            ) : (
              <div className="flex min-h-60 items-center justify-center rounded-2xl border border-dashed border-outline-variant/20 bg-surface-container-lowest px-6 text-center text-sm text-on-surface-variant">
                This lesson is published without a content body yet.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="rounded-2xl border border-outline-variant/10">
            <CardHeader>
              <CardTitle>Lesson Flow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl bg-surface-container-high p-3">
                <p className="font-medium text-on-surface">1. Read the guide</p>
                <p className="mt-1 text-on-surface-variant">
                  Study the markdown lesson and examples before opening the sandbox.
                </p>
              </div>
              <div className="rounded-xl bg-surface-container-high p-3">
                <p className="font-medium text-on-surface">2. Start the lab</p>
                <p className="mt-1 text-on-surface-variant">
                  SQLCraft will preload the starter query from this lesson version.
                </p>
              </div>
              <div className="rounded-xl bg-surface-container-high p-3">
                <p className="font-medium text-on-surface">3. Practice more</p>
                <p className="mt-1 text-on-surface-variant">
                  Optional challenges live here next. The layout already reserves that slot.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-outline-variant/10">
            <CardHeader>
              <CardTitle>Practice After This Lesson</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lessonVersion?.challenges.length ? (
                lessonVersion.challenges.map((challenge) => (
                  <div
                    key={challenge.id}
                    className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-on-surface">{challenge.title}</p>
                      <DifficultyBadge difficulty={challenge.difficulty} />
                    </div>
                    <p className="text-xs leading-6 text-on-surface-variant">
                      {challenge.description}
                    </p>
                    <p className="mt-2 text-[11px] uppercase tracking-wider text-outline">
                      Challenge UI lands in feature 4
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-lowest p-4 text-sm text-on-surface-variant">
                  No optional challenges are attached to this lesson yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

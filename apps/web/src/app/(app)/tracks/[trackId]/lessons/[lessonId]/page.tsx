'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { LessonMarkdown } from '@/components/lesson/lesson-markdown';
import { Badge, DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { lessonsApi, sessionsApi, tracksApi } from '@/lib/api';
import { saveLabBootstrap } from '@/lib/lab-bootstrap';
import { formatMinutes, formatRelativeTime } from '@/lib/utils';

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

function isResumableSession(status: string | null | undefined): boolean {
  return status === 'active' || status === 'provisioning' || status === 'paused';
}

function getSchemaTableNames(definition: unknown): string[] {
  if (!definition || typeof definition !== 'object') {
    return [];
  }

  const maybeTables = (definition as { tables?: unknown }).tables;
  if (!Array.isArray(maybeTables)) {
    return [];
  }

  return maybeTables
    .map((table) =>
      table && typeof table === 'object' && typeof (table as { name?: unknown }).name === 'string'
        ? (table as { name: string }).name
        : null,
    )
    .filter((tableName): tableName is string => Boolean(tableName));
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

  const { data: sessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionsApi.list,
    enabled: Boolean(lesson?.publishedVersionId),
    staleTime: 30_000,
  });

  const isLoading = trackLoading || lessonLoading || (Boolean(lesson?.publishedVersionId) && versionLoading);
  const error = lessonError ?? versionError;

  const lessonTitle = lessonVersion?.lesson?.title ?? lesson?.title ?? 'Practice Set';
  const estimatedMinutes = lessonVersion?.lesson?.estimatedMinutes ?? lesson?.estimatedMinutes ?? 0;
  const challengeCount = lessonVersion?.challenges.length ?? 0;
  const starterQuery = lessonVersion?.starterQuery?.trim() ?? '';
  const starterQueryPreview = starterQuery
    ? starterQuery.split('\n').slice(0, 8).join('\n')
    : '';
  const schemaTableNames = getSchemaTableNames(lessonVersion?.schemaTemplate?.definition);
  const schemaPreviewTables = schemaTableNames.slice(0, 4);
  const orderedTrackLessons = (track?.lessons ?? [])
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title));
  const lessonIndex = lesson
    ? orderedTrackLessons.findIndex((trackLesson) => trackLesson.id === lesson.id)
    : -1;
  const lessonOrderLabel = lesson
    ? lessonIndex >= 0 && orderedTrackLessons.length > 0
      ? `Practice set ${lessonIndex + 1} of ${orderedTrackLessons.length}`
      : lesson.sortOrder > 0
        ? `Practice set ${lesson.sortOrder}`
        : null
    : null;
  const resumableLessonSession =
    lessonVersion && sessions
      ? sessions.find(
          (session) =>
            session.lessonVersionId === lessonVersion.id &&
            !session.challengeVersionId &&
            isResumableSession(session.status),
        )
      : undefined;
  const resumeActivityLabel = resumableLessonSession
    ? `Resume your current sandbox from ${formatRelativeTime(
        resumableLessonSession.lastActivityAt ?? resumableLessonSession.startedAt,
      )}.`
    : null;

  const handleStartLab = async () => {
    if (!lessonVersion) {
      toast.error('This practice set is not published yet');
      return;
    }

    setStartingLab(true);

    try {
      const session = await sessionsApi.create({ lessonVersionId: lessonVersion.id });

      saveLabBootstrap(session.id, {
        mode: 'lesson',
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

  const handleContinueLab = () => {
    if (!resumableLessonSession) {
      return;
    }

    saveLabBootstrap(resumableLessonSession.id, {
      mode: 'lesson',
      lessonPath: `/tracks/${params.trackId}/lessons/${params.lessonId}`,
      lessonTitle,
      starterQuery: lessonVersion?.starterQuery ?? null,
      starterQueryConsumed: true,
    });

    router.push(`/lab/${resumableLessonSession.id}`);
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
          Back to collection
        </Link>

        <Card className="rounded-2xl">
          <CardContent className="flex flex-col gap-4 py-8">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-3xl text-outline">menu_book</span>
              <div>
                <CardTitle>Practice set unavailable</CardTitle>
                <CardDescription className="mt-1">
                  {error instanceof Error ? error.message : 'This practice set could not be loaded.'}
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => { void refetchLesson(); void refetchLessonVersion(); }}>
                Try again
              </Button>
              <Button variant="secondary" onClick={() => router.push(`/tracks/${params.trackId}`)}>
                Back to collection
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
        {track?.title ? `Back to ${track.title}` : 'Back to collection'}
      </Link>

      <Card className="overflow-hidden rounded-[1.75rem] border border-outline-variant/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0.01))]">
        <CardContent className="px-6 py-7 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {lessonOrderLabel ? (
                  <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                    {lessonOrderLabel}
                  </span>
                ) : null}
                <DifficultyBadge difficulty={lesson.difficulty} />
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                  {formatMinutes(estimatedMinutes)}
                </span>
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                  {challengeCount > 0 ? `${challengeCount} optional challenges` : 'Guide entry'}
                </span>
              </div>
              <h1 className="font-headline text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
                {lessonTitle}
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-on-surface-variant">
                {lesson.description ||
                  'Review the guide and SQL examples, then launch the lab with the starter query preloaded.'}
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto">
              {resumableLessonSession ? (
                <>
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={handleContinueLab}
                    leftIcon={<span className="material-symbols-outlined text-lg">play_circle</span>}
                  >
                    Continue Lab
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    loading={startingLab}
                    onClick={handleStartLab}
                    leftIcon={<span className="material-symbols-outlined text-lg">add_circle</span>}
                  >
                    Start New Lab
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  loading={startingLab}
                  onClick={handleStartLab}
                  leftIcon={<span className="material-symbols-outlined text-lg">play_arrow</span>}
                >
                  Start Lab
                </Button>
              )}
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => router.push(`/tracks/${params.trackId}`)}
              >
                View all practice sets
              </Button>
              {resumeActivityLabel ? (
                <p className="max-w-64 text-xs leading-5 text-on-surface-variant">
                  {resumeActivityLabel}
                </p>
              ) : null}
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
                This practice set is published without a guide body yet.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="rounded-2xl border border-outline-variant/10">
            <CardHeader>
              <CardTitle>Execution Flow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl bg-surface-container-high p-3">
                <p className="font-medium text-on-surface">1. Review the guide</p>
                <p className="mt-1 text-on-surface-variant">
                  Check the markdown content and SQL examples before opening the sandbox.
                </p>
              </div>
              <div className="rounded-xl bg-surface-container-high p-3">
                <p className="font-medium text-on-surface">2. Start the lab</p>
                <p className="mt-1 text-on-surface-variant">
                  SQLCraft will resume your existing sandbox when available, or preload the starter query into a fresh one.
                </p>
              </div>
              <div className="rounded-xl bg-surface-container-high p-3">
                <p className="font-medium text-on-surface">3. Run optional validations</p>
                <p className="mt-1 text-on-surface-variant">
                  Optional challenges live here next. The layout already reserves that slot.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-outline-variant/10">
            <CardHeader>
              <CardTitle>Lab Prep</CardTitle>
              <CardDescription>
                Review what opens in the workbench before launching the sandbox.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={starterQuery ? 'ready' : 'draft'}>
                  {starterQuery ? 'Starter query ready' : 'No starter query'}
                </Badge>
                {lessonVersion?.isPublished ? <StatusBadge status="published" /> : null}
              </div>

              {starterQuery ? (
                <div className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-outline">
                    Query Preview
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-6 text-on-surface-variant">
                    {starterQueryPreview}
                    {starterQueryPreview !== starterQuery ? '\n…' : ''}
                  </pre>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-lowest p-4 text-sm text-on-surface-variant">
                  This practice set starts with a blank editor. You can still launch the lab and write the first query from scratch.
                </div>
              )}

              <p className="text-xs leading-5 text-on-surface-variant">
                {resumableLessonSession
                  ? 'Continue Lab keeps your current sandbox and editor state. Start New Lab provisions a fresh environment.'
                  : 'Start Lab provisions a new sandbox and preloads this query into the editor once.'}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-outline-variant/10">
            <CardHeader>
              <CardTitle>Schema Context</CardTitle>
              <CardDescription>
                Database shape bundled with this practice set version.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {lessonVersion?.schemaTemplate ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-on-surface">
                      {lessonVersion.schemaTemplate.name}
                    </p>
                    <Badge variant="published">v{lessonVersion.schemaTemplate.version}</Badge>
                    <StatusBadge status={lessonVersion.schemaTemplate.status} />
                  </div>
                  <p className="text-sm leading-6 text-on-surface-variant">
                    {lessonVersion.schemaTemplate.description ||
                      'This practice set uses a published schema template without an extra description yet.'}
                  </p>
                  <div className="rounded-xl bg-surface-container-high p-3">
                    <p className="text-[11px] uppercase tracking-wider text-outline">
                      Tables
                    </p>
                    <p className="mt-1 text-sm font-medium text-on-surface">
                      {schemaTableNames.length > 0
                        ? `${schemaTableNames.length} table${schemaTableNames.length > 1 ? 's' : ''}`
                        : 'Table count unavailable'}
                    </p>
                    {schemaPreviewTables.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {schemaPreviewTables.map((tableName) => (
                          <span
                            key={tableName}
                            className="rounded-full bg-surface-container-lowest px-2.5 py-1 font-mono text-[11px] text-on-surface-variant"
                          >
                            {tableName}
                          </span>
                        ))}
                        {schemaTableNames.length > schemaPreviewTables.length ? (
                          <span className="rounded-full bg-surface-container-lowest px-2.5 py-1 text-[11px] text-outline">
                            +{schemaTableNames.length - schemaPreviewTables.length} more
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-lowest p-4 text-sm text-on-surface-variant">
                  No schema template is linked to this practice set version yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-outline-variant/10">
            <CardHeader>
              <CardTitle>Practice After This Set</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lessonVersion?.challenges.length ? (
                lessonVersion.challenges.map((challenge) => (
                  <Link
                    key={challenge.id}
                    href={`/tracks/${params.trackId}/lessons/${params.lessonId}/challenges/${challenge.id}`}
                    className="block rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-3 transition-colors hover:bg-surface-container"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-on-surface">{challenge.title}</p>
                      <DifficultyBadge difficulty={challenge.difficulty} />
                    </div>
                    <p className="text-xs leading-6 text-on-surface-variant">
                      {challenge.description}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-wider text-outline">
                        Placeholder route ready for feature 4
                      </p>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-on-surface-variant">
                        Open
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                      </span>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-lowest p-4 text-sm text-on-surface-variant">
                  No optional challenges are attached to this practice set yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

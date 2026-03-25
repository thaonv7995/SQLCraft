'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge, DifficultyBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { lessonsApi, sessionsApi, tracksApi } from '@/lib/api';
import { formatMinutes, formatRelativeTime } from '@/lib/utils';

function isResumableSession(status: string | null | undefined): boolean {
  return status === 'active' || status === 'provisioning' || status === 'paused';
}

function getLessonCardStatus(args: {
  isAvailable: boolean;
  hasResumableSession: boolean;
  resumableStatus?: string;
  isCompletedByTrackProgress: boolean;
}): { variant: 'draft' | 'provisioning' | 'active' | 'success' | 'ready'; label: string } {
  if (!args.isAvailable) {
    return { variant: 'draft', label: 'Draft' };
  }

  if (args.hasResumableSession) {
    if (args.resumableStatus === 'provisioning') {
      return { variant: 'provisioning', label: 'Provisioning lab' };
    }

    if (args.resumableStatus === 'paused') {
      return { variant: 'active', label: 'Paused lab' };
    }

    return { variant: 'active', label: 'Active lab' };
  }

  if (args.isCompletedByTrackProgress) {
    return { variant: 'success', label: 'Completed' };
  }

  return { variant: 'ready', label: 'Ready' };
}

function TrackPageSkeleton() {
  return (
    <div className="page-shell-narrow page-stack">
      <div className="h-48 animate-pulse rounded-2xl bg-surface-container-low" />
      <div className="space-y-3">
        {[1, 2, 3, 4].map((row) => (
          <div key={row} className="h-28 animate-pulse rounded-2xl bg-surface-container-low" />
        ))}
      </div>
    </div>
  );
}

export default function TrackDetailPage() {
  const { trackId } = useParams<{ trackId: string }>();
  const router = useRouter();

  const {
    data: track,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['track', trackId],
    queryFn: () => tracksApi.get(trackId),
    staleTime: 60_000,
  });

  const lessons = (track?.lessons ?? [])
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title));
  const { data: challengeCounts } = useQuery({
    queryKey: [
      'track-challenge-counts',
      trackId,
      lessons.map((lesson) => `${lesson.id}:${lesson.publishedVersionId ?? 'draft'}`),
    ],
    queryFn: async () => {
      const entries = await Promise.all(
        lessons
          .filter((lesson) => lesson.publishedVersionId)
          .map(async (lesson) => {
            const version = await lessonsApi.getVersion(lesson.publishedVersionId!);
            return [lesson.id, version.challenges.length] as const;
          })
      );

      return Object.fromEntries(entries) as Record<string, number>;
    },
    enabled: lessons.some((lesson) => lesson.publishedVersionId),
    staleTime: 60_000,
  });
  const { data: sessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionsApi.list,
    staleTime: 30_000,
  });

  if (isLoading) {
    return <TrackPageSkeleton />;
  }

  if (error || !track) {
    return (
      <div className="page-shell-narrow page-stack">
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col gap-4 py-8">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-3xl text-outline">route</span>
              <div>
                <h1 className="font-headline text-xl font-semibold text-on-surface">Track unavailable</h1>
                <p className="mt-1 text-sm text-on-surface-variant">
                  {error instanceof Error ? error.message : 'This track could not be loaded.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void refetch()}>
                Try again
              </Button>
              <Button variant="secondary" onClick={() => router.push('/tracks')}>
                Back to tracks
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalMinutes = lessons.reduce((sum, lesson) => sum + (lesson.estimatedMinutes ?? 0), 0);
  const totalChallenges = Object.values(challengeCounts ?? {}).reduce((sum, count) => sum + count, 0);
  const completedLessons = Math.min(track.userProgress?.completedLessons ?? 0, lessons.length);
  const progressPercent =
    lessons.length > 0 ? Math.round((completedLessons / lessons.length) * 100) : 0;
  const publishedLessons = lessons.filter((lesson) => lesson.publishedVersionId).length;
  const resumableLessonSessions = (sessions ?? []).filter(
    (session) =>
      !session.challengeVersionId &&
      isResumableSession(session.status) &&
      lessons.some((lesson) => lesson.publishedVersionId === session.lessonVersionId),
  );
  const activeLessonSessionIds = new Set(
    resumableLessonSessions.map((session) => session.lessonVersionId),
  );
  const latestTrackActivity = track.userProgress?.lastAccessedAt
    ? formatRelativeTime(track.userProgress.lastAccessedAt)
    : null;

  return (
    <div className="page-shell-narrow page-stack">
      <Link
        href="/tracks"
        className="inline-flex w-fit items-center gap-2 text-sm text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Back to tracks
      </Link>

      <Card className="overflow-hidden rounded-[1.75rem] border border-outline-variant/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0.01))]">
        <CardContent className="px-6 py-7 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <DifficultyBadge difficulty={track.difficulty} />
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                  {lessons.length} lessons
                </span>
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                  {formatMinutes(totalMinutes)}
                </span>
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                  {totalChallenges > 0 ? `${totalChallenges} optional challenges` : 'Lesson-first path'}
                </span>
              </div>
              <h1 className="font-headline text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
                {track.title}
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-on-surface-variant">
                {track.description || 'Open each lesson to read the guide, then launch the SQL lab with the lesson starter query.'}
              </p>
              <div className="mt-5 max-w-xl space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs text-on-surface-variant">
                  <span>{completedLessons} of {lessons.length} lessons completed</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-container-high">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
                  {latestTrackActivity ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">history</span>
                      Last activity {latestTrackActivity}
                    </span>
                  ) : null}
                  {resumableLessonSessions.length > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">terminal</span>
                      {resumableLessonSessions.length} lesson lab{resumableLessonSessions.length > 1 ? 's' : ''} in progress
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 sm:min-w-72 lg:grid-cols-4">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-outline">Published lessons</p>
                <p className="mt-1 font-headline text-2xl font-semibold text-on-surface">
                  {publishedLessons}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-outline">Learning path</p>
                <p className="mt-1 font-headline text-2xl font-semibold text-on-surface">
                  {lessons.length}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-outline">Challenges</p>
                <p className="mt-1 font-headline text-2xl font-semibold text-on-surface">
                  {totalChallenges}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-outline">Completed</p>
                <p className="mt-1 font-headline text-2xl font-semibold text-on-surface">
                  {completedLessons}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-headline text-xl font-semibold text-on-surface">Lessons</h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Read the lesson first. Practice starts from the lesson page, not directly from the track.
            </p>
          </div>
        </div>

        {lessons.length === 0 ? (
          <Card className="rounded-2xl border border-dashed border-outline-variant/20">
            <CardContent className="py-8 text-center text-sm text-on-surface-variant">
              No published lessons are attached to this track yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {lessons.map((lesson, index) => {
              const isAvailable = Boolean(lesson.publishedVersionId);
              const challengeCount = challengeCounts?.[lesson.id] ?? 0;
              const resumableLessonSession = lesson.publishedVersionId
                ? resumableLessonSessions.find(
                    (session) => session.lessonVersionId === lesson.publishedVersionId,
                  )
                : undefined;
              const lessonStatus = getLessonCardStatus({
                isAvailable,
                hasResumableSession: Boolean(
                  lesson.publishedVersionId &&
                    activeLessonSessionIds.has(lesson.publishedVersionId),
                ),
                resumableStatus: resumableLessonSession?.status,
                isCompletedByTrackProgress: index < completedLessons,
              });

              return (
                <Card
                  key={lesson.id}
                  className="rounded-2xl border border-outline-variant/10 transition-colors hover:bg-surface-container"
                >
                  <CardContent className="px-5 py-5 sm:px-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-mono text-sm text-on-surface-variant">
                          {index + 1}
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={lessonStatus.variant}>{lessonStatus.label}</Badge>
                            <h3 className="text-base font-semibold text-on-surface">{lesson.title}</h3>
                            <DifficultyBadge difficulty={lesson.difficulty} />
                          </div>
                          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                            {lesson.description || 'Open this lesson to read the guide and launch the lab.'}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
                            <span className="inline-flex items-center gap-1">
                              <span className="material-symbols-outlined text-sm">schedule</span>
                              {formatMinutes(lesson.estimatedMinutes)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="material-symbols-outlined text-sm">article</span>
                              Markdown lesson
                            </span>
                            {challengeCount > 0 && (
                              <span className="inline-flex items-center gap-1">
                                <span className="material-symbols-outlined text-sm">target</span>
                                {challengeCount} optional challenge{challengeCount > 1 ? 's' : ''}
                              </span>
                            )}
                            {resumableLessonSession?.lastActivityAt && (
                              <span className="inline-flex items-center gap-1">
                                <span className="material-symbols-outlined text-sm">history</span>
                                Active {formatRelativeTime(resumableLessonSession.lastActivityAt)}
                              </span>
                            )}
                            {!isAvailable && (
                              <span className="inline-flex items-center gap-1 text-outline">
                                <span className="material-symbols-outlined text-sm">hourglass_top</span>
                                Publish required
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant={isAvailable ? 'primary' : 'secondary'}
                          onClick={() => {
                            if (isAvailable) {
                              router.push(`/tracks/${trackId}/lessons/${lesson.id}`);
                            }
                          }}
                          disabled={!isAvailable}
                          leftIcon={
                            <span className="material-symbols-outlined text-sm">
                              {isAvailable ? 'menu_book' : 'lock'}
                            </span>
                          }
                        >
                          {isAvailable ? 'Open lesson' : 'Coming soon'}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

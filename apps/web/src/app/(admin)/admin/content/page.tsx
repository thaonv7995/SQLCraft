'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Badge, DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { LessonMarkdown } from '@/components/lesson/lesson-markdown';
import { SqlEditor } from '@/components/ui/sql-editor';
import type { Lesson, Track } from '@/lib/api';
import { adminApi, challengesApi, tracksApi } from '@/lib/api';
import { cn, formatRelativeTime } from '@/lib/utils';

type TrackWithLessons = Track & { lessons?: Lesson[] };
type ContentTab = 'challenges' | 'lessons' | 'review';

type LessonVersionForm = {
  title: string;
  content: string;
  starterQuery: string;
};

const TAB_LABELS: Record<ContentTab, string> = {
  challenges: 'Challenges',
  lessons: 'Lessons',
  review: 'Review Queue',
};
const CONTENT_TABS = Object.keys(TAB_LABELS) as ContentTab[];

const DEFAULT_LESSON_VERSION_FORM: LessonVersionForm = {
  title: '',
  content: '',
  starterQuery: '',
};

const isContentTab = (value: string | null): value is ContentTab =>
  value !== null && CONTENT_TABS.includes(value as ContentTab);

const REVIEW_STATUS_META: Record<
  'pending' | 'approved' | 'changes_requested' | 'rejected',
  { label: string; className: string }
> = {
  pending: {
    label: 'Pending review',
    className: 'bg-surface-container-highest text-on-surface-variant',
  },
  approved: {
    label: 'Approved',
    className: 'bg-secondary/10 text-secondary',
  },
  changes_requested: {
    label: 'Changes requested',
    className: 'bg-tertiary/10 text-tertiary',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-error/10 text-error',
  },
};

function ReviewStatusBadge({
  status,
}: {
  status: 'pending' | 'approved' | 'changes_requested' | 'rejected' | null | undefined;
}) {
  if (!status) {
    return <Badge className="bg-surface-container-high text-on-surface-variant">Unknown</Badge>;
  }

  const meta = REVIEW_STATUS_META[status];
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

export default function AdminContentPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const requestedTab = searchParams?.get('tab') ?? null;
  const [activeTabOverride, setActiveTabOverride] = useState<ContentTab | null>(null);
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [selectedLessonVersionId, setSelectedLessonVersionId] = useState<string | null>(null);
  const [lessonVersionForm, setLessonVersionForm] = useState<LessonVersionForm>(
    DEFAULT_LESSON_VERSION_FORM,
  );
  const reviewNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const activeTab = activeTabOverride ?? (isContentTab(requestedTab) ? requestedTab : 'challenges');

  const tracksQuery = useQuery({
    queryKey: ['tracks-admin'],
    queryFn: () => tracksApi.list({ limit: 50 }),
    staleTime: 60_000,
  });

  const trackIds = tracksQuery.data?.items.map((track) => track.id) ?? [];

  const trackDetailsQuery = useQuery({
    queryKey: ['tracks-admin-detail', trackIds],
    enabled: trackIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const tracks = await Promise.all(trackIds.map((trackId) => tracksApi.get(trackId)));
      return tracks as TrackWithLessons[];
    },
  });

  const lessonOptions = useMemo(() => {
    const tracks = trackDetailsQuery.data ?? [];

    return tracks.flatMap((track) =>
      (track.lessons ?? []).map((lesson) => ({
        value: lesson.id,
        label: `${track.title} / ${lesson.title}`,
      })),
    );
  }, [trackDetailsQuery.data]);
  const effectiveSelectedLessonId = useMemo(() => {
    if (lessonOptions.length === 0) {
      return '';
    }

    const selectedLessonStillExists = lessonOptions.some(
      (lesson) => lesson.value === selectedLessonId,
    );
    return selectedLessonStillExists ? selectedLessonId : lessonOptions[0]?.value ?? '';
  }, [lessonOptions, selectedLessonId]);

  const reviewQueueQuery = useQuery({
    queryKey: ['challenge-review-queue'],
    queryFn: () => challengesApi.listReviewQueue(),
    staleTime: 30_000,
  });

  const publishedChallengesQuery = useQuery({
    queryKey: ['admin-published-challenges'],
    queryFn: () => challengesApi.listPublished(),
    staleTime: 30_000,
  });

  const reviewQueue = useMemo(() => reviewQueueQuery.data ?? [], [reviewQueueQuery.data]);
  const effectiveSelectedChallengeId = useMemo(() => {
    if (reviewQueue.length === 0) {
      return null;
    }

    const selectedStillExists = reviewQueue.some(
      (challenge) => challenge.id === selectedChallengeId,
    );
    return selectedStillExists ? selectedChallengeId : reviewQueue[0]?.id ?? null;
  }, [reviewQueue, selectedChallengeId]);

  const selectedChallengeSummary =
    reviewQueue.find((challenge) => challenge.id === effectiveSelectedChallengeId) ?? null;

  const challengeDetailQuery = useQuery({
    queryKey: ['admin-challenge-draft', effectiveSelectedChallengeId],
    enabled: Boolean(effectiveSelectedChallengeId),
    queryFn: () => challengesApi.getDraft(effectiveSelectedChallengeId as string),
    staleTime: 0,
  });

  const lessonVersionsQuery = useQuery({
    queryKey: ['admin-lesson-versions', effectiveSelectedLessonId],
    enabled: Boolean(effectiveSelectedLessonId),
    queryFn: () => adminApi.listLessonVersions(effectiveSelectedLessonId),
    staleTime: 30_000,
  });

  const lessonVersions = useMemo(() => lessonVersionsQuery.data ?? [], [lessonVersionsQuery.data]);
  const effectiveSelectedLessonVersionId = useMemo(() => {
    if (lessonVersions.length === 0) {
      return null;
    }

    const selectedStillExists = lessonVersions.some(
      (version) => version.id === selectedLessonVersionId,
    );
    return selectedStillExists ? selectedLessonVersionId : lessonVersions[0]?.id ?? null;
  }, [lessonVersions, selectedLessonVersionId]);

  const lessonVersionDetailQuery = useQuery({
    queryKey: ['admin-lesson-version-detail', effectiveSelectedLessonVersionId],
    enabled: Boolean(effectiveSelectedLessonVersionId),
    queryFn: () => adminApi.getLessonVersion(effectiveSelectedLessonVersionId as string),
    staleTime: 0,
  });

  const hydrateLessonVersionForm = () => {
    if (!lessonVersionDetailQuery.data) {
      return;
    }

    setLessonVersionForm({
      title: lessonVersionDetailQuery.data.title,
      content: lessonVersionDetailQuery.data.content,
      starterQuery: lessonVersionDetailQuery.data.starterQuery ?? '',
    });
  };

  const reviewMutation = useMutation({
    mutationFn: async (decision: 'approve' | 'request_changes' | 'reject') => {
      const versionId = challengeDetailQuery.data?.latestVersion.id;
      if (!versionId) {
        throw new Error('No challenge draft selected');
      }

      return challengesApi.reviewVersion(versionId, {
        decision,
        note: reviewNoteRef.current?.value.trim() || undefined,
      });
    },
    onSuccess: async (_result, decision) => {
      await queryClient.invalidateQueries({ queryKey: ['challenge-review-queue'] });
      await queryClient.invalidateQueries({
        queryKey: ['admin-challenge-draft', effectiveSelectedChallengeId],
      });

      const message =
        decision === 'approve'
          ? 'Challenge approved and published'
          : decision === 'request_changes'
            ? 'Requested user changes'
            : 'Challenge draft rejected';

      toast.success(message);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not save review decision');
    },
  });

  const createLessonVersionMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSelectedLessonId) {
        throw new Error('Select a lesson before creating a version');
      }

      return adminApi.createLessonVersion({
        lessonId: effectiveSelectedLessonId,
        title: lessonVersionForm.title.trim(),
        content: lessonVersionForm.content,
        starterQuery: lessonVersionForm.starterQuery.trim() || undefined,
      });
    },
    onSuccess: async (version) => {
      setSelectedLessonVersionId(version.id);
      await queryClient.invalidateQueries({
        queryKey: ['admin-lesson-versions', effectiveSelectedLessonId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['admin-lesson-version-detail', version.id],
      });
      toast.success('Lesson version created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not create lesson version');
    },
  });

  const publishLessonVersionMutation = useMutation({
    mutationFn: (versionId: string) => adminApi.publishLessonVersion(versionId),
    onSuccess: async (version) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-lesson-versions', version.lessonId] });
      await queryClient.invalidateQueries({
        queryKey: ['admin-lesson-version-detail', version.id],
      });
      toast.success('Lesson version published');
    },
    onError: () => {
      toast.error('Could not publish lesson version');
    },
  });

  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Content</h1>
          <p className="page-lead mt-1">
            Manage lessons, challenge definitions, fixed-point values, and the review queue for
            user-submitted content.
          </p>
        </div>

        {activeTab === 'review' ? (
          <button
            type="button"
            onClick={() => setActiveTabOverride('challenges')}
            className="inline-flex items-center justify-center rounded-lg border border-outline-variant bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:brightness-110"
          >
            Open Challenge Catalog
          </button>
        ) : activeTab === 'challenges' ? (
          <button
            type="button"
            onClick={() => setActiveTabOverride('review')}
            className="inline-flex items-center justify-center rounded-lg border border-outline-variant bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:brightness-110"
          >
            Review Pending Drafts
          </button>
        ) : (
          <Link href="/admin/rankings">
            <Button variant="primary" size="sm">
              Open Rankings
            </Button>
          </Link>
        )}
      </div>

      <div className="flex w-fit items-center gap-1 rounded-xl bg-surface-container-low p-1">
        {CONTENT_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTabOverride(tab)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
              activeTab === tab
                ? 'bg-surface-container-high text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'challenges' && (
        <div className="space-y-3">
          {publishedChallengesQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((index) => (
                <div key={index} className="h-28 animate-pulse rounded-xl bg-surface-container-low" />
              ))}
            </div>
          ) : (publishedChallengesQuery.data ?? []).length === 0 ? (
            <div className="rounded-xl bg-surface-container-low p-10 text-center">
              <p className="text-sm font-medium text-on-surface">No published challenges yet</p>
            </div>
          ) : (
            (publishedChallengesQuery.data ?? []).map((challenge) => (
              <div
                key={challenge.id}
                className="rounded-xl bg-surface-container-low px-5 py-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-on-surface">{challenge.title}</h3>
                      <DifficultyBadge difficulty={challenge.difficulty} />
                      <StatusBadge status={challenge.status} />
                      <Badge className="bg-primary/10 text-primary">
                        {challenge.points} pts
                      </Badge>
                    </div>
                    <p className="text-sm leading-6 text-on-surface-variant">
                      {challenge.description}
                    </p>
                    <div className="mt-3 grid gap-2 text-xs text-on-surface-variant sm:grid-cols-2 lg:grid-cols-4">
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

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveTabOverride('review')}
                    >
                      Open Review Queue
                    </Button>
                    <Link href="/admin/rankings">
                      <Button variant="secondary" size="sm">
                        View Rankings
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'lessons' && (
        <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <Card className="rounded-[28px] border border-outline-variant/10">
            <CardHeader className="flex-col items-start gap-3 px-6 py-5">
              <div>
                <CardTitle>Lesson Version Inventory</CardTitle>
                <CardDescription className="mt-1">
                  Review historical lesson versions, load one into the editor, and publish the active
                  lesson revision.
                </CardDescription>
              </div>

              <Select
                label="Lesson"
                value={effectiveSelectedLessonId}
                onChange={(event) => setSelectedLessonId(event.target.value)}
                options={[
                  {
                    value: '',
                    label: lessonOptions.length > 0 ? 'Select a lesson' : 'No lessons available',
                  },
                  ...lessonOptions,
                ]}
              />
            </CardHeader>

            <CardContent className="space-y-4 px-6 pb-6 pt-0">
              {!effectiveSelectedLessonId ? (
                <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                  Select a lesson to inspect its version history.
                </div>
              ) : lessonVersionsQuery.isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((index) => (
                    <div key={index} className="h-20 animate-pulse rounded-2xl bg-surface-container-low" />
                  ))}
                </div>
              ) : lessonVersions.length === 0 ? (
                <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                  No versions exist for this lesson yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {lessonVersions.map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      onClick={() => setSelectedLessonVersionId(version.id)}
                      className={cn(
                        'w-full rounded-2xl border px-4 py-4 text-left transition-all',
                        effectiveSelectedLessonVersionId === version.id
                          ? 'border-primary/30 bg-primary/10'
                          : 'border-outline-variant/10 bg-surface-container-low hover:bg-surface-container',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-on-surface">v{version.versionNo}</p>
                            {version.isPublished && <StatusBadge status="published" />}
                          </div>
                          <p className="text-sm text-on-surface">{version.title}</p>
                          <p className="text-xs text-on-surface-variant">
                            Created {formatRelativeTime(version.createdAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {lessonVersionDetailQuery.data && (
                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-on-surface">
                          v{lessonVersionDetailQuery.data.versionNo}
                        </p>
                        <StatusBadge
                          status={lessonVersionDetailQuery.data.isPublished ? 'published' : 'draft'}
                        />
                      </div>
                      <p className="text-sm text-on-surface">{lessonVersionDetailQuery.data.title}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" size="sm" onClick={hydrateLessonVersionForm}>
                        Load Into Editor
                      </Button>
                      {!lessonVersionDetailQuery.data.isPublished && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            publishLessonVersionMutation.mutate(lessonVersionDetailQuery.data!.id)
                          }
                          loading={
                            publishLessonVersionMutation.isPending &&
                            publishLessonVersionMutation.variables === lessonVersionDetailQuery.data.id
                          }
                        >
                          Publish Version
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border border-outline-variant/10">
            <CardHeader className="flex-col items-start gap-2 px-6 py-5">
              <div>
                <CardTitle>Create Lesson Version</CardTitle>
                <CardDescription className="mt-1">
                  Draft the next lesson revision, then preview the markdown before publishing.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 px-6 pb-6 pt-0">
              <Input
                label="Version Title"
                value={lessonVersionForm.title}
                onChange={(event) =>
                  setLessonVersionForm((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="Filtering and ordering results"
              />

              <Textarea
                label="Lesson Content"
                hint="Markdown supported"
                value={lessonVersionForm.content}
                onChange={(event) =>
                  setLessonVersionForm((current) => ({ ...current, content: event.target.value }))
                }
                className="min-h-[220px]"
                placeholder={'## Goal\n\nGuide users through filtering and sorting result sets.'}
              />

              <Textarea
                label="Starter Query"
                value={lessonVersionForm.starterQuery}
                onChange={(event) =>
                  setLessonVersionForm((current) => ({
                    ...current,
                    starterQuery: event.target.value,
                  }))
                }
                placeholder="SELECT * FROM users;"
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => createLessonVersionMutation.mutate()}
                  loading={createLessonVersionMutation.isPending}
                  disabled={
                    !effectiveSelectedLessonId ||
                    !lessonVersionForm.title.trim() ||
                    !lessonVersionForm.content.trim()
                  }
                >
                  Create Lesson Version
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setLessonVersionForm(DEFAULT_LESSON_VERSION_FORM)}
                >
                  Clear
                </Button>
              </div>

              <div className="rounded-3xl border border-outline-variant/10 bg-surface-container-lowest p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-on-surface">Lesson Preview</h3>
                    <p className="text-xs text-on-surface-variant">
                      This is the user-facing markdown for the next lesson version.
                    </p>
                  </div>
                </div>

                {lessonVersionForm.content.trim() ? (
                  <LessonMarkdown content={lessonVersionForm.content} />
                ) : (
                  <p className="text-sm text-on-surface-variant">
                    Add lesson markdown to preview the version content.
                  </p>
                )}

                {lessonVersionForm.starterQuery.trim() && (
                  <div className="mt-6 space-y-3">
                    <div>
                      <h4 className="text-sm font-semibold text-on-surface">Starter Query Preview</h4>
                      <p className="text-xs text-on-surface-variant">
                        Starter SQL shown alongside the lesson.
                      </p>
                    </div>
                    <div className="h-56 overflow-hidden rounded-3xl border border-outline-variant/10">
                      <SqlEditor
                        value={lessonVersionForm.starterQuery}
                        onChange={() => undefined}
                        readOnly
                        testId="lesson-starter-query-preview"
                      />
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'review' && (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="rounded-[28px] border border-outline-variant/10">
            <CardHeader className="flex-col items-start gap-2 px-6 py-5">
              <div>
                <CardTitle>Challenge Review Queue</CardTitle>
                <CardDescription className="mt-1">
                  Only the latest unpublished user submissions that still need moderation appear
                  here.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-3 px-6 pb-6 pt-0">
              {reviewQueueQuery.isLoading ? (
                <div className="space-y-3">
                  {[1, 2].map((index) => (
                    <div key={index} className="h-24 animate-pulse rounded-2xl bg-surface-container-low" />
                  ))}
                </div>
              ) : reviewQueue.length === 0 ? (
                <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                  No challenge drafts are waiting for admin review.
                </div>
              ) : (
                reviewQueue.map((challenge) => (
                  <button
                    key={challenge.id}
                    type="button"
                    onClick={() => setSelectedChallengeId(challenge.id)}
                    className={cn(
                      'w-full rounded-2xl border px-4 py-4 text-left transition-all',
                      effectiveSelectedChallengeId === challenge.id
                        ? 'border-primary/30 bg-primary/10'
                        : 'border-outline-variant/10 bg-surface-container-low hover:bg-surface-container',
                    )}
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-on-surface">{challenge.title}</p>
                        <DifficultyBadge difficulty={challenge.difficulty} />
                        <ReviewStatusBadge status={challenge.latestVersionReviewStatus} />
                      </div>

                      <div className="grid gap-1 text-xs text-on-surface-variant sm:grid-cols-2">
                        <p>{challenge.trackTitle}</p>
                        <p>{challenge.lessonTitle}</p>
                        <p>
                          Creator:{' '}
                          {challenge.createdBy.displayName ?? challenge.createdBy.username ?? 'Unknown'}
                        </p>
                        <p>v{challenge.latestVersionNo ?? 1}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border border-outline-variant/10">
            <CardHeader className="flex-col items-start gap-2 px-6 py-5">
              <div>
                <CardTitle>Moderation Detail</CardTitle>
                <CardDescription className="mt-1">
                  Inspect the latest draft version, review the validator contract, then approve,
                  request changes, or reject.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 px-6 pb-6 pt-0">
              {!effectiveSelectedChallengeId ? (
                <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                  Select a draft from the queue to inspect its latest version.
                </div>
              ) : challengeDetailQuery.isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((index) => (
                    <div key={index} className="h-24 animate-pulse rounded-2xl bg-surface-container-low" />
                  ))}
                </div>
              ) : !challengeDetailQuery.data ? (
                <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                  Challenge detail is unavailable.
                </div>
              ) : (
                <>
                  <div className="space-y-3 rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-on-surface">
                        {challengeDetailQuery.data.title}
                      </h2>
                      <DifficultyBadge difficulty={challengeDetailQuery.data.difficulty} />
                      <StatusBadge status={challengeDetailQuery.data.status} />
                      <ReviewStatusBadge status={challengeDetailQuery.data.latestVersion.reviewStatus} />
                      <Badge className="bg-primary/10 text-primary">
                        {challengeDetailQuery.data.points} pts
                      </Badge>
                    </div>

                    <div className="grid gap-2 text-sm text-on-surface-variant sm:grid-cols-2">
                      <p>
                        <span className="text-on-surface">Submitted by:</span>{' '}
                        {selectedChallengeSummary?.createdBy.displayName ??
                          selectedChallengeSummary?.createdBy.username ??
                          'Unknown'}
                      </p>
                      <p>
                        <span className="text-on-surface">Lesson:</span>{' '}
                        {selectedChallengeSummary?.lessonTitle}
                      </p>
                      <p>
                        <span className="text-on-surface">Track:</span>{' '}
                        {selectedChallengeSummary?.trackTitle}
                      </p>
                      <p>
                        <span className="text-on-surface">Version:</span> v
                        {challengeDetailQuery.data.latestVersion.versionNo}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-outline-variant/10 bg-surface-container-lowest p-6">
                    <LessonMarkdown
                      content={[
                        challengeDetailQuery.data.description.trim()
                          ? `## Description\n\n${challengeDetailQuery.data.description.trim()}`
                          : '',
                        `## Problem Statement\n\n${challengeDetailQuery.data.latestVersion.problemStatement}`,
                        challengeDetailQuery.data.latestVersion.hintText
                          ? `## Hint\n\n${challengeDetailQuery.data.latestVersion.hintText}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join('\n\n')}
                    />
                  </div>

                  <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-outline">
                      Expected Result Columns
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {challengeDetailQuery.data.latestVersion.expectedResultColumns.length > 0 ? (
                        challengeDetailQuery.data.latestVersion.expectedResultColumns.map((column) => (
                          <Badge
                            key={column}
                            className="bg-surface-container-high text-on-surface-variant"
                          >
                            {column}
                          </Badge>
                        ))
                      ) : (
                        <p className="text-sm text-on-surface-variant">No explicit column contract.</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-on-surface">Reference SQL</h3>
                      <p className="text-xs text-on-surface-variant">
                        This query is used for result-set validation and reviewer verification.
                      </p>
                    </div>
                    <div className="h-64 overflow-hidden rounded-3xl border border-outline-variant/10">
                      <SqlEditor
                        value={challengeDetailQuery.data.latestVersion.referenceSolution ?? ''}
                        onChange={() => undefined}
                        readOnly
                        testId="challenge-reference-sql"
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-outline">
                      Validator Config
                    </p>
                    <div className="mt-3 grid gap-2 text-sm text-on-surface-variant sm:grid-cols-2">
                      <p>
                        <span className="text-on-surface">Type:</span>{' '}
                        {challengeDetailQuery.data.latestVersion.validatorType}
                      </p>
                      <p>
                        <span className="text-on-surface">Baseline:</span>{' '}
                        {typeof challengeDetailQuery.data.latestVersion.validatorConfig?.baselineDurationMs === 'number'
                          ? `${challengeDetailQuery.data.latestVersion.validatorConfig.baselineDurationMs} ms`
                          : 'Not set'}
                      </p>
                      <p>
                        <span className="text-on-surface">Index optimization:</span>{' '}
                        {challengeDetailQuery.data.latestVersion.validatorConfig?.requiresIndexOptimization === true
                          ? 'Required'
                          : 'Not required'}
                      </p>
                      <p>
                        <span className="text-on-surface">Created:</span>{' '}
                        {formatRelativeTime(challengeDetailQuery.data.latestVersion.createdAt)}
                      </p>
                    </div>
                  </div>

                  <Textarea
                    key={challengeDetailQuery.data.latestVersion.id}
                    ref={reviewNoteRef}
                    label="Review Note"
                    hint="This note is sent back to the submitting user or stored with the approval."
                    defaultValue={challengeDetailQuery.data.latestVersion.reviewNotes ?? ''}
                    placeholder="Call out what to change or document why this version is approved."
                  />

                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => reviewMutation.mutate('approve')}
                      loading={
                        reviewMutation.isPending && reviewMutation.variables === 'approve'
                      }
                    >
                      Approve & Publish
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => reviewMutation.mutate('request_changes')}
                      loading={
                        reviewMutation.isPending &&
                        reviewMutation.variables === 'request_changes'
                      }
                    >
                      Request Changes
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => reviewMutation.mutate('reject')}
                      loading={reviewMutation.isPending && reviewMutation.variables === 'reject'}
                    >
                      Reject Draft
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

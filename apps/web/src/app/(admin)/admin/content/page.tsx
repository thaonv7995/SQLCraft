'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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
type ContentTab = 'tracks' | 'lessons' | 'challenges';

type LessonVersionForm = {
  title: string;
  content: string;
  starterQuery: string;
};

const TAB_LABELS: Record<ContentTab, string> = {
  tracks: 'Tracks',
  lessons: 'Lessons',
  challenges: 'Challenges',
};

const DEFAULT_LESSON_VERSION_FORM: LessonVersionForm = {
  title: '',
  content: '',
  starterQuery: '',
};

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
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ContentTab>('tracks');
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [selectedLessonVersionId, setSelectedLessonVersionId] = useState<string | null>(null);
  const [lessonVersionForm, setLessonVersionForm] = useState<LessonVersionForm>(
    DEFAULT_LESSON_VERSION_FORM,
  );

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

  useEffect(() => {
    if (lessonOptions.length === 0) {
      return;
    }

    const selectedLessonStillExists = lessonOptions.some((lesson) => lesson.value === selectedLessonId);
    if (!selectedLessonId || !selectedLessonStillExists) {
      setSelectedLessonId(lessonOptions[0]?.value ?? '');
    }
  }, [lessonOptions, selectedLessonId]);

  const reviewQueueQuery = useQuery({
    queryKey: ['challenge-review-queue'],
    queryFn: () => challengesApi.listReviewQueue(),
    staleTime: 30_000,
  });

  const reviewQueue = reviewQueueQuery.data ?? [];

  useEffect(() => {
    if (reviewQueue.length === 0) {
      setSelectedChallengeId(null);
      return;
    }

    const selectedStillExists = reviewQueue.some((challenge) => challenge.id === selectedChallengeId);
    if (!selectedChallengeId || !selectedStillExists) {
      setSelectedChallengeId(reviewQueue[0]?.id ?? null);
    }
  }, [reviewQueue, selectedChallengeId]);

  const selectedChallengeSummary =
    reviewQueue.find((challenge) => challenge.id === selectedChallengeId) ?? null;

  const challengeDetailQuery = useQuery({
    queryKey: ['admin-challenge-draft', selectedChallengeId],
    enabled: Boolean(selectedChallengeId),
    queryFn: () => challengesApi.getDraft(selectedChallengeId as string),
    staleTime: 0,
  });

  useEffect(() => {
    if (!challengeDetailQuery.data) {
      return;
    }

    setReviewNote(challengeDetailQuery.data.latestVersion.reviewNotes ?? '');
  }, [challengeDetailQuery.data?.latestVersion.id, challengeDetailQuery.data?.latestVersion.reviewNotes]);

  const lessonVersionsQuery = useQuery({
    queryKey: ['admin-lesson-versions', selectedLessonId],
    enabled: Boolean(selectedLessonId),
    queryFn: () => adminApi.listLessonVersions(selectedLessonId),
    staleTime: 30_000,
  });

  const lessonVersions = lessonVersionsQuery.data ?? [];

  useEffect(() => {
    if (lessonVersions.length === 0) {
      setSelectedLessonVersionId(null);
      return;
    }

    const selectedStillExists = lessonVersions.some((version) => version.id === selectedLessonVersionId);
    if (!selectedLessonVersionId || !selectedStillExists) {
      setSelectedLessonVersionId(lessonVersions[0]?.id ?? null);
    }
  }, [lessonVersions, selectedLessonVersionId]);

  const lessonVersionDetailQuery = useQuery({
    queryKey: ['admin-lesson-version-detail', selectedLessonVersionId],
    enabled: Boolean(selectedLessonVersionId),
    queryFn: () => adminApi.getLessonVersion(selectedLessonVersionId as string),
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
        note: reviewNote.trim() || undefined,
      });
    },
    onSuccess: async (_result, decision) => {
      await queryClient.invalidateQueries({ queryKey: ['challenge-review-queue'] });
      await queryClient.invalidateQueries({
        queryKey: ['admin-challenge-draft', selectedChallengeId],
      });

      const message =
        decision === 'approve'
          ? 'Challenge approved and published'
          : decision === 'request_changes'
            ? 'Requested contributor changes'
            : 'Challenge draft rejected';

      toast.success(message);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not save review decision');
    },
  });

  const createLessonVersionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLessonId) {
        throw new Error('Select a lesson before creating a version');
      }

      return adminApi.createLessonVersion({
        lessonId: selectedLessonId,
        title: lessonVersionForm.title.trim(),
        content: lessonVersionForm.content,
        starterQuery: lessonVersionForm.starterQuery.trim() || undefined,
      });
    },
    onSuccess: async (version) => {
      setSelectedLessonVersionId(version.id);
      await queryClient.invalidateQueries({ queryKey: ['admin-lesson-versions', selectedLessonId] });
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

  const tracks = tracksQuery.data?.items ?? [];

  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Content Management</h1>
          <p className="page-lead mt-1">
            Moderate challenge submissions, manage lesson versions, and keep the curriculum release
            flow auditable.
          </p>
        </div>

        {activeTab === 'challenges' ? (
          <Link href="/contributor">
            <Button variant="primary" size="sm">
              Open Contributor Drafts
            </Button>
          </Link>
        ) : (
          <Button
            variant="primary"
            size="sm"
            leftIcon={<span className="material-symbols-outlined text-sm">history_edu</span>}
            onClick={() => setActiveTab(activeTab === 'tracks' ? 'lessons' : activeTab)}
          >
            {activeTab === 'tracks' ? 'Manage Versions' : 'Stay in Lesson Versions'}
          </Button>
        )}
      </div>

      <div className="flex w-fit items-center gap-1 rounded-xl bg-surface-container-low p-1">
        {(Object.keys(TAB_LABELS) as ContentTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
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

      {activeTab === 'tracks' && (
        <div className="space-y-3">
          {tracksQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((index) => (
                <div key={index} className="h-20 animate-pulse rounded-xl bg-surface-container-low" />
              ))}
            </div>
          ) : tracks.length === 0 ? (
            <div className="rounded-xl bg-surface-container-low p-10 text-center">
              <p className="text-sm font-medium text-on-surface">No tracks yet</p>
            </div>
          ) : (
            tracks.map((track) => (
              <div
                key={track.id}
                className="flex items-center gap-4 rounded-xl bg-surface-container-low px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-on-surface">{track.title}</h3>
                    <DifficultyBadge difficulty={track.difficulty} />
                    <StatusBadge status={track.isPublished ? 'published' : 'draft'} />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-on-surface-variant">
                    <span>{track.lessonCount} lessons</span>
                    {track.createdAt && (
                      <span>Created {new Date(track.createdAt).toLocaleDateString()}</span>
                    )}
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
                value={selectedLessonId}
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
              {!selectedLessonId ? (
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
                        selectedLessonVersionId === version.id
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
                placeholder={'## Goal\n\nTeach learners how to filter and sort rows.'}
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
                  disabled={!selectedLessonId || !lessonVersionForm.title.trim() || !lessonVersionForm.content.trim()}
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
                      This is the learner-facing markdown for the next lesson version.
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

      {activeTab === 'challenges' && (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="rounded-[28px] border border-outline-variant/10">
            <CardHeader className="flex-col items-start gap-2 px-6 py-5">
              <div>
                <CardTitle>Challenge Review Queue</CardTitle>
                <CardDescription className="mt-1">
                  Only the latest unpublished contributor versions that still need moderation appear here.
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
                      selectedChallengeId === challenge.id
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
                  Inspect the latest draft version, review the validator contract, then approve, request
                  changes, or reject.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 px-6 pb-6 pt-0">
              {!selectedChallengeId ? (
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
                        <span className="text-on-surface">Creator:</span>{' '}
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
                    label="Review Note"
                    hint="This note is sent back to the contributor or stored with the approval."
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
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

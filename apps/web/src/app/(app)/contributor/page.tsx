'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Badge, DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { LessonMarkdown } from '@/components/lesson/lesson-markdown';
import { SqlEditor } from '@/components/ui/sql-editor';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  ChallengeDraftValidationResult,
  EditableChallengeDetail,
  Lesson,
  Track,
} from '@/lib/api';
import { challengesApi, tracksApi } from '@/lib/api';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

type TrackWithLessons = Track & { lessons?: Lesson[] };
type EditorTab = 'write' | 'preview' | 'preflight';
type ReviewStatus = 'pending' | 'approved' | 'changes_requested' | 'rejected';

type ContributorForm = {
  lessonId: string;
  title: string;
  slug: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  points: string;
  problemStatement: string;
  hintText: string;
  expectedResultColumns: string;
  referenceSolution: string;
  baselineDurationMs: string;
  requiresIndexOptimization: 'false' | 'true';
};

const DEFAULT_FORM: ContributorForm = {
  lessonId: '',
  title: '',
  slug: '',
  description: '',
  difficulty: 'beginner',
  points: '100',
  problemStatement: '',
  hintText: '',
  expectedResultColumns: '',
  referenceSolution: '',
  baselineDurationMs: '',
  requiresIndexOptimization: 'false',
};

const EDITOR_TABS: Array<{ id: EditorTab; label: string }> = [
  { id: 'write', label: 'Write' },
  { id: 'preview', label: 'Preview' },
  { id: 'preflight', label: 'Preflight' },
];

const REVIEW_STATUS_META: Record<ReviewStatus, { label: string; className: string }> = {
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseExpectedColumns(value: string): string[] {
  return value
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);
}

function buildValidatorConfig(form: ContributorForm): Record<string, unknown> | undefined {
  const validatorConfig: Record<string, unknown> = {};

  if (form.baselineDurationMs.trim()) {
    validatorConfig.baselineDurationMs = Number(form.baselineDurationMs);
  }

  if (form.requiresIndexOptimization === 'true') {
    validatorConfig.requiresIndexOptimization = true;
  }

  return Object.keys(validatorConfig).length > 0 ? validatorConfig : undefined;
}

function createPayload(form: ContributorForm, challengeId?: string) {
  return {
    challengeId,
    lessonId: form.lessonId,
    title: form.title.trim(),
    slug: form.slug.trim(),
    description: form.description.trim() || undefined,
    difficulty: form.difficulty,
    points: Number(form.points),
    problemStatement: form.problemStatement.trim(),
    hintText: form.hintText.trim() || undefined,
    expectedResultColumns: parseExpectedColumns(form.expectedResultColumns),
    referenceSolution: form.referenceSolution.trim() || undefined,
    validatorType: 'result_set' as const,
    validatorConfig: buildValidatorConfig(form),
  };
}

function buildFormFromDraft(draft: EditableChallengeDetail): ContributorForm {
  const baselineDurationCandidate = draft.latestVersion.validatorConfig?.baselineDurationMs;
  const baselineDurationMs =
    typeof baselineDurationCandidate === 'number' && Number.isFinite(baselineDurationCandidate)
      ? String(baselineDurationCandidate)
      : '';

  return {
    lessonId: draft.lessonId,
    title: draft.title,
    slug: draft.slug,
    description: draft.description,
    difficulty: draft.difficulty,
    points: String(draft.points),
    problemStatement: draft.latestVersion.problemStatement,
    hintText: draft.latestVersion.hintText ?? '',
    expectedResultColumns: draft.latestVersion.expectedResultColumns.join(', '),
    referenceSolution: draft.latestVersion.referenceSolution ?? '',
    baselineDurationMs,
    requiresIndexOptimization:
      draft.latestVersion.validatorConfig?.requiresIndexOptimization === true ? 'true' : 'false',
  };
}

function buildPreviewMarkdown(form: ContributorForm): string {
  return [
    form.description.trim() ? `## What This Challenge Teaches\n\n${form.description.trim()}` : '',
    form.problemStatement.trim() ? `## Problem Statement\n\n${form.problemStatement.trim()}` : '',
    form.hintText.trim() ? `## Hint\n\n${form.hintText.trim()}` : '',
    form.expectedResultColumns.trim()
      ? `## Expected Result Columns\n\n${parseExpectedColumns(form.expectedResultColumns)
          .map((column) => `- \`${column}\``)
          .join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function ReviewStatusBadge({
  status,
}: {
  status: ReviewStatus | null | undefined;
}) {
  if (!status) {
    return <Badge className="bg-surface-container-high text-on-surface-variant">Unknown</Badge>;
  }

  const meta = REVIEW_STATUS_META[status];
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

export default function ContributorPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const displayName = user?.displayName ?? user?.username ?? 'User';
  const isAdmin = user?.role === 'admin' || (user?.roles?.includes('admin') ?? false);

  const [form, setForm] = useState<ContributorForm>(DEFAULT_FORM);
  const [activeTab, setActiveTab] = useState<EditorTab>('write');
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [preflightResult, setPreflightResult] = useState<ChallengeDraftValidationResult | null>(null);

  const tracksQuery = useQuery({
    queryKey: ['contributor-track-list'],
    queryFn: () => tracksApi.list({ limit: 50 }),
    staleTime: 60_000,
  });

  const trackIds = tracksQuery.data?.items.map((track) => track.id) ?? [];

  const lessonsQuery = useQuery({
    queryKey: ['contributor-track-details', trackIds],
    enabled: trackIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const tracks = await Promise.all(trackIds.map((trackId) => tracksApi.get(trackId)));
      return tracks as TrackWithLessons[];
    },
  });

  const myChallengesQuery = useQuery({
    queryKey: ['contributor-challenges'],
    queryFn: () => challengesApi.listMine(),
    staleTime: 30_000,
  });

  const editableDraftQuery = useQuery({
    queryKey: ['contributor-editable-draft', selectedDraftId],
    enabled: Boolean(selectedDraftId),
    queryFn: () => challengesApi.getDraft(selectedDraftId as string),
    staleTime: 0,
  });

  const lessonOptions = useMemo(() => {
    const tracks = lessonsQuery.data ?? [];

    return tracks.flatMap((track) =>
      (track.lessons ?? []).map((lesson) => ({
        value: lesson.id,
        label: `${track.title} / ${lesson.title}`,
      })),
    );
  }, [lessonsQuery.data]);

  const myChallenges = myChallengesQuery.data ?? [];
  const selectedChallenge = myChallenges.find((challenge) => challenge.id === selectedDraftId) ?? null;
  const fallbackLessonId = lessonOptions[0]?.value ?? '';
  const editorForm = form.lessonId ? form : { ...form, lessonId: fallbackLessonId };
  const editorMode = selectedDraftId ? 'edit' : 'create';
  const draftCount = myChallenges.filter((challenge) => challenge.status === 'draft').length;
  const publishedCount = myChallenges.filter((challenge) => challenge.status === 'published').length;
  const previewMarkdown = buildPreviewMarkdown(editorForm);

  const loadEditableDraft = async (challengeId: string) => {
    const draft = await queryClient.fetchQuery({
      queryKey: ['contributor-editable-draft', challengeId],
      queryFn: () => challengesApi.getDraft(challengeId),
      staleTime: 0,
    });

    setForm(buildFormFromDraft(draft));
    return draft;
  };

  const preflightMutation = useMutation({
    mutationFn: async () => {
      const result = await challengesApi.validateDraft(
        createPayload(editorForm, selectedDraftId ?? undefined),
      );
      return result;
    },
    onSuccess: (result) => {
      setPreflightResult(result);
      setActiveTab('preflight');
      toast.success(result.valid ? 'Preflight passed' : 'Preflight found issues');
    },
    onError: () => {
      toast.error('Could not run challenge preflight');
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const payload = createPayload(editorForm, selectedDraftId ?? undefined);
      const validation = await challengesApi.validateDraft(payload);

      if (!validation.valid) {
        throw new Error(validation.errors.join(' '));
      }

      const result = selectedDraftId
        ? await challengesApi.createVersion(selectedDraftId, payload)
        : await challengesApi.create(payload);

      return {
        validation,
        result,
        mode: selectedDraftId ? 'edit' : 'create',
      } as const;
    },
    onSuccess: async ({ validation, result, mode }) => {
      setPreflightResult(validation);
      setSelectedDraftId(result.challenge.id);
      setActiveTab('preflight');
      await queryClient.invalidateQueries({ queryKey: ['contributor-challenges'] });
      await queryClient.invalidateQueries({
        queryKey: ['contributor-editable-draft', result.challenge.id],
      });
      await loadEditableDraft(result.challenge.id);
      toast.success(mode === 'edit' ? 'Draft version submitted for review' : 'Challenge draft created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not save challenge draft');
      setActiveTab('preflight');
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !editorForm.lessonId ||
      !editorForm.title.trim() ||
      !editorForm.slug.trim() ||
      !editorForm.problemStatement.trim() ||
      !editorForm.referenceSolution.trim()
    ) {
      toast.error('Practice set, title, slug, problem statement, and reference solution are required');
      return;
    }

    saveDraftMutation.mutate();
  };

  const resetEditor = () => {
    setSelectedDraftId(null);
    setPreflightResult(null);
    setActiveTab('write');
    setForm({
      ...DEFAULT_FORM,
      lessonId: fallbackLessonId,
    });
  };

  return (
    <div className="page-shell page-stack">
      <section className="flex flex-col gap-5 rounded-[28px] border border-outline-variant/10 bg-surface-container-low px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.24em] text-outline">Submissions workspace</p>
          <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface">
            Manage Submission Drafts
          </h1>
          <p className="max-w-3xl text-base leading-7 text-on-surface-variant">
            {displayName}, prepare challenge drafts, run SQL preflight before submitting, and
            iterate on the latest review note in one workspace.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Badge className="bg-secondary/10 text-secondary">{draftCount} drafts open</Badge>
          <Badge className="bg-primary/10 text-primary">{publishedCount} live</Badge>
          {isAdmin && (
            <Link href="/admin/content">
              <Button variant="secondary">Open Review Queue</Button>
            </Link>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="My Drafts" value={draftCount} accent="primary" />
        <StatCard label="Live Challenges" value={publishedCount} accent="secondary" />
        <StatCard label="Available Practice Sets" value={lessonOptions.length} accent="tertiary" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.28fr_1.72fr]">
        <Card className="rounded-[28px] border border-outline-variant/10">
          <CardHeader className="flex-col items-start gap-3 px-6 py-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>
                  {editorMode === 'edit' ? 'Revise Existing Draft' : 'Create a New Draft'}
                </CardTitle>
                {selectedChallenge && (
                  <>
                    <StatusBadge status={selectedChallenge.status} />
                    <ReviewStatusBadge status={selectedChallenge.latestVersionReviewStatus} />
                  </>
                )}
              </div>
              <CardDescription className="mt-1">
                Keep the practice set reference and scoring config in sync with the newest challenge version.
              </CardDescription>
            </div>

            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 rounded-xl bg-surface-container p-1">
                {EDITOR_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
                      activeTab === tab.id
                        ? 'bg-surface-container-high text-on-surface'
                        : 'text-on-surface-variant hover:text-on-surface',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {editorMode === 'edit' && (
                  <Button variant="ghost" type="button" onClick={resetEditor}>
                    New Draft
                  </Button>
                )}
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => preflightMutation.mutate()}
                  loading={preflightMutation.isPending}
                  disabled={lessonOptions.length === 0}
                >
                  Run Preflight
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="px-6 pb-6 pt-0">
            {selectedChallenge?.latestVersionReviewNotes && (
              <div className="mb-4 rounded-2xl border border-tertiary/20 bg-tertiary/10 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-tertiary">
                  Latest review note
                </p>
                <p className="mt-2 text-sm leading-6 text-on-surface">
                  {selectedChallenge.latestVersionReviewNotes}
                </p>
              </div>
            )}

            {activeTab === 'write' && (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <Select
                  label="Practice Set"
                  value={editorForm.lessonId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, lessonId: event.target.value }))
                  }
                  options={[
                    {
                      value: '',
                      label:
                        lessonOptions.length > 0
                          ? 'Select a practice set'
                          : 'No practice sets available',
                    },
                    ...lessonOptions,
                  ]}
                />

                <Input
                  label="Title"
                  value={editorForm.title}
                  onChange={(event) => {
                    const title = event.target.value;
                    setForm((current) => ({
                      ...current,
                      title,
                      slug:
                        current.slug === '' || current.slug === slugify(current.title)
                          ? slugify(title)
                          : current.slug,
                    }));
                  }}
                  placeholder="Index active users"
                />

                <Input
                  label="Slug"
                  value={editorForm.slug}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, slug: slugify(event.target.value) }))
                  }
                  placeholder="index-active-users"
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label="Difficulty"
                    value={editorForm.difficulty}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        difficulty: event.target.value as ContributorForm['difficulty'],
                      }))
                    }
                    options={[
                      { value: 'beginner', label: 'Beginner' },
                      { value: 'intermediate', label: 'Intermediate' },
                      { value: 'advanced', label: 'Advanced' },
                    ]}
                  />

                  <Input
                    label="Points"
                    type="number"
                    min={10}
                    max={1000}
                    value={editorForm.points}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, points: event.target.value }))
                    }
                  />
                </div>

                <Textarea
                  label="Description"
                  hint="Markdown supported"
                  value={editorForm.description}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="What is this challenge teaching?"
                />

                <Textarea
                  label="Problem Statement"
                  hint="Markdown supported"
                  value={editorForm.problemStatement}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, problemStatement: event.target.value }))
                  }
                  placeholder="Return active users quickly and reward indexed solutions."
                />

                <Textarea
                  label="Hint Text"
                  hint="Markdown supported"
                  value={editorForm.hintText}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, hintText: event.target.value }))
                  }
                  placeholder="Optional hint for solvers."
                />

                <Input
                  label="Expected Columns"
                  value={editorForm.expectedResultColumns}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      expectedResultColumns: event.target.value,
                    }))
                  }
                  placeholder="id, email"
                />

                <Textarea
                  label="Reference Solution"
                  hint="This SQL is validated before submit."
                  value={editorForm.referenceSolution}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, referenceSolution: event.target.value }))
                  }
                  placeholder="SELECT id, email FROM users WHERE active = true ORDER BY id;"
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Baseline Duration (ms)"
                    type="number"
                    min={1}
                    value={editorForm.baselineDurationMs}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        baselineDurationMs: event.target.value,
                      }))
                    }
                    placeholder="200"
                  />

                  <Select
                    label="Index Optimization"
                    value={editorForm.requiresIndexOptimization}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        requiresIndexOptimization:
                          event.target.value as ContributorForm['requiresIndexOptimization'],
                      }))
                    }
                    options={[
                      { value: 'false', label: 'Not required' },
                      { value: 'true', label: 'Required' },
                    ]}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="submit"
                    loading={saveDraftMutation.isPending}
                    disabled={lessonOptions.length === 0}
                  >
                    {editorMode === 'edit' ? 'Submit New Version' : 'Create Draft'}
                  </Button>

                  {editableDraftQuery.isFetching && (
                    <p className="text-xs text-on-surface-variant">Refreshing latest draft version…</p>
                  )}
                </div>
              </form>
            )}

            {activeTab === 'preview' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <DifficultyBadge difficulty={editorForm.difficulty} />
                  <Badge className="bg-primary/10 text-primary">{editorForm.points} pts</Badge>
                  <Badge className="bg-surface-container-high text-on-surface-variant">
                    {editorForm.slug || 'slug-preview'}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <h2 className="font-headline text-2xl font-semibold text-on-surface">
                    {editorForm.title || 'Untitled challenge'}
                  </h2>
                  <p className="text-sm text-on-surface-variant">
                    Markdown preview for the solver-facing copy and review context.
                  </p>
                </div>

                <div className="rounded-3xl border border-outline-variant/10 bg-surface-container-lowest p-6">
                  {previewMarkdown ? (
                    <LessonMarkdown content={previewMarkdown} />
                  ) : (
                    <p className="text-sm text-on-surface-variant">
                      Add description, problem statement, or hint text to preview the challenge copy.
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-on-surface">Reference SQL</h3>
                      <p className="text-xs text-on-surface-variant">
                        Reviewer-only source of truth used by preflight validation.
                      </p>
                    </div>
                  </div>
                  <div className="h-64 overflow-hidden rounded-3xl border border-outline-variant/10">
                    <SqlEditor
                      value={editorForm.referenceSolution}
                      onChange={() => undefined}
                      readOnly
                      testId="reference-solution-preview"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'preflight' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => preflightMutation.mutate()}
                    loading={preflightMutation.isPending}
                  >
                    Re-run Preflight
                  </Button>
                  <p className="text-sm text-on-surface-variant">
                    SQL validation runs server-side against the same submission contract the API enforces.
                  </p>
                </div>

                {!preflightResult ? (
                  <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                    Run preflight to validate the reference SQL, slug uniqueness, and scoring setup.
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-outline">
                          Normalized slug
                        </p>
                        <p className="mt-2 font-mono text-sm text-on-surface">
                          {preflightResult.normalized.slug}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-outline">
                          Expected columns
                        </p>
                        <p className="mt-2 text-sm text-on-surface">
                          {preflightResult.normalized.expectedResultColumns.length > 0
                            ? preflightResult.normalized.expectedResultColumns.join(', ')
                            : 'No explicit column contract'}
                        </p>
                      </div>
                    </div>

                    <div
                      className={cn(
                        'rounded-2xl border px-4 py-4',
                        preflightResult.valid
                          ? 'border-secondary/20 bg-secondary/10'
                          : 'border-error/20 bg-error/10',
                      )}
                    >
                      <p className="text-sm font-semibold text-on-surface">
                        {preflightResult.valid
                          ? 'Preflight passed and the draft is ready to submit.'
                          : 'Preflight failed. Fix the errors below before submitting.'}
                      </p>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-error/20 bg-error/10 px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-error">Errors</p>
                        {preflightResult.errors.length === 0 ? (
                          <p className="mt-2 text-sm text-on-surface">No blocking issues.</p>
                        ) : (
                          <ul className="mt-2 space-y-2 text-sm text-on-surface">
                            {preflightResult.errors.map((error) => (
                              <li key={error}>{error}</li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="rounded-2xl border border-tertiary/20 bg-tertiary/10 px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-tertiary">Warnings</p>
                        {preflightResult.warnings.length === 0 ? (
                          <p className="mt-2 text-sm text-on-surface">No warnings.</p>
                        ) : (
                          <ul className="mt-2 space-y-2 text-sm text-on-surface">
                            {preflightResult.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border border-outline-variant/10">
          <CardHeader className="flex-col items-start gap-2 px-6 py-5">
            <div>
              <CardTitle>My Challenge Submissions</CardTitle>
          <CardDescription className="mt-1">
            Open any draft to revise the latest version and inspect the newest review note.
          </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-2 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Challenge</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myChallengesQuery.isLoading ? (
                  <TableEmpty colSpan={5} message="Loading your challenge drafts..." />
                ) : myChallenges.length === 0 ? (
                  <TableEmpty colSpan={5} message="No submissions yet." />
                ) : (
                  myChallenges.map((challenge) => (
                    <TableRow key={challenge.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-on-surface">{challenge.title}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <DifficultyBadge difficulty={challenge.difficulty} />
                            <Badge className="bg-surface-container-high text-on-surface-variant">
                              {challenge.validatorType ?? 'result_set'}
                            </Badge>
                            <StatusBadge status={challenge.status} />
                          </div>
                          <p className="text-xs uppercase tracking-[0.18em] text-outline">
                            {challenge.trackTitle} / {challenge.lessonTitle}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-on-surface">
                        v{challenge.latestVersionNo ?? 1}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          <ReviewStatusBadge status={challenge.latestVersionReviewStatus} />
                          {challenge.latestVersionReviewNotes && (
                            <p className="max-w-[18rem] text-xs leading-5 text-on-surface-variant">
                              {challenge.latestVersionReviewNotes}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-on-surface-variant">
                        {formatRelativeTime(challenge.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            setSelectedDraftId(challenge.id);
                            setActiveTab('write');
                            setPreflightResult(null);
                            await loadEditableDraft(challenge.id);
                          }}
                          disabled={challenge.status !== 'draft'}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

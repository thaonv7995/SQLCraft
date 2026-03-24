'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Badge, DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Lesson, Track } from '@/lib/api';
import { challengesApi, tracksApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { formatRelativeTime } from '@/lib/utils';

type TrackWithLessons = Track & { lessons?: Lesson[] };

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
  difficulty: 'beginner' as const,
  points: '100',
  problemStatement: '',
  hintText: '',
  expectedResultColumns: '',
  referenceSolution: '',
  baselineDurationMs: '',
  requiresIndexOptimization: 'false' as const,
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function ContributorPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const displayName = user?.displayName ?? user?.username ?? 'Contributor';
  const [form, setForm] = useState<ContributorForm>(DEFAULT_FORM);

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
  const draftCount = myChallenges.filter((challenge) => challenge.status === 'draft').length;
  const publishedCount = myChallenges.filter((challenge) => challenge.status === 'published').length;

  const createChallengeMutation = useMutation({
    mutationFn: () => {
      const expectedResultColumns = form.expectedResultColumns
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const validatorConfig: Record<string, unknown> = {};

      if (form.baselineDurationMs.trim()) {
        validatorConfig.baselineDurationMs = Number(form.baselineDurationMs);
      }

      if (form.requiresIndexOptimization === 'true') {
        validatorConfig.requiresIndexOptimization = true;
      }

      return challengesApi.create({
        lessonId: form.lessonId,
        title: form.title.trim(),
        slug: form.slug.trim(),
        description: form.description.trim() || undefined,
        difficulty: form.difficulty,
        points: Number(form.points),
        problemStatement: form.problemStatement.trim(),
        hintText: form.hintText.trim() || undefined,
        expectedResultColumns: expectedResultColumns.length > 0 ? expectedResultColumns : undefined,
        referenceSolution: form.referenceSolution.trim(),
        validatorType: 'result_set',
        validatorConfig: Object.keys(validatorConfig).length > 0 ? validatorConfig : undefined,
      });
    },
    onSuccess: () => {
      toast.success('Challenge draft created');
      setForm((current) => ({
        ...DEFAULT_FORM,
        lessonId: current.lessonId,
      }));
      void queryClient.invalidateQueries({ queryKey: ['contributor-challenges'] });
    },
    onError: () => {
      toast.error('Could not create challenge draft');
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !form.lessonId ||
      !form.title.trim() ||
      !form.slug.trim() ||
      !form.problemStatement.trim() ||
      !form.referenceSolution.trim()
    ) {
      toast.error('Lesson, title, slug, problem statement, and reference solution are required');
      return;
    }

    createChallengeMutation.mutate();
  };

  return (
    <div className="page-shell page-stack">
      <section className="flex flex-col gap-5 rounded-[28px] border border-outline-variant/10 bg-surface-container-low px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.24em] text-outline">Contributor workflow</p>
          <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface">
            Build Challenge Drafts
          </h1>
          <p className="max-w-3xl text-base leading-7 text-on-surface-variant">
            {displayName}, ship new challenge drafts against live lessons, keep the review queue
            visible, and hand clean publish-ready versions to the admin lane.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Badge className="bg-secondary/10 text-secondary">{draftCount} drafts open</Badge>
          <Badge className="bg-primary/10 text-primary">{publishedCount} published</Badge>
          <Link href="/admin/content">
            <Button variant="secondary">Open Admin Queue</Button>
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="My Drafts" value={draftCount} accent="primary" />
        <StatCard label="Published Challenges" value={publishedCount} accent="secondary" />
        <StatCard
          label="Available Lessons"
          value={lessonOptions.length}
          accent="tertiary"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_1.8fr]">
        <Card className="rounded-[28px] border border-outline-variant/10">
          <CardHeader className="flex-col items-start gap-2 px-6 py-5">
            <div>
              <CardTitle>Create a New Draft</CardTitle>
              <CardDescription className="mt-1">
                Draft against an existing lesson so the challenge can inherit the right learning
                context immediately.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-0">
            <form className="space-y-4" onSubmit={handleSubmit}>
              <Select
                label="Lesson"
                value={form.lessonId}
                onChange={(event) => setForm((current) => ({ ...current, lessonId: event.target.value }))}
                options={[
                  { value: '', label: lessonOptions.length > 0 ? 'Select a lesson' : 'No lessons available' },
                  ...lessonOptions,
                ]}
              />

              <Input
                label="Title"
                value={form.title}
                onChange={(event) => {
                  const title = event.target.value;
                  setForm((current) => ({
                    ...current,
                    title,
                    slug: current.slug === '' || current.slug === slugify(current.title) ? slugify(title) : current.slug,
                  }));
                }}
                placeholder="Index active users"
              />

              <Input
                label="Slug"
                value={form.slug}
                onChange={(event) => setForm((current) => ({ ...current, slug: slugify(event.target.value) }))}
                placeholder="index-active-users"
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Difficulty"
                  value={form.difficulty}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      difficulty: event.target.value as typeof DEFAULT_FORM.difficulty,
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
                  value={form.points}
                  onChange={(event) => setForm((current) => ({ ...current, points: event.target.value }))}
                />
              </div>

              <Textarea
                label="Description"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="What is this challenge teaching?"
              />

              <Textarea
                label="Problem Statement"
                value={form.problemStatement}
                onChange={(event) => setForm((current) => ({ ...current, problemStatement: event.target.value }))}
                placeholder="Return active users quickly and reward indexed solutions."
              />

              <Textarea
                label="Hint Text"
                value={form.hintText}
                onChange={(event) => setForm((current) => ({ ...current, hintText: event.target.value }))}
                placeholder="Optional hint for the learner."
              />

              <Input
                label="Expected Columns"
                value={form.expectedResultColumns}
                onChange={(event) =>
                  setForm((current) => ({ ...current, expectedResultColumns: event.target.value }))
                }
                placeholder="id, email"
              />

              <Textarea
                label="Reference Solution"
                value={form.referenceSolution}
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
                  value={form.baselineDurationMs}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, baselineDurationMs: event.target.value }))
                  }
                  placeholder="200"
                />

                <Select
                  label="Index Optimization"
                  value={form.requiresIndexOptimization}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      requiresIndexOptimization: event.target.value as typeof DEFAULT_FORM.requiresIndexOptimization,
                    }))
                  }
                  options={[
                    { value: 'false', label: 'Not required' },
                    { value: 'true', label: 'Required' },
                  ]}
                />
              </div>

              <Button
                type="submit"
                loading={createChallengeMutation.isPending}
                disabled={lessonOptions.length === 0}
              >
                Create Draft
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border border-outline-variant/10">
          <CardHeader className="flex-col items-start gap-2 px-6 py-5">
            <div>
              <CardTitle>My Challenge Drafts</CardTitle>
              <CardDescription className="mt-1">
                Every draft you own, with lesson context and the latest review surface.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-2 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Challenge</TableHead>
                  <TableHead>Lesson</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myChallengesQuery.isLoading ? (
                  <TableEmpty colSpan={5} message="Loading your challenge drafts..." />
                ) : myChallenges.length === 0 ? (
                  <TableEmpty colSpan={5} message="No challenge drafts yet." />
                ) : (
                  myChallenges.map((challenge) => (
                    <TableRow key={challenge.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-on-surface">{challenge.title}</p>
                          <div className="flex items-center gap-2">
                            <DifficultyBadge difficulty={challenge.difficulty} />
                            <Badge className="bg-surface-container-high text-on-surface-variant">
                              {challenge.validatorType ?? 'result_set'}
                            </Badge>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm text-on-surface">{challenge.lessonTitle}</p>
                          <p className="text-xs uppercase tracking-[0.18em] text-outline">
                            {challenge.trackTitle}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-on-surface">{challenge.points}</TableCell>
                      <TableCell>
                        <StatusBadge status={challenge.status} />
                      </TableCell>
                      <TableCell className="text-on-surface-variant">
                        {formatRelativeTime(challenge.updatedAt)}
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

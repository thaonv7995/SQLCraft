'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import {
  adminApi,
  challengesApi,
  databasesApi,
  type AdminCreateChallengePayload,
} from '@/lib/api';
import toast from 'react-hot-toast';

const DIFFICULTY_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
] as const;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseExpectedColumns(raw: string): string[] | undefined {
  const cols = raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return cols.length > 0 ? cols : undefined;
}

export default function AdminEditChallengePage() {
  const router = useRouter();
  const params = useParams();
  const queryClient = useQueryClient();
  const challengeId = typeof params.challengeId === 'string' ? params.challengeId : '';
  const hydratedRef = useRef(false);

  const draftQuery = useQuery({
    queryKey: ['admin-challenge-draft', challengeId],
    enabled: Boolean(challengeId),
    queryFn: () => challengesApi.getDraft(challengeId),
  });

  const databasesQuery = useQuery({
    queryKey: ['admin-content-databases'],
    queryFn: () => databasesApi.list({ limit: 100, page: 1 }),
  });

  const databaseOptions = useMemo(() => {
    const items = databasesQuery.data?.items ?? [];
    return items.map((d) => ({
      value: d.schemaTemplateId ?? d.id,
      label: d.name,
    }));
  }, [databasesQuery.data?.items]);

  const [databaseId, setDatabaseId] = useState('');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [points, setPoints] = useState(100);
  const [sortOrder, setSortOrder] = useState(0);
  const [problemStatement, setProblemStatement] = useState('');
  const [hintText, setHintText] = useState('');
  const [referenceSolution, setReferenceSolution] = useState('');
  const [expectedColumnsRaw, setExpectedColumnsRaw] = useState('');
  const [baselineDurationMs, setBaselineDurationMs] = useState(5000);
  const [maxTotalCost, setMaxTotalCost] = useState(10_000);
  const [requiresIndexOptimization, setRequiresIndexOptimization] = useState(false);

  useEffect(() => {
    hydratedRef.current = false;
  }, [challengeId]);

  useEffect(() => {
    const data = draftQuery.data;
    if (!data || hydratedRef.current) return;
    const v = data.latestVersion;
    const cfg = v.validatorConfig && typeof v.validatorConfig === 'object' ? v.validatorConfig : {};
    const baseline =
      typeof cfg.baselineDurationMs === 'number' && Number.isFinite(cfg.baselineDurationMs)
        ? cfg.baselineDurationMs
        : 5000;
    const maxCost =
      typeof cfg.maxTotalCost === 'number' && Number.isFinite(cfg.maxTotalCost)
        ? cfg.maxTotalCost
        : 10_000;

    setDatabaseId(data.databaseId ?? '');
    setSlug(data.slug);
    setTitle(data.title);
    setDescription(data.description ?? '');
    setDifficulty(data.difficulty as 'beginner' | 'intermediate' | 'advanced');
    setPoints(data.points);
    setSortOrder(data.sortOrder);
    setProblemStatement(v.problemStatement);
    setHintText(v.hintText ?? '');
    setReferenceSolution(v.referenceSolution ?? '');
    setExpectedColumnsRaw((v.expectedResultColumns ?? []).join(', '));
    setBaselineDurationMs(baseline);
    setMaxTotalCost(maxCost);
    setRequiresIndexOptimization(cfg.requiresIndexOptimization === true);
    hydratedRef.current = true;
  }, [draftQuery.data]);

  const updateMutation = useMutation({
    mutationFn: (payload: AdminCreateChallengePayload) =>
      adminApi.updateChallenge(challengeId, payload),
    onSuccess: () => {
      toast.success('Challenge updated');
      queryClient.invalidateQueries({ queryKey: ['admin-challenge-draft', challengeId] });
      queryClient.invalidateQueries({ queryKey: ['admin-challenge-review'] });
      queryClient.invalidateQueries({ queryKey: ['challenges-published'] });
      queryClient.invalidateQueries({ queryKey: ['admin-challenges-catalog'] });
      router.push(`/admin/content/${challengeId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeId) return;
    if (!databaseId) {
      toast.error('Select a database');
      return;
    }
    if (!SLUG_PATTERN.test(slug)) {
      toast.error('Slug: lowercase letters, numbers, and hyphens only (e.g. total-orders-q1)');
      return;
    }
    if (!referenceSolution.trim()) {
      toast.error('Reference SQL is required for result_set validation');
      return;
    }
    if (!Number.isFinite(baselineDurationMs) || baselineDurationMs <= 0) {
      toast.error('Max query duration must be a positive number (ms)');
      return;
    }
    if (!Number.isFinite(maxTotalCost) || maxTotalCost <= 0) {
      toast.error('Max planner cost (EXPLAIN total cost) must be a positive number');
      return;
    }

    const expectedResultColumns = parseExpectedColumns(expectedColumnsRaw);

    updateMutation.mutate({
      databaseId,
      slug: slug.trim(),
      title: title.trim(),
      description: description.trim() || undefined,
      difficulty,
      sortOrder,
      points,
      problemStatement: problemStatement.trim(),
      hintText: hintText.trim() || undefined,
      referenceSolution: referenceSolution.trim(),
      expectedResultColumns,
      validatorType: 'result_set',
      validatorConfig: {
        baselineDurationMs,
        maxTotalCost,
        ...(requiresIndexOptimization ? { requiresIndexOptimization: true } : {}),
      },
    });
  };

  const suggestSlugFromTitle = () => {
    const s = title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
    if (s) setSlug(s);
  };

  if (!challengeId) {
    return (
      <div className="page-shell-wide page-stack pb-10">
        <p className="text-sm text-on-surface-variant">Invalid challenge.</p>
      </div>
    );
  }

  if (draftQuery.isError) {
    return (
      <div className="page-shell-wide page-stack pb-10">
        <Link href="/admin/content" className="text-sm text-primary hover:underline">
          ← Back to challenges
        </Link>
        <p className="mt-4 text-sm text-error">Could not load this challenge.</p>
      </div>
    );
  }

  if (draftQuery.isLoading || !draftQuery.data) {
    return (
      <div className="page-shell-wide page-stack pb-10">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-container-low" />
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-surface-container-low" />
      </div>
    );
  }

  return (
    <div className="page-shell-wide page-stack pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href={`/admin/content/${challengeId}`}
            className="text-sm text-primary hover:underline mb-2 inline-block"
          >
            ← Back to challenge
          </Link>
          <h1 className="page-title-lg">Edit challenge</h1>
          <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">
            Updates catalog fields and the <strong>latest</strong> version in place (same version id;
            learner attempts stay attached).
          </p>
        </div>
      </div>

      <Card className="border-outline-variant/10 bg-surface-container-low/40 max-w-3xl">
        <CardHeader>
          <CardTitle className="text-lg">Challenge details</CardTitle>
          <CardDescription>Save to apply validation rules (reference SQL, pass thresholds).</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Database (schema)"
                value={databaseId}
                onChange={(e) => setDatabaseId(e.target.value)}
                options={[
                  { value: '', label: databasesQuery.isLoading ? 'Loading…' : 'Select database' },
                  ...databaseOptions,
                ]}
              />
              <div className="flex flex-col gap-1.5">
                <Input
                  label="Slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. monthly-revenue"
                  hint="Lowercase, numbers, hyphens only. Unique per database."
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="self-start text-xs"
                  onClick={suggestSlugFromTitle}
                >
                  Suggest from title
                </Button>
              </div>
            </div>

            <Input
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Short display title"
            />

            <Textarea
              label="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="One line for catalog cards"
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                label="Difficulty"
                value={difficulty}
                onChange={(e) =>
                  setDifficulty(e.target.value as 'beginner' | 'intermediate' | 'advanced')
                }
                options={[...DIFFICULTY_OPTIONS]}
              />
              <Input
                label="Points"
                type="number"
                min={10}
                max={1000}
                value={points}
                onChange={(e) => setPoints(Number(e.target.value) || 100)}
              />
              <Input
                label="Sort order"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
              />
            </div>

            <Textarea
              label="Problem statement"
              value={problemStatement}
              onChange={(e) => setProblemStatement(e.target.value)}
              required
              rows={5}
              placeholder="What should the learner write SQL to answer?"
            />

            <Textarea
              label="Hint (optional)"
              value={hintText}
              onChange={(e) => setHintText(e.target.value)}
              rows={2}
            />

            <Textarea
              label="Reference solution SQL"
              value={referenceSolution}
              onChange={(e) => setReferenceSolution(e.target.value)}
              required
              rows={4}
              hint="Required for result_set checking. This query defines the expected result shape."
            />

            <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low/40 p-4 space-y-3">
              <p className="text-sm font-medium text-on-surface">Pass thresholds</p>
              <p className="text-xs text-on-surface-variant">
                Learners must return the correct result set and stay within these limits (when set) to pass.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Max query duration (ms)"
                  type="number"
                  min={1}
                  value={baselineDurationMs}
                  onChange={(e) => setBaselineDurationMs(Number(e.target.value) || 0)}
                  hint="Wall-clock execution time on the sandbox must be ≤ this value."
                />
                <Input
                  label="Max EXPLAIN total cost"
                  type="number"
                  min={1}
                  step="any"
                  value={maxTotalCost}
                  onChange={(e) => setMaxTotalCost(Number(e.target.value) || 0)}
                  hint="Planner total cost from EXPLAIN must be ≤ this value."
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
                <input
                  type="checkbox"
                  checked={requiresIndexOptimization}
                  onChange={(e) => setRequiresIndexOptimization(e.target.checked)}
                  className="size-4 rounded border-outline"
                />
                Require index usage (EXPLAIN must show index scan when enabled)
              </label>
            </div>

            <Input
              label="Expected columns (optional)"
              value={expectedColumnsRaw}
              onChange={(e) => setExpectedColumnsRaw(e.target.value)}
              placeholder="id, name, total — comma-separated"
            />

            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push(`/admin/content/${challengeId}`)}
                disabled={updateMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

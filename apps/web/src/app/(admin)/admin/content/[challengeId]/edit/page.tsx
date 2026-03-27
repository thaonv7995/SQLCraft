'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import {
  PassCriteriaEditor,
  type PassCriteriaSchemaState,
} from '@/components/challenge/pass-criteria-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import {
  expectedResultColumnsFromPassCriteriaRows,
  newPassCriterionDraft,
  newRequiredOutputColumnGroup,
  passCriteriaDraftsFromConfig,
  passCriteriaDraftsToPayload,
  type PassCriterionDraft,
} from '@/lib/challenge-pass-criteria';
import {
  adminApi,
  challengesApi,
  databasesApi,
  type AdminCreateChallengePayload,
} from '@/lib/api';
import { CHALLENGE_SLUG_PATTERN, slugifyChallengeTitle } from '@/lib/slugify-challenge';
import toast from 'react-hot-toast';

const DIFFICULTY_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
] as const;

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
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [points, setPoints] = useState(100);
  const [sortOrder, setSortOrder] = useState(0);
  const [problemStatement, setProblemStatement] = useState('');
  const [hintText, setHintText] = useState('');
  const [referenceSolution, setReferenceSolution] = useState('');
  const [passCriteriaRows, setPassCriteriaRows] = useState<PassCriterionDraft[]>(() =>
    passCriteriaDraftsFromConfig(null),
  );

  const databaseSchemaQuery = useQuery({
    queryKey: ['admin-challenge-form-database', databaseId],
    enabled: Boolean(databaseId),
    queryFn: () => databasesApi.get(databaseId),
  });

  const schemaTables = databaseSchemaQuery.data?.schema ?? [];
  const passCriteriaSchemaState: PassCriteriaSchemaState = !databaseId
    ? 'no-database'
    : databaseSchemaQuery.isLoading
      ? 'loading'
      : databaseSchemaQuery.isError
        ? 'error'
        : 'ready';

  useEffect(() => {
    hydratedRef.current = false;
  }, [challengeId]);

  useEffect(() => {
    const data = draftQuery.data;
    if (!data || hydratedRef.current) return;
    const v = data.latestVersion;
    const cfg = v.validatorConfig && typeof v.validatorConfig === 'object' ? v.validatorConfig : {};

    setDatabaseId(data.databaseId ?? '');
    setTitle(data.title);
    setDescription(data.description ?? '');
    setDifficulty(data.difficulty as 'beginner' | 'intermediate' | 'advanced');
    setPoints(data.points);
    setSortOrder(data.sortOrder);
    setProblemStatement(v.problemStatement);
    setHintText(v.hintText ?? '');
    setReferenceSolution(v.referenceSolution ?? '');
    let rows = passCriteriaDraftsFromConfig(cfg as Record<string, unknown>);
    const existingCols = v.expectedResultColumns ?? [];
    const hasColCriterion = rows.some((r) => r.type === 'required_output_columns');
    if (existingCols.length > 0 && !hasColCriterion) {
      const { key } = newPassCriterionDraft('required_output_columns');
      rows = [
        ...rows,
        {
          key,
          type: 'required_output_columns' as const,
          groups: [{ ...newRequiredOutputColumnGroup(), columns: [...existingCols] }],
        },
      ];
    }
    setPassCriteriaRows(rows);
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
    const slug = slugifyChallengeTitle(title);
    if (!slug || !CHALLENGE_SLUG_PATTERN.test(slug)) {
      toast.error(
        'Title must include letters or numbers so a URL slug can be generated (e.g. Total orders Q1).',
      );
      return;
    }
    if (!referenceSolution.trim()) {
      toast.error('Reference SQL is required for result_set validation');
      return;
    }
    let validatorConfig: AdminCreateChallengePayload['validatorConfig'];
    try {
      validatorConfig = passCriteriaDraftsToPayload(passCriteriaRows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid pass criteria');
      return;
    }

    const expectedResultColumns = expectedResultColumnsFromPassCriteriaRows(passCriteriaRows);

    updateMutation.mutate({
      databaseId,
      slug,
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
      validatorConfig,
    });
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
            <Select
              label="Database (schema)"
              value={databaseId}
              onChange={(e) => setDatabaseId(e.target.value)}
              options={[
                { value: '', label: databasesQuery.isLoading ? 'Loading…' : 'Select database' },
                ...databaseOptions,
              ]}
            />

            <Input
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Short display title"
              hint="URL slug is generated from the title (lowercase, hyphens). Unique per database."
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

            <PassCriteriaEditor
              rows={passCriteriaRows}
              onChange={setPassCriteriaRows}
              schemaTables={schemaTables}
              schemaState={passCriteriaSchemaState}
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

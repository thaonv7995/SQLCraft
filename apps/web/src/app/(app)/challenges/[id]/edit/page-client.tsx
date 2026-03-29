'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
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
  challengesApi,
  databasesApi,
  type ChallengeDraftValidationResult,
  type DatasetScale,
} from '@/lib/api';
import { CHALLENGE_SLUG_PATTERN, slugifyChallengeTitle } from '@/lib/slugify-challenge';
import toast from 'react-hot-toast';
import type { ClientPageProps } from '@/lib/page-props';

const DIFFICULTY_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
] as const;

const DATASET_SCALE_OPTIONS: { value: DatasetScale; label: string }[] = [
  { value: 'tiny', label: 'Tiny (~100 rows)' },
  { value: 'small', label: 'Small (~10K rows)' },
  { value: 'medium', label: 'Medium (~1M–5M rows)' },
  { value: 'large', label: 'Large (10M+ rows)' },
];

export default function UserEditChallengePage({ params }: ClientPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const challengeId = params.id ?? '';
  const hydratedRef = useRef(false);

  const draftQuery = useQuery({
    queryKey: ['user-challenge-draft', challengeId],
    enabled: Boolean(challengeId),
    queryFn: () => challengesApi.getDraft(challengeId),
  });

  const databasesQuery = useQuery({
    queryKey: ['catalog-databases', 'challenge-edit', challengeId, 'authoring'],
    queryFn: () =>
      databasesApi.list({ limit: 100, page: 1, forChallengeAuthoring: true }),
  });

  const databaseOptions = useMemo(() => {
    const items = databasesQuery.data?.items ?? [];
    return items.map((d) => ({
      value: d.schemaTemplateId ?? d.id,
      label: d.catalogKind === 'private_owner' ? `${d.name} (my upload)` : d.name,
    }));
  }, [databasesQuery.data?.items]);

  const [databaseId, setDatabaseId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [points, setPoints] = useState(100);
  const [datasetScale, setDatasetScale] = useState<DatasetScale>('small');
  const [sortOrder, setSortOrder] = useState(0);
  const [problemStatement, setProblemStatement] = useState('');
  const [hintText, setHintText] = useState('');
  const [referenceSolution, setReferenceSolution] = useState('');
  const [passCriteriaRows, setPassCriteriaRows] = useState<PassCriterionDraft[]>(() =>
    passCriteriaDraftsFromConfig(null),
  );
  const [lastValidation, setLastValidation] = useState<ChallengeDraftValidationResult | null>(null);
  const [lockedVisibility, setLockedVisibility] = useState<'public' | 'private'>('public');

  const databaseSchemaQuery = useQuery({
    queryKey: ['challenge-form-database', databaseId, 'authoring'],
    enabled: Boolean(databaseId),
    queryFn: () => databasesApi.get(databaseId, { forChallengeAuthoring: true }),
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
    if (data.status !== 'draft') return;

    const v = data.latestVersion;
    const cfg = v.validatorConfig && typeof v.validatorConfig === 'object' ? v.validatorConfig : {};

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

    queueMicrotask(() => {
      setDatabaseId(data.databaseId ?? '');
      setTitle(data.title);
      setDescription(data.description ?? '');
      setDifficulty(data.difficulty);
      setPoints(data.points);
      setDatasetScale(data.datasetScale);
      setSortOrder(data.sortOrder);
      setProblemStatement(v.problemStatement);
      setHintText(v.hintText ?? '');
      setReferenceSolution(v.referenceSolution ?? '');
      setPassCriteriaRows(rows);
      setLockedVisibility(data.visibility ?? 'public');
      hydratedRef.current = true;
    });
  }, [draftQuery.data]);

  const buildPayload = () => {
    const slug = slugifyChallengeTitle(title);
    const validatorConfig = passCriteriaDraftsToPayload(passCriteriaRows);
    const expectedResultColumns = expectedResultColumnsFromPassCriteriaRows(passCriteriaRows);
    return {
      databaseId,
      slug,
      title: title.trim(),
      description: description.trim() || undefined,
      difficulty,
      sortOrder,
      points,
      datasetScale,
      visibility: lockedVisibility,
      problemStatement: problemStatement.trim(),
      hintText: hintText.trim() || undefined,
      referenceSolution: referenceSolution.trim(),
      expectedResultColumns,
      validatorType: 'result_set' as const,
      validatorConfig,
    };
  };

  const validateMutation = useMutation({
    mutationFn: async () => {
      const p = buildPayload();
      return challengesApi.validateDraft({
        challengeId,
        databaseId: p.databaseId,
        slug: p.slug,
        title: p.title,
        description: p.description,
        difficulty: p.difficulty,
        sortOrder: p.sortOrder,
        points: p.points,
        datasetScale: p.datasetScale,
        visibility: p.visibility,
        problemStatement: p.problemStatement,
        hintText: p.hintText,
        expectedResultColumns: p.expectedResultColumns,
        referenceSolution: p.referenceSolution,
        validatorType: p.validatorType,
        validatorConfig: p.validatorConfig,
      });
    },
    onSuccess: (res) => {
      setLastValidation(res);
      if (res.valid) {
        toast.success(
          res.warnings.length
            ? `Draft looks valid (${res.warnings.length} warning${res.warnings.length > 1 ? 's' : ''})`
            : 'Draft looks valid',
        );
      } else {
        toast.error(res.errors.join(' ') || 'Validation failed');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveMutation = useMutation({
    mutationFn: () => challengesApi.createVersion(challengeId, buildPayload()),
    onSuccess: () => {
      toast.success('New draft version saved');
      queryClient.invalidateQueries({ queryKey: ['user-challenge-draft', challengeId] });
      queryClient.invalidateQueries({ queryKey: ['my-challenges'] });
      queryClient.invalidateQueries({ queryKey: ['published-challenges'] });
      router.push(`/challenges/${challengeId}`);
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
    try {
      passCriteriaDraftsToPayload(passCriteriaRows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid pass criteria');
      return;
    }
    saveMutation.mutate();
  };

  const busy = saveMutation.isPending || validateMutation.isPending;

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
        <Link href="/leaderboard" className="text-sm text-primary hover:underline">
          ← Challenges
        </Link>
        <p className="mt-4 text-sm text-error">
          Could not load this challenge or you do not have access.
        </p>
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

  if (draftQuery.data.status !== 'draft') {
    return (
      <div className="page-shell-wide page-stack pb-10">
        <Link
          href={`/challenges/${challengeId}`}
          className="text-sm text-primary hover:underline mb-4 inline-block"
        >
          ← Back to challenge
        </Link>
        <p className="text-sm text-on-surface-variant">
          Only <strong>draft</strong> challenges can be revised here. This challenge is already
          published.
        </p>
      </div>
    );
  }

  return (
    <div className="page-shell-wide page-stack pb-10">
      <div>
        <Link
          href={`/challenges/${challengeId}`}
          className="text-sm text-primary hover:underline mb-2 inline-block"
        >
          ← Back to challenge
        </Link>
        <h1 className="page-title-lg">Edit draft</h1>
        <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">
          Saving creates a <strong>new version</strong> of your draft (challenge stays in review until
          approved). Visibility stays{' '}
          <span className="text-on-surface font-medium">
            {lockedVisibility === 'private' ? 'private' : 'public'}
          </span>
          — change invites from the challenge page after publish, or recreate if you need to switch.
        </p>
      </div>

      <Card className="border-outline-variant/10 bg-surface-container-low/40 max-w-3xl mt-6">
        <CardHeader>
          <CardTitle className="text-lg">Challenge details</CardTitle>
          <CardDescription>Update fields and pass criteria, then save a new draft version.</CardDescription>
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
            <p className="text-xs text-on-surface-variant">
              Not listed?{' '}
              <Link
                href="/explore?import=1"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Import a SQL database on Explorer
              </Link>
              , then refresh this page or pick it from the dropdown.
            </p>

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

            <Select
              label="Dataset scale"
              value={datasetScale}
              onChange={(e) => setDatasetScale(e.target.value as DatasetScale)}
              options={DATASET_SCALE_OPTIONS}
              hint="Sandbox data volume for every submission on this challenge."
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
              hint="Required for result_set checking."
            />

            <PassCriteriaEditor
              rows={passCriteriaRows}
              onChange={setPassCriteriaRows}
              schemaTables={schemaTables}
              schemaState={passCriteriaSchemaState}
            />

            {lastValidation && lastValidation.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-on-surface">
                <p className="font-medium text-amber-200">Warnings</p>
                <ul className="mt-1 list-inside list-disc text-on-surface-variant">
                  {lastValidation.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" disabled={busy}>
                {saveMutation.isPending ? 'Saving…' : 'Save new version'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => validateMutation.mutate()}
                disabled={busy || !databaseId}
              >
                {validateMutation.isPending ? 'Checking…' : 'Check draft'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push(`/challenges/${challengeId}`)}
                disabled={busy}
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

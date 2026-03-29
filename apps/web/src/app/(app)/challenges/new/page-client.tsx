'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
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
import { useAuthStore } from '@/stores/auth';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseUuidList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const s = part.trim();
    if (!s || !UUID_RE.test(s)) continue;
    const lower = s.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(s);
  }
  return out;
}

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

const VISIBILITY_OPTIONS = [
  {
    value: 'public' as const,
    label: 'Public',
    hint: 'Listed for everyone after an admin approves the draft.',
  },
  {
    value: 'private' as const,
    label: 'Private',
    hint: 'Hidden from the public catalog. You can publish without admin review; only you and invited users can play.',
  },
];

export default function UserNewChallengePage(_props: ClientPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const databasesQuery = useQuery({
    queryKey: ['catalog-databases', 'challenge-create'],
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
  const [datasetScale, setDatasetScale] = useState<DatasetScale>('small');
  const [sortOrder, setSortOrder] = useState(0);
  const [problemStatement, setProblemStatement] = useState('');
  const [hintText, setHintText] = useState('');
  const [referenceSolution, setReferenceSolution] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [inviteUserIdsRaw, setInviteUserIdsRaw] = useState('');
  const [passCriteriaRows, setPassCriteriaRows] = useState<PassCriterionDraft[]>(() =>
    passCriteriaDraftsFromConfig(null),
  );
  const [lastValidation, setLastValidation] = useState<ChallengeDraftValidationResult | null>(null);

  const databaseSchemaQuery = useQuery({
    queryKey: ['challenge-form-database', databaseId],
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

  const buildPayload = () => {
    const slug = slugifyChallengeTitle(title);
    const validatorConfig = passCriteriaDraftsToPayload(passCriteriaRows);
    const expectedResultColumns = expectedResultColumnsFromPassCriteriaRows(passCriteriaRows);
    const invitedUserIds =
      visibility === 'private' ? parseUuidList(inviteUserIdsRaw) : undefined;
    return {
      databaseId,
      slug,
      title: title.trim(),
      description: description.trim() || undefined,
      difficulty,
      sortOrder,
      points,
      datasetScale,
      visibility,
      ...(visibility === 'private' && invitedUserIds && invitedUserIds.length > 0
        ? { invitedUserIds }
        : {}),
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
        databaseId: p.databaseId,
        slug: p.slug,
        title: p.title,
        description: p.description,
        difficulty: p.difficulty,
        sortOrder: p.sortOrder,
        points: p.points,
        datasetScale: p.datasetScale,
        visibility: p.visibility,
        invitedUserIds: p.invitedUserIds,
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

  const createMutation = useMutation({
    mutationFn: () => {
      const p = buildPayload();
      return challengesApi.create(p);
    },
    onSuccess: () => {
      toast.success('Challenge draft saved');
      queryClient.invalidateQueries({ queryKey: ['my-challenges'] });
      queryClient.invalidateQueries({ queryKey: ['published-challenges'] });
      router.push('/leaderboard#challenge-catalog');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
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
    if (visibility === 'public' && parseUuidList(inviteUserIdsRaw).length > 0) {
      toast.error('Invites are only for private challenges. Switch to private or clear invite IDs.');
      return;
    }
    createMutation.mutate();
  };

  const busy = createMutation.isPending || validateMutation.isPending;

  return (
    <div className="page-shell-wide page-stack pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/leaderboard"
            className="text-sm text-primary hover:underline mb-2 inline-block"
          >
            ← Challenges
          </Link>
          <h1 className="page-title-lg">Create challenge</h1>
          <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">
            Save a <strong>draft</strong> tied to a catalog database.{' '}
            <span className="text-on-surface">
              Public drafts go through admin review before they appear in the challenge list.
            </span>{' '}
            Private challenges stay off the public catalog; you can publish them yourself and invite
            others by user ID.
          </p>
        </div>
      </div>

      <Card className="border-outline-variant/10 bg-surface-container-low/40 max-w-3xl">
        <CardHeader>
          <CardTitle className="text-lg">Challenge details</CardTitle>
          <CardDescription>
            Same validation rules as the admin form. Pass criteria must include at least one rule.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmitCreate} className="space-y-4">
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

            <div className="space-y-2">
              <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">
                Visibility
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {VISIBILITY_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm transition-colors ${
                      visibility === opt.value
                        ? 'border-primary bg-surface-container-high'
                        : 'border-outline-variant/30 hover:border-outline-variant/60'
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium text-on-surface">
                      <input
                        type="radio"
                        name="visibility"
                        value={opt.value}
                        checked={visibility === opt.value}
                        onChange={() => setVisibility(opt.value)}
                        className="accent-primary"
                      />
                      {opt.label}
                    </span>
                    <span className="mt-1 pl-6 text-xs text-on-surface-variant">{opt.hint}</span>
                  </label>
                ))}
              </div>
            </div>

            {visibility === 'private' && (
              <div className="space-y-2 rounded-lg border border-outline-variant/20 bg-surface-container/40 p-3">
                <Textarea
                  label="Invite users (optional)"
                  value={inviteUserIdsRaw}
                  onChange={(e) => setInviteUserIdsRaw(e.target.value)}
                  rows={3}
                  placeholder="One UUID per line or comma-separated"
                  hint="Registered users only. Invalid IDs are ignored here; the server rejects unknown IDs on save. You can add more invites later from your draft."
                />
                {user?.id ? (
                  <p className="text-xs text-on-surface-variant">
                    Your user ID (share so others can invite you):{' '}
                    <code className="rounded bg-surface-container-high px-1 py-0.5 font-mono text-on-surface">
                      {user.id}
                    </code>
                  </p>
                ) : null}
              </div>
            )}

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
              hint="Required for result_set checking. This query defines the expected result shape."
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
                {createMutation.isPending ? 'Saving…' : 'Save draft'}
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
                onClick={() => router.push('/leaderboard')}
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

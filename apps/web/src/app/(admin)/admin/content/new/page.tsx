'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { adminApi, databasesApi, type AdminCreateChallengePayload } from '@/lib/api';
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

export default function AdminNewChallengePage() {
  const router = useRouter();
  const queryClient = useQueryClient();

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

  const createMutation = useMutation({
    mutationFn: (payload: AdminCreateChallengePayload) => adminApi.createChallenge(payload),
    onSuccess: () => {
      toast.success('Challenge draft created');
      queryClient.invalidateQueries({ queryKey: ['admin-challenge-review'] });
      queryClient.invalidateQueries({ queryKey: ['challenges-published'] });
      queryClient.invalidateQueries({ queryKey: ['admin-challenges-catalog'] });
      router.push('/admin/content');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
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

    const expectedResultColumns = parseExpectedColumns(expectedColumnsRaw);

    createMutation.mutate({
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

  return (
    <div className="page-shell-wide page-stack pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/admin/content"
            className="text-sm text-primary hover:underline mb-2 inline-block"
          >
            ← Back to challenges
          </Link>
          <h1 className="page-title-lg">New challenge</h1>
          <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">
            Saves a <strong>draft</strong> with version 1. Use the review queue on the content page
            to publish or send back for edits.
          </p>
        </div>
      </div>

      <Card className="border-outline-variant/10 bg-surface-container-low/40 max-w-3xl">
        <CardHeader>
          <CardTitle className="text-lg">Challenge details</CardTitle>
          <CardDescription>
            Tie the challenge to a published catalog database and provide the first version
            content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmitCreate} className="space-y-4">
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

            <Input
              label="Expected columns (optional)"
              value={expectedColumnsRaw}
              onChange={(e) => setExpectedColumnsRaw(e.target.value)}
              placeholder="id, name, total — comma-separated"
            />

            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create draft'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push('/admin/content')}
                disabled={createMutation.isPending}
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

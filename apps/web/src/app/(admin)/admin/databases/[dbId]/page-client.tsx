'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@/components/ui/table';
import { DatabaseImportPanel } from '@/components/admin/database-import-panel';
import { GoldenSnapshotErrorDialog } from '@/components/admin/golden-snapshot-error-dialog';
import { adminApi, databasesApi, type Database } from '@/lib/api';
import {
  DATABASE_DIFFICULTY_STYLES,
  DATABASE_DOMAIN_LABELS,
  DATABASE_SCALE_LABELS,
  SANDBOX_GOLDEN_STATUS_STYLES,
} from '@/lib/database-catalog';
import { cn, formatRelativeTime, formatRows } from '@/lib/utils';
import { searchParamFirst } from '@/lib/next-app-page';
import type { ClientPageProps } from '@/lib/page-props';

type DatabaseDetailTab = 'schema-template' | 'dataset-templates' | 'generation-jobs';

const DETAIL_TABS: Array<{ id: DatabaseDetailTab; label: string }> = [
  { id: 'schema-template', label: 'Schema Template' },
  { id: 'dataset-templates', label: 'Dataset Templates' },
  { id: 'generation-jobs', label: 'Generation Jobs' },
];

function isDetailTab(value: string | null): value is DatabaseDetailTab {
  return DETAIL_TABS.some((tab) => tab.id === value);
}

function DetailStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-outline">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-on-surface">{value}</p>
      <p className="mt-1 text-xs text-on-surface-variant">{hint}</p>
    </div>
  );
}

function SchemaTemplateTab({
  database,
  reviewDraft = false,
}: {
  database: Database;
  reviewDraft?: boolean;
}) {
  const tables = useMemo(() => database.schema ?? [], [database.schema]);
  const schemaTemplateId = database.schemaTemplateId ?? database.id;
  const [query, setQuery] = useState('');
  const [selectedTableName, setSelectedTableName] = useState<string | null>(tables[0]?.name ?? null);

  const filteredTables = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return tables;
    }

    return tables.filter((table) => table.name.toLowerCase().includes(normalizedQuery));
  }, [query, tables]);

  const selectedTable = useMemo(() => {
    if (filteredTables.length === 0) {
      return null;
    }

    if (selectedTableName && filteredTables.some((table) => table.name === selectedTableName)) {
      return filteredTables.find((table) => table.name === selectedTableName) ?? null;
    }

    return filteredTables[0] ?? null;
  }, [filteredTables, selectedTableName]);

  const relatedEdges = useMemo(() => {
    if (!selectedTable) {
      return [];
    }

    return (database.relationships ?? []).filter(
      (relationship) =>
        relationship.from === selectedTable.name || relationship.to === selectedTable.name,
    );
  }, [database.relationships, selectedTable]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        <DetailStat
          label="Schema Template ID"
          value={schemaTemplateId.slice(0, 8)}
          hint={
            reviewDraft
              ? 'Draft schema from the user upload; publishing happens after you approve.'
              : 'The published blueprint backing this database catalog entry.'
          }
        />
        <DetailStat
          label="Tables"
          value={String(database.tableCount)}
          hint="Normalized tables parsed from the schema definition."
        />
        <DetailStat
          label="Relationships"
          value={String(database.relationships?.length ?? 0)}
          hint="Detected edges between tables in the published schema."
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <Card className="border border-outline-variant/10">
          <CardHeader className="flex-col items-start gap-2">
            <CardTitle>Tables</CardTitle>
            <CardDescription>Search and select a table from the published schema.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tables…"
              leftIcon={<span className="material-symbols-outlined text-[18px]">search</span>}
            />

            {filteredTables.length === 0 ? (
              <div className="rounded-xl bg-surface-container px-4 py-6 text-sm text-on-surface-variant">
                No tables match this search.
              </div>
            ) : (
              <div className="max-h-[420px] space-y-1 overflow-y-auto rounded-xl bg-surface-container p-2">
                {filteredTables.map((table) => {
                  const active = selectedTable?.name === table.name;

                  return (
                    <button
                      key={table.name}
                      type="button"
                      onClick={() => setSelectedTableName(table.name)}
                      className={cn(
                        'w-full rounded-lg px-3 py-2 text-left transition-colors',
                        active
                          ? 'bg-primary/12 text-on-surface ring-1 ring-primary/25'
                          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                      )}
                    >
                      <p className="text-sm font-medium">{table.name}</p>
                      <p className="mt-0.5 text-xs">
                        {table.columns.length} column{table.columns.length === 1 ? '' : 's'}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border border-outline-variant/10">
            <CardHeader className="flex-col items-start gap-2">
              <CardTitle>{selectedTable?.name ?? 'Table Detail'}</CardTitle>
              <CardDescription>
                Columns and key markers for the selected table in this schema template.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedTable ? (
                <p className="text-sm text-on-surface-variant">No table selected.</p>
              ) : (
                selectedTable.columns.map((column) => (
                  <div
                    key={`${selectedTable.name}-${column.name}`}
                    className="grid gap-3 rounded-xl bg-surface-container px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-sm font-medium text-on-surface">{column.name}</p>
                        {column.isPrimary ? <Badge variant="active">Primary Key</Badge> : null}
                        {column.isForeign ? <Badge variant="running">Foreign Key</Badge> : null}
                      </div>
                      {column.references ? (
                        <p className="mt-1 text-xs text-on-surface-variant">References {column.references}</p>
                      ) : null}
                    </div>
                    <code className="rounded-md bg-surface-container-high px-2 py-1 text-xs text-on-surface-variant">
                      {column.type}
                    </code>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border border-outline-variant/10">
            <CardHeader className="flex-col items-start gap-2">
              <CardTitle>Relationships</CardTitle>
              <CardDescription>
                Edges touching the selected table inside the current schema template.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {relatedEdges.length === 0 ? (
                <p className="text-sm text-on-surface-variant">
                  {selectedTable
                    ? 'No explicit relationships were parsed for this table.'
                    : 'Select a table to inspect related edges.'}
                </p>
              ) : (
                relatedEdges.map((relationship, index) => (
                  <div
                    key={`${relationship.from}-${relationship.to}-${index}`}
                    className="flex items-center justify-between rounded-xl bg-surface-container px-3 py-3 text-sm"
                  >
                    <p className="font-mono text-on-surface">
                      {relationship.from} → {relationship.to}
                    </p>
                    <Badge variant="default">{relationship.label ?? 'linked'}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DatasetTemplatesTab({
  database,
  reviewDraft = false,
}: {
  database: Database;
  reviewDraft?: boolean;
}) {
  const schemaTemplateId = database.schemaTemplateId ?? database.id;
  const variants =
    database.availableScaleMetadata?.length
      ? database.availableScaleMetadata
      : (database.availableScales ?? []).map((scale) => ({
          scale,
          rowCount:
            scale === (database.sourceScale ?? database.scale)
              ? database.sourceRowCount ?? database.rowCount
              : 0,
        }));

  const [downloadingScale, setDownloadingScale] = useState<string | null>(null);

  const downloadMutation = useMutation({
    mutationFn: (scale: string) => adminApi.getArtifactDownloadUrls(schemaTemplateId).then(
      (items) => ({ items, scale }),
    ),
    onSuccess: ({ items, scale }) => {
      const item = items.find((i) => i.scale === scale);
      if (item?.downloadUrl) {
        window.open(item.downloadUrl, '_blank', 'noopener');
      } else {
        toast.error('No artifact available for this scale');
      }
      setDownloadingScale(null);
    },
    onError: () => {
      toast.error('Failed to generate download URL');
      setDownloadingScale(null);
    },
  });

  const handleDownload = (scale: string) => {
    setDownloadingScale(scale);
    downloadMutation.mutate(scale);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        <DetailStat
          label="Available Variants"
          value={String(variants.length)}
          hint={
            reviewDraft
              ? 'Draft dataset sizes from the import; they publish with the schema when approved.'
              : 'Published dataset sizes tied to this schema template.'
          }
        />
        <DetailStat
          label="Source Scale"
          value={(database.sourceScale ?? database.scale).toUpperCase()}
          hint={
            reviewDraft
              ? 'Canonical scale from the submitted dump (draft until approval).'
              : 'Largest published scale used as the canonical source.'
          }
        />
        <DetailStat
          label="Source Rows"
          value={formatRows(database.sourceRowCount ?? database.rowCount)}
          hint={
            reviewDraft
              ? 'Row counts from the draft dataset template(s).'
              : 'Row footprint of the canonical published dataset.'
          }
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {variants.map((variant) => {
          const isSource = variant.scale === (database.sourceScale ?? database.scale);
          const isDownloading = downloadingScale === variant.scale;

          return (
            <Card key={`${database.id}-${variant.scale}`} className="border border-outline-variant/10">
              <CardHeader className="flex-col items-start gap-2">
                <div className="flex w-full items-start justify-between gap-3">
                  <CardTitle>{variant.scale.toUpperCase()}</CardTitle>
                  <div className="flex items-center gap-1.5">
                    {isSource ? <Badge variant="active">Source</Badge> : <Badge variant="default">Derived</Badge>}
                    {!reviewDraft ? (
                      <button
                        type="button"
                        title={`Download ${variant.scale} SQL dump (presigned, 5 min TTL)`}
                        disabled={isDownloading}
                        onClick={() => handleDownload(variant.scale)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
                      >
                        {isDownloading ? (
                          <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                        ) : (
                          <span className="material-symbols-outlined text-[18px]">download</span>
                        )}
                      </button>
                    ) : null}
                  </div>
                </div>
                <CardDescription>
                  {DATABASE_SCALE_LABELS[variant.scale]} dataset variant for sandbox resets and session provisioning.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl bg-surface-container px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Rows</p>
                  <p className="mt-1 text-lg font-semibold text-on-surface">
                    {formatRows(variant.rowCount)}
                  </p>
                </div>
                <div className="rounded-xl bg-surface-container px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Template Scope</p>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Tied to schema template <span className="font-mono text-on-surface">{schemaTemplateId.slice(0, 8)}</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function GenerationJobsTab({
  database,
  jobs,
  jobsLoading,
}: {
  database: Database;
  jobs: Awaited<ReturnType<typeof adminApi.systemJobs>>;
  jobsLoading: boolean;
}) {
  const schemaTemplateId = database.schemaTemplateId ?? database.id;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        <DetailStat
          label="Recent Jobs"
          value={String(jobs.length)}
          hint="Recent import and dataset generation jobs linked to this database."
        />
        <DetailStat
          label="Schema Target"
          value={schemaTemplateId.slice(0, 8)}
          hint="System jobs are matched against this schema template identifier."
        />
        <DetailStat
          label="Database Name"
          value={database.name}
          hint="Recent canonical import jobs also target this schema name."
        />
      </div>

      <Card className="border border-outline-variant/10">
        <CardHeader className="flex-col items-start gap-2">
          <CardTitle>Recent Generation Jobs</CardTitle>
          <CardDescription>
            Recent import and derived dataset generation runs associated with this database.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0 pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsLoading ? (
                <TableSkeleton rows={4} cols={5} />
              ) : jobs.length === 0 ? (
                <TableEmpty message="No recent generation jobs linked to this database" colSpan={5} />
              ) : (
                jobs.map((job) => {
                  const duration = job.completedAt
                    ? `${Math.round(
                        (new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) /
                          1000,
                      )}s`
                    : job.status === 'running'
                      ? 'Running...'
                      : '—';

                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono text-xs text-on-surface-variant">
                          {job.type}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-on-surface-variant">
                        {job.target ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-on-surface-variant">
                        {formatRelativeTime(job.startedAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-on-surface-variant">
                        {duration}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="page-shell-wide page-stack">
      <div className="h-4 w-40 animate-pulse rounded bg-surface-container-low" />
      <div className="h-24 animate-pulse rounded-2xl bg-surface-container-low" />
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl bg-surface-container-low" />
        ))}
      </div>
      <div className="h-12 animate-pulse rounded-xl bg-surface-container-low" />
      <div className="h-[420px] animate-pulse rounded-xl bg-surface-container-low" />
    </div>
  );
}

export default function AdminDatabaseDetailPage({ params, searchParams }: ClientPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestedTab = searchParamFirst(searchParams, 'tab');
  const pendingReview = searchParamFirst(searchParams, 'pendingReview') === '1';
  const databaseId = params.dbId ?? '';
  const [activeTab, setActiveTab] = useState<DatabaseDetailTab>(
    isDetailTab(requestedTab) ? requestedTab : 'schema-template',
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [showUploadVersionPanel, setShowUploadVersionPanel] = useState(false);
  const [goldenErrorOpen, setGoldenErrorOpen] = useState(false);

  const { data: database, isLoading, isError } = useQuery({
    queryKey: ['admin-database-detail', databaseId, pendingReview],
    queryFn: () =>
      pendingReview
        ? adminApi.getPendingSchemaTemplateReviewDetail(databaseId)
        : databasesApi.get(databaseId, { includeAwaitingGolden: true }),
    enabled: Boolean(databaseId),
    staleTime: 60_000,
  });

  const approveReviewMutation = useMutation({
    mutationFn: (schemaTemplateId: string) => adminApi.approveSchemaTemplateReview(schemaTemplateId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-pending-schema-template-reviews'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-database-catalog'] }),
      ]);
      toast.success('Approved and published to the catalog.');
      router.push('/admin/databases');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Approve failed');
    },
  });

  const rejectReviewMutation = useMutation({
    mutationFn: (schemaTemplateId: string) => adminApi.rejectSchemaTemplateReview(schemaTemplateId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-pending-schema-template-reviews'] });
      toast.success('Submission rejected.');
      router.push('/admin/databases');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Reject failed');
    },
  });

  const { data: generationJobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['admin-database-generation-jobs', database?.schemaTemplateId ?? database?.id, database?.name],
    enabled: activeTab === 'generation-jobs' && Boolean(database),
    queryFn: async () => {
      if (!database) {
        return [];
      }

      const schemaTemplateId = database.schemaTemplateId ?? database.id;

      const [importJobs, datasetJobs] = await Promise.all([
        adminApi.systemJobs({ limit: 50, type: 'canonical-dataset-import' }),
        adminApi.systemJobs({ limit: 50, type: 'dataset-template-generation' }),
      ]);

      return [...importJobs, ...datasetJobs]
        .filter(
          (job) =>
            job.target === schemaTemplateId || job.target === database.name,
        )
        .sort(
          (left, right) =>
            new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
        );
    },
    staleTime: 30_000,
  });

  const handleVersionImported = useCallback(
    (_importedAnchorId: string) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-database-detail', databaseId] });
      void queryClient.invalidateQueries({ queryKey: ['admin-database-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-pending-scans'] });
      setShowUploadVersionPanel(false);
      toast.success('New version published. This page will show the updated schema.');
    },
    [databaseId, queryClient],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteDatabase(id),
    onSuccess: async (_result, deletedId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-database-catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-database-detail', deletedId] }),
      ]);
      toast.success('Database deleted');
      router.push('/admin/databases');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete database');
    },
  });

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (isError || !database) {
    return (
      <div className="page-shell-wide page-stack">
        <div className="rounded-xl border border-error/20 bg-error/5 px-5 py-4 text-sm text-error">
          Failed to load this database.
        </div>
      </div>
    );
  }

  const difficulty =
    DATABASE_DIFFICULTY_STYLES[database.difficulty] ?? DATABASE_DIFFICULTY_STYLES.beginner;
  const goldenStatus = database.sandboxGoldenStatus ?? 'none';
  const golden =
    SANDBOX_GOLDEN_STATUS_STYLES[goldenStatus] ??
    SANDBOX_GOLDEN_STATUS_STYLES.none;

  const reviewTemplateId = database.schemaTemplateId ?? databaseId;

  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
        <Link href="/admin/databases" className="hover:text-on-surface">
          Databases
        </Link>
        <span>/</span>
        <span className="text-on-surface">{database.name}</span>
      </div>

      {pendingReview ? (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-4 sm:px-5">
          <p className="text-sm font-medium text-on-surface">Pending catalog review</p>
          <p className="mt-1 text-sm text-on-surface-variant">
            Inspect schema and dataset variants below, then approve to publish to the public catalog or reject
            to discard this submission.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={approveReviewMutation.isPending}
              disabled={rejectReviewMutation.isPending}
              onClick={() => approveReviewMutation.mutate(reviewTemplateId)}
            >
              Approve & publish
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={rejectReviewMutation.isPending}
              disabled={approveReviewMutation.isPending}
              onClick={() => rejectReviewMutation.mutate(reviewTemplateId)}
            >
              Reject
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => router.push('/admin/databases')}
            >
              Back to list
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-6 lg:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">{DATABASE_DOMAIN_LABELS[database.domain]}</Badge>
              <Badge variant="default">{database.engine}</Badge>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider font-bold',
                  difficulty.badge,
                )}
              >
                {difficulty.label}
              </span>
              {goldenStatus === 'failed' ? (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Snapshot failed; click to view error"
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider',
                    golden.badge,
                  )}
                  title="Snapshot failed (click to view error)"
                  onClick={() => setGoldenErrorOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    setGoldenErrorOpen(true);
                  }}
                >
                  {golden.label}
                </span>
              ) : (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider',
                    golden.badge,
                  )}
                  title="Sandbox golden bake (source dataset)"
                >
                  {golden.label}
                </span>
              )}
              {pendingReview ? (
                <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
                  Awaiting approval
                </span>
              ) : null}
            </div>
            <h1 className="mt-4 font-headline text-4xl font-bold tracking-tight text-on-surface">
              {database.name}
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-on-surface-variant">
              {database.description}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!pendingReview ? (
              <Button
                variant="secondary"
                onClick={() => setShowUploadVersionPanel((open) => !open)}
                disabled={!database.schemaTemplateId}
              >
                {showUploadVersionPanel ? 'Hide SQL upload' : 'Upload new version'}
              </Button>
            ) : null}
            {!pendingReview ? (
              <Link href={`/explore/${database.id}`}>
                <Button variant="ghost">Open in Explorer</Button>
              </Link>
            ) : null}
            <Button
              variant="destructive"
              onClick={() => setDeleteConfirmOpen(true)}
              loading={deleteMutation.isPending}
            >
              Delete Database
            </Button>
          </div>
        </div>
      </div>

      {showUploadVersionPanel && database.schemaTemplateId && !pendingReview ? (
        <DatabaseImportPanel
          replaceSchemaTemplateId={database.schemaTemplateId}
          lockedSchemaName={database.name}
          lockedCatalogDomain={database.domain}
          lockedDialect={database.dialect ?? 'postgresql'}
          lockedEngineVersion={database.engineVersion ?? null}
          onClose={() => setShowUploadVersionPanel(false)}
          onImported={handleVersionImported}
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <DetailStat
          label="Rows"
          value={formatRows(database.sourceRowCount ?? database.rowCount)}
          hint={
            pendingReview
              ? 'Row counts from the draft import (visible to submitter as “Reviewing” until you approve).'
              : 'Source dataset footprint published for this database.'
          }
        />
        <DetailStat
          label="Source Scale"
          value={(database.sourceScale ?? database.scale).toUpperCase()}
          hint={DATABASE_SCALE_LABELS[database.sourceScale ?? database.scale]}
        />
        <DetailStat
          label="Scale Variants"
          value={String(database.availableScaleMetadata?.length ?? database.availableScales?.length ?? 0)}
          hint={
            pendingReview
              ? 'Draft dataset template sizes; they go live when the schema is approved.'
              : 'Published dataset templates available for provisioning.'
          }
        />
        <DetailStat
          label="Tables"
          value={String(database.tableCount)}
          hint="Tables parsed from the schema definition in the template."
        />
      </div>

      <div className="flex w-fit flex-wrap items-center gap-1 rounded-xl bg-surface-container-low p-1">
        {DETAIL_TABS.map((tab) => (
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

      {activeTab === 'schema-template' ? (
        <SchemaTemplateTab database={database} reviewDraft={pendingReview} />
      ) : null}
      {activeTab === 'dataset-templates' ? (
        <DatasetTemplatesTab database={database} reviewDraft={pendingReview} />
      ) : null}
      {activeTab === 'generation-jobs' ? (
        <GenerationJobsTab
          database={database}
          jobs={generationJobs}
          jobsLoading={jobsLoading}
        />
      ) : null}

      <ConfirmModal
        open={deleteConfirmOpen}
        eyebrow="Databases"
        title={`Delete “${database.name}”?`}
        description={
          pendingReview
            ? 'This removes the draft upload and its draft dataset templates from the system.'
            : 'This removes its schema template and published dataset variants. If any lesson versions or sandboxes still reference it, the delete will be blocked.'
        }
        confirmLabel="Delete database"
        cancelLabel="Cancel"
        icon="delete_forever"
        isPending={deleteMutation.isPending}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          if (!databaseId) return;
          deleteMutation.mutate(databaseId, {
            onSettled: () => setDeleteConfirmOpen(false),
          });
        }}
        titleId="admin-delete-database-title"
      />

      {database ? (
        <GoldenSnapshotErrorDialog
          open={goldenErrorOpen}
          databaseId={database.id}
          databaseName={database.name}
          schemaTemplateId={database.schemaTemplateId}
          error={database.sandboxGoldenError}
          onClose={() => setGoldenErrorOpen(false)}
        />
      ) : null}
    </div>
  );
}

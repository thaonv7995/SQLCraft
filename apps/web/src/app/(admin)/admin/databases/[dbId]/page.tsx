'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
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
import { adminApi, databasesApi, type Database } from '@/lib/api';
import {
  DATABASE_DIFFICULTY_STYLES,
  DATABASE_DOMAIN_LABELS,
  DATABASE_SCALE_LABELS,
} from '@/lib/database-catalog';
import { cn, formatRelativeTime, formatRows } from '@/lib/utils';
import { useAppPageProps, searchParamFirst } from '@/lib/next-app-page';

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

function SchemaTemplateTab({ database }: { database: Database }) {
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
          hint="The published blueprint backing this database catalog entry."
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

function DatasetTemplatesTab({ database }: { database: Database }) {
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

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        <DetailStat
          label="Available Variants"
          value={String(variants.length)}
          hint="Published dataset sizes tied to this schema template."
        />
        <DetailStat
          label="Source Scale"
          value={(database.sourceScale ?? database.scale).toUpperCase()}
          hint="Largest published scale used as the canonical source."
        />
        <DetailStat
          label="Source Rows"
          value={formatRows(database.sourceRowCount ?? database.rowCount)}
          hint="Row footprint of the canonical published dataset."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {variants.map((variant) => {
          const isSource = variant.scale === (database.sourceScale ?? database.scale);

          return (
            <Card key={`${database.id}-${variant.scale}`} className="border border-outline-variant/10">
              <CardHeader className="flex-col items-start gap-2">
                <div className="flex w-full items-start justify-between gap-3">
                  <CardTitle>{variant.scale.toUpperCase()}</CardTitle>
                  {isSource ? <Badge variant="active">Source</Badge> : <Badge variant="default">Derived</Badge>}
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

export default function AdminDatabaseDetailPage(props: PageProps<'/admin/databases/[dbId]'>) {
  const { params, searchParams } = useAppPageProps(props);
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestedTab = searchParamFirst(searchParams, 'tab');
  const databaseId = params.dbId ?? '';
  const [activeTab, setActiveTab] = useState<DatabaseDetailTab>(
    isDetailTab(requestedTab) ? requestedTab : 'schema-template',
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: database, isLoading, isError } = useQuery({
    queryKey: ['admin-database-detail', databaseId],
    queryFn: () => databasesApi.get(databaseId),
    enabled: Boolean(databaseId),
    staleTime: 60_000,
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

  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
        <Link href="/admin/databases" className="hover:text-on-surface">
          Databases
        </Link>
        <span>/</span>
        <span className="text-on-surface">{database.name}</span>
      </div>

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
            </div>
            <h1 className="mt-4 font-headline text-4xl font-bold tracking-tight text-on-surface">
              {database.name}
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-on-surface-variant">
              {database.description}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link href="/admin/databases?view=import">
              <Button variant="secondary">SQL Import</Button>
            </Link>
            <Link href={`/explore/${database.id}`}>
              <Button variant="ghost">Open in Explorer</Button>
            </Link>
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

      <div className="grid gap-3 md:grid-cols-4">
        <DetailStat
          label="Rows"
          value={formatRows(database.sourceRowCount ?? database.rowCount)}
          hint="Source dataset footprint published for this database."
        />
        <DetailStat
          label="Source Scale"
          value={(database.sourceScale ?? database.scale).toUpperCase()}
          hint={DATABASE_SCALE_LABELS[database.sourceScale ?? database.scale]}
        />
        <DetailStat
          label="Scale Variants"
          value={String(database.availableScaleMetadata?.length ?? database.availableScales?.length ?? 0)}
          hint="Published dataset templates available for provisioning."
        />
        <DetailStat
          label="Tables"
          value={String(database.tableCount)}
          hint="Tables parsed from the backing schema template."
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

      {activeTab === 'schema-template' ? <SchemaTemplateTab database={database} /> : null}
      {activeTab === 'dataset-templates' ? <DatasetTemplatesTab database={database} /> : null}
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
        description="This removes its schema template and published dataset variants. If any lesson versions or sandboxes still reference it, the delete will be blocked."
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
    </div>
  );
}

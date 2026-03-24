'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { databasesApi, type Database, type DatabaseScale, type DatasetScale } from '@/lib/api';
import {
  DATABASE_DIFFICULTY_STYLES,
  DATABASE_DOMAIN_LABELS,
  DATABASE_SCALE_LABELS,
  getFallbackDatabase,
} from '@/lib/database-catalog';
import { cn, formatRows } from '@/lib/utils';

const SCALE_OPTIONS: Array<{ value: DatasetScale; label: string }> = [
  { value: 'tiny', label: DATABASE_SCALE_LABELS.tiny },
  { value: 'small', label: DATABASE_SCALE_LABELS.small },
  { value: 'medium', label: DATABASE_SCALE_LABELS.medium },
  { value: 'large', label: DATABASE_SCALE_LABELS.large },
];

const ROLE_STYLES = {
  primary: 'border-primary/30 bg-primary/5 text-primary',
  secondary: 'border-tertiary/30 bg-tertiary/5 text-tertiary',
  junction: 'border-secondary/30 bg-secondary/5 text-secondary',
};

const PROVISIONING_STEPS = [
  { label: 'Allocating', description: 'Reserving compute and restoring the base image.', threshold: 12 },
  { label: 'Seeding', description: 'Hydrating the selected dataset scale and table indexes.', threshold: 38 },
  { label: 'Verifying', description: 'Running health checks, permissions, and connection probes.', threshold: 72 },
  { label: 'Ready', description: 'Workspace is warm and the SQL editor is about to open.', threshold: 100 },
];

function DetailSkeleton() {
  return (
    <div className="page-shell page-stack">
      <div className="h-5 w-40 rounded bg-surface-container-low animate-pulse" />
      <div className="overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-low">
        <div className="h-14 animate-pulse border-b border-outline-variant/10 bg-surface-container/50" />
        <div className="flex flex-col gap-6 p-6 lg:flex-row lg:p-8">
          <div className="flex-1 space-y-4">
            <div className="h-6 w-48 rounded bg-surface-container animate-pulse" />
            <div className="h-4 w-full max-w-xl rounded bg-surface-container animate-pulse" />
            <div className="h-4 w-4/5 max-w-xl rounded bg-surface-container animate-pulse" />
          </div>
          <div className="h-40 w-full shrink-0 rounded-xl bg-surface-container animate-pulse lg:w-80" />
        </div>
      </div>
      <div className="rounded-xl bg-surface-container-low p-6">
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-48 rounded-2xl bg-surface-container animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}

type SchemaTable = NonNullable<Database['schema']>[number];

function ColumnRow({ column }: { column: SchemaTable['columns'][number] }) {
  const keyKind = column.isPrimary ? 'pk' : column.isForeign ? 'fk' : null;

  return (
    <div
      role="row"
      className={cn(
        'group grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-x-3 gap-y-0.5 border-b border-outline-variant/10 py-2.5 pl-1 pr-2 last:border-b-0 sm:grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1.15fr)] sm:py-3',
        'transition-colors hover:bg-surface-container-high/40',
      )}
    >
      <div className="flex h-6 w-full items-center justify-center pt-0.5" title={keyKind === 'pk' ? 'Primary key' : keyKind === 'fk' ? 'Foreign key' : 'Column'}>
        {keyKind === 'pk' && (
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-secondary/10 text-secondary"
            aria-hidden
          >
            <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              key
            </span>
          </span>
        )}
        {keyKind === 'fk' && (
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-tertiary/10 text-tertiary"
            aria-hidden
          >
            <span className="material-symbols-outlined text-[18px]">link</span>
          </span>
        )}
        {!keyKind && (
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-outline-variant/15 bg-surface-container-low text-[11px] font-medium text-outline/55"
            aria-hidden
          >
            —
          </span>
        )}
      </div>

      <div className="min-w-0 pt-0.5">
        <p className="font-mono text-[13px] font-medium leading-snug text-on-surface">{column.name}</p>
        {column.references ? (
          <p className="mt-0.5 truncate font-mono text-[11px] text-tertiary/90">→ {column.references}</p>
        ) : null}
      </div>

      <div className="min-w-0 pt-0.5 text-right sm:text-left">
        <code className="inline-block max-w-full rounded-md border border-outline-variant/10 bg-surface-container-low px-2 py-1 text-left font-mono text-[10px] leading-relaxed text-on-surface-variant sm:text-[11px]">
          {column.type}
        </code>
      </div>
    </div>
  );
}

function SchemaTableDetail({ table }: { table: SchemaTable }) {
  const role = table.role ?? 'secondary';
  const roleStyle = ROLE_STYLES[role] ?? ROLE_STYLES.secondary;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container-low',
        role === 'primary' && 'border-primary/25',
      )}
    >
      <div className="border-b border-outline-variant/10 px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-headline text-lg font-semibold tracking-tight text-on-surface sm:text-xl">
              {table.name}
            </h3>
            <p className="mt-0.5 text-sm text-on-surface-variant">
              <span className="tabular-nums text-on-surface">{table.columns.length}</span>{' '}
              {table.columns.length === 1 ? 'column' : 'columns'}
            </p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider',
              roleStyle,
            )}
          >
            {role}
          </span>
        </div>
      </div>

      <div className="px-2 pb-2 pt-0 sm:px-3">
        <div
          className="hidden grid-cols-[2rem_minmax(0,1fr)_minmax(0,1.1fr)] gap-x-3 border-b border-outline-variant/10 px-1 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-outline sm:grid sm:grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1.15fr)] sm:px-2"
          role="rowgroup"
          aria-hidden
        >
          <span className="text-center" />
          <span>Column</span>
          <span className="text-right sm:text-left">Type</span>
        </div>

        <div
          role="table"
          aria-label={`Columns of ${table.name}`}
          className="max-h-[min(60vh,560px)] overflow-y-auto overscroll-contain px-1 sm:px-2"
        >
          <div role="rowgroup">
            {table.columns.map((column) => (
              <ColumnRow key={`${table.name}-${column.name}`} column={column} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SchemaBrowser({ tables }: { tables: NonNullable<Database['schema']> }) {
  const [query, setQuery] = useState('');
  /** User-picked table name; when null, selection falls back to the first filtered table. */
  const [tablePick, setTablePick] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return tables;
    }
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, query]);

  const selectedName = useMemo(() => {
    if (filtered.length === 0) {
      return null;
    }
    if (tablePick && filtered.some((t) => t.name === tablePick)) {
      return tablePick;
    }
    return filtered[0].name;
  }, [filtered, tablePick]);

  const selected = useMemo(
    () => filtered.find((t) => t.name === selectedName) ?? null,
    [filtered, selectedName],
  );

  return (
    <div className="relative z-[1] flex min-h-[min(70vh,640px)] flex-col gap-4 lg:flex-row lg:gap-0">
      {/* Table list — dense, scrollable; fits many more names than a card grid */}
      <div className="flex flex-col lg:w-[min(100%,300px)] lg:shrink-0 lg:border-r lg:border-outline-variant/10 lg:pr-5">
        <Input
          placeholder="Search tables…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leftIcon={<span className="material-symbols-outlined text-[20px]">search</span>}
          aria-label="Search schema tables"
          className="w-full"
        />
        <p className="mt-2 text-xs text-on-surface-variant">
          <span className="tabular-nums text-on-surface">{filtered.length}</span> shown
          {filtered.length !== tables.length && (
            <span className="text-outline"> of {tables.length}</span>
          )}
        </p>

        {filtered.length === 0 ? (
          <div className="mt-3 rounded-xl border border-outline-variant/10 bg-surface-container-low/50 px-4 py-8 text-center text-sm text-on-surface-variant">
            {query.trim() ? `No tables match “${query.trim()}”.` : 'No tables in this schema.'}
          </div>
        ) : (
          <div
            className="mt-3 flex max-h-[min(42vh,360px)] flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-xl border border-outline-variant/10 bg-surface-container-low/40 p-1.5 lg:max-h-[min(58vh,520px)]"
            role="listbox"
            aria-label="Tables in schema"
          >
            {filtered.map((table) => {
              const isActive = selectedName === table.name;
              return (
                <button
                  key={table.name}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => setTablePick(table.name)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition-colors sm:px-3 sm:py-2.5',
                    'focus-visible:ring-2 focus-visible:ring-primary/40',
                    isActive
                      ? 'bg-primary/12 text-on-surface ring-1 ring-primary/25'
                      : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                  )}
                >
                  <span className="material-symbols-outlined shrink-0 text-[20px] opacity-75">
                    table_chart
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{table.name}</span>
                  <span className="shrink-0 tabular-nums text-[11px] text-outline">
                    {table.columns.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail — one table at a time, full column list */}
      <div className="min-w-0 flex-1 lg:pl-6">
        {selected ? (
          <SchemaTableDetail table={selected} />
        ) : (
          <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-outline-variant/20 bg-surface-container-low/30 px-6 py-12 text-center lg:min-h-[320px]">
            <span className="material-symbols-outlined text-5xl text-outline/80">table_rows</span>
            <p className="mt-3 max-w-xs text-sm text-on-surface-variant">
              Select a table on the left to view columns, types, and keys.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ProvisioningModal({
  open,
  database,
  progress,
  scale,
  isPending,
  isError,
  errorMessage,
  onClose,
}: {
  open: boolean;
  database: Database;
  progress: number;
  scale: DatabaseScale;
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-xl border border-outline-variant/15 bg-surface-container-low p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-outline">Provisioning</p>
            <h2 className="mt-2 font-headline text-2xl font-semibold text-on-surface">
              {database.name}
            </h2>
            <p className="mt-2 text-sm text-on-surface-variant">
              Spinning up a {DATABASE_SCALE_LABELS[scale]} sandbox on {database.engine}.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Close
          </Button>
        </div>

        <div className="mb-6 rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-on-surface-variant">Environment progress</span>
            <span className="font-mono text-on-surface">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-container-high">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                isError ? 'bg-error' : 'bg-on-surface-variant',
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="space-y-3">
          {PROVISIONING_STEPS.map((step, index) => {
            const isComplete = progress >= step.threshold && !isError;
            const isCurrent =
              !isError &&
              progress < step.threshold &&
              (index === 0 || progress >= PROVISIONING_STEPS[index - 1].threshold);

            return (
              <div
                key={step.label}
                className={cn(
                  'flex items-start gap-4 rounded-2xl border px-4 py-3 transition-colors',
                  isComplete
                    ? 'border-outline bg-surface-container-high'
                    : isCurrent
                      ? 'border-outline-variant bg-surface-container'
                      : 'border-outline-variant/10 bg-surface-container-low',
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm',
                    isComplete
                      ? 'border-outline bg-surface-container-highest text-on-surface'
                      : isCurrent
                        ? 'border-outline-variant bg-surface-container text-on-surface'
                        : 'border-outline-variant/15 bg-surface-container-high text-outline',
                  )}
                >
                  {isComplete ? (
                    <span className="material-symbols-outlined text-base">check</span>
                  ) : (
                    <span className="material-symbols-outlined text-base">
                      {isCurrent ? 'autorenew' : 'radio_button_unchecked'}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <p className="font-medium text-on-surface">{step.label}</p>
                    <StatusBadge
                      status={isComplete ? 'ready' : isCurrent ? 'running' : 'pending'}
                    />
                  </div>
                  <p className="text-sm text-on-surface-variant">{step.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {isError && (
          <div className="mt-4 rounded-2xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">
            {errorMessage ?? 'Unable to launch this sandbox right now. Please try again.'}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DatabaseDetailPage() {
  const { dbId: dbIdParam } = useParams<{ dbId: string }>();
  const dbId = decodeURIComponent(dbIdParam ?? '');
  return <DatabaseDetail key={dbId} dbId={dbId} />;
}

function DatabaseDetail({ dbId }: { dbId: string }) {
  const router = useRouter();
  const [scaleOverride, setScaleOverride] = useState<DatasetScale | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [progress, setProgress] = useState(10);

  const fallbackDatabase = useMemo(() => getFallbackDatabase(dbId), [dbId]);

  const {
    data: database,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['database', dbId],
    queryFn: async () => {
      try {
        return await databasesApi.get(dbId);
      } catch {
        if (fallbackDatabase) {
          return fallbackDatabase;
        }
        throw new Error('Database not found');
      }
    },
    staleTime: 60_000,
  });

  const availableScales = useMemo(() => {
    if (!database?.availableScales?.length) {
      return SCALE_OPTIONS.map((option) => option.value);
    }

    return database.availableScales;
  }, [database?.availableScales]);

  const defaultScale =
    database?.selectedScale ??
    database?.sourceScale ??
    availableScales[availableScales.length - 1] ??
    'medium';
  const selectedScale = scaleOverride && availableScales.includes(scaleOverride)
    ? scaleOverride
    : defaultScale;

  useEffect(() => {
    if (scaleOverride && !availableScales.includes(scaleOverride)) {
      setScaleOverride(null);
    }
  }, [availableScales, scaleOverride]);

  const launchMutation = useMutation({
    mutationFn: async () => {
      if (!database) {
        throw new Error('Database not loaded');
      }
      return databasesApi.createSession(database.id, selectedScale);
    },
    onSuccess: (session) => {
      setProgress(100);
      toast.success('Sandbox ready. Opening SQL Lab.');
      window.setTimeout(() => {
        setIsModalOpen(false);
        router.push(`/lab/${session.id}`);
      }, 900);
    },
    onError: (launchError: Error) => {
      setProgress((current) => Math.max(current, 78));
      toast.error(launchError.message);
    },
  });

  useEffect(() => {
    if (!isModalOpen || !launchMutation.isPending) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 88) {
          return current;
        }
        if (current < 36) {
          return current + 7;
        }
        if (current < 68) {
          return current + 5;
        }
        return current + 3;
      });
    }, 260);

    return () => window.clearInterval(timer);
  }, [isModalOpen, launchMutation.isPending]);

  const handleLaunch = () => {
    if (!database || launchMutation.isPending) {
      return;
    }

    setProgress(10);
    setIsModalOpen(true);
    launchMutation.reset();
    launchMutation.mutate();
  };

  const handleCloseModal = () => {
    if (launchMutation.isPending) {
      return;
    }
    setIsModalOpen(false);
    setProgress(10);
    launchMutation.reset();
  };

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!database) {
    return (
      <div className="page-shell-narrow">
        <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-10 text-center">
          <span className="material-symbols-outlined text-5xl text-outline">database_off</span>
          <h1 className="mt-4 font-headline text-3xl font-semibold text-on-surface">
            Database not found
          </h1>
          <p className="mt-3 text-sm text-on-surface-variant">
            {error instanceof Error ? error.message : 'This catalog entry is unavailable.'}
          </p>
          <Link href="/explore" className="mt-6 inline-flex">
            <Button variant="primary">Back to Explorer</Button>
          </Link>
        </div>
      </div>
    );
  }

  const difficulty =
    DATABASE_DIFFICULTY_STYLES[database.difficulty] ?? DATABASE_DIFFICULTY_STYLES.beginner;

  const scalePicker = (
    <div
      className="flex flex-wrap gap-1.5"
      role="group"
      aria-label="Sandbox dataset size"
    >
      {availableScales.map((scaleValue) => (
        <button
          key={scaleValue}
          type="button"
          onClick={() => setScaleOverride(scaleValue)}
          className={cn(
            'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
            selectedScale === scaleValue
              ? 'border-primary/40 bg-primary/10 text-on-surface'
              : 'border-outline-variant/10 text-on-surface-variant hover:border-outline-variant/25 hover:bg-surface-container',
          )}
        >
          {DATABASE_SCALE_LABELS[scaleValue]}
        </button>
      ))}
    </div>
  );

  const launchButton = (
    <Button
      fullWidth
      size="lg"
      onClick={handleLaunch}
      loading={launchMutation.isPending}
      leftIcon={<span className="material-symbols-outlined text-xl">rocket_launch</span>}
    >
      Launch sandbox
    </Button>
  );

  const datasetSummary = (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-on-surface-variant">
        {formatRows(database.sourceRowCount ?? database.rowCount)} rows
        <span className="mx-1.5 text-outline">·</span>
        {database.tableCount} tables
        <span className="mx-1.5 text-outline">·</span>
        {database.estimatedSizeGb.toFixed(1)} GB
        <span className="mx-1.5 text-outline">·</span>
        Source scale {DATABASE_SCALE_LABELS[database.sourceScale ?? selectedScale]}
      </p>
      <p className="text-[11px] text-outline">
        Launch scale <span className="font-medium text-on-surface-variant">{DATABASE_SCALE_LABELS[selectedScale]}</span>
        <span className="mx-1.5">·</span>
        {availableScales.length} option{availableScales.length === 1 ? '' : 's'} available
      </p>
      <p className="text-[11px] text-outline">
        Region{' '}
        <span className="font-mono text-on-surface-variant">{database.region ?? 'global-edge'}</span>
        <span className="mx-1.5">·</span>
        Uptime{' '}
        <span className="font-mono text-on-surface-variant">
          {database.uptime != null ? `${database.uptime.toFixed(2)}%` : 'SLA pending'}
        </span>
      </p>
    </div>
  );

  return (
    <>
      <div className="page-shell page-stack">
        <Link
          href="/explore"
          className="inline-flex w-fit items-center gap-2 rounded-lg text-sm text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Back to database explorer
        </Link>

        {/* Hero: identity + compact sandbox controls (no duplicate metric grids) */}
        <section className="overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-low">
          {/* Small screens: action first */}
          <div className="space-y-3 border-b border-outline-variant/10 p-4 sm:p-5 lg:hidden">
            {launchButton}
            {scalePicker}
          </div>

          <div className="flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between lg:gap-12 lg:p-8">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface-container-high px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-outline sm:px-3 sm:py-1 sm:text-[11px]">
                  {DATABASE_DOMAIN_LABELS[database.domain] ?? 'Catalog'}
                </span>
                <Badge className={difficulty.badge}>{difficulty.label}</Badge>
                <Badge className="bg-surface-container-high text-on-surface-variant">{database.engine}</Badge>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-container-high sm:h-14 sm:w-14">
                  <span
                    className="material-symbols-outlined text-2xl text-tertiary sm:text-3xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    {database.domainIcon}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <h1 className="font-headline text-2xl font-bold tracking-tight text-on-surface sm:text-3xl lg:text-4xl">
                    {database.name}
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant sm:text-base">
                    {database.description}
                  </p>
                  {datasetSummary}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {database.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md border border-outline-variant/10 bg-surface-container/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-outline sm:text-[11px]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <aside className="hidden w-full max-w-sm shrink-0 flex-col gap-3 lg:flex">
              {launchButton}
              {scalePicker}
            </aside>
          </div>
        </section>

        <section className="space-y-6">
          <Card className="overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-low">
            <CardHeader className="flex flex-col gap-4 border-b border-outline-variant/10 bg-surface-container-low/80 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:py-5">
              <div className="min-w-0">
                <CardTitle className="text-lg sm:text-xl">Schema overview</CardTitle>
                <CardDescription className="mt-1 max-w-2xl text-sm leading-relaxed">
                  Search tables, pick one in the list, then inspect columns and types in the detail
                  panel — compact for large catalogs.
                </CardDescription>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Badge className="bg-surface-container-high text-on-surface-variant">
                  {database.schema?.length ?? 0} tables
                </Badge>
                <Badge className="bg-surface-container-high text-on-surface-variant">
                  {database.relationships?.length ?? 0} relationships
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="relative overflow-hidden px-4 py-5 sm:px-6 sm:py-6">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-surface-container-low/80"
              />

              {database.schema?.length ? (
                <SchemaBrowser tables={database.schema} />
              ) : (
                <div className="relative rounded-2xl border border-outline-variant/10 bg-surface-container-low p-8 text-center">
                  <span className="material-symbols-outlined text-4xl text-outline">schema</span>
                  <p className="mt-3 text-sm text-on-surface-variant">
                    Schema metadata is not available for this catalog entry yet.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {database.relationships?.length ? (
            <Card className="rounded-2xl border border-outline-variant/10 bg-surface-container-low">
              <CardHeader className="border-b border-outline-variant/10 px-5 py-4 sm:px-6 sm:py-5">
                <CardTitle className="text-lg">Relationship lanes</CardTitle>
                <CardDescription className="mt-1 text-sm leading-relaxed">
                  Common joins to try first in analytical queries.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-3 sm:px-5 sm:pb-4">
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {database.relationships.map((relationship) => (
                    <div
                      key={`${relationship.from}-${relationship.to}`}
                      className="rounded-lg border border-outline-variant/10 bg-surface-container/80 px-2.5 py-1.5 transition-colors hover:border-outline-variant/25 hover:bg-surface-container"
                    >
                      <p className="text-xs font-medium leading-snug text-on-surface">
                        <span className="font-mono">{relationship.from}</span>
                        <span className="mx-1 text-outline/80">→</span>
                        <span className="font-mono">{relationship.to}</span>
                        {relationship.label ? (
                          <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-outline">
                            {relationship.label}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </section>
      </div>

      <ProvisioningModal
        open={isModalOpen}
        database={database}
        progress={progress}
        scale={selectedScale}
        isPending={launchMutation.isPending}
        isError={launchMutation.isError}
        errorMessage={launchMutation.error?.message}
        onClose={handleCloseModal}
      />
    </>
  );
}

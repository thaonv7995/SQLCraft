'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { databasesApi, type Database, type DatabaseScale } from '@/lib/api';
import {
  DATABASE_DIFFICULTY_STYLES,
  DATABASE_DOMAIN_LABELS,
  DATABASE_SCALE_LABELS,
  DATABASE_SCALE_OPTIONS,
  getFallbackDatabase,
} from '@/lib/database-catalog';
import { cn, formatRows } from '@/lib/utils';

const SCALE_OPTIONS = DATABASE_SCALE_OPTIONS.filter((option) => option.value !== 'all') as Array<{
  value: DatabaseScale;
  label: string;
}>;

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
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="h-5 w-32 rounded bg-surface-container-low animate-pulse" />
      <div className="rounded-3xl bg-surface-container-low p-8 space-y-4">
        <div className="h-10 w-72 rounded bg-surface-container animate-pulse" />
        <div className="h-4 w-full max-w-3xl rounded bg-surface-container animate-pulse" />
        <div className="h-4 w-5/6 rounded bg-surface-container animate-pulse" />
      </div>
      <div className="grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8 rounded-3xl bg-surface-container-low p-8">
          <div className="grid gap-5 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-48 rounded-2xl bg-surface-container animate-pulse" />
            ))}
          </div>
        </div>
        <div className="xl:col-span-4 rounded-3xl bg-surface-container-low p-8 space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-20 rounded-2xl bg-surface-container animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-outline">
        <span className="material-symbols-outlined text-base">{icon}</span>
        {label}
      </div>
      <p className="font-mono text-lg font-semibold text-on-surface">{value}</p>
    </div>
  );
}

function SchemaTableCard({
  table,
  index,
}: {
  table: NonNullable<Database['schema']>[number];
  index: number;
}) {
  const role = table.role ?? 'secondary';
  const roleStyle = ROLE_STYLES[role] ?? ROLE_STYLES.secondary;
  const connectFromLeft = index % 2 === 1;

  return (
    <article
      className={cn(
        'relative rounded-2xl border border-outline-variant/10 bg-[#181818] p-4 shadow-[0_12px_30px_rgba(0,0,0,0.18)]',
        role === 'primary' && 'ring-1 ring-primary/20',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-1/2 hidden w-6 border-t border-dashed border-outline-variant/30 md:block',
          connectFromLeft ? '-left-6' : '-right-6',
        )}
      />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-headline text-lg font-semibold text-on-surface">{table.name}</h3>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-outline">
            {table.columns.length} columns
          </p>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]',
            roleStyle,
          )}
        >
          {role}
        </span>
      </div>

      <div className="space-y-2">
        {table.columns.map((column) => (
          <div
            key={`${table.name}-${column.name}`}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl bg-surface-container-low px-3 py-2"
          >
            <div className="flex items-center gap-1.5">
              {column.isPrimary && (
                <span className="material-symbols-outlined text-sm text-secondary">key</span>
              )}
              {!column.isPrimary && column.isForeign && (
                <span className="material-symbols-outlined text-sm text-tertiary">link</span>
              )}
              {!column.isPrimary && !column.isForeign && (
                <span className="material-symbols-outlined text-sm text-outline">circle</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-on-surface">{column.name}</p>
              {column.references && (
                <p className="truncate text-[11px] text-outline">ref {column.references}</p>
              )}
            </div>
            <span className="text-[11px] font-mono uppercase tracking-wide text-outline">
              {column.type}
            </span>
          </div>
        ))}
      </div>
    </article>
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
      <div className="w-full max-w-xl rounded-3xl border border-outline-variant/15 bg-[#121212] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
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
                isError
                  ? 'bg-gradient-to-r from-error to-[#ff8b7a]'
                  : 'bg-gradient-to-r from-primary via-tertiary to-secondary',
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
                    ? 'border-secondary/20 bg-secondary/10'
                    : isCurrent
                      ? 'border-primary/25 bg-primary/10'
                      : 'border-outline-variant/10 bg-surface-container-low',
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm',
                    isComplete
                      ? 'border-secondary/25 bg-secondary/15 text-secondary'
                      : isCurrent
                        ? 'border-primary/25 bg-primary/15 text-primary'
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

export default function DatabaseDetailPage({
  params,
}: {
  params: { dbId: string };
}) {
  const router = useRouter();
  const dbId = decodeURIComponent(params.dbId);
  const [selectedScale, setSelectedScale] = useState<DatabaseScale>('medium');
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

  useEffect(() => {
    if (database?.scale) {
      setSelectedScale(database.scale);
    }
  }, [database?.id, database?.scale]);

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
      <div className="p-8 max-w-5xl mx-auto">
        <div className="rounded-3xl border border-outline-variant/10 bg-surface-container-low p-10 text-center">
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

  return (
    <>
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <Link
          href="/explore"
          className="inline-flex items-center gap-2 text-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Back to database explorer
        </Link>

        <section className="overflow-hidden rounded-[28px] border border-outline-variant/10 bg-[radial-gradient(circle_at_top_left,_rgba(186,195,255,0.12),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.02),_rgba(255,255,255,0))] px-8 py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface-container-high px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-outline">
                  {DATABASE_DOMAIN_LABELS[database.domain] ?? 'Catalog'}
                </span>
                <Badge className={difficulty.badge}>{difficulty.label}</Badge>
                <Badge className="bg-surface-container-high text-on-surface-variant">
                  {database.engine}
                </Badge>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-surface-container-high">
                  <span
                    className="material-symbols-outlined text-4xl text-tertiary"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    {database.domainIcon}
                  </span>
                </div>

                <div className="min-w-0">
                  <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface">
                    {database.name}
                  </h1>
                  <p className="mt-3 max-w-3xl text-base leading-7 text-on-surface-variant">
                    {database.description}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {database.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-outline-variant/10 bg-surface-container-low px-3 py-1 text-xs uppercase tracking-[0.16em] text-outline"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[340px]">
              <InfoMetric label="Engine" value={database.engine} icon="deployed_code" />
              <InfoMetric label="Region" value={database.region ?? 'global-edge'} icon="public" />
              <InfoMetric
                label="Uptime"
                value={database.uptime ? `${database.uptime.toFixed(2)}%` : 'SLA pending'}
                icon="query_stats"
              />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <Card className="overflow-hidden rounded-[28px] border border-outline-variant/10 bg-[#111111]">
              <CardHeader className="border-b border-outline-variant/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))] px-6 py-5">
                <div>
                  <CardTitle className="text-xl">Schema ERD</CardTitle>
                  <CardDescription className="mt-1 max-w-2xl leading-6">
                    Table layout for the sandbox image. Connectors highlight the main dependency
                    rail between primary entities and support tables.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-surface-container-high text-on-surface-variant">
                    {database.schema?.length ?? 0} tables
                  </Badge>
                  <Badge className="bg-surface-container-high text-on-surface-variant">
                    {database.relationships?.length ?? 0} key paths
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="relative overflow-hidden px-6 py-6">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(68,216,241,0.07),transparent_25%),radial-gradient(circle_at_80%_0%,rgba(186,195,255,0.08),transparent_30%)]"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-10 left-1/2 hidden w-px -translate-x-1/2 border-l border-dashed border-outline-variant/25 md:block"
                />

                {database.schema?.length ? (
                  <div className="relative grid gap-5 md:grid-cols-2">
                    {database.schema.map((table, index) => (
                      <SchemaTableCard key={table.name} table={table} index={index} />
                    ))}
                  </div>
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
              <Card className="rounded-[28px] border border-outline-variant/10">
                <CardHeader className="px-6 py-5">
                  <div>
                    <CardTitle className="text-lg">Relationship lanes</CardTitle>
                    <CardDescription className="mt-1">
                      Primary joins you will usually touch first when writing analytical queries.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="px-6 pb-6 pt-0">
                  <div className="flex flex-wrap gap-3">
                    {database.relationships.map((relationship) => (
                      <div
                        key={`${relationship.from}-${relationship.to}`}
                        className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-3"
                      >
                        <p className="text-sm font-medium text-on-surface">
                          {relationship.from}
                          <span className="mx-2 text-outline">→</span>
                          {relationship.to}
                        </p>
                        {relationship.label && (
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-outline">
                            {relationship.label}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="space-y-6 xl:col-span-4">
            <Card className="rounded-[28px] border border-outline-variant/10 xl:sticky xl:top-20">
              <CardHeader className="px-6 py-5">
                <div>
                  <CardTitle className="text-xl">Quick Stats</CardTitle>
                  <CardDescription className="mt-1">
                    Use this brief to decide whether the dataset shape fits the SQL problem you
                    want to practice.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 px-6 pb-6 pt-0">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <InfoMetric label="Rows" value={formatRows(database.rowCount)} icon="table_rows" />
                  <InfoMetric label="Tables" value={String(database.tableCount)} icon="dataset" />
                  <InfoMetric
                    label="Footprint"
                    value={`${database.estimatedSizeGb.toFixed(1)} GB`}
                    icon="database"
                  />
                  <InfoMetric
                    label="Default Scale"
                    value={DATABASE_SCALE_LABELS[database.scale] ?? database.scale}
                    icon="equalizer"
                  />
                </div>

                <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4">
                  <p className="mb-3 text-xs uppercase tracking-[0.18em] text-outline">
                    Provisioning scale
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {SCALE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSelectedScale(option.value)}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-left transition-colors',
                          selectedScale === option.value
                            ? 'border-primary/30 bg-primary/10 text-on-surface'
                            : 'border-outline-variant/10 bg-surface text-on-surface-variant hover:border-outline-variant/25 hover:text-on-surface',
                        )}
                      >
                        <p className="text-sm font-medium">{option.label}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-outline">
                          {DATABASE_SCALE_LABELS[option.value]}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  fullWidth
                  size="lg"
                  onClick={handleLaunch}
                  loading={launchMutation.isPending}
                  leftIcon={<span className="material-symbols-outlined">rocket_launch</span>}
                >
                  Launch Sandbox
                </Button>

                <div className="rounded-2xl border border-dashed border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
                  A successful launch redirects you straight into the dedicated SQL editor for this
                  environment.
                </div>
              </CardContent>
            </Card>
          </div>
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

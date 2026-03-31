'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { searchParamFirst } from '@/lib/next-app-page';
import type { ClientPageProps } from '@/lib/page-props';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Database } from '@/lib/api';
import { adminApi, databasesApi } from '@/lib/api';
import { DatabaseImportPanel } from '@/components/admin/database-import-panel';
import {
  DATABASE_DIFFICULTY_STYLES,
  DATABASE_DIALECT_OPTIONS,
  DATABASE_DOMAIN_LABELS,
  DATABASE_DOMAIN_OPTIONS,
  DATABASE_SCALE_OPTIONS,
  SANDBOX_GOLDEN_STATUS_STYLES,
} from '@/lib/database-catalog';
import { cn, formatRows } from '@/lib/utils';
import { GoldenSnapshotErrorDialog } from '@/components/admin/golden-snapshot-error-dialog';
import { ConfirmModal } from '@/components/ui/confirm-modal';

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="appearance-none rounded-lg border border-outline-variant/20 bg-surface-container-low pl-3 pr-8 py-2 text-xs font-medium text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-base text-outline">
        expand_more
      </span>
    </div>
  );
}

function CatalogMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-outline">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-on-surface">{value}</p>
      <p className="mt-1 text-xs text-on-surface-variant">{hint}</p>
    </div>
  );
}

function DatabaseCatalogCard({
  database,
  onGoldenErrorClick,
}: {
  database: Database;
  onGoldenErrorClick: (db: Database) => void;
}) {
  const difficulty =
    DATABASE_DIFFICULTY_STYLES[database.difficulty] ?? DATABASE_DIFFICULTY_STYLES.beginner;
  const goldenStatus = database.sandboxGoldenStatus ?? 'none';
  const golden =
    SANDBOX_GOLDEN_STATUS_STYLES[goldenStatus] ??
    SANDBOX_GOLDEN_STATUS_STYLES.none;

  return (
    <Link
      href={`/admin/databases/${database.id}`}
      className="group block rounded-xl border border-outline-variant/10 bg-surface-container-low p-5 transition-colors hover:border-outline-variant/30 hover:bg-surface-container"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest">
            <span
              className="material-symbols-outlined text-xl text-tertiary"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {database.domainIcon}
            </span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-on-surface group-hover:text-primary">
              {database.name}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {DATABASE_DOMAIN_LABELS[database.domain]}
            </p>
            <p className="mt-0.5 truncate text-[10px] font-mono text-outline">{database.engine}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
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
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onGoldenErrorClick(database);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                onGoldenErrorClick(database);
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
              title="Sandbox golden snapshot bake status (source dataset)"
            >
              {golden.label}
            </span>
          )}
        </div>
      </div>

      <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-on-surface-variant">
        {database.description}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(database.availableScales ?? []).map((scale) => (
          <span
            key={`${database.id}-${scale}`}
            className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-on-surface-variant"
          >
            {scale}
          </span>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-outline-variant/10 pt-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-outline">Rows</p>
          <p className="mt-1 text-sm font-mono font-semibold text-on-surface">
            {formatRows(database.sourceRowCount ?? database.rowCount)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-outline">Tables</p>
          <p className="mt-1 text-sm font-mono font-semibold text-on-surface">
            {database.tableCount}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-outline">Source Scale</p>
          <p className="mt-1 text-sm font-mono font-semibold capitalize text-tertiary">
            {database.sourceScale ?? database.scale}
          </p>
        </div>
      </div>
    </Link>
  );
}

function DatabaseCatalogSkeleton() {
  return (
    <div className="rounded-xl bg-surface-container-low p-5">
      <div className="flex items-start justify-between">
        <div className="flex gap-3">
          <div className="h-11 w-11 animate-pulse rounded-lg bg-surface-container-high" />
          <div className="space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-surface-container-high" />
            <div className="h-3 w-20 animate-pulse rounded bg-surface-container-high" />
          </div>
        </div>
        <div className="h-5 w-20 animate-pulse rounded-full bg-surface-container-high" />
      </div>
      <div className="mt-4 h-4 w-full animate-pulse rounded bg-surface-container-high" />
      <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-surface-container-high" />
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-5 w-14 animate-pulse rounded-full bg-surface-container-high" />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-outline-variant/10 pt-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <div className="h-3 w-14 animate-pulse rounded bg-surface-container-high" />
            <div className="h-4 w-16 animate-pulse rounded bg-surface-container-high" />
          </div>
        ))}
      </div>
    </div>
  );
}

const CATALOG_PAGE_SIZE = 9;
const PENDING_SCANS_PAGE_SIZE = 5;

export default function AdminDatabasesPage({ searchParams }: ClientPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestedView = searchParamFirst(searchParams, 'view');
  const requestedTab = searchParamFirst(searchParams, 'tab');
  const replaceParam = searchParamFirst(searchParams, 'replace');
  const lockedCatalogName = searchParamFirst(searchParams, 'schemaName');

  const [showImportPanel, setShowImportPanel] = useState(
    requestedView === 'import' || requestedTab === 'sql-imports' || Boolean(replaceParam),
  );
  const [resumeScanId, setResumeScanId] = useState<string | null>(null);
  const [goldenErrorDb, setGoldenErrorDb] = useState<Database | null>(null);
  const [confirmDeleteScanId, setConfirmDeleteScanId] = useState<string | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [pendingPage, setPendingPage] = useState(1);
  const [catalogPage, setCatalogPage] = useState(1);
  const [domain, setDomain] = useState('all');
  const [scale, setScale] = useState('all');
  const [dialect, setDialect] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setCatalogPage(1);
  }, [domain, scale, dialect, debouncedQ]);

  useEffect(() => {
    if (replaceParam) {
      setShowImportPanel(true);
    }
  }, [replaceParam]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-database-catalog', domain, scale, dialect, debouncedQ, catalogPage],
    queryFn: () =>
      databasesApi.list({
        domain: domain === 'all' ? undefined : domain,
        scale: scale === 'all' ? undefined : scale,
        dialect: dialect === 'all' ? undefined : dialect,
        q: debouncedQ || undefined,
        page: catalogPage,
        limit: CATALOG_PAGE_SIZE,
        includeAwaitingGolden: true,
      }),
    staleTime: 60_000,
  });

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['admin-pending-scans', pendingPage],
    queryFn: () =>
      databasesApi.listPendingScans({ page: pendingPage, limit: PENDING_SCANS_PAGE_SIZE }),
    staleTime: 30_000,
  });

  const pendingReviewQuery = useQuery({
    queryKey: ['admin-pending-schema-template-reviews'],
    queryFn: () => adminApi.listPendingSchemaTemplateReviews(),
    staleTime: 30_000,
  });

  const approveReviewMutation = useMutation({
    mutationFn: (schemaTemplateId: string) =>
      adminApi.approveSchemaTemplateReview(schemaTemplateId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-pending-schema-template-reviews'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-database-catalog'] });
    },
  });

  const rejectReviewMutation = useMutation({
    mutationFn: (schemaTemplateId: string) =>
      adminApi.rejectSchemaTemplateReview(schemaTemplateId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-pending-schema-template-reviews'] });
    },
  });

  const clearResumeScan = useCallback(() => setResumeScanId(null), []);

  const deleteScanMutation = useMutation({
    mutationFn: (scanId: string) => adminApi.deletePendingScan(scanId),
    onSuccess: () => {
      setConfirmDeleteScanId(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-pending-scans'] });
    },
  });

  const cleanupScansMutation = useMutation({
    mutationFn: () => adminApi.cleanupStalePendingScans(),
    onSuccess: () => {
      setConfirmCleanup(false);
      void queryClient.invalidateQueries({ queryKey: ['admin-pending-scans'] });
    },
  });

  const databases = useMemo(() => data?.items ?? [], [data?.items]);
  const replaceCatalogMatch = useMemo(() => {
    const id = replaceParam?.trim();
    if (!id) return null;
    return databases.find((d) => d.schemaTemplateId === id || d.id === id) ?? null;
  }, [replaceParam, databases]);
  const datasetVariantCount = useMemo(
    () =>
      databases.reduce((sum, database) => sum + (database.availableScales?.length ?? 0), 0),
    [databases],
  );
  const largestSourceRows = useMemo(
    () =>
      databases.reduce(
        (max, database) => Math.max(max, database.sourceRowCount ?? database.rowCount),
        0,
      ),
    [databases],
  );

  const pendingReviews = pendingReviewQuery.data ?? [];
  const showPendingReviewSection =
    pendingReviewQuery.isError ||
    (pendingReviewQuery.isFetched && pendingReviews.length > 0);

  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h1 className="page-title">Databases</h1>
          <p className="page-lead mt-2">
            Browse the published database catalog first. Open any database to inspect its schema
            blueprint, dataset variants, and generation history, or import a new SQL dump into the
            catalog.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant={showImportPanel ? 'secondary' : 'primary'}
            onClick={() => setShowImportPanel((value) => !value)}
          >
            {showImportPanel ? 'Hide SQL Import' : 'SQL Import'}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <CatalogMetric
          label="Published Databases"
          value={isLoading ? '—' : String(data?.total ?? databases.length)}
          hint="Catalog entries built from published schema templates."
        />
        <CatalogMetric
          label="Dataset Variants"
          value={isLoading ? '—' : String(datasetVariantCount)}
          hint="Published scale variants on this catalog page."
        />
        <CatalogMetric
          label="Largest Source Dataset"
          value={isLoading ? '—' : formatRows(largestSourceRows)}
          hint="Largest source row count among databases on this catalog page."
        />
      </div>

      {showImportPanel ? (
        <DatabaseImportPanel
          variant="admin"
          resumeScanId={resumeScanId}
          onResumeConsumed={clearResumeScan}
          replaceSchemaTemplateId={replaceParam ?? undefined}
          lockedSchemaName={lockedCatalogName ?? undefined}
          lockedCatalogDomain={replaceCatalogMatch?.domain}
          lockedDialect={replaceCatalogMatch ? (replaceCatalogMatch.dialect ?? 'postgresql') : undefined}
          lockedEngineVersion={
            replaceCatalogMatch ? (replaceCatalogMatch.engineVersion ?? null) : undefined
          }
          onClose={() => {
            setShowImportPanel(false);
            setResumeScanId(null);
          }}
          onImported={(databaseId) => {
            void queryClient.invalidateQueries({ queryKey: ['admin-pending-scans'] });
            void queryClient.invalidateQueries({ queryKey: ['admin-database-catalog'] });
            setShowImportPanel(false);
            setResumeScanId(null);
            router.push(`/admin/databases/${databaseId}`);
          }}
        />
      ) : null}

      {showPendingReviewSection ? (
        <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-on-surface">Pending catalog review</h2>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                Open the name or Details to inspect the schema, then approve or reject.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => void pendingReviewQuery.refetch()}
            >
              Refresh
            </Button>
          </div>
          {pendingReviewQuery.isError ? (
            <p className="mt-4 text-xs text-error">Could not load pending reviews.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead>
                  <tr className="border-b border-outline-variant/15 text-on-surface-variant">
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Description</th>
                    <th className="py-2 pr-3 font-medium">Dialect</th>
                    <th className="py-2 pr-3 font-medium">Submitted</th>
                    <th className="py-2 pr-3 font-medium">Template ID</th>
                    <th className="py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingReviews.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-outline-variant/10 text-on-surface last:border-0"
                    >
                      <td className="py-2 pr-3 font-medium">
                        <Link
                          href={`/admin/databases/${row.id}?pendingReview=1`}
                          className="text-primary hover:underline"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="max-w-[200px] py-2 pr-3 text-on-surface-variant line-clamp-2">
                        {row.description?.trim() || '—'}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px]">{row.dialect}</td>
                      <td className="py-2 pr-3 text-on-surface-variant">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="max-w-[min(200px,28vw)] py-2 pr-3">
                        <span
                          className="block font-mono text-[10px] text-outline break-all"
                          title={row.id}
                        >
                          {row.id}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Link
                            href={`/admin/databases/${row.id}?pendingReview=1`}
                            className="inline-flex h-7 items-center justify-center rounded-lg px-3 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                          >
                            Details
                          </Link>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={approveReviewMutation.isPending}
                            disabled={rejectReviewMutation.isPending}
                            onClick={() => approveReviewMutation.mutate(row.id)}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={rejectReviewMutation.isPending}
                            disabled={approveReviewMutation.isPending}
                            onClick={() => rejectReviewMutation.mutate(row.id)}
                          >
                            Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="page-section-title">Published Database Catalog</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Select a database to inspect its templates and operational history.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:max-w-3xl">
          <Input
            label="Search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Name, description, engine, tags…"
            className="w-full"
          />
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect value={domain} onChange={setDomain} options={DATABASE_DOMAIN_OPTIONS} />
            <FilterSelect value={scale} onChange={setScale} options={DATABASE_SCALE_OPTIONS} />
            <FilterSelect value={dialect} onChange={setDialect} options={DATABASE_DIALECT_OPTIONS} />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: CATALOG_PAGE_SIZE }).map((_, index) => (
            <DatabaseCatalogSkeleton key={index} />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-error/20 bg-error/5 px-5 py-4 text-sm text-error">
          Failed to load the database catalog.
        </div>
      ) : databases.length === 0 ? (
        <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-5 py-8 text-center">
          <p className="text-sm font-medium text-on-surface">No published databases found</p>
          <p className="mt-1 text-sm text-on-surface-variant">
            Import a SQL dump or adjust filters — no database matches the current criteria.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {databases.map((database) => (
              <DatabaseCatalogCard
                key={database.id}
                database={database}
                onGoldenErrorClick={setGoldenErrorDb}
              />
            ))}
          </div>
          {data && data.totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={catalogPage <= 1}
                onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-xs text-on-surface-variant">
                Page {data.page} / {data.totalPages} · {data.total} total
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={catalogPage >= data.totalPages}
                onClick={() => setCatalogPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}

      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-on-surface">Scanned SQL dumps (storage)</h2>
            <p className="mt-0.5 text-xs text-on-surface-variant">
              Uploads that finished scan and have metadata in object storage. Resume to publish or
              review before import.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              size="sm"
              title="Delete all pending scans older than the configured threshold (default 7 days)"
              onClick={() => setConfirmCleanup(true)}
            >
              Cleanup stale
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowImportPanel(true);
                setResumeScanId(null);
              }}
            >
              Open SQL import
            </Button>
          </div>
        </div>
        {pendingLoading ? (
          <p className="mt-4 text-xs text-on-surface-variant">Loading pending scans…</p>
        ) : !pendingData?.items.length ? (
          <p className="mt-4 text-xs text-on-surface-variant">No scan metadata found under storage.</p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead>
                  <tr className="border-b border-outline-variant/15 text-on-surface-variant">
                    <th className="py-2 pr-3 font-medium">File</th>
                    <th className="py-2 pr-3 font-medium">Scan ID</th>
                    <th className="py-2 pr-3 font-medium">Updated</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingData.items.map((row) => (
                    <tr
                      key={row.scanId}
                      className="border-b border-outline-variant/10 text-on-surface last:border-0"
                    >
                      <td className="py-2 pr-3 font-mono text-[11px]">{row.fileName}</td>
                      <td className="max-w-[140px] truncate py-2 pr-3 font-mono text-[10px] text-outline">
                        {row.scanId}
                      </td>
                      <td className="py-2 pr-3 text-on-surface-variant">
                        {row.lastModified
                          ? new Date(row.lastModified).toLocaleString()
                          : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        {row.imported ? (
                          <span className="rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary">
                            Published
                          </span>
                        ) : (
                          <span className="rounded-full bg-tertiary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tertiary">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={row.imported}
                            onClick={() => {
                              setResumeScanId(row.scanId);
                              setShowImportPanel(true);
                            }}
                          >
                            Resume
                          </Button>
                          {!row.imported ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Delete this pending scan from object storage"
                              onClick={() => setConfirmDeleteScanId(row.scanId)}
                            >
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pendingData.totalPages > 1 ? (
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pendingData.page <= 1}
                  onClick={() => setPendingPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs text-on-surface-variant">
                  Page {pendingData.page} / {pendingData.totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pendingData.page >= pendingData.totalPages}
                  onClick={() => setPendingPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <GoldenSnapshotErrorDialog
        open={goldenErrorDb !== null}
        databaseId={goldenErrorDb?.id ?? ''}
        databaseName={goldenErrorDb?.name ?? ''}
        schemaTemplateId={goldenErrorDb?.schemaTemplateId}
        error={goldenErrorDb?.sandboxGoldenError}
        onClose={() => setGoldenErrorDb(null)}
      />

      <ConfirmModal
        open={confirmDeleteScanId !== null}
        title="Delete scan?"
        description={
          <>
            This will permanently remove the scan metadata and SQL dump file for{' '}
            <span className="font-mono text-xs">{confirmDeleteScanId}</span> from object storage.
            This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        icon="delete"
        isPending={deleteScanMutation.isPending}
        onCancel={() => setConfirmDeleteScanId(null)}
        onConfirm={() => {
          if (confirmDeleteScanId) deleteScanMutation.mutate(confirmDeleteScanId);
        }}
      />

      <ConfirmModal
        open={confirmCleanup}
        title="Cleanup stale scans?"
        description="This will delete all pending (not imported) SQL dump scans that have not been updated within the configured retention period (default 7 days). This cannot be undone."
        confirmLabel="Cleanup"
        confirmVariant="destructive"
        icon="auto_delete"
        isPending={cleanupScansMutation.isPending}
        onCancel={() => setConfirmCleanup(false)}
        onConfirm={() => cleanupScansMutation.mutate()}
      />
    </div>
  );
}

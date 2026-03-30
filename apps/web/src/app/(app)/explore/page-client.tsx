'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ExploreDatabaseImportModal } from '@/components/user/explore-database-import-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { databasesApi } from '@/lib/api';
import type { Database } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import {
  DATABASE_DIFFICULTY_STYLES,
  DATABASE_ACCESS_FILTER_OPTIONS,
  DATABASE_DIALECT_OPTIONS,
  DATABASE_DOMAIN_OPTIONS,
  DATABASE_SCALE_OPTIONS,
  databaseScaleDisplayLabelFromRowCount,
} from '@/lib/database-catalog';
import { cn, formatRows } from '@/lib/utils';
import type { ClientPageProps } from '@/lib/page-props';

function wantsImportFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
): boolean {
  const v = sp.import;
  if (v === '1') {
    return true;
  }
  if (Array.isArray(v)) {
    return v.some((x) => x === '1');
  }
  return false;
}

// ─── Database Card ────────────────────────────────────────────────────────────

function DatabaseCard({ db, onClick }: { db: Database; onClick: () => void }) {
  const diff =
    DATABASE_DIFFICULTY_STYLES[db.difficulty] ?? DATABASE_DIFFICULTY_STYLES.beginner;
  const mine = db.catalogKind === 'private_owner';
  const reviewing = db.catalogKind === 'public_pending_owner';

  return (
    <div
      onClick={onClick}
      className="group bg-surface-container-low rounded-xl p-6 cursor-pointer hover:bg-surface-container transition-all duration-200 border border-transparent hover:border-outline-variant/20 relative overflow-hidden"
    >
      {/* Top row: domain icon + difficulty badge */}
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-lg bg-surface-container-highest flex items-center justify-center">
          <span
            className="material-symbols-outlined text-2xl text-tertiary"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {db.domainIcon}
          </span>
        </div>
        <span className={cn('text-[10px] px-2 py-0.5 rounded font-mono uppercase tracking-wider font-bold', diff.badge)}>
          {diff.label}
        </span>
      </div>

      {/* Title + description */}
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <h3 className="font-headline text-base font-bold text-on-surface group-hover:text-primary transition-colors">
          {db.name}
        </h3>
        {reviewing ? (
          <span className="rounded-md border border-amber-500/35 bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200">
            Reviewing
          </span>
        ) : null}
        {mine ? (
          <span className="rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
            My upload
          </span>
        ) : null}
      </div>
      <p className="text-xs text-outline leading-relaxed line-clamp-2 mb-2">
        {db.description}
      </p>
      <p className="text-[10px] font-mono text-outline/80 mb-4 truncate">{db.engine}</p>

      {/* Tags */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {db.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="text-[9px] font-mono bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded uppercase tracking-wide">
            {tag}
          </span>
        ))}
      </div>

      {/* Footer stats */}
      <div className="border-t border-outline-variant/10 pt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-outline mb-1">Rows</p>
          <p className="text-sm font-mono font-bold text-on-surface">{formatRows(db.rowCount)}</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-outline mb-1">Scale</p>
          <p className="text-sm font-mono font-bold text-tertiary">
            {databaseScaleDisplayLabelFromRowCount(db.rowCount)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DatabaseCardSkeleton() {
  return (
    <div className="bg-surface-container-low rounded-xl p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div className="w-12 h-12 bg-surface-container-high rounded-lg animate-pulse" />
        <div className="w-16 h-5 bg-surface-container-high rounded animate-pulse" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-3/4 bg-surface-container-high rounded animate-pulse" />
        <div className="h-3 w-full bg-surface-container-high rounded animate-pulse" />
        <div className="h-3 w-5/6 bg-surface-container-high rounded animate-pulse" />
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3].map((i) => <div key={i} className="w-12 h-4 bg-surface-container-high rounded animate-pulse" />)}
      </div>
      <div className="border-t border-outline-variant/10 pt-4 grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="h-2 w-8 bg-surface-container-high rounded animate-pulse" />
          <div className="h-4 w-12 bg-surface-container-high rounded animate-pulse" />
        </div>
        <div className="space-y-1.5">
          <div className="h-2 w-8 bg-surface-container-high rounded animate-pulse" />
          <div className="h-4 w-14 bg-surface-container-high rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}

// ─── Select dropdown ──────────────────────────────────────────────────────────

function FilterSelect({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-surface-container-low border border-outline-variant/20 rounded-lg pl-3 pr-8 py-2 text-xs font-medium text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-base text-outline pointer-events-none">
        expand_more
      </span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const EXPLORE_PAGE_SIZE = 12;

export default function ExplorePage(props: ClientPageProps) {
  const router = useRouter();
  const authUser = useAuthStore((s) => s.user);
  const importFromQuery = wantsImportFromSearchParams(props.searchParams);
  const [importModalOpen, setImportModalOpen] = useState(importFromQuery);
  const [domain, setDomain] = useState('all');
  const [scale, setScale] = useState('all');
  const [dialect, setDialect] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);
  const [accessFilter, setAccessFilter] = useState<(typeof DATABASE_ACCESS_FILTER_OPTIONS)[number]['value']>(
    'all',
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setCatalogPage(1);
  }, [domain, scale, dialect, debouncedQ, accessFilter]);

  useEffect(() => {
    if (!authUser) {
      setAccessFilter('all');
    }
  }, [authUser]);

  useEffect(() => {
    if (importFromQuery) {
      setImportModalOpen(true);
    }
  }, [importFromQuery]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (window.location.hash === '#import-your-database') {
      setImportModalOpen(true);
    }
  }, []);

  const {
    data: apiData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['databases', domain, scale, dialect, debouncedQ, catalogPage, accessFilter, authUser?.id],
    queryFn: () =>
      databasesApi.list({
        domain: domain === 'all' ? undefined : domain,
        scale: scale === 'all' ? undefined : scale,
        dialect: dialect === 'all' ? undefined : dialect,
        q: debouncedQ || undefined,
        page: catalogPage,
        limit: EXPLORE_PAGE_SIZE,
        ...(authUser && accessFilter !== 'all' ? { accessFilter } : {}),
      }),
    staleTime: 60_000,
  });

  const filtered = apiData?.items ?? [];
  const totalMatching = apiData?.total ?? filtered.length;

  return (
    <div className="page-shell page-stack">
      {/* Page header */}
      <div className="mb-10">
        <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface mb-2">
          Database Explorer
        </h1>
        <p className="text-outline font-light max-w-2xl">
          Choose a database to spin up a sandbox and start querying. Each environment is isolated,
          read-optimized, and provisioned in under 30 seconds.
        </p>
      </div>

      <ExploreDatabaseImportModal
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        onCatalogUpdated={() => void refetch()}
      />

      {/* Toolbar: catalog title + import | search + filters */}
      <div className="mb-6 flex flex-col gap-3 lg:mb-8 lg:flex-row lg:items-end lg:justify-between lg:gap-4">
        <div
          id="import-your-database"
          className="scroll-mt-20 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4"
        >
          <h2 className="font-headline flex shrink-0 items-center gap-1.5 text-sm font-semibold tracking-tight text-on-surface">
            <span className="h-3 w-0.5 shrink-0 rounded-full bg-tertiary" aria-hidden />
            <span className="whitespace-nowrap">
              Available databases{' '}
              <span className="font-normal tabular-nums text-on-surface-variant">
                ({totalMatching})
              </span>
            </span>
          </h2>
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="w-full shrink-0 sm:w-auto"
            leftIcon={
              <span className="material-symbols-outlined text-base" aria-hidden>
                upload_file
              </span>
            }
            onClick={() => setImportModalOpen(true)}
          >
            Import database
          </Button>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2 lg:justify-end">
          <div className="w-full min-w-[11rem] sm:max-w-sm lg:w-56 lg:max-w-none lg:shrink-0">
            <Input
              label="Search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Name, engine, tags…"
              className="w-full min-w-0"
            />
          </div>
          <FilterSelect value={domain} onChange={setDomain} options={DATABASE_DOMAIN_OPTIONS} />
          <FilterSelect value={scale} onChange={setScale} options={DATABASE_SCALE_OPTIONS} />
          <FilterSelect value={dialect} onChange={setDialect} options={DATABASE_DIALECT_OPTIONS} />
          {authUser ? (
            <FilterSelect
              value={accessFilter}
              onChange={(v) => setAccessFilter(v as (typeof DATABASE_ACCESS_FILTER_OPTIONS)[number]['value'])}
              options={[...DATABASE_ACCESS_FILTER_OPTIONS]}
            />
          ) : null}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => <DatabaseCardSkeleton key={i} />)}
        </div>
      ) : isError ? (
        <div className="bg-surface-container-low rounded-xl p-16 flex flex-col items-center text-center">
          <span className="material-symbols-outlined text-4xl text-outline mb-3">error</span>
          <p className="text-sm font-medium text-on-surface mb-1">Database catalog unavailable</p>
          <p className="text-xs text-on-surface-variant">
            {error instanceof Error ? error.message : 'The explorer could not load databases.'}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 rounded-lg border border-outline-variant/20 bg-surface-container-high px-4 py-2 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container-highest"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-surface-container-low rounded-xl p-16 flex flex-col items-center text-center">
          <span className="material-symbols-outlined text-4xl text-outline mb-3">search_off</span>
          <p className="text-sm font-medium text-on-surface mb-1">No databases found</p>
          <p className="text-xs text-on-surface-variant">
            Try different filters or clear the search box.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((db) => (
              <DatabaseCard
                key={db.id}
                db={db}
                onClick={() => router.push(`/explore/${db.id}`)}
              />
            ))}
          </div>
          {apiData && apiData.totalPages > 1 ? (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                disabled={catalogPage <= 1}
                onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-outline-variant/20 bg-surface-container-high px-4 py-2 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-on-surface-variant">
                Page {apiData.page} / {apiData.totalPages}
              </span>
              <button
                type="button"
                disabled={catalogPage >= apiData.totalPages}
                onClick={() => setCatalogPage((p) => p + 1)}
                className="rounded-lg border border-outline-variant/20 bg-surface-container-high px-4 py-2 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

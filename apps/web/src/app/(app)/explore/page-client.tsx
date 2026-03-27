'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { databasesApi } from '@/lib/api';
import type { Database } from '@/lib/api';
import {
  DATABASE_DIFFICULTY_STYLES,
  DATABASE_DOMAIN_OPTIONS,
  DATABASE_SCALE_OPTIONS,
  databaseScaleDisplayLabelFromRowCount,
} from '@/lib/database-catalog';
import { cn, formatRows } from '@/lib/utils';
import type { ClientPageProps } from '@/lib/page-props';

// ─── Database Card ────────────────────────────────────────────────────────────

function DatabaseCard({ db, onClick }: { db: Database; onClick: () => void }) {
  const diff =
    DATABASE_DIFFICULTY_STYLES[db.difficulty] ?? DATABASE_DIFFICULTY_STYLES.beginner;

  return (
    <div
      onClick={onClick}
      className="group bg-surface-container-low rounded-xl p-6 cursor-pointer hover:bg-surface-container transition-all duration-200 border border-transparent hover:border-outline-variant/20 relative overflow-hidden"
    >
      {/* Hover open icon */}
      <span className="material-symbols-outlined absolute top-4 right-4 text-outline text-base opacity-0 group-hover:opacity-100 transition-opacity">
        open_in_new
      </span>

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
      <h3 className="font-headline text-base font-bold text-on-surface group-hover:text-primary transition-colors mb-1.5">
        {db.name}
      </h3>
      <p className="text-xs text-outline leading-relaxed line-clamp-2 mb-4">
        {db.description}
      </p>

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

export default function ExplorePage(_props: ClientPageProps) {
  const router = useRouter();
  const [domain, setDomain] = useState('all');
  const [scale, setScale] = useState('all');

  const {
    data: apiData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['databases', domain, scale],
    queryFn: () =>
      databasesApi.list({
        domain: domain === 'all' ? undefined : domain,
        scale: scale === 'all' ? undefined : scale,
    }),
    staleTime: 60_000,
  });

  const filtered = apiData?.items ?? [];

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

      {/* Filters row */}
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-headline text-xl font-medium flex items-center gap-2">
          <span className="w-1.5 h-6 bg-tertiary rounded-full shrink-0" />
          Available Databases
          <span className="text-sm font-normal text-outline ml-1">({filtered.length})</span>
        </h2>

        <div className="flex items-center gap-2">
          <FilterSelect value={domain} onChange={setDomain} options={DATABASE_DOMAIN_OPTIONS} />
          <FilterSelect value={scale} onChange={setScale} options={DATABASE_SCALE_OPTIONS} />
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
          <p className="text-xs text-on-surface-variant">Try a different domain or scale filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((db) => (
            <DatabaseCard
              key={db.id}
              db={db}
              onClick={() => router.push(`/explore/${db.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

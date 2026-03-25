'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

type DatabasesTab = 'schema-templates' | 'dataset-templates' | 'sql-imports' | 'generation-jobs';

const TAB_LABELS: Record<DatabasesTab, string> = {
  'schema-templates': 'Schema Templates',
  'dataset-templates': 'Dataset Templates',
  'sql-imports': 'SQL Imports',
  'generation-jobs': 'Generation Jobs',
};

const MOCK_TEMPLATE_METRICS = [
  { label: 'Schema Templates', value: '24' },
  { label: 'Dataset Templates', value: '13' },
  { label: 'Imports This Week', value: '38' },
  { label: 'Queued Jobs', value: '5' },
];

const DATABASE_TABS = Object.keys(TAB_LABELS) as DatabasesTab[];

const isDatabasesTab = (value: string | null): value is DatabasesTab =>
  value !== null && DATABASE_TABS.includes(value as DatabasesTab);

export default function AdminDatabasesPage() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<DatabasesTab>(
    isDatabasesTab(requestedTab) ? requestedTab : 'schema-templates',
  );

  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-col gap-3">
        <h1 className="page-title">Databases</h1>
        <p className="page-lead max-w-3xl">
          Admin shell for curating SQL practice datasets, source schemas, and generation workflows.
          This page is frontend-only and provides the operational IA for database tooling.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MOCK_TEMPLATE_METRICS.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3"
          >
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold text-on-surface">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="flex w-fit flex-wrap items-center gap-1 rounded-xl bg-surface-container-low p-1">
        {DATABASE_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
              activeTab === tab
                ? 'bg-surface-container-high text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'schema-templates' ? (
        <section className="section-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="page-section-title">Schema Templates</h2>
            <button className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm text-on-surface">
              New Schema Template
            </button>
          </div>
          <p className="mt-2 text-sm text-on-surface-variant">
            Define reusable table blueprints, constraints, and relationship presets for challenge
            generation.
          </p>
        </section>
      ) : null}

      {activeTab === 'dataset-templates' ? (
        <section className="section-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="page-section-title">Dataset Templates</h2>
            <button className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm text-on-surface">
              Create Dataset Template
            </button>
          </div>
          <p className="mt-2 text-sm text-on-surface-variant">
            Prepare seed-data packs and row-generation profiles aligned with template schemas.
          </p>
        </section>
      ) : null}

      {activeTab === 'sql-imports' ? (
        <section className="section-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="page-section-title">SQL Imports</h2>
            <button className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm text-on-surface">
              Upload SQL File
            </button>
          </div>
          <p className="mt-2 text-sm text-on-surface-variant">
            Track SQL dump imports and validate conversion into reusable template assets.
          </p>
        </section>
      ) : null}

      {activeTab === 'generation-jobs' ? (
        <section className="section-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="page-section-title">Generation Jobs</h2>
            <button className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm text-on-surface">
              Queue Generation
            </button>
          </div>
          <p className="mt-2 text-sm text-on-surface-variant">
            Observe batched generation status and output readiness for challenge authoring flows.
          </p>
        </section>
      ) : null}
    </div>
  );
}

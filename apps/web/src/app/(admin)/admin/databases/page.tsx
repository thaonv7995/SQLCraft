'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  DatabaseDomain,
  DatasetScale,
  SqlDumpImportPayload,
  SqlDumpScanResult,
  databasesApi,
} from '@/lib/api';

type DatabasesTab = 'schema-templates' | 'dataset-templates' | 'sql-imports' | 'generation-jobs';

const TAB_LABELS: Record<DatabasesTab, string> = {
  'schema-templates': 'Schema Templates',
  'dataset-templates': 'Dataset Templates',
  'sql-imports': 'SQL Imports',
  'generation-jobs': 'Generation Jobs',
};

const DATABASE_TABS = Object.keys(TAB_LABELS) as DatabasesTab[];

const isDatabasesTab = (value: string | null): value is DatabasesTab =>
  value !== null && DATABASE_TABS.includes(value as DatabasesTab);

const METRICS = [
  { label: 'Published Schemas', value: '38' },
  { label: 'Reusable Datasets', value: '21' },
  { label: 'SQL Imports Weekly', value: '12' },
  { label: 'Pending Reviews', value: '3' },
];

const DOMAIN_OPTIONS: DatabaseDomain[] = [
  'ecommerce',
  'fintech',
  'health',
  'iot',
  'social',
  'analytics',
  'other',
];

const DATASET_SCALE_OPTIONS: DatasetScale[] = ['tiny', 'small', 'medium', 'large'];

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

export default function AdminDatabasesPage() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<DatabasesTab>(
    isDatabasesTab(requestedTab) ? requestedTab : 'sql-imports',
  );

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanResult, setScanResult] = useState<SqlDumpScanResult | null>(null);
  const [schemaName, setSchemaName] = useState('');
  const [domain, setDomain] = useState<DatabaseDomain | ''>('');
  const [datasetScale, setDatasetScale] = useState<DatasetScale | ''>('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const scanMutation = useMutation({
    mutationFn: (file: File) => databasesApi.scanSqlDump(file),
    onSuccess(result) {
      setScanResult(result);
      const fallbackName = result.fileName.replace(/\.sql$/i, '').slice(0, 32);
      setSchemaName(result.schemaName?.trim() ?? fallbackName);
      setDomain(result.domain);
      setDatasetScale(result.inferredScale ?? '');
      setDescription('');
      setTags('');
      setImportSuccess(null);
    },
  });

  const importMutation = useMutation({
    mutationFn: (payload: SqlDumpImportPayload) => databasesApi.importFromScan(payload),
    onSuccess(result) {
      setImportSuccess(
        `Published schema template ${result.schemaTemplateId}` +
          (result.datasetTemplateId ? ` and dataset ${result.datasetTemplateId}` : ''),
      );
    },
  });

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setScanResult(null);
    setSchemaName('');
    setDomain('');
    setDatasetScale('');
    setDescription('');
    setTags('');
    setImportSuccess(null);
  };

  const tablePreview = useMemo(
    () => (scanResult?.tables ? scanResult.tables.slice(0, 3) : []),
    [scanResult],
  );

  const allowImport =
    Boolean(scanResult) && schemaName.trim().length > 0 && domain.length > 0 && !importMutation.isPending;

  const handleScan = () => {
    if (!selectedFile) {
      return;
    }
    scanMutation.mutate(selectedFile);
  };

  const handleImport = () => {
    if (!scanResult) return;
    const normalizedTags = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    const payload: SqlDumpImportPayload = {
      scanId: scanResult.scanId,
      schemaName: schemaName.trim(),
      domain: domain || 'other',
      datasetScale: datasetScale || undefined,
      description: description.trim() || undefined,
      tags: normalizedTags.length ? normalizedTags : undefined,
    };
    importMutation.mutate(payload);
  };

  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-col gap-4">
        <h1 className="page-title">Databases</h1>
        <p className="page-lead max-w-3xl">
          Curate SQL dump imports, review extracted schema metadata, and publish templates for reuse.
          Upload a .sql dump, verify the discovered tables/columns, then publish schema and dataset
          assets with confidence.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {METRICS.map((metric) => (
          <div
            key={metric.label}
            className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3"
          >
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold text-on-surface">{metric.value}</p>
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

      {activeTab === 'schema-templates' && (
        <section className="section-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="page-section-title">Schema Templates</h2>
          </div>
          <p className="mt-2 text-sm text-on-surface-variant">
            Manage schema templates derived from vetted imports. Visit this section when you want to
            browse or archive published blueprints.
          </p>
        </section>
      )}

      {activeTab === 'dataset-templates' && (
        <section className="section-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="page-section-title">Dataset Templates</h2>
          </div>
          <p className="mt-2 text-sm text-on-surface-variant">
            Dataset templates house row generation profiles matched to schema blueprints. Revisit after
            you publish a dataset asset.
          </p>
        </section>
      )}

      {activeTab === 'generation-jobs' && (
        <section className="section-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="page-section-title">Generation Jobs</h2>
          </div>
          <p className="mt-2 text-sm text-on-surface-variant">
            Monitor background generation workflows that produce sample data from template schemas.
          </p>
        </section>
      )}

      {activeTab === 'sql-imports' && (
        <section className="section-card grid gap-4 p-6 lg:grid-cols-[1.2fr,0.8fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h2 className="page-section-title">SQL Imports</h2>
                <button
                  onClick={handleScan}
                  disabled={!selectedFile || scanMutation.isPending}
                  className="rounded-lg border border-outline-variant/20 bg-transparent px-4 py-1.5 text-sm font-medium text-on-surface transition-all hover:border-on-surface hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {scanMutation.isPending ? 'Scanning…' : 'Scan SQL Dump'}
                </button>
              </div>
              <p className="mt-2 text-sm text-on-surface-variant">
                Upload a SQL dump to automatically extract tables, columns, and inferred metadata before
                publishing.
              </p>
            </div>

            <label className="block rounded-lg border border-dashed border-outline-variant px-4 py-6 text-sm">
              <span className="text-xs uppercase tracking-[0.35em] text-outline">SQL Dump</span>
              <p className="mt-2 font-medium text-on-surface">
                {selectedFile ? selectedFile.name : 'No file chosen'}
              </p>
              <p className="text-xs text-on-surface-variant">
                Supported file types: <span className="font-medium">.sql</span> (up to 400MB)
              </p>
              <input
                type="file"
                accept=".sql"
                onChange={handleFileSelection}
                className="mt-4 w-full cursor-pointer text-sm text-on-surface file:mr-4 file:rounded-lg file:border file:border-outline-variant file:bg-surface-container-low file:px-3 file:py-1.5 file:text-sm file:font-medium"
              />
            </label>

            {scanMutation.isError && (
              <p className="text-xs text-destructive">
                {scanMutation.error instanceof Error ? scanMutation.error.message : 'Scan failed.'}
              </p>
            )}

            {scanResult && (
              <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-4">
                <p className="text-xs uppercase tracking-[0.35em] text-outline">Scan Summary</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] text-on-surface-variant">Detected Tables</p>
                    <p className="text-lg font-semibold">{scanResult.totalTables}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-on-surface-variant">Total Rows</p>
                    <p className="text-lg font-semibold">{formatNumber(scanResult.totalRows)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-on-surface-variant">Columns</p>
                    <p className="text-lg font-semibold">{scanResult.columnCount}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-on-surface-variant">Primary Keys</p>
                    <p className="text-lg font-semibold">{scanResult.detectedPrimaryKeys}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500">
                <span className="sr-only">Ready</span>
              </div>
              <p className="text-sm font-medium text-on-surface">Review before publish</p>
            </div>

            <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4">
              <label className="text-xs text-on-surface-variant">Schema Name</label>
              <input
                type="text"
                value={schemaName}
                onChange={(event) => setSchemaName(event.target.value)}
                placeholder="Enter schema name"
                className="w-full rounded-lg border border-outline-variant/40 bg-transparent px-3 py-2 text-sm"
              />

              <label className="text-xs text-on-surface-variant">Domain</label>
              <select
                value={domain}
                onChange={(event) =>
                  setDomain(event.target.value as DatabaseDomain | '')
                }
                className="w-full rounded-lg border border-outline-variant/40 bg-transparent px-3 py-2 text-sm"
              >
                <option value="">Select a domain</option>
                {DOMAIN_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </option>
                ))}
              </select>

              <label className="text-xs text-on-surface-variant">Dataset Scale</label>
              <select
                value={datasetScale}
                onChange={(event) =>
                  setDatasetScale(event.target.value as DatasetScale | '')
                }
                className="w-full rounded-lg border border-outline-variant/40 bg-transparent px-3 py-2 text-sm"
              >
                <option value="">Use inferred scale</option>
                {DATASET_SCALE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </option>
                ))}
              </select>

              <label className="text-xs text-on-surface-variant">Description</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                placeholder="Optional: summarize the schema or dataset"
                className="w-full rounded-lg border border-outline-variant/40 bg-transparent px-3 py-2 text-sm"
              />

              <label className="text-xs text-on-surface-variant">Tags</label>
              <input
                type="text"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="Comma separated tags"
                className="w-full rounded-lg border border-outline-variant/40 bg-transparent px-3 py-2 text-sm"
              />

              <button
                onClick={handleImport}
                disabled={!allowImport}
                className="mt-2 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary-foreground transition hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importMutation.isPending ? 'Publishing…' : 'Publish Schema'}
              </button>

              {importMutation.isError && (
                <p className="text-xs text-destructive">
                  {importMutation.error instanceof Error
                    ? importMutation.error.message
                    : 'Publish failed.'}
                </p>
              )}
              {importSuccess && (
                <p className="text-xs text-emerald-500">{importSuccess}</p>
              )}
            </div>

            {scanResult && (
              <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-4">
                <p className="text-xs uppercase tracking-[0.35em] text-outline">Tables preview</p>
                <div className="space-y-3">
                  {tablePreview.length === 0 && (
                    <p className="text-xs text-on-surface-variant">No tables detected.</p>
                  )}
                  {tablePreview.map((table) => (
                    <div
                      key={table.name}
                      className="rounded-lg border border-outline-variant/30 bg-surface-subtle p-3"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <p className="font-medium text-on-surface">{table.name}</p>
                        <p className="text-xs text-on-surface-variant">
                          {table.rowCount.toLocaleString()} rows · {table.columnCount} cols
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {table.columns.map((column) => column.name).join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
                {scanResult.tables.length > 3 && (
                  <p className="text-xs text-on-surface-variant">
                    + {scanResult.tables.length - 3} more tables detected
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

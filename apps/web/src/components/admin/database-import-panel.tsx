'use client';

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import {
  type DatabaseDomain,
  type DatasetScale,
  type SchemaSqlDialect,
  type SqlDumpImportPayload,
  type SqlDumpScanResult,
  databasesApi,
} from '@/lib/api';
import {
  formatSqlDumpMaxUploadLabel,
  SQL_DUMP_FULL_PARSE_MAX_MB,
} from '@/lib/sql-dump-limits';

interface DatabaseImportPanelProps {
  onClose?: () => void;
  onImported?: (databaseId: string) => void;
  /** When set, load this scan from storage (same payload as after a fresh upload scan). */
  resumeScanId?: string | null;
  onResumeConsumed?: () => void;
  /** Publish as a new version of this catalog entry (pass current published head template id). */
  replaceSchemaTemplateId?: string;
  /** Must match server validation; schema name field stays fixed when replacing. */
  lockedSchemaName?: string;
  /** When replacing, keep catalog classification aligned (disable domain picker). */
  lockedCatalogDomain?: DatabaseDomain;
  /** When replacing, keep stored SQL engine family (disable dialect picker). */
  lockedDialect?: SchemaSqlDialect;
  /**
   * When replacing, engine version from catalog (`null` = none stored; field disabled, import uses scan/header).
   * Omit prop entirely for a non-locked engine field.
   */
  lockedEngineVersion?: string | null;
}

const DOMAIN_OPTIONS: Array<{ value: DatabaseDomain; label: string }> = [
  { value: 'ecommerce', label: 'E-Commerce' },
  { value: 'fintech', label: 'Fintech' },
  { value: 'health', label: 'Health Systems' },
  { value: 'iot', label: 'IoT Core' },
  { value: 'social', label: 'Social' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'other', label: 'General' },
];

const DATASET_SCALE_OPTIONS: Array<{ value: DatasetScale; label: string }> = [
  { value: 'tiny', label: 'Tiny' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const DIALECT_OPTIONS: Array<{ value: SchemaSqlDialect; label: string }> = [
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'sqlserver', label: 'SQL Server' },
  { value: 'sqlite', label: 'SQLite' },
];

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

export function DatabaseImportPanel({
  onClose,
  onImported,
  resumeScanId,
  onResumeConsumed,
  replaceSchemaTemplateId,
  lockedSchemaName,
  lockedCatalogDomain,
  lockedDialect,
  lockedEngineVersion,
}: DatabaseImportPanelProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanResult, setScanResult] = useState<SqlDumpScanResult | null>(null);
  const [schemaName, setSchemaName] = useState('');
  const [domain, setDomain] = useState<DatabaseDomain | ''>('');
  const [datasetScale, setDatasetScale] = useState<DatasetScale | ''>('');
  const [dialect, setDialect] = useState<SchemaSqlDialect>('postgresql');
  const [engineVersion, setEngineVersion] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  /** When true, next scan skips strict CREATE TABLE parsing (MySQL/SQL Server dumps, odd DDL). */
  const [skipStrictSchemaScan, setSkipStrictSchemaScan] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyScanResult = useCallback(
    (result: SqlDumpScanResult) => {
      setScanResult(result);
      const fallbackName = result.fileName.replace(/\.sql$/i, '').slice(0, 32);
      const nameFromScan = result.schemaName?.trim() ?? fallbackName;
      setSchemaName(
        replaceSchemaTemplateId && lockedSchemaName?.trim()
          ? lockedSchemaName.trim()
          : nameFromScan,
      );
      setDomain(
        replaceSchemaTemplateId && lockedCatalogDomain ? lockedCatalogDomain : result.domain,
      );
      setDatasetScale(result.inferredScale ?? '');
      setDialect(
        replaceSchemaTemplateId && lockedDialect ? lockedDialect : result.inferredDialect,
      );
      setEngineVersion(
        replaceSchemaTemplateId && lockedEngineVersion !== undefined
          ? (lockedEngineVersion?.trim() ?? '')
          : (result.inferredEngineVersion?.trim() ?? ''),
      );
      setDescription('');
      setTags('');
      setImportSuccess(null);
      setSelectedFile(null);
      setSkipStrictSchemaScan(Boolean(result.artifactOnly));
    },
    [
      replaceSchemaTemplateId,
      lockedSchemaName,
      lockedCatalogDomain,
      lockedDialect,
      lockedEngineVersion,
    ],
  );

  useEffect(() => {
    if (lockedSchemaName?.trim()) {
      setSchemaName(lockedSchemaName.trim());
    }
  }, [lockedSchemaName]);

  useEffect(() => {
    if (!replaceSchemaTemplateId) {
      return;
    }
    if (lockedCatalogDomain) {
      setDomain(lockedCatalogDomain);
    }
    if (lockedDialect) {
      setDialect(lockedDialect);
    }
    if (lockedEngineVersion !== undefined) {
      setEngineVersion(lockedEngineVersion?.trim() ?? '');
    }
  }, [
    replaceSchemaTemplateId,
    lockedCatalogDomain,
    lockedDialect,
    lockedEngineVersion,
  ]);

  useEffect(() => {
    if (!resumeScanId?.trim()) {
      return;
    }
    const id = resumeScanId.trim();
    let cancelled = false;
    setResumeLoading(true);
    setResumeError(null);
    void databasesApi
      .getSqlDumpScan(id)
      .then((result) => {
        if (cancelled) return;
        applyScanResult(result);
        onResumeConsumed?.();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResumeError(err instanceof Error ? err.message : 'Could not load scan.');
      })
      .finally(() => {
        if (!cancelled) setResumeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeScanId, applyScanResult, onResumeConsumed]);

  const scanMutation = useMutation({
    mutationFn: ({ file, artifactOnly }: { file: File; artifactOnly: boolean }) =>
      databasesApi.scanSqlDump(file, { artifactOnly }),
    onSuccess(result) {
      applyScanResult(result);
    },
  });

  const importMutation = useMutation({
    mutationFn: (payload: SqlDumpImportPayload) => databasesApi.importFromScan(payload),
    onSuccess(result) {
      setImportSuccess(
        `Published schema template ${result.schemaTemplateId}` +
          (result.datasetTemplateId ? ` and dataset ${result.datasetTemplateId}` : ''),
      );
      onImported?.(result.databaseId ?? result.schemaTemplateId);
    },
  });

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setScanResult(null);
    if (replaceSchemaTemplateId && lockedSchemaName?.trim()) {
      setSchemaName(lockedSchemaName.trim());
    } else {
      setSchemaName('');
    }
    if (replaceSchemaTemplateId && lockedCatalogDomain) {
      setDomain(lockedCatalogDomain);
    } else {
      setDomain('');
    }
    setDatasetScale('');
    if (replaceSchemaTemplateId && lockedDialect) {
      setDialect(lockedDialect);
    } else {
      setDialect('postgresql');
    }
    if (replaceSchemaTemplateId && lockedEngineVersion !== undefined) {
      setEngineVersion(lockedEngineVersion?.trim() ?? '');
    } else {
      setEngineVersion('');
    }
    setDescription('');
    setTags('');
    setImportSuccess(null);
    setSkipStrictSchemaScan(false);
  };

  const tablePreview = useMemo(
    () => (scanResult?.tables ? scanResult.tables.slice(0, 3) : []),
    [scanResult],
  );

  const domainLocked = Boolean(replaceSchemaTemplateId && lockedCatalogDomain);
  const dialectLocked = Boolean(replaceSchemaTemplateId && lockedDialect);
  const engineVersionLocked = replaceSchemaTemplateId && lockedEngineVersion !== undefined;

  const allowImport =
    Boolean(scanResult) &&
    schemaName.trim().length > 0 &&
    domain.length > 0 &&
    !importMutation.isPending;

  const handleScan = () => {
    if (!selectedFile) {
      return;
    }

    scanMutation.mutate({ file: selectedFile, artifactOnly: skipStrictSchemaScan });
  };

  const handleImport = () => {
    if (!scanResult) {
      return;
    }

    const normalizedTags = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    const payload: SqlDumpImportPayload = {
      scanId: scanResult.scanId,
      schemaName: schemaName.trim(),
      domain: domain || 'other',
      datasetScale: datasetScale || undefined,
      dialect,
      ...(engineVersion.trim()
        ? { engineVersion: engineVersion.trim() }
        : {}),
      description: description.trim() || undefined,
      tags: normalizedTags.length ? normalizedTags : undefined,
      ...(replaceSchemaTemplateId ? { replaceSchemaTemplateId } : {}),
    };

    importMutation.mutate(payload);
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
      <Card className="border border-outline-variant/10">
        <CardHeader className="flex-col items-start gap-3">
          <div className="flex w-full items-start justify-between gap-3">
            <div>
              <CardTitle>SQL Import</CardTitle>
              <CardDescription className="mt-1">Upload a .sql file, scan, then publish.</CardDescription>
            </div>
            {onClose ? (
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {replaceSchemaTemplateId ? (
            <p className="rounded-lg border border-secondary/30 bg-secondary/5 px-3 py-2 text-xs text-on-surface">
              New version replaces the default template; public catalog links stay the same.
            </p>
          ) : null}
          {resumeLoading ? (
            <p className="text-xs text-on-surface-variant">Loading saved scan…</p>
          ) : null}
          {resumeError ? <p className="text-xs text-error">{resumeError}</p> : null}
          <div className="rounded-lg border border-dashed border-outline-variant/60 bg-surface-container-low/40 px-4 py-4 text-sm ring-offset-surface focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/25">
            <span className="text-xs uppercase tracking-[0.35em] text-outline">SQL dump</span>
            <p className="mt-2 text-xs text-on-surface-variant">
              <span className="font-medium text-on-surface">.sql</span> · max{' '}
              <span className="font-medium text-on-surface">{formatSqlDumpMaxUploadLabel()}</span>
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sql,.SQL"
              aria-label="Choose SQL dump file"
              onChange={handleFileSelection}
              className="sr-only"
            />
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="shrink-0 border-primary/35 bg-primary/12 text-on-surface hover:bg-primary/20 hover:border-primary/50"
                leftIcon={
                  <span className="material-symbols-outlined text-lg text-primary" aria-hidden>
                    upload_file
                  </span>
                }
                onClick={() => fileInputRef.current?.click()}
              >
                Choose SQL file
              </Button>
              <p className="min-w-0 text-sm text-on-surface-variant">
                {selectedFile ? (
                  <span className="font-medium text-on-surface break-all">{selectedFile.name}</span>
                ) : (
                  <span>No file</span>
                )}
              </p>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm text-on-surface">
            <input
              type="checkbox"
              checked={skipStrictSchemaScan}
              onChange={(e) => setSkipStrictSchemaScan(e.target.checked)}
              className="mt-0.5 size-4 rounded border-outline-variant"
            />
            <span>
              Artifact only — required above {SQL_DUMP_FULL_PARSE_MAX_MB} MB, or for MySQL / SQL
              Server / odd dumps.
            </span>
          </label>

          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleScan}
              disabled={!selectedFile || scanMutation.isPending}
            >
              {scanMutation.isPending ? 'Scanning…' : 'Scan SQL Dump'}
            </Button>
          </div>

          {scanMutation.isError ? (
            <p className="text-xs text-error">
              {scanMutation.error instanceof Error ? scanMutation.error.message : 'Scan failed.'}
            </p>
          ) : null}

          {scanResult ? (
            <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-4">
              {scanResult.artifactOnly ? (
                <p className="mb-3 rounded-lg border border-secondary/30 bg-secondary/5 px-3 py-2 text-xs text-on-surface">
                  No table graph — confirm dialect / engine below before publish.
                </p>
              ) : null}
              <p className="text-xs uppercase tracking-[0.35em] text-outline">Summary</p>
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
              <p className="mt-3 text-xs text-on-surface-variant">
                Dialect:{' '}
                <span className="font-medium text-on-surface">
                  {DIALECT_OPTIONS.find((o) => o.value === scanResult.inferredDialect)?.label ??
                    scanResult.inferredDialect}
                </span>{' '}
                <span className="text-on-surface-variant/80">({scanResult.dialectConfidence})</span>
                {!dialectLocked ? ' · fix below if wrong' : null}
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">
                Engine:{' '}
                <span className="font-medium text-on-surface">
                  {scanResult.inferredEngineVersion?.trim() || '—'}
                </span>
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="border border-outline-variant/10">
          <CardHeader className="flex-col items-start gap-2">
            <CardTitle>Publish</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Schema Name"
              value={schemaName}
              onChange={(event) => setSchemaName(event.target.value)}
              placeholder="Enter schema name"
              disabled={Boolean(replaceSchemaTemplateId && lockedSchemaName?.trim())}
            />

            <Select
              label="Domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value as DatabaseDomain | '')}
              disabled={domainLocked}
              options={[
                { value: '', label: 'Select a domain' },
                ...DOMAIN_OPTIONS,
              ]}
            />

            <Select
              label="Dataset Scale"
              value={datasetScale}
              onChange={(event) => setDatasetScale(event.target.value as DatasetScale | '')}
              options={[
                { value: '', label: 'Use inferred scale' },
                ...DATASET_SCALE_OPTIONS,
              ]}
            />

            <Select
              label="Dialect"
              value={dialect}
              onChange={(event) => setDialect(event.target.value as SchemaSqlDialect)}
              disabled={dialectLocked}
              options={DIALECT_OPTIONS}
            />

            <Input
              label="Engine version"
              value={engineVersion}
              onChange={(event) => setEngineVersion(event.target.value)}
              placeholder="e.g. 16.2"
              disabled={Boolean(engineVersionLocked)}
            />

            <Textarea
              label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="Optional"
            />

            <Input
              label="Tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Comma separated tags"
            />

            <Button variant="primary" fullWidth onClick={handleImport} disabled={!allowImport}>
              {importMutation.isPending ? 'Publishing…' : 'Publish'}
            </Button>

            {importMutation.isError ? (
              <p className="text-xs text-error">
                {importMutation.error instanceof Error
                  ? importMutation.error.message
                  : 'Publish failed.'}
              </p>
            ) : null}

            {importSuccess ? <p className="text-xs text-secondary">{importSuccess}</p> : null}
          </CardContent>
        </Card>

        {scanResult ? (
          <Card className="border border-outline-variant/10">
            <CardHeader className="flex-col items-start gap-2">
              <CardTitle>Tables</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {tablePreview.length === 0 ? (
                <p className="text-xs text-on-surface-variant">No tables detected.</p>
              ) : (
                tablePreview.map((table) => (
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
                ))
              )}

              {scanResult.tables.length > 3 ? (
                <p className="text-xs text-on-surface-variant">
                  + {scanResult.tables.length - 3} more tables detected
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </section>
  );
}

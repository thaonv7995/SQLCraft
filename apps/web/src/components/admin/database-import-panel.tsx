'use client';

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import {
  type DatabaseDomain,
  type DatasetScale,
  type DatasetScaleDownOptions,
  type SchemaSqlDialect,
  type SqlDumpImportPayload,
  type SqlDumpScanResult,
  type UserSqlDumpImportPayload,
  type InviteUserSearchItem,
  databasesApi,
} from '@/lib/api';
import toast from 'react-hot-toast';
import { UserInviteMultiSelect } from '@/components/user/user-invite-multi-select';
import {
  formatSqlDumpFullParseLimitLabel,
  formatSqlDumpMaxUploadLabel,
  SQL_DUMP_DIRECT_UPLOAD_MIN_BYTES,
  SQL_DUMP_FULL_PARSE_MAX_MB,
} from '@/lib/sql-dump-limits';
import {
  DATASET_SCALE_SHORT_LABELS,
  DATASET_SCALE_TIER_OPTIONS,
  inferDatasetScaleFromRowCount,
} from '@/lib/database-catalog';

interface DatabaseImportPanelProps {
  /** Admin: publish to catalog. User: import with visibility / invites (enforced server-side). */
  variant?: 'admin' | 'user';
  onClose?: () => void;
  onImported?: (databaseId: string) => void;
  /**
   * User variant: called after a successful import so the host can toast / close a dialog
   * without leaving long in-panel copy (e.g. public → catalog review).
   */
  onAfterUserImport?: (ctx: {
    visibility: 'public' | 'private';
    databaseId: string;
    schemaTemplateId: string;
    datasetTemplateId?: string | null;
  }) => void;
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

const DIALECT_OPTIONS: Array<{ value: SchemaSqlDialect; label: string }> = [
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'sqlserver', label: 'SQL Server' },
  { value: 'sqlite', label: 'SQLite' },
];

/** File picker `accept` — include `.gz` and gzip MIME types: `name.sql.gz` is often matched as `.gz` only, not `.sql.gz`. */
const SQL_DUMP_FILE_ACCEPT =
  '.sql,.SQL,.txt,.TXT,.sql.gz,.SQL.GZ,.gz,.GZ,.zip,.ZIP,application/gzip,application/x-gzip';

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

function parseTableScaleRolesJson(
  raw: string,
): Record<string, 'fact' | 'dimension'> | undefined | 'invalid' {
  const t = raw.trim();
  if (!t) return undefined;
  try {
    const o = JSON.parse(t) as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return 'invalid';
    const out: Record<string, 'fact' | 'dimension'> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v !== 'fact' && v !== 'dimension') return 'invalid';
      out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return 'invalid';
  }
}

function buildDatasetScaleDownPayload(params: {
  allowEmptyTablesInDerived: boolean;
  inferTableRoles: boolean;
  useQuadraticRefinement: boolean;
  strictFkMetadata: boolean;
  dimensionBudgetFractionStr: string;
  tableScaleRolesJson: string;
}): DatasetScaleDownOptions | undefined {
  const roles = parseTableScaleRolesJson(params.tableScaleRolesJson);
  if (roles === 'invalid') {
    return undefined;
  }

  const dimParsed = Number.parseFloat(params.dimensionBudgetFractionStr);
  const dimFracCustom =
    params.inferTableRoles &&
    Number.isFinite(dimParsed) &&
    Math.abs(dimParsed - 0.15) > 1e-6;

  const out: DatasetScaleDownOptions = {};
  if (params.allowEmptyTablesInDerived) out.allowEmptyTablesInDerived = true;
  if (params.inferTableRoles) out.inferTableRoles = true;
  if (params.useQuadraticRefinement) out.useQuadraticRefinement = true;
  if (params.strictFkMetadata) out.strictFkMetadata = true;
  if (dimFracCustom) {
    out.dimensionBudgetFraction = Math.min(0.5, Math.max(0, dimParsed));
  }
  if (roles) {
    out.tableScaleRoles = roles;
  }

  if (
    !out.allowEmptyTablesInDerived &&
    !out.inferTableRoles &&
    !out.useQuadraticRefinement &&
    !out.strictFkMetadata &&
    out.dimensionBudgetFraction === undefined &&
    !out.tableScaleRoles
  ) {
    return undefined;
  }
  return out;
}

export function DatabaseImportPanel({
  variant = 'admin',
  onClose,
  onImported,
  onAfterUserImport,
  resumeScanId,
  onResumeConsumed,
  replaceSchemaTemplateId,
  lockedSchemaName,
  lockedCatalogDomain,
  lockedDialect,
  lockedEngineVersion,
}: DatabaseImportPanelProps) {
  const isUser = variant === 'user';
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanResult, setScanResult] = useState<SqlDumpScanResult | null>(null);
  const [schemaName, setSchemaName] = useState('');
  const [domain, setDomain] = useState<DatabaseDomain | ''>('');
  const [datasetScale, setDatasetScale] = useState<DatasetScale | ''>('');
  const [dialect, setDialect] = useState<SchemaSqlDialect>('postgresql');
  const [engineVersion, setEngineVersion] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [dbVisibility, setDbVisibility] = useState<'public' | 'private'>('public');
  const [invitedUsers, setInvitedUsers] = useState<InviteUserSearchItem[]>([]);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    status: 'queued' | 'running' | 'done' | 'failed';
    progressBytes: number;
    totalBytes: number;
    startedAt: number;
    updatedAt: number;
  } | null>(null);
  /** When true, next scan skips strict CREATE TABLE parsing (MySQL/SQL Server dumps, odd DDL). */
  const [skipStrictSchemaScan, setSkipStrictSchemaScan] = useState(false);
  const [allowEmptyTablesInDerived, setAllowEmptyTablesInDerived] = useState(false);
  const [inferTableRoles, setInferTableRoles] = useState(false);
  const [useQuadraticRefinement, setUseQuadraticRefinement] = useState(false);
  const [strictFkMetadata, setStrictFkMetadata] = useState(false);
  const [dimensionBudgetFractionStr, setDimensionBudgetFractionStr] = useState('0.15');
  const [tableScaleRolesJson, setTableScaleRolesJson] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveReplaceId = isUser ? undefined : replaceSchemaTemplateId;

  const applyScanResult = useCallback(
    (result: SqlDumpScanResult) => {
      setScanResult(result);
      const fallbackName = result.fileName
        .replace(/\.sql\.gz$/i, '')
        .replace(/\.zip$/i, '')
        .replace(/\.sql$/i, '')
        .replace(/\.txt$/i, '')
        .slice(0, 32);
      const nameFromScan = result.schemaName?.trim() ?? fallbackName;
      setSchemaName(
        effectiveReplaceId && lockedSchemaName?.trim()
          ? lockedSchemaName.trim()
          : nameFromScan,
      );
      setDomain(effectiveReplaceId && lockedCatalogDomain ? lockedCatalogDomain : result.domain);
      setDatasetScale(
        result.totalRows > 0
          ? inferDatasetScaleFromRowCount(result.totalRows)
          : (result.inferredScale ?? ''),
      );
      setDialect(effectiveReplaceId && lockedDialect ? lockedDialect : result.inferredDialect);
      setEngineVersion(
        effectiveReplaceId && lockedEngineVersion !== undefined
          ? (lockedEngineVersion?.trim() ?? '')
          : (result.inferredEngineVersion?.trim() ?? ''),
      );
      setDescription('');
      setTags('');
      setImportSuccess(null);
      setSelectedFile(null);
      setSkipStrictSchemaScan(Boolean(result.artifactOnly));
      setAllowEmptyTablesInDerived(false);
      setInferTableRoles(false);
      setUseQuadraticRefinement(false);
      setDimensionBudgetFractionStr('0.15');
      setTableScaleRolesJson('');
    },
    [
      effectiveReplaceId,
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
    if (!effectiveReplaceId) {
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
    effectiveReplaceId,
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
    void (isUser ? databasesApi.userGetSqlDumpScan(id) : databasesApi.getSqlDumpScan(id))
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
  }, [resumeScanId, applyScanResult, onResumeConsumed, isUser]);

  const scanMutation = useMutation({
    mutationFn: ({ file, artifactOnly }: { file: File; artifactOnly: boolean }) =>
      isUser
        ? databasesApi.userScanSqlDump(file, {
            artifactOnly,
            onProgress: (scan) => {
              const total = scan.totalBytes ?? file.size;
              const now = Date.now();
              setScanProgress((prev) => ({
                status: scan.scanStatus ?? 'running',
                progressBytes: scan.progressBytes ?? prev?.progressBytes ?? 0,
                totalBytes: total,
                startedAt: prev?.startedAt ?? now,
                updatedAt: now,
              }));
            },
          })
        : databasesApi.scanSqlDump(file, {
            artifactOnly,
            onProgress: (scan) => {
              const total = scan.totalBytes ?? file.size;
              const now = Date.now();
              setScanProgress((prev) => ({
                status: scan.scanStatus ?? 'running',
                progressBytes: scan.progressBytes ?? prev?.progressBytes ?? 0,
                totalBytes: total,
                startedAt: prev?.startedAt ?? now,
                updatedAt: now,
              }));
            },
          }),
    onSuccess(result) {
      applyScanResult(result);
      setScanProgress((prev) =>
        prev
          ? { ...prev, status: 'done', progressBytes: prev.totalBytes, updatedAt: Date.now() }
          : null,
      );
    },
    onError() {
      setScanProgress((prev) =>
        prev
          ? { ...prev, status: 'failed', updatedAt: Date.now() }
          : null,
      );
    },
  });

  const importMutation = useMutation({
    mutationFn: (payload: SqlDumpImportPayload | UserSqlDumpImportPayload) =>
      isUser
        ? databasesApi.userImportFromScan(payload as UserSqlDumpImportPayload)
        : databasesApi.importFromScan(payload as SqlDumpImportPayload),
    onSuccess(result, variables) {
      if (isUser) {
        const vis = (variables as UserSqlDumpImportPayload).visibility ?? 'public';
        const databaseId = result.databaseId ?? result.schemaTemplateId;
        if (onAfterUserImport) {
          onAfterUserImport({
            visibility: vis,
            databaseId,
            schemaTemplateId: result.schemaTemplateId,
            datasetTemplateId: result.datasetTemplateId ?? null,
          });
          setImportSuccess(null);
        } else if (vis === 'public') {
          setImportSuccess(
            'Submitted for catalog review. An admin must approve before it appears in the public list.',
          );
        } else {
          setImportSuccess(
            `Imported — schema ${result.schemaTemplateId}` +
              (result.datasetTemplateId ? `, dataset ${result.datasetTemplateId}` : '') +
              '. You can use it when authoring challenges.',
          );
        }
      } else {
        setImportSuccess(
          `Published schema template ${result.schemaTemplateId}` +
            (result.datasetTemplateId ? ` and dataset ${result.datasetTemplateId}` : ''),
        );
      }
      onImported?.(result.databaseId ?? result.schemaTemplateId);
    },
  });

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setScanResult(null);
    if (effectiveReplaceId && lockedSchemaName?.trim()) {
      setSchemaName(lockedSchemaName.trim());
    } else {
      setSchemaName('');
    }
    if (effectiveReplaceId && lockedCatalogDomain) {
      setDomain(lockedCatalogDomain);
    } else {
      setDomain('');
    }
    setDatasetScale('');
    if (effectiveReplaceId && lockedDialect) {
      setDialect(lockedDialect);
    } else {
      setDialect('postgresql');
    }
    if (effectiveReplaceId && lockedEngineVersion !== undefined) {
      setEngineVersion(lockedEngineVersion?.trim() ?? '');
    } else {
      setEngineVersion('');
    }
    setDescription('');
    setTags('');
    setImportSuccess(null);
    setSkipStrictSchemaScan(false);
    setAllowEmptyTablesInDerived(false);
    setInferTableRoles(false);
    setUseQuadraticRefinement(false);
    setStrictFkMetadata(false);
    setDimensionBudgetFractionStr('0.15');
    setTableScaleRolesJson('');
  };

  const tablePreview = useMemo(
    () => (scanResult?.tables ? scanResult.tables.slice(0, 3) : []),
    [scanResult],
  );

  const domainLocked = Boolean(effectiveReplaceId && lockedCatalogDomain);
  const dialectLocked = Boolean(effectiveReplaceId && lockedDialect);
  const engineVersionLocked = effectiveReplaceId && lockedEngineVersion !== undefined;

  const allowImport =
    Boolean(scanResult) &&
    schemaName.trim().length > 0 &&
    domain.length > 0 &&
    !importMutation.isPending;

  const handleScan = () => {
    if (!selectedFile) {
      return;
    }
    const now = Date.now();
    setScanProgress({
      status: 'queued',
      progressBytes: 0,
      totalBytes: selectedFile.size,
      startedAt: now,
      updatedAt: now,
    });
    scanMutation.mutate({ file: selectedFile, artifactOnly: skipStrictSchemaScan });
  };

  const progressUi = useMemo(() => {
    if (!scanProgress) return null;
    const total = Math.max(1, scanProgress.totalBytes);
    const progress = Math.max(0, Math.min(1, scanProgress.progressBytes / total));
    const pct = Math.round(progress * 100);
    const elapsedSec = Math.max(0.001, (scanProgress.updatedAt - scanProgress.startedAt) / 1000);
    const mbps = (scanProgress.progressBytes / (1024 * 1024)) / elapsedSec;
    const remainingBytes = Math.max(0, total - scanProgress.progressBytes);
    const etaSec = mbps > 0.01 ? remainingBytes / (mbps * 1024 * 1024) : null;
    return { pct, mbps, etaSec };
  }, [scanProgress]);

  const handleImport = () => {
    if (!scanResult) {
      return;
    }

    const normalizedTags = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    const rolesCheck = parseTableScaleRolesJson(tableScaleRolesJson);
    if (rolesCheck === 'invalid') {
      toast.error(
        'Table roles JSON must be an object with "fact" or "dimension" values, e.g. {"orders":"fact","categories":"dimension"}.',
      );
      return;
    }

    if (inferTableRoles) {
      const df = Number.parseFloat(dimensionBudgetFractionStr);
      if (!Number.isFinite(df) || df < 0 || df > 0.5) {
        toast.error('Dimension budget fraction must be a number between 0 and 0.5.');
        return;
      }
    }

    const scaleDown = buildDatasetScaleDownPayload({
      allowEmptyTablesInDerived,
      inferTableRoles,
      useQuadraticRefinement,
      strictFkMetadata,
      dimensionBudgetFractionStr,
      tableScaleRolesJson,
    });

    if (isUser) {
      const invited = invitedUsers.map((u) => u.id);
      const payload: UserSqlDumpImportPayload = {
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
        visibility: dbVisibility,
        ...(dbVisibility === 'private' && invited.length ? { invitedUserIds: invited } : {}),
        ...scaleDown,
      };
      importMutation.mutate(payload);
      return;
    }

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
      ...(effectiveReplaceId ? { replaceSchemaTemplateId: effectiveReplaceId } : {}),
      ...scaleDown,
    };

    importMutation.mutate(payload);
  };

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-[1.2fr,0.8fr]">
      <Card className="border border-outline-variant/10">
        <CardHeader className="flex-col items-start gap-3">
          <div className="flex w-full items-start justify-between gap-3">
            <div>
              <CardTitle>{isUser ? 'Import SQL database' : 'SQL Import'}</CardTitle>
              <CardDescription className="mt-1">
                {isUser
                  ? 'Upload a SQL dump (.sql, .txt, .sql.gz, or .zip with a .sql inside). Public submissions need admin approval before they appear in the catalog.'
                  : 'Upload .sql, .txt, .sql.gz, or .zip (containing .sql), scan, then publish.'}
              </CardDescription>
            </div>
            {onClose ? (
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {effectiveReplaceId ? (
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
              <span className="font-medium text-on-surface">.sql / .txt / .sql.gz / .zip</span> · max{' '}
              <span className="font-medium text-on-surface">{formatSqlDumpMaxUploadLabel()}</span>
              {' · '}
              {Math.round(SQL_DUMP_DIRECT_UPLOAD_MIN_BYTES / (1024 * 1024))} MB+ uses direct storage upload.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={SQL_DUMP_FILE_ACCEPT}
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
                Choose dump file
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
              Artifact only — required above {formatSqlDumpFullParseLimitLabel()}, or for MySQL /
              SQL Server / odd dumps.
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
          {scanMutation.isPending && scanProgress && progressUi ? (
            <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low/50 px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-on-surface-variant">
                <span>Scan status: {scanProgress.status}</span>
                <span>{progressUi.pct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest/80">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${progressUi.pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-on-surface-variant">
                {progressUi.mbps.toFixed(1)} MB/s
                {progressUi.etaSec != null ? ` · ETA ${Math.ceil(progressUi.etaSec)}s` : ' · ETA —'}
              </p>
            </div>
          ) : null}

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
                {!scanResult.artifactOnly && scanResult.totalRows > 0 ? (
                  <div className="sm:col-span-2">
                    <p className="text-[11px] text-on-surface-variant">Scale from row total</p>
                    <p className="text-lg font-semibold">
                      {DATASET_SCALE_SHORT_LABELS[inferDatasetScaleFromRowCount(scanResult.totalRows)]}
                    </p>
                  </div>
                ) : null}
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
            <CardTitle>{isUser ? 'Details & visibility' : 'Publish'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Schema Name"
              value={schemaName}
              onChange={(event) => setSchemaName(event.target.value)}
              placeholder="Enter schema name"
              disabled={Boolean(effectiveReplaceId && lockedSchemaName?.trim())}
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
                ...DATASET_SCALE_TIER_OPTIONS,
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

            <details className="rounded-lg border border-outline-variant/30 bg-surface-container-low/50 px-3 py-2 text-sm">
              <summary className="cursor-pointer select-none font-medium text-on-surface">
                Derived dataset scaling (advanced)
              </summary>
              <p className="mt-2 text-xs text-on-surface-variant">
                Applies when the API builds smaller PostgreSQL derived tiers from your canonical dump.
                {scanResult?.artifactOnly ? (
                  <span className="block pt-1 text-secondary">
                    Artifact-only scans do not generate derived tiers; these options are ignored.
                  </span>
                ) : null}
              </p>
              <div className="mt-3 space-y-3 border-t border-outline-variant/20 pt-3">
                <label className="flex cursor-pointer items-start gap-2 text-on-surface">
                  <input
                    type="checkbox"
                    checked={allowEmptyTablesInDerived}
                    onChange={(e) => setAllowEmptyTablesInDerived(e.target.checked)}
                    className="mt-0.5 size-4 rounded border-outline-variant"
                  />
                  <span>
                    Allow empty tables in derived dumps — some tables may get 0 rows (tighter totals).
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-on-surface">
                  <input
                    type="checkbox"
                    checked={inferTableRoles}
                    onChange={(e) => setInferTableRoles(e.target.checked)}
                    className="mt-0.5 size-4 rounded border-outline-variant"
                  />
                  <span>
                    Infer fact vs dimension tables from names — reserves part of the row budget for
                    &quot;dimension&quot; tables before scaling facts.
                  </span>
                </label>
                {inferTableRoles ? (
                  <Input
                    label="Dimension budget fraction"
                    type="number"
                    min={0}
                    max={0.5}
                    step={0.01}
                    value={dimensionBudgetFractionStr}
                    onChange={(e) => setDimensionBudgetFractionStr(e.target.value)}
                    hint="Share of the derived target for dimension tables (default 0.15)."
                  />
                ) : null}
                <label className="flex cursor-pointer items-start gap-2 text-on-surface">
                  <input
                    type="checkbox"
                    checked={useQuadraticRefinement}
                    onChange={(e) => setUseQuadraticRefinement(e.target.checked)}
                    className="mt-0.5 size-4 rounded border-outline-variant"
                  />
                  <span>
                    Quadratic refinement — extra pass to better match proportional row targets
                    (slightly slower import).
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-on-surface">
                  <input
                    type="checkbox"
                    checked={strictFkMetadata}
                    onChange={(e) => setStrictFkMetadata(e.target.checked)}
                    className="mt-0.5 size-4 rounded border-outline-variant"
                  />
                  <span>
                    Strict FK metadata — fail import if materialized derived row counts differ from
                    apportioned targets (after FK-aware selection).
                  </span>
                </label>
                <Textarea
                  label="Explicit table roles (JSON, optional)"
                  value={tableScaleRolesJson}
                  onChange={(e) => setTableScaleRolesJson(e.target.value)}
                  rows={3}
                  placeholder='{"orders":"fact","categories":"dimension"}'
                  hint="Overrides name inference. Values must be fact or dimension."
                />
              </div>
            </details>

            {isUser ? (
              <>
                <Select
                  label="Visibility"
                  value={dbVisibility}
                  onChange={(event) =>
                    setDbVisibility(event.target.value as 'public' | 'private')
                  }
                  options={[
                    {
                      value: 'public',
                      label: 'Public (pending admin review)',
                    },
                    {
                      value: 'private',
                      label: 'Private (yours immediately; optional invites)',
                    },
                  ]}
                />
                {dbVisibility === 'private' ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-on-surface-variant">
                      Invite people <span className="font-normal text-on-surface-variant/80">(optional)</span>
                    </p>
                    <UserInviteMultiSelect value={invitedUsers} onChange={setInvitedUsers} />
                  </div>
                ) : null}
              </>
            ) : null}

            <Button variant="primary" fullWidth onClick={handleImport} disabled={!allowImport}>
              {importMutation.isPending
                ? isUser
                  ? 'Submitting…'
                  : 'Publishing…'
                : isUser
                  ? 'Submit import'
                  : 'Publish'}
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

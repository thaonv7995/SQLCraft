'use client';

import { type ChangeEvent, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import {
  type DatabaseDomain,
  type DatasetScale,
  type SqlDumpImportPayload,
  type SqlDumpScanResult,
  databasesApi,
} from '@/lib/api';

interface DatabaseImportPanelProps {
  onClose?: () => void;
  onImported?: (databaseId: string) => void;
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

function formatNumber(value: number) {
  return value.toLocaleString('en-US');
}

export function DatabaseImportPanel({ onClose, onImported }: DatabaseImportPanelProps) {
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
      onImported?.(result.databaseId ?? result.schemaTemplateId);
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
    Boolean(scanResult) &&
    schemaName.trim().length > 0 &&
    domain.length > 0 &&
    !importMutation.isPending;

  const handleScan = () => {
    if (!selectedFile) {
      return;
    }

    scanMutation.mutate(selectedFile);
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
      description: description.trim() || undefined,
      tags: normalizedTags.length ? normalizedTags : undefined,
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
              <CardDescription className="mt-1">
                Upload a `.sql` dump, inspect the discovered schema, then publish it as a reusable
                training database.
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
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="border border-outline-variant/10">
          <CardHeader className="flex-col items-start gap-2">
            <CardTitle>Review Before Publish</CardTitle>
            <CardDescription>
              Confirm metadata before this dump becomes part of the reusable database catalog.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Schema Name"
              value={schemaName}
              onChange={(event) => setSchemaName(event.target.value)}
              placeholder="Enter schema name"
            />

            <Select
              label="Domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value as DatabaseDomain | '')}
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

            <Textarea
              label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="Optional: summarize the schema or dataset"
            />

            <Input
              label="Tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Comma separated tags"
            />

            <Button variant="primary" fullWidth onClick={handleImport} disabled={!allowImport}>
              {importMutation.isPending ? 'Publishing…' : 'Publish Database'}
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
              <CardTitle>Tables Preview</CardTitle>
              <CardDescription>
                A quick read of the extracted tables before you publish the database.
              </CardDescription>
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

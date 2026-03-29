import type { DatasetScale } from '@/lib/api';

const DATASET_SCALE_LABELS: Record<DatasetScale, string> = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

/** Human-readable SQL engine label for lab sandboxes (matches SQL Lab toolbar). */
export function formatSandboxDialect(dialect: string | null | undefined): string {
  if (dialect == null || !String(dialect).trim()) return '—';
  const key = String(dialect).toLowerCase().trim();
  const labels: Record<string, string> = {
    postgresql: 'PostgreSQL',
    postgres: 'PostgreSQL',
    mysql: 'MySQL',
    mariadb: 'MariaDB',
    mssql: 'SQL Server',
    sqlserver: 'SQL Server',
    sqlite: 'SQLite',
  };
  return labels[key] ?? key;
}

/** Short label for the loaded dataset scale (selected sandbox scale). */
export function formatDatasetScaleShort(scale: DatasetScale | null | undefined): string {
  if (scale == null) return '—';
  return DATASET_SCALE_LABELS[scale] ?? String(scale);
}

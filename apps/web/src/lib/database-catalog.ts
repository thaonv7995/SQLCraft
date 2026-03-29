import type { DatabaseDomain, DatabaseScale, SandboxGoldenStatus } from './api';

export const DATABASE_DOMAIN_LABELS: Record<DatabaseDomain, string> = {
  ecommerce: 'E-Commerce',
  fintech: 'Fintech',
  health: 'Health Systems',
  iot: 'IoT Core',
  social: 'Social',
  analytics: 'Analytics',
  other: 'General',
};

export const DATABASE_SCALE_LABELS: Record<DatabaseScale, string> = {
  tiny: '100 rows',
  small: '10K rows',
  medium: '1M-5M rows',
  large: '10M+ rows',
};

/**
 * Maps total row count to a scale bucket for human-readable labels.
 * Use this for subtitles and stats so copy matches `rowCount` (catalog `scale` is the
 * largest published template tier and can read "10M+" while data is still ~1.3M).
 */
export function inferDatasetScaleFromRowCount(rowCount: number): DatabaseScale {
  if (!Number.isFinite(rowCount) || rowCount <= 0) {
    return 'tiny';
  }
  if (rowCount <= 1_000) return 'tiny';
  if (rowCount <= 200_000) return 'small';
  if (rowCount <= 5_000_000) return 'medium';
  return 'large';
}

export function databaseScaleDisplayLabelFromRowCount(rowCount: number): string {
  return DATABASE_SCALE_LABELS[inferDatasetScaleFromRowCount(rowCount)];
}

export const DATABASE_DOMAIN_OPTIONS = [
  { value: 'all', label: 'All Domains' },
  { value: 'ecommerce', label: 'E-Commerce' },
  { value: 'fintech', label: 'Fintech' },
  { value: 'health', label: 'Health Systems' },
  { value: 'iot', label: 'IoT Core' },
  { value: 'social', label: 'Social' },
  { value: 'analytics', label: 'Analytics' },
];

export const DATABASE_SCALE_OPTIONS = [
  { value: 'all', label: 'Any Scale' },
  { value: 'tiny', label: 'Tiny' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

/** Shown when logged in on Explorer to separate catalog+shared vs your uploads. */
export const DATABASE_ACCESS_FILTER_OPTIONS = [
  { value: 'all', label: 'All accessible' },
  { value: 'catalog', label: 'Catalog & shared' },
  { value: 'mine', label: 'My uploads' },
] as const;

export const DATABASE_DIALECT_OPTIONS = [
  { value: 'all', label: 'All SQL engines' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'sqlserver', label: 'SQL Server' },
  { value: 'sqlite', label: 'SQLite' },
];

export const DATABASE_DIFFICULTY_STYLES: Record<
  string,
  { badge: string; label: string; accent: string }
> = {
  beginner: {
    badge: 'bg-secondary/10 text-secondary',
    label: 'Novice',
    accent: 'border-secondary/35',
  },
  intermediate: {
    badge: 'bg-primary/10 text-primary',
    label: 'Intermediate',
    accent: 'border-primary/35',
  },
  advanced: {
    badge: 'bg-error/10 text-error',
    label: 'Advanced',
    accent: 'border-error/35',
  },
};

/** Admin catalog cards: golden bake pipeline for the source dataset. */
export const SANDBOX_GOLDEN_STATUS_STYLES: Record<
  SandboxGoldenStatus,
  { badge: string; label: string }
> = {
  none: {
    badge: 'bg-outline-variant/15 text-on-surface-variant',
    label: 'Golden —',
  },
  pending: {
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    label: 'Golden pending',
  },
  ready: {
    badge: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
    label: 'Golden ready',
  },
  failed: {
    badge: 'bg-error/15 text-error',
    label: 'Golden failed',
  },
};

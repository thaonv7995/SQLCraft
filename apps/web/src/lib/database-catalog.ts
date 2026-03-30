import type { DatabaseDomain, DatabaseScale, DatasetScale, SandboxGoldenStatus } from './api';

export const DATABASE_DOMAIN_LABELS: Record<DatabaseDomain, string> = {
  ecommerce: 'E-Commerce',
  fintech: 'Fintech',
  health: 'Health Systems',
  iot: 'IoT Core',
  social: 'Social',
  analytics: 'Analytics',
  other: 'General',
};

/**
 * Row-count bands for display — keep in sync with `classifyDatasetScaleFromTotalRows`
 * in `apps/api/src/lib/dataset-scales.ts` (scan + catalog inferred scale).
 */
export const DATABASE_SCALE_LABELS: Record<DatabaseScale, string> = {
  tiny: '< 50K rows',
  small: '50K - 1M rows',
  medium: '1M - 10M rows',
  large: '10M - 100M rows',
  extra_large: '100M+ rows',
};

/** Short tier name (matches catalog filter rows below "Any Scale"). */
export const DATASET_SCALE_SHORT_LABELS: Record<DatabaseScale, string> = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  extra_large: 'Extra Large',
};

/** Challenge / admin forms: tier name plus row-range hint. */
export const DATASET_SCALE_FORM_OPTIONS: { value: DatasetScale; label: string }[] = (
  ['tiny', 'small', 'medium', 'large', 'extra_large'] as const
).map((value) => ({
  value,
  label: `${DATASET_SCALE_SHORT_LABELS[value]} (${DATABASE_SCALE_LABELS[value]})`,
}));

/** Detail / lab UI: short tier name + row-range line (challenge page, sandbox toolbar). */
export const DATASET_SCALE_DISPLAY_META: Record<DatasetScale, { label: string; desc: string }> = {
  tiny: { label: DATASET_SCALE_SHORT_LABELS.tiny, desc: DATABASE_SCALE_LABELS.tiny },
  small: { label: DATASET_SCALE_SHORT_LABELS.small, desc: DATABASE_SCALE_LABELS.small },
  medium: { label: DATASET_SCALE_SHORT_LABELS.medium, desc: DATABASE_SCALE_LABELS.medium },
  large: { label: DATASET_SCALE_SHORT_LABELS.large, desc: DATABASE_SCALE_LABELS.large },
  extra_large: {
    label: DATASET_SCALE_SHORT_LABELS.extra_large,
    desc: DATABASE_SCALE_LABELS.extra_large,
  },
};

/**
 * Maps total row count to a scale bucket — same thresholds as
 * `classifyDatasetScaleFromTotalRows` on the API (SQL dump scan, imports).
 */
export function inferDatasetScaleFromRowCount(rowCount: number): DatabaseScale {
  if (!Number.isFinite(rowCount) || rowCount <= 0) {
    return 'tiny';
  }
  if (rowCount >= 100_000_000) {
    return 'extra_large';
  }
  if (rowCount >= 10_000_000) {
    return 'large';
  }
  if (rowCount >= 1_000_000) {
    return 'medium';
  }
  if (rowCount >= 50_000) {
    return 'small';
  }
  return 'tiny';
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
  ...(['tiny', 'small', 'medium', 'large', 'extra_large'] as const).map((value) => ({
    value,
    label: DATASET_SCALE_SHORT_LABELS[value],
  })),
];

/** Import panels and tier-only pickers (no "Any Scale" row). */
export const DATASET_SCALE_TIER_OPTIONS = DATABASE_SCALE_OPTIONS.slice(1) as Array<{
  value: DatasetScale;
  label: string;
}>;

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

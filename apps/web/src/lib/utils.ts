import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ExplainPlanMode = 'explain' | 'explain_analyze';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatRows(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

export function formatMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

export function truncateSql(sql: string | null | undefined, maxLen = 80): string {
  if (sql == null || typeof sql !== 'string') {
    return '';
  }
  const cleaned = sql.trim().replace(/\s+/g, ' ');
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '...' : cleaned;
}

export function formatDate(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(d);
}

export function formatRelativeTime(date: string | Date | null | undefined): string {
  if (date == null) {
    return '—';
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(d);
}

export function getDifficultyColor(difficulty: string): string {
  switch (difficulty?.toLowerCase()) {
    case 'beginner':
      return 'text-secondary';
    case 'intermediate':
      return 'text-primary';
    case 'advanced':
      return 'text-error';
    default:
      return 'text-on-surface-variant';
  }
}

export function getStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'ready':
    case 'success':
    case 'completed':
      return 'text-secondary';
    case 'provisioning':
    case 'pending':
    case 'running':
      return 'text-tertiary';
    case 'error':
    case 'failed':
      return 'text-error';
    case 'active':
      return 'text-primary';
    default:
      return 'text-on-surface-variant';
  }
}

export function generateInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function classifyQueryType(sql: string | null | undefined): string {
  if (sql == null || typeof sql !== 'string') {
    return 'QUERY';
  }
  const trimmed = stripLeadingSqlComments(sql).toUpperCase();
  if (trimmed.startsWith('SELECT')) return 'SELECT';
  if (trimmed.startsWith('INSERT')) return 'INSERT';
  if (trimmed.startsWith('UPDATE')) return 'UPDATE';
  if (trimmed.startsWith('DELETE')) return 'DELETE';
  if (trimmed.startsWith('CREATE')) return 'CREATE';
  if (trimmed.startsWith('DROP')) return 'DROP';
  if (trimmed.startsWith('ALTER')) return 'ALTER';
  if (trimmed.startsWith('EXPLAIN')) return 'EXPLAIN';
  return 'QUERY';
}

export function stripLeadingSqlComments(sql: string | null | undefined): string {
  if (sql == null || typeof sql !== 'string') {
    return '';
  }

  let remaining = sql.trimStart();

  while (remaining.length > 0) {
    if (remaining.startsWith('--')) {
      const newlineIndex = remaining.indexOf('\n');
      remaining = newlineIndex === -1 ? '' : remaining.slice(newlineIndex + 1).trimStart();
      continue;
    }

    if (remaining.startsWith('/*')) {
      const blockEnd = remaining.indexOf('*/');
      remaining = blockEnd === -1 ? '' : remaining.slice(blockEnd + 2).trimStart();
      continue;
    }

    break;
  }

  return remaining.trimStart();
}

export function getExplainPlanMode(sql: string | null | undefined): ExplainPlanMode | null {
  const normalizedSql = stripLeadingSqlComments(sql);

  if (!normalizedSql || /^explain\b/i.test(normalizedSql)) {
    return null;
  }

  if (/^select\b/i.test(normalizedSql)) {
    return 'explain_analyze';
  }

  if (/^with\b/i.test(normalizedSql)) {
    return /\b(insert|update|delete|merge)\b/i.test(normalizedSql)
      ? 'explain'
      : 'explain_analyze';
  }

  if (/^(insert|update|delete|merge)\b/i.test(normalizedSql)) {
    return 'explain';
  }

  return null;
}

export function shouldAutoExplainAnalyze(sql: string | null | undefined): boolean {
  return getExplainPlanMode(sql) === 'explain_analyze';
}

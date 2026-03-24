import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatRows(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
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
  const trimmed = sql.trim().toUpperCase();
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

import * as React from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant =
  | 'provisioning'
  | 'ready'
  | 'success'
  | 'error'
  | 'pending'
  | 'active'
  | 'archived'
  | 'draft'
  | 'published'
  | 'merged'
  | 'closed'
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'running'
  | 'terminated'
  | 'idle'
  | 'default';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

const variantConfig: Record<BadgeVariant, { label: string; classes: string; dotClass?: string }> = {
  provisioning: {
    label: 'Provisioning',
    classes: 'text-tertiary bg-tertiary/15 animate-pulse-glow',
    dotClass: 'bg-tertiary',
  },
  ready: {
    label: 'Ready',
    classes: 'text-secondary bg-secondary/15',
    dotClass: 'bg-secondary',
  },
  success: {
    label: 'Success',
    classes: 'text-secondary bg-secondary/15',
    dotClass: 'bg-secondary',
  },
  error: {
    label: 'Error',
    classes: 'text-error bg-error/15',
    dotClass: 'bg-error',
  },
  pending: {
    label: 'Pending',
    classes: 'text-on-surface-variant bg-surface-container-highest',
    dotClass: 'bg-on-surface-variant',
  },
  active: {
    label: 'Active',
    classes: 'text-primary bg-primary/15',
    dotClass: 'bg-primary',
  },
  archived: {
    label: 'Archived',
    classes: 'text-on-surface-variant bg-surface-container-high',
    dotClass: 'bg-on-surface-variant',
  },
  draft: {
    label: 'Draft',
    classes: 'text-on-surface-variant bg-surface-container-highest',
    dotClass: 'bg-on-surface-variant',
  },
  published: {
    label: 'Published',
    classes: 'text-secondary bg-secondary/15',
    dotClass: 'bg-secondary',
  },
  merged: {
    label: 'Merged',
    classes: 'text-primary bg-primary/15',
    dotClass: 'bg-primary',
  },
  closed: {
    label: 'Closed',
    classes: 'text-on-surface-variant bg-surface-container-high',
    dotClass: 'bg-on-surface-variant',
  },
  beginner: {
    label: 'Beginner',
    classes: 'text-secondary bg-secondary/15',
  },
  intermediate: {
    label: 'Intermediate',
    classes: 'text-primary bg-primary/15',
  },
  advanced: {
    label: 'Advanced',
    classes: 'text-error bg-error/15',
  },
  running: {
    label: 'Running',
    classes: 'text-tertiary bg-tertiary/15',
    dotClass: 'bg-tertiary animate-pulse',
  },
  terminated: {
    label: 'Terminated',
    classes: 'text-on-surface-variant bg-surface-container-high',
    dotClass: 'bg-on-surface-variant',
  },
  idle: {
    label: 'Idle',
    classes: 'text-on-surface-variant bg-surface-container-highest',
    dotClass: 'bg-on-surface-variant',
  },
  default: {
    label: 'Unknown',
    classes: 'text-on-surface-variant bg-surface-container-high',
  },
};

export function Badge({ variant = 'default', dot = false, className, children, ...props }: BadgeProps) {
  const config = variantConfig[variant] ?? variantConfig.default;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        'px-2 py-0.5',
        'rounded-full',
        'text-xs font-medium font-body',
        'whitespace-nowrap',
        config.classes,
        className
      )}
      {...props}
    >
      {dot && config.dotClass && (
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', config.dotClass)} />
      )}
      {children ?? config.label}
    </span>
  );
}

// Convenience wrappers
export function StatusBadge({ status, ...props }: { status: string } & Omit<BadgeProps, 'variant'>) {
  const map: Record<string, BadgeVariant> = {
    provisioning: 'provisioning',
    ready: 'ready',
    active: 'active',
    idle: 'idle',
    terminated: 'terminated',
    success: 'success',
    error: 'error',
    failed: 'error',
    pending: 'pending',
    running: 'running',
    published: 'published',
    draft: 'draft',
    archived: 'archived',
    completed: 'success',
    merged: 'merged',
    closed: 'closed',
  };
  const v = map[status?.toLowerCase()] ?? 'default';
  return <Badge variant={v} dot {...props} />;
}

export function DifficultyBadge({
  difficulty,
  ...props
}: { difficulty: string } & Omit<BadgeProps, 'variant'>) {
  const map: Record<string, BadgeVariant> = {
    beginner: 'beginner',
    intermediate: 'intermediate',
    advanced: 'advanced',
  };
  const v = map[difficulty?.toLowerCase()] ?? 'default';
  return <Badge variant={v} {...props}>{difficulty}</Badge>;
}

import type { DatabaseDomain, DatabaseScale } from './api';

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

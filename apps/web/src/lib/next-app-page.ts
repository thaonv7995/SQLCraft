'use client';

export type { ClientPageProps } from '@/lib/page-props';

export function searchParamFirst(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const raw = searchParams[key];
  if (raw === undefined) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

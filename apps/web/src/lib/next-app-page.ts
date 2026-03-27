'use client';

import { use } from 'react';

/**
 * Unwraps App Router `params` and `searchParams` promises (Next.js 15+).
 * Use at the top of every client `page.tsx` so devtools / serialization never
 * enumerates a pending Promise.
 */
type ClientPagePromises = {
  params: Promise<unknown>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function useAppPageProps(props: ClientPagePromises) {
  const params = use(props.params) as Record<string, string>;
  const searchParams = use(props.searchParams);
  return { params, searchParams };
}

export function searchParamFirst(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const raw = searchParams[key];
  if (raw === undefined) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

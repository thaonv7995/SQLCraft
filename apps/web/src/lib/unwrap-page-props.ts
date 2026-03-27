import type { ClientPageProps } from '@/lib/page-props';

/** Await `params` and `searchParams` in a Server Component before rendering a client page. */
export async function unwrapPageProps<P extends Record<string, string> = Record<string, string>>(
  props: {
    params: Promise<P>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
): Promise<ClientPageProps<P>> {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  return { params, searchParams };
}

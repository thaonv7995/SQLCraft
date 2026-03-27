/**
 * Resolved route props passed from a Server Component page into a Client page.
 * Keeps `params` / `searchParams` off the client boundary as Promises (Next.js 15+),
 * which avoids devtools / inspector sync-access warnings.
 */
/** Default `P` is open so static routes (`{}`) and dynamic segments share one client boundary type. */
export type ClientPageProps<P extends Record<string, string> = Record<string, string>> = {
  params: P;
  searchParams: Record<string, string | string[] | undefined>;
};

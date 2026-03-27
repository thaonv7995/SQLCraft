import { unwrapPageProps } from '@/lib/unwrap-page-props';
import PageClient from './page-client';

export default async function Page(props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PageClient {...(await unwrapPageProps(props))} />;
}

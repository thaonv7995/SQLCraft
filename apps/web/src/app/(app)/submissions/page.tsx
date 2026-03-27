'use client';

import Link from 'next/link';
import { useAppPageProps } from '@/lib/next-app-page';

export default function SubmissionsPage(props: PageProps<'/submissions'>) {
  useAppPageProps(props);
  return (
    <div className="page-shell page-stack">
      <section className="rounded-[28px] border border-outline-variant/10 bg-surface-container-low px-6 py-8">
        <h1 className="font-headline text-3xl font-bold text-on-surface">Submissions</h1>
        <p className="mt-3 text-sm text-on-surface-variant">
          Luong contributor cu da duoc go bo. Hay tao submission truc tiep tu trang challenge leaderboard.
        </p>
        <Link
          href="/leaderboard"
          className="mt-6 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary"
        >
          Mo Challenge Leaderboard
        </Link>
      </section>
    </div>
  );
}

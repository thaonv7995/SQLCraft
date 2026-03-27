import Link from 'next/link';

const CONTENT_LINKS = [
  {
    href: '/admin/databases',
    title: 'Databases',
    description:
      'Manage the practice catalog: import dumps, edit metadata, and wire schemas to lessons and challenges.',
    icon: 'database',
  },
  {
    href: '/admin/rankings',
    title: 'Rankings',
    description: 'View global and per-challenge leaderboards tied to published content.',
    icon: 'leaderboard',
  },
] as const;

export default function AdminContentPage() {
  return (
    <div className="page-shell-wide page-stack">
      <div>
        <h1 className="page-title-lg">Content</h1>
        <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">
          Curated datasets and published challenges power the lab. Jump into the areas you maintain most
          often.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CONTENT_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group section-card card-padding flex flex-col gap-3 transition-colors hover:bg-surface-container-high/40"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-outline-variant/20 bg-surface-container-high text-on-surface">
              <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
            </div>
            <div>
              <h2 className="text-base font-semibold text-on-surface group-hover:underline">
                {item.title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{item.description}</p>
            </div>
            <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
              Open
              <span className="material-symbols-outlined text-base transition-transform group-hover:translate-x-0.5">
                arrow_forward
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

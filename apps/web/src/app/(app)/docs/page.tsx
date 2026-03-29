import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'User guide',
  description:
    'How to use SQLCraft: screens, SQL practice flow, Lab, challenges, and keyboard shortcuts.',
};

const TOC = [
  { href: '#overview', label: 'Overview' },
  { href: '#typical-flow', label: 'Typical flow' },
  { href: '#screens', label: 'Screens' },
  { href: '#concepts', label: 'Concepts' },
  { href: '#shortcuts', label: 'Shortcuts' },
  { href: '#author', label: 'Author & support' },
] as const;

const APP_SECTIONS = [
  {
    title: 'Dashboard',
    description:
      'Activity overview: running sessions, query count (last 7 days), completed challenges, featured database suggestions, and recent queries.',
    href: '/dashboard',
    icon: 'dashboard',
  },
  {
    title: 'Databases (Explorer)',
    description:
      'Sample datasets: read descriptions, scale (row counts), and table structure. Pick one to open details and start a practice session.',
    href: '/explore',
    icon: 'database',
  },
  {
    title: 'SQL Lab',
    description:
      'Sessions you have created or that are still open; open one to write SQL, run statements, view execution plans, history, and (when available) compare results.',
    href: '/lab',
    icon: 'terminal',
  },
  {
    title: 'Challenges & Leaderboard',
    description:
      'Leaderboard and challenge hub: graded exercises, submissions, and community progress.',
    href: '/leaderboard',
    icon: 'target',
  },
  {
    title: 'Query history',
    description: 'All queries run across sessions, filterable with SQL and summarized results.',
    href: '/history',
    icon: 'history',
  },
  {
    title: 'Profile & Settings',
    description:
      'User profile and personal stats; account settings from the sidebar menu.',
    href: '/profile',
    icon: 'person',
  },
] as const;

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 font-mono text-xs text-on-surface">
      {children}
    </kbd>
  );
}

export default function DocsPage() {
  return (
    <div className="page-shell-narrow page-stack">
      <header className="space-y-3">
        <h1 className="page-title-lg">User guide</h1>
        <p className="page-lead max-w-2xl">
          SQLCraft helps you <strong className="font-semibold text-on-surface">practice SQL</strong> on
          sample datasets in a <strong className="font-semibold text-on-surface">dedicated environment</strong>{' '}
          per session: write statements, view results, analyze queries, and join challenges. This page is
          for <strong className="font-semibold text-on-surface">app users</strong>
          — how to navigate and use each screen.
        </p>
        <nav
          aria-label="Table of contents"
          className="flex flex-wrap gap-2 border-b border-outline-variant/10 pb-4"
        >
          {TOC.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full border border-outline-variant/20 bg-surface-container-low px-3 py-1 text-xs font-medium text-on-surface-variant transition-colors hover:border-outline-variant/40 hover:text-on-surface"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <section id="overview" className="scroll-mt-24 section-card card-padding">
        <h2 className="page-section-title">What is SQLCraft?</h2>
        <ul className="mt-4 list-inside list-disc space-y-2 text-sm leading-relaxed text-on-surface-variant">
          <li>
            <span className="text-on-surface">Write and run SQL in the browser</span> — each session has
            its own database; you see a subset of rows (enough to learn) and statement runtime.
          </li>
          <li>
            <span className="text-on-surface">Multiple data scales</span> — the same table set may offer
            smaller or larger scales per exercise; on-screen row counts reflect the dataset you chose.
          </li>
          <li>
            <span className="text-on-surface">Challenges & leaderboard</span> — graded exercises,
            points, and rankings to track progress.
          </li>
        </ul>
      </section>

      <section id="typical-flow" className="scroll-mt-24 section-card card-padding">
        <h2 className="page-section-title">Typical usage flow</h2>
        <ol className="mt-4 list-inside list-decimal space-y-3 text-sm leading-relaxed text-on-surface-variant">
          <li>
            <span className="text-on-surface">Sign in</span> — you need an account to access practice
            screens and save progress.
          </li>
          <li>
            <span className="text-on-surface">Open Databases</span> — pick a catalog (e.g. ecommerce),
            read the description and schema.
          </li>
          <li>
            <span className="text-on-surface">Start a session</span> — choose a data scale when offered,
            then launch; the app opens{' '}
            <Link href="/lab" className="font-medium text-primary underline-offset-2 hover:underline">
              SQL Lab
            </Link>{' '}
            for the new session.
          </li>
          <li>
            <span className="text-on-surface">Write and run SQL</span> — in Lab, use the editor and
            shortcuts to execute statements; view plans and history in the same session.
          </li>
          <li>
            <span className="text-on-surface">End a session</span> — when time expires or you end it,
            that session&apos;s environment closes and temporary data is no longer available.
          </li>
          <li>
            <span className="text-on-surface">Challenges</span> — from the leaderboard, open each
            challenge and submit solutions per instructions.
          </li>
        </ol>
      </section>

      <section id="screens" className="scroll-mt-24 space-y-4">
        <h2 className="page-section-title px-1">Screens in the app</h2>
        <p className="px-1 text-sm text-on-surface-variant">
          Main navigation is in the sidebar (desktop) or bottom bar (mobile). Admins also see{' '}
          <strong className="text-on-surface">Admin Panel</strong> when their account has access.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {APP_SECTIONS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="section-card card-padding group transition-colors hover:border-outline-variant/25"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined shrink-0 text-on-surface-variant group-hover:text-on-surface">
                  {item.icon}
                </span>
                <div>
                  <h3 className="page-section-title text-base">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
                    {item.description}
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-on-surface">
                    Open page
                    <span className="material-symbols-outlined text-base">arrow_forward</span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
        <p className="px-1 text-sm text-on-surface-variant">
          The{' '}
          <Link href="/submissions" className="font-medium text-primary underline-offset-2 hover:underline">
            Submissions
          </Link>{' '}
          page lists your challenge submissions (if you have any).
        </p>
      </section>

      <section id="concepts" className="scroll-mt-24 section-card card-padding">
        <h2 className="page-section-title">Important concepts</h2>
        <dl className="mt-4 space-y-4 text-sm text-on-surface-variant">
          <div>
            <dt className="font-semibold text-on-surface">Lab session</dt>
            <dd className="mt-1 leading-relaxed">
              A single work period tied to one temporary database. Starting from Databases usually
              creates a new session; you can also resume an open session from the list in SQL Lab.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-on-surface">Session time limit</dt>
            <dd className="mt-1 leading-relaxed">
              Sessions have a time limit. While you work in Lab, it may be extended slightly. After
              expiry or when the session ends, you cannot reopen the same data.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-on-surface">Dashboard and Profile numbers</dt>
            <dd className="mt-1 leading-relaxed">
              <strong className="text-on-surface">Queries</strong> usually counts statements you ran in
              the <strong className="text-on-surface">last 7 days</strong> to reflect recent practice —
              not an all-time total. Completed challenges may show as a lifetime count.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-on-surface">Results and execution plans</dt>
            <dd className="mt-1 leading-relaxed">
              Each run shows a subset of result rows (enough to read and verify). The execution plan
              explains how the database engine processes the statement (useful for query optimization).
            </dd>
          </div>
        </dl>
      </section>

      <section id="shortcuts" className="scroll-mt-24 section-card card-padding">
        <h2 className="page-section-title">SQL Lab shortcuts</h2>
        <ul className="mt-4 space-y-3 text-sm text-on-surface-variant">
          <li className="flex flex-wrap items-center gap-2">
            <Kbd>Ctrl</Kbd>
            <span>+</span>
            <Kbd>Enter</Kbd>
            <span className="text-on-surface-variant">
              — run the current query{' '}
              <span className="text-on-surface">(macOS: ⌘ + Enter)</span>
            </span>
          </li>
        </ul>
        <p className="mt-4 text-xs text-outline">
          A similar hint appears below the editor in Lab.
        </p>
      </section>

      <section id="author" className="scroll-mt-24 section-card card-padding">
        <h2 className="page-section-title">Author & support</h2>
        <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
          SQLCraft is maintained by <strong className="text-on-surface">Thao Nguyen</strong>. If the
          project helps you learn or teach SQL, you can connect or show support via the links below.
        </p>
        <ul className="mt-4 flex flex-col gap-3 text-sm">
          <li>
            <a
              href="https://www.linkedin.com/in/thaonv795/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-medium text-primary underline-offset-2 hover:underline"
            >
              <span className="material-symbols-outlined text-lg" aria-hidden>
                work
              </span>
              LinkedIn — Thao Nguyen
            </a>
          </li>
          <li>
            <a
              href="https://buymeacoffee.com/thaonv795"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-medium text-primary underline-offset-2 hover:underline"
            >
              <span className="material-symbols-outlined text-lg" aria-hidden>
                local_cafe
              </span>
              Buy Me a Coffee
            </a>
          </li>
        </ul>
      </section>

      <div className="rounded-xl border border-dashed border-outline-variant/25 bg-surface-container-low/50 p-5 text-sm text-on-surface-variant">
        <p>
          Need to change account or theme? Open{' '}
          <Link href="/settings" className="font-medium text-on-surface underline-offset-2 hover:underline">
            User Settings
          </Link>
          . For operations support, contact your organization&apos;s admins.
        </p>
      </div>
    </div>
  );
}

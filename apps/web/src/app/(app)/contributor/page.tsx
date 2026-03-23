'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/stores/auth';
import { StatCard } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/utils';

type ContributionDay = { count: number; weekIdx: number; dayIdx: number };

function generateContributionWeeks(): ContributionDay[][] {
  return Array.from({ length: 12 }, (_, weekIdx) =>
    Array.from({ length: 7 }, (_, dayIdx) => {
      const count = Math.random() < 0.4 ? 0 : Math.floor(Math.random() * 5);
      return { count, weekIdx, dayIdx };
    })
  );
}

const RECENT_CONTRIBUTIONS = [
  { id: 'c1', type: 'lesson', title: 'Advanced Window Functions Exercise', status: 'published', date: new Date(Date.now() - 2 * 86400_000).toISOString(), track: 'Window Functions' },
  { id: 'c2', type: 'pr', title: 'Fix: Incorrect expected output in JOIN exercises', status: 'merged', date: new Date(Date.now() - 5 * 86400_000).toISOString(), track: null },
  { id: 'c3', type: 'lesson', title: 'Introduction to CTEs', status: 'draft', date: new Date(Date.now() - 8 * 86400_000).toISOString(), track: 'CTEs & Subqueries' },
  { id: 'c4', type: 'issue', title: 'Outdated syntax in MySQL lesson 4', status: 'closed', date: new Date(Date.now() - 12 * 86400_000).toISOString(), track: null },
];

const OPEN_ISSUES = [
  { id: 'i1', title: 'Need exercises for recursive CTEs', label: 'help wanted', difficulty: 'advanced', assignees: 0 },
  { id: 'i2', title: 'Add PostgreSQL-specific window function examples', label: 'enhancement', difficulty: 'intermediate', assignees: 1 },
  { id: 'i3', title: 'Improve explanation in GROUP BY lesson 3', label: 'good first issue', difficulty: 'beginner', assignees: 0 },
  { id: 'i4', title: 'Add test cases for ROLLUP and CUBE operators', label: 'help wanted', difficulty: 'advanced', assignees: 0 },
];

const CONTRIBUTION_TYPE_ICONS: Record<string, string> = {
  lesson: 'menu_book',
  pr: 'merge',
  issue: 'bug_report',
};

function ContributionGrid() {
  const [weeks, setWeeks] = useState<ContributionDay[][]>([]);
  useEffect(() => {
    setWeeks(generateContributionWeeks());
  }, []);

  return (
    <div className="bg-surface-container-low rounded-xl p-5">
      <h3 className="font-headline text-sm font-semibold text-on-surface mb-4">
        Contribution Activity
      </h3>
      <div className="overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {weeks.length === 0
            ? Array.from({ length: 12 }, (_, wi) => (
                <div key={wi} className="flex flex-col gap-1">
                  {Array.from({ length: 7 }, (_, di) => (
                    <div key={di} className="w-3 h-3 rounded-sm bg-surface-container-highest" />
                  ))}
                </div>
              ))
            : weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day, di) => (
                <div
                  key={di}
                  title={`${day.count} contributions`}
                  className={`w-3 h-3 rounded-sm transition-colors ${
                    day.count === 0
                      ? 'bg-surface-container-highest'
                      : day.count === 1
                      ? 'bg-primary/20'
                      : day.count === 2
                      ? 'bg-primary/40'
                      : day.count === 3
                      ? 'bg-primary/60'
                      : 'bg-primary/90'
                  }`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 text-xs text-outline">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={`w-3 h-3 rounded-sm ${
              level === 0
                ? 'bg-surface-container-highest'
                : level === 1
                ? 'bg-primary/20'
                : level === 2
                ? 'bg-primary/40'
                : level === 3
                ? 'bg-primary/60'
                : 'bg-primary/90'
            }`}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

export default function ContributorPage() {
  const { user } = useAuthStore();
  const displayName = user?.displayName ?? user?.username ?? 'Contributor';

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-on-surface-variant mb-1">Contributor Dashboard</p>
          <h1 className="font-headline text-2xl font-bold text-on-surface">{displayName}</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Thank you for building SQLCraft with us.
          </p>
        </div>
        <Link href="/admin/content">
          <Button
            variant="primary"
            leftIcon={<span className="material-symbols-outlined text-sm">add</span>}
          >
            Create New Lesson
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="PRs Merged"
          value="12"
          delta="+2 this month"
          deltaPositive
          accent="secondary"
          icon={<span className="material-symbols-outlined">merge</span>}
        />
        <StatCard
          label="Lessons Authored"
          value="8"
          accent="primary"
          icon={<span className="material-symbols-outlined">menu_book</span>}
        />
        <StatCard
          label="Issues Closed"
          value="27"
          delta="+5 this month"
          deltaPositive
          accent="tertiary"
          icon={<span className="material-symbols-outlined">task_alt</span>}
        />
        <StatCard
          label="Contributor Rank"
          value="#14"
          accent="error"
          icon={<span className="material-symbols-outlined">military_tech</span>}
        />
      </div>

      {/* Contribution chart */}
      <ContributionGrid />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Recent contributions */}
        <div className="bg-surface-container-low rounded-xl overflow-hidden">
          <div className="px-5 py-4">
            <h2 className="font-headline text-base font-semibold text-on-surface">
              Recent Contributions
            </h2>
          </div>
          <div className="flex flex-col">
            {RECENT_CONTRIBUTIONS.map((c) => (
              <div key={c.id} className="px-5 py-3 flex items-center gap-3 hover:bg-surface-container transition-colors">
                <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-sm text-on-surface-variant">
                    {CONTRIBUTION_TYPE_ICONS[c.type] ?? 'code'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-on-surface truncate">{c.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusBadge status={c.status} />
                    {c.track && (
                      <span className="text-xs text-tertiary truncate">{c.track}</span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-outline shrink-0">
                  {formatRelativeTime(c.date)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Open issues */}
        <div className="bg-surface-container-low rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="font-headline text-base font-semibold text-on-surface">
              Open Tasks
            </h2>
            <Button variant="ghost" size="sm">
              View all issues
            </Button>
          </div>
          <div className="flex flex-col">
            {OPEN_ISSUES.map((issue) => (
              <div key={issue.id} className="px-5 py-3 hover:bg-surface-container transition-colors">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-base text-outline mt-0.5 shrink-0">
                    radio_button_unchecked
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-on-surface leading-snug">{issue.title}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          issue.label === 'good first issue'
                            ? 'text-secondary bg-secondary/15'
                            : issue.label === 'help wanted'
                            ? 'text-primary bg-primary/15'
                            : 'text-on-surface-variant bg-surface-container-highest'
                        }`}
                      >
                        {issue.label}
                      </span>
                      <span className={`text-xs ${
                        issue.difficulty === 'advanced' ? 'text-error' :
                        issue.difficulty === 'intermediate' ? 'text-primary' : 'text-secondary'
                      }`}>
                        {issue.difficulty}
                      </span>
                      {issue.assignees === 0 && (
                        <span className="text-xs text-outline">unassigned</span>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">
                    Claim
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

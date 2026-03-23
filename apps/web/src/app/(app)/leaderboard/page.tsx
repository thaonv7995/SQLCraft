'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { leaderboardApi } from '@/lib/api';
import type { LeaderboardEntry } from '@/lib/api';
import { cn, generateInitials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  TableSkeleton,
} from '@/components/ui/table';

type Period = 'weekly' | 'monthly' | 'alltime';

const PERIOD_TABS: { value: Period; label: string }[] = [
  { value: 'weekly', label: 'This Week' },
  { value: 'monthly', label: 'This Month' },
  { value: 'alltime', label: 'All Time' },
];

const RANK_STYLES: Record<number, { bg: string; text: string; icon?: string }> = {
  1: { bg: 'bg-[#FFD700]/10', text: 'text-[#FFD700]', icon: '🥇' },
  2: { bg: 'bg-[#C0C0C0]/10', text: 'text-[#C0C0C0]', icon: '🥈' },
  3: { bg: 'bg-[#CD7F32]/10', text: 'text-[#CD7F32]', icon: '🥉' },
};

// Podium for top 3
function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  const top3 = entries.slice(0, 3);
  // Reorder: 2nd, 1st, 3rd
  const order = [top3[1], top3[0], top3[2]];
  const heights = ['h-24', 'h-32', 'h-20'];

  return (
    <div className="flex items-end justify-center gap-4 py-8">
      {order.map((entry, i) => {
        if (!entry) return null;
        const podiumHeight = heights[i];
        const actualRank = i === 1 ? 1 : i === 0 ? 2 : 3;
        const rankStyle = RANK_STYLES[actualRank];

        return (
          <div key={entry.userId} className="flex flex-col items-center gap-3 w-32">
            {/* Avatar + name */}
            <div className="text-center">
              <div
                className={cn(
                  'w-12 h-12 rounded-full mx-auto mb-2 flex items-center justify-center text-base font-bold font-headline',
                  actualRank === 1
                    ? 'bg-gradient-to-br from-[#FFD700]/40 to-[#FFD700]/20 text-[#FFD700]'
                    : actualRank === 2
                    ? 'bg-gradient-to-br from-[#C0C0C0]/40 to-[#C0C0C0]/20 text-[#C0C0C0]'
                    : 'bg-gradient-to-br from-[#CD7F32]/40 to-[#CD7F32]/20 text-[#CD7F32]'
                )}
              >
                {generateInitials(entry.displayName)}
              </div>
              <p className="text-xs font-medium text-on-surface truncate">{entry.displayName}</p>
              <p className="text-xs text-on-surface-variant">{entry.points.toLocaleString()} pts</p>
            </div>

            {/* Podium block */}
            <div
              className={cn(
                'w-full rounded-t-xl flex items-center justify-center',
                podiumHeight,
                rankStyle.bg
              )}
            >
              <span className={cn('text-2xl font-headline font-bold', rankStyle.text)}>
                {actualRank}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>('alltime');

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', period],
    queryFn: () => leaderboardApi.get(period),
    staleTime: 60_000,
  });

  const entries = data ?? [];

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="text-center">
        <h1 className="font-headline text-3xl font-bold text-on-surface mb-2">
          Leaderboard
        </h1>
        <p className="text-sm text-on-surface-variant">
          The top SQL engineers on The Architectural Lab.
        </p>
      </div>

      {/* Period tabs */}
      <div className="flex justify-center">
        <div className="flex items-center gap-1 bg-surface-container-low rounded-xl p-1">
          {PERIOD_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setPeriod(tab.value)}
              className={cn(
                'px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
                period === tab.value
                  ? 'bg-surface-container-high text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Podium */}
      {!isLoading && entries.length >= 3 && (
        <div className="bg-surface-container-low rounded-xl overflow-hidden">
          <div className="px-5 pt-4">
            <h2 className="font-headline text-sm font-semibold text-outline uppercase tracking-wider text-center">
              Top Performers
            </h2>
          </div>
          <Podium entries={entries} />
        </div>
      )}

      {/* Full leaderboard table */}
      <div className="bg-surface-container-low rounded-xl overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="font-headline text-base font-semibold text-on-surface">Rankings</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Rank</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Points</TableHead>
              <TableHead>Challenges</TableHead>
              <TableHead>Streak</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={10} cols={6} />
            ) : entries.length === 0 ? (
              <TableEmpty message="No rankings available" colSpan={6} />
            ) : (
              entries.map((entry) => {
                const rankStyle = RANK_STYLES[entry.rank];
                return (
                  <TableRow key={entry.userId}>
                    {/* Rank */}
                    <TableCell>
                      <div
                        className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold font-headline',
                          rankStyle
                            ? cn(rankStyle.bg, rankStyle.text)
                            : 'bg-surface-container-high text-on-surface-variant'
                        )}
                      >
                        {entry.rank}
                      </div>
                    </TableCell>

                    {/* User */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {entry.avatarUrl ? (
                          <img
                            src={entry.avatarUrl}
                            alt={entry.displayName}
                            className="w-8 h-8 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/50 to-[#4453a7]/50 flex items-center justify-center text-xs font-bold font-headline text-[#00105b] shrink-0">
                            {generateInitials(entry.displayName)}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-on-surface">{entry.displayName}</p>
                          <p className="text-xs text-on-surface-variant">@{entry.username}</p>
                        </div>
                      </div>
                    </TableCell>

                    {/* Points */}
                    <TableCell>
                      <span className={cn('text-sm font-mono font-bold', rankStyle?.text ?? 'text-primary')}>
                        {entry.points.toLocaleString()}
                      </span>
                    </TableCell>

                    {/* Challenges */}
                    <TableCell className="font-mono text-sm text-on-surface-variant">
                      {entry.challengesCompleted}
                    </TableCell>

                    {/* Streak */}
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <span className="material-symbols-outlined text-base text-error" style={{ fontVariationSettings: "'FILL' 1" }}>
                          local_fire_department
                        </span>
                        <span className="font-mono text-on-surface-variant">{entry.streak}d</span>
                      </div>
                    </TableCell>

                    {/* View profile */}
                    <TableCell>
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Challenge completion section */}
      <div className="bg-surface-container-low rounded-xl p-5">
        <h2 className="font-headline text-base font-semibold text-on-surface mb-4">
          Challenge Completion Rates
        </h2>
        <div className="space-y-3">
          {[
            { label: 'SQL Fundamentals', completed: 847, total: 1489, color: 'bg-secondary' },
            { label: 'Window Functions', completed: 312, total: 1489, color: 'bg-primary' },
            { label: 'CTEs & Subqueries', completed: 234, total: 1489, color: 'bg-tertiary' },
            { label: 'Query Optimization', completed: 89, total: 1489, color: 'bg-error' },
          ].map((item) => {
            const pct = Math.round((item.completed / item.total) * 100);
            return (
              <div key={item.label}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-on-surface-variant">{item.label}</span>
                  <span className="font-mono text-on-surface">{item.completed.toLocaleString()} users ({pct}%)</span>
                </div>
                <div className="h-2 bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${item.color}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

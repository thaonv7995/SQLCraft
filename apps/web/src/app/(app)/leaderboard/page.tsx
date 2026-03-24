'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { leaderboardApi } from '@/lib/api';
import type { LeaderboardEntry } from '@/lib/api';
import { cn, generateInitials } from '@/lib/utils';

type Period = 'weekly' | 'monthly' | 'alltime';

const PERIOD_TABS: { value: Period; label: string }[] = [
  { value: 'weekly', label: 'This Week' },
  { value: 'monthly', label: 'This Month' },
  { value: 'alltime', label: 'All Time' },
];

// Top rank accent colors
const RANK_STYLES: Record<number, { num: string }> = {
  1: { num: 'text-[#FFD700]' },
  2: { num: 'text-[#C0C0C0]' },
  3: { num: 'text-[#CD7F32]' },
};

function RankRow({ entry, isMe = false }: { entry: LeaderboardEntry; isMe?: boolean }) {
  const style = RANK_STYLES[entry.rank];
  return (
    <div
      className={cn(
        'px-4 py-3 flex items-center justify-between hover:bg-surface-container-high transition-colors',
        isMe && 'bg-primary/10',
        entry.rank < 4 ? '' : ''
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'w-6 text-center font-mono font-bold text-sm shrink-0',
            style?.num ?? 'text-outline/60'
          )}
        >
          {entry.rank}
        </div>
        {entry.avatarUrl ? (
          <img
            src={entry.avatarUrl}
            alt={entry.displayName}
            className={cn(
              'w-8 h-8 rounded-full object-cover shrink-0',
              isMe && 'ring-1 ring-outline'
            )}
          />
        ) : (
          <div
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold font-headline shrink-0',
              isMe
                ? 'bg-surface-container-highest text-on-surface ring-1 ring-outline'
                : 'bg-surface-container-highest text-on-surface-variant'
            )}
          >
            {generateInitials(entry.displayName)}
          </div>
        )}
        <div className="min-w-0">
          <p className={cn('text-sm font-medium truncate', isMe && 'text-on-surface font-bold')}>
            {isMe ? 'You' : entry.displayName}
          </p>
          <p className="text-[10px] text-outline font-mono">@{entry.username}</p>
        </div>
      </div>
      <div className="text-right shrink-0 ml-2">
        <p className={cn('font-mono text-sm', entry.rank <= 3 ? 'text-secondary' : 'text-outline')}>
          {entry.points.toLocaleString()} pts
        </p>
        <div className="flex items-center gap-0.5 justify-end mt-0.5">
          <span
            className="material-symbols-outlined text-[10px] text-error"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            local_fire_department
          </span>
          <span className="text-[10px] text-outline font-mono">{entry.streak}d</span>
        </div>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>('alltime');

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', period],
    queryFn: () => leaderboardApi.get(period, 50),
    staleTime: 60_000,
  });

  const entries = data ?? [];
  const top5 = entries.slice(0, 5);

  return (
    <div className="page-shell page-stack">
      {/* Page header */}
      <div className="mb-10">
        <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface mb-2">
          Competitive Tracks
        </h1>
        <p className="text-outline font-light max-w-2xl">
          Fine-tune your architecture. Compete against the engine and the community in
          precision-focused SQL challenges.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* ── Left: challenge cards ──────────────────────────────── */}
        <div className="xl:col-span-8 space-y-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-headline text-xl font-medium flex items-center gap-2">
              <span className="w-1.5 h-6 bg-on-surface-variant rounded-full shrink-0" />
              Active Missions
            </h2>
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-surface-container-high rounded-full text-xs text-outline">
                Filter: All
              </span>
              <span className="px-3 py-1 bg-surface-container-high rounded-full text-xs text-outline">
                Sort: Difficulty
              </span>
            </div>
          </div>

          {/* Challenge cards */}
          {[
            {
              title: 'The Heavy Hitter',
              tag: 'Crucial',
              tagColor: 'bg-error-container/20 text-error',
              desc: 'Optimize massive analytical joins across legacy schemas without using temp tables.',
              pts: '840 pts',
              stats: [
                { label: 'Difficulty', value: 'Expert (Lvl 9)', color: 'text-secondary' },
                { label: 'Domain', value: 'Data Warehousing', color: 'text-on-surface' },
                { label: 'Dataset', value: '2.4 TB', color: 'text-tertiary' },
              ],
            },
            {
              title: 'Index Optimizer',
              tag: 'Optimization',
              tagColor: 'bg-secondary/10 text-secondary',
              desc: 'Refactor a fragmented search query to reduce scan times by 40% using partial indexing.',
              pts: '620 pts',
              stats: [
                { label: 'Difficulty', value: 'Advanced', color: 'text-primary' },
                { label: 'Domain', value: 'Performance Tuning', color: 'text-on-surface' },
                { label: 'Dataset', value: '140 GB', color: 'text-tertiary' },
              ],
            },
            {
              title: 'Recursive Descent',
              tag: 'Logic',
              tagColor: 'bg-primary/10 text-primary',
              desc: 'Solve a multi-level organizational hierarchy traversal using CTEs and window functions.',
              pts: '510 pts',
              stats: [
                { label: 'Difficulty', value: 'Intermediate', color: 'text-primary' },
                { label: 'Domain', value: 'Complex Logic', color: 'text-on-surface' },
                { label: 'Dataset', value: '12 MB', color: 'text-tertiary' },
              ],
            },
          ].map((challenge) => (
            <div
              key={challenge.title}
              className="bg-surface-container-low p-6 rounded-xl group hover:bg-surface-container-high transition-all duration-200 border-l-4 border-transparent hover:border-primary cursor-pointer"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-headline text-xl font-bold text-on-surface">
                      {challenge.title}
                    </h3>
                    <span
                      className={cn(
                        'text-[10px] px-2 py-0.5 rounded font-mono uppercase tracking-tighter',
                        challenge.tagColor
                      )}
                    >
                      {challenge.tag}
                    </span>
                  </div>
                  <p className="text-sm text-outline">{challenge.desc}</p>
                </div>
                <span className="text-tertiary font-mono text-xs shrink-0 ml-4">
                  {challenge.pts}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-4 mt-1 bg-surface-container-lowest/30 rounded-lg px-4 py-3">
                {challenge.stats.map((stat) => (
                  <div key={stat.label} className="flex flex-col">
                    <span className="text-[9px] text-outline uppercase tracking-widest mb-1 font-bold">
                      {stat.label}
                    </span>
                    <span className={cn('text-sm font-medium', stat.color)}>{stat.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Locked card */}
          <div className="bg-surface-container-low p-6 rounded-xl opacity-50 border-l-4 border-transparent">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-headline text-xl font-bold text-on-surface">The Sentinel</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase tracking-tighter bg-surface-container-highest text-outline">
                    Locked
                  </span>
                </div>
                <p className="text-sm text-outline">
                  Coming Soon: Distributed SQL performance across geographically separated nodes.
                </p>
              </div>
              <span className="material-symbols-outlined text-outline text-xl shrink-0 ml-4">
                lock
              </span>
            </div>
          </div>
        </div>

        {/* ── Right: leaderboard panel ───────────────────────────── */}
        <div className="xl:col-span-4 flex flex-col gap-5">
          {/* Period tabs */}
          <div className="bg-surface-container-low rounded-xl p-1 flex items-center">
            {PERIOD_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setPeriod(tab.value)}
                className={cn(
                  'flex-1 py-2.5 text-xs font-semibold rounded-lg transition-all',
                  period === tab.value
                    ? 'bg-surface-container-highest text-on-surface'
                    : 'text-outline hover:text-on-surface'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Rankings panel */}
          <div className="bg-surface-container-low rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-surface-container-high flex justify-between items-center">
              <h3 className="font-headline font-bold uppercase tracking-wider text-xs text-on-surface">
                Global Rankings
              </h3>
              <span
                className="material-symbols-outlined text-tertiary text-lg"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                leaderboard
              </span>
            </div>

            <div className="flex-1">
              {isLoading ? (
                <div className="space-y-px">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="px-4 py-3 flex items-center gap-3">
                      <div className="w-6 h-4 bg-surface-container-high rounded animate-pulse" />
                      <div className="w-8 h-8 bg-surface-container-high rounded-full animate-pulse shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-24 bg-surface-container-high rounded animate-pulse" />
                        <div className="h-2 w-16 bg-surface-container-high rounded animate-pulse" />
                      </div>
                      <div className="h-4 w-16 bg-surface-container-high rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : entries.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <span className="material-symbols-outlined text-2xl text-outline mb-2 block">
                    leaderboard
                  </span>
                  <p className="text-xs text-on-surface-variant">No rankings yet.</p>
                </div>
              ) : (
                top5.map((entry) => <RankRow key={entry.userId} entry={entry} />)
              )}
            </div>

            {/* Current user highlight */}
            {entries.length > 0 && (
              <div className="border-t border-outline-variant/10">
                <RankRow
                  entry={{
                    rank: 142,
                    userId: 'me',
                    username: 'you',
                    displayName: 'You',
                    points: 0,
                    challengesCompleted: 0,
                    streak: 0,
                  }}
                  isMe
                />
              </div>
            )}
          </div>

          {/* Challenge completion rates */}
          <div className="bg-surface-container-low rounded-xl p-5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-outline mb-4">
              Completion Rates
            </h3>
            <div className="space-y-3">
              {[
                { label: 'SQL Fundamentals', pct: 57, color: 'bg-secondary' },
                { label: 'Window Functions', pct: 21, color: 'bg-primary' },
                { label: 'CTEs & Subqueries', pct: 16, color: 'bg-tertiary' },
                { label: 'Query Optimization', pct: 6, color: 'bg-error' },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-on-surface-variant">{item.label}</span>
                    <span className="font-mono text-outline">{item.pct}%</span>
                  </div>
                  <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', item.color)}
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

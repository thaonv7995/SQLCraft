'use client';

import type { PassCriterionCheckClient } from '@/lib/api';
import { labelForPassCriterionType } from '@/lib/pass-criterion-labels';
import { cn } from '@/lib/utils';

export function ChallengeAttemptCriteriaChecks({ checks }: { checks: PassCriterionCheckClient[] }) {
  if (checks.length === 0) return null;

  return (
    <ul className="m-0 flex max-w-full min-w-0 list-none flex-nowrap items-stretch justify-start gap-2 overflow-x-auto p-0 pb-0.5 [scrollbar-width:thin]">
      {checks.map((ch, i) => (
        <li key={`${ch.type}-${i}`} className="shrink-0">
          <span
            className={cn(
              'inline-flex max-w-[min(100vw-4rem,22rem)] flex-col gap-0.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium leading-tight',
              ch.passed
                ? 'border-outline-variant bg-green-500/10 text-on-surface'
                : 'border-outline-variant bg-error/10 text-on-surface',
            )}
          >
            <span className="inline-flex min-w-0 items-center gap-1">
              <span
                className={cn(
                  'material-symbols-outlined shrink-0 text-[16px] leading-none',
                  ch.passed ? 'text-green-400' : 'text-error',
                )}
                style={ch.passed ? { fontVariationSettings: "'FILL' 1" } : undefined}
                aria-hidden
              >
                {ch.passed ? 'check_circle' : 'cancel'}
              </span>
              <span className="truncate">{labelForPassCriterionType(ch.type)}</span>
            </span>
            {ch.detail ? (
              <span
                className="line-clamp-2 pl-[22px] text-[10px] font-normal leading-snug text-on-surface-variant"
                title={ch.detail}
              >
                {ch.detail}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

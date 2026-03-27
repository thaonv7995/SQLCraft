'use client';

import type { ChallengeEvaluation, PassCriterionCheckClient } from '@/lib/api';
import { compactPassCriterionChipDetail } from '@/lib/pass-criterion-chip-display';
import { labelForPassCriterionType } from '@/lib/pass-criterion-labels';
import { cn } from '@/lib/utils';

export function ChallengeAttemptCriteriaChecks({
  checks,
  evaluation,
}: {
  checks: PassCriterionCheckClient[];
  /** Used to show threshold-only text when API `detail` is missing or legacy. */
  evaluation?: ChallengeEvaluation | null;
}) {
  if (checks.length === 0) return null;

  return (
    <ul className="m-0 flex max-w-full min-w-0 list-none flex-nowrap items-center justify-start gap-2 overflow-x-auto p-0 py-0.5 [scrollbar-width:thin]">
      {checks.map((ch, i) => {
        const label = labelForPassCriterionType(ch.type);
        const displayDetail = compactPassCriterionChipDetail(ch, evaluation);
        const fullTitle = ch.detail ? `${label}: ${ch.detail}` : label;
        return (
          <li key={`${ch.type}-${i}`} className="min-w-0 max-w-[min(100vw-4rem,20rem)] shrink-0">
            <span
              className={cn(
                'inline-flex w-full min-w-0 max-w-full flex-row items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] leading-tight',
                ch.passed
                  ? 'border-outline-variant/80 bg-surface-container-high/60 text-on-surface'
                  : 'border-outline-variant bg-error/10 text-on-surface',
              )}
              title={fullTitle}
            >
              <span
                className={cn(
                  'material-symbols-outlined shrink-0 text-[15px] leading-none',
                  ch.passed ? 'text-green-400' : 'text-error',
                )}
                style={ch.passed ? { fontVariationSettings: "'FILL' 1" } : undefined}
                aria-hidden
              >
                {ch.passed ? 'check_circle' : 'cancel'}
              </span>
              <span className="min-w-0 truncate font-medium">
                {label}
                {displayDetail ? (
                  <span className="text-[10px] font-normal text-on-surface-variant">
                    : {displayDetail}
                  </span>
                ) : null}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

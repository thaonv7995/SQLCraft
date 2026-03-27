'use client';

import type { ReactNode } from 'react';
import { Check, Table2, Timer, Gauge, Database, Columns3, ListChecks } from 'lucide-react';
import {
  type ChallengePassCriteriaSource,
  type PassCriterionDraft,
  getChallengePassCriteriaExplainerLines,
  passCriteriaDraftsFromConfigReadOnly,
} from '@/lib/challenge-pass-criteria';
import { cn } from '@/lib/utils';

const TYPE_META: Record<
  PassCriterionDraft['type'],
  { label: string; Icon: typeof Timer }
> = {
  max_query_duration_ms: { label: 'Thời gian query tối đa', Icon: Timer },
  max_explain_total_cost: { label: 'EXPLAIN total cost tối đa', Icon: Gauge },
  requires_index_usage: { label: 'Plan phải dùng index', Icon: Check },
  required_output_columns: { label: 'Cột output bắt buộc', Icon: Columns3 },
  required_tables_in_query: { label: 'Bảng trong SQL', Icon: Table2 },
};

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-md bg-surface-container-highest px-2 py-0.5 font-mono text-[11px] text-on-surface ring-1 ring-outline-variant/15',
        className,
      )}
    >
      {children}
    </span>
  );
}

function splitTables(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function CriterionValue({ row }: { row: PassCriterionDraft }) {
  switch (row.type) {
    case 'max_query_duration_ms':
      return (
        <span className="font-mono text-sm font-semibold text-secondary">
          ≤ {row.maxMs.toLocaleString()} ms
        </span>
      );
    case 'max_explain_total_cost':
      return (
        <span className="font-mono text-sm font-semibold text-secondary">
          ≤ {row.maxTotalCost.toLocaleString()}
          <span className="ml-1.5 text-xs font-normal text-on-surface-variant">(EXPLAIN total)</span>
        </span>
      );
    case 'requires_index_usage':
      return (
        <span className="flex items-center gap-1.5 text-sm text-on-surface">
          <Check className="size-4 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
          Bật — plan thực thi phải thể hiện dùng index khi áp dụng
        </span>
      );
    case 'required_output_columns': {
      const groups = row.groups.filter((g) => g.table.trim() || g.columns.length > 0);
      if (groups.length === 0) {
        return <span className="text-sm text-on-surface-variant">—</span>;
      }
      return (
        <div className="flex min-w-0 flex-col gap-2">
          {groups.map((g) => (
            <div key={g.key} className="flex min-w-0 flex-wrap items-center gap-1.5">
              {g.table.trim() ? (
                <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-outline">
                  <Database className="size-3.5 opacity-80" aria-hidden />
                  <span className="font-mono text-on-surface-variant normal-case tracking-normal">
                    {g.table}
                  </span>
                </span>
              ) : null}
              <div className="flex min-w-0 flex-wrap gap-1">
                {g.columns.map((c) => (
                  <Chip key={`${g.key}-${c}`}>{c}</Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    case 'required_tables_in_query': {
      const tables = splitTables(row.tablesRaw);
      if (tables.length === 0) {
        return <span className="text-sm text-on-surface-variant">—</span>;
      }
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {tables.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1',
              row.matchMode === 'any'
                ? 'bg-secondary-container/40 text-on-secondary-container ring-secondary/25'
                : 'bg-primary-container/35 text-on-primary-container ring-primary/20',
            )}
          >
            {row.matchMode === 'any' ? 'Chỉ cần một' : 'Tất cả'}
          </span>
        </div>
      );
    }
    default:
      return null;
  }
}

function CriterionRow({ row }: { row: PassCriterionDraft }) {
  const meta = TYPE_META[row.type];
  const Icon = meta.Icon;

  return (
    <div className="flex min-w-0 flex-col gap-2 border-b border-outline-variant/10 px-3 py-3 last:border-b-0 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:w-[min(42%,200px)]">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-container-highest/80 text-on-surface-variant ring-1 ring-outline-variant/15">
          <Icon className="size-4" strokeWidth={2} aria-hidden />
        </span>
        <span className="text-[11px] font-semibold uppercase leading-snug tracking-[0.12em] text-outline">
          {meta.label}
        </span>
      </div>
      <div className="min-w-0 flex-1 pt-0.5 sm:pt-1">
        <CriterionValue row={row} />
      </div>
    </div>
  );
}

export function ChallengePassCriteriaDisplay({
  validatorConfig,
  explainerSource,
  showExplainer = true,
  className,
  adminNote,
}: {
  validatorConfig?: Record<string, unknown> | null;
  /** Required when `showExplainer` is true (admin detail). */
  explainerSource?: ChallengePassCriteriaSource;
  /** Learner-facing pages hide the long grading narrative. */
  showExplainer?: boolean;
  className?: string;
  /** Shown only in admin detail (e.g. server evaluation note). */
  adminNote?: string;
}) {
  const drafts = passCriteriaDraftsFromConfigReadOnly(validatorConfig);
  const explainerLines =
    showExplainer && explainerSource
      ? getChallengePassCriteriaExplainerLines(explainerSource)
      : [];

  return (
    <div className={cn('space-y-4', className)}>
      {adminNote ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">{adminNote}</p>
      ) : null}

      {drafts.length > 0 ? (
        <div className="overflow-hidden rounded-lg bg-surface-container-high/35 ring-1 ring-outline-variant/20">
          <div className="flex items-center gap-2 border-b border-outline-variant/10 px-3 py-2">
            <ListChecks className="size-4 text-on-surface-variant" strokeWidth={2} aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline">
              Điều kiện pass
            </span>
          </div>
          {drafts.map((row) => (
            <CriterionRow key={row.key} row={row} />
          ))}
          <p className="border-t border-outline-variant/10 bg-surface-container/30 px-3 py-2 text-[11px] leading-snug text-on-surface-variant">
            Tất cả điều kiện trên phải đạt (AND).
          </p>
        </div>
      ) : (
        <p className="rounded-lg bg-surface-container-high/30 px-3 py-2.5 text-sm text-on-surface-variant ring-1 ring-outline-variant/15">
          Chưa cấu hình tiêu chí pass cụ thể trong phiên bản này.
        </p>
      )}

      {showExplainer && explainerLines.length > 0 ? (
        <div className="rounded-lg border border-outline-variant/15 bg-surface-container/50 px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-outline">
            Chi tiết chấm &amp; điểm
          </p>
          <ul className="mt-2 space-y-2.5 text-sm leading-relaxed text-on-surface-variant">
            {explainerLines.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-outline" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

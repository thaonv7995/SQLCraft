'use client';

import * as React from 'react';
import { ChevronDown, Minus } from 'lucide-react';
import { RequiredOutputColumnsPicker } from '@/components/challenge/required-output-columns-picker';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DatabaseTable } from '@/lib/api';
import { type PassCriterionDraft, newPassCriterionDraft } from '@/lib/challenge-pass-criteria';

const CRITERION_TYPE_OPTIONS = [
  { value: 'max_query_duration_ms', label: 'Max query time (ms)' },
  { value: 'max_explain_total_cost', label: 'Max EXPLAIN total cost' },
  { value: 'requires_index_usage', label: 'Require index usage in plan' },
  { value: 'required_output_columns', label: 'Required output columns' },
  { value: 'required_tables_in_query', label: 'Required table(s) in SQL' },
] as const;

function SelectWithChevron({
  className,
  chevronClassName,
  children,
  ...props
}: React.ComponentProps<'select'> & { chevronClassName?: string }) {
  return (
    <div className={cn('relative h-full min-h-10 min-w-0', className)}>
      <select
        className={cn(
          'h-full min-h-10 w-full cursor-pointer appearance-none bg-transparent pl-2.5 pr-9 text-sm text-on-surface outline-none',
          'focus:bg-surface-container-highest/15 disabled:opacity-40',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className={cn(
          'pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-on-surface-variant opacity-85',
          'right-2.5',
          chevronClassName,
        )}
        strokeWidth={2}
        aria-hidden
      />
    </div>
  );
}

function parseTokens(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function serializeTokens(tokens: string[]): string {
  return tokens.join(', ');
}

function ChipTokenField({
  value,
  onChange,
  placeholder,
  'aria-label': ariaLabel,
  className,
  unframed,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  'aria-label': string;
  className?: string;
  unframed?: boolean;
}) {
  const [draft, setDraft] = React.useState('');
  const tokens = parseTokens(value);

  const pushToken = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const lower = t.toLowerCase();
    if (tokens.some((x) => x.toLowerCase() === lower)) {
      setDraft('');
      return;
    }
    onChange(serializeTokens([...tokens, t]));
    setDraft('');
  };

  const removeAt = (index: number) => {
    onChange(serializeTokens(tokens.filter((_, i) => i !== index)));
  };

  return (
    <div
      className={cn(
        'flex min-h-9 min-w-0 w-full flex-wrap items-center gap-1 px-1 py-0.5',
        !unframed &&
          'rounded-lg bg-surface-container-high px-2 py-1 ring-1 ring-outline-variant/20 focus-within:ring-primary/40',
        unframed && 'flex-1',
        className,
      )}
    >
      {tokens.map((tok, i) => (
        <span
          key={`${tok}-${i}`}
          className="inline-flex max-w-full items-center gap-0.5 rounded-md bg-surface-container-highest px-2 py-0.5 font-mono text-xs text-on-surface"
        >
          <span className="truncate">{tok}</span>
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="shrink-0 rounded px-0.5 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            aria-label={`Remove ${tok}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="h-7 min-w-[3rem] flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-outline"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            pushToken(draft);
          }
          if (e.key === ',') {
            e.preventDefault();
            pushToken(draft);
          }
          if (e.key === 'Backspace' && draft === '' && tokens.length > 0) {
            removeAt(tokens.length - 1);
          }
        }}
        placeholder={tokens.length === 0 ? placeholder : ''}
        aria-label={ariaLabel}
      />
    </div>
  );
}

const removeIconButtonClass = cn(
  'pointer-events-auto absolute right-0 top-0 z-20 flex size-[1.375rem] items-center justify-center rounded-full',
  '-translate-y-1/2 translate-x-1/2',
  'border border-red-300/55 bg-surface-container-high text-red-300/95 shadow-sm',
  'transition-colors hover:border-red-300/90 hover:bg-red-500/15 hover:text-red-200',
  'disabled:pointer-events-none disabled:opacity-30',
);

/** Single merged row: criterion type | value, shared border. */
const mergedCriterionRowClass =
  'relative flex w-full min-h-10 items-stretch overflow-visible rounded-lg bg-surface-container-high/80 ring-1 ring-outline-variant/20 focus-within:ring-primary/40';

const valueInputClass =
  'h-9 w-full min-w-0 border-0 bg-transparent px-1 text-sm text-on-surface outline-none placeholder:text-outline focus:ring-0';

export type PassCriteriaSchemaState = 'no-database' | 'loading' | 'error' | 'ready';

export function PassCriteriaEditor({
  rows,
  onChange,
  schemaTables = [],
  schemaState = 'no-database',
}: {
  rows: PassCriterionDraft[];
  onChange: (next: PassCriterionDraft[]) => void;
  /** From GET /databases/:id after admin selects a database */
  schemaTables?: DatabaseTable[];
  schemaState?: PassCriteriaSchemaState;
}) {
  const columnsIdleHint =
    schemaState === 'no-database'
      ? 'Select a database first.'
      : schemaState === 'loading'
        ? 'Loading…'
        : schemaState === 'error'
          ? 'Failed to load schema.'
          : schemaTables.length === 0
            ? 'No tables.'
            : '';

  const columnsPickerTables = schemaState === 'ready' ? schemaTables : [];
  const columnsPickerDisabled = schemaState !== 'ready';
  const updateRow = (key: string, patch: Partial<PassCriterionDraft>) => {
    onChange(
      rows.map((r) => {
        if (r.key !== key) return r;
        return { ...r, ...patch } as PassCriterionDraft;
      }),
    );
  };

  const removeRow = (key: string) => {
    onChange(rows.filter((r) => r.key !== key));
  };

  const changeType = (key: string, type: PassCriterionDraft['type']) => {
    onChange(rows.map((r) => (r.key === key ? newPassCriterionDraft(type, key) : r)));
  };

  return (
    <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low/40 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-on-surface">Pass criteria</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="text-xs shrink-0"
          onClick={() => onChange([...rows, newPassCriterionDraft('max_query_duration_ms')])}
        >
          + Add criterion
        </Button>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className={mergedCriterionRowClass}>
            <button
              type="button"
              onClick={() => removeRow(row.key)}
              disabled={rows.length <= 1}
              className={removeIconButtonClass}
              aria-label="Remove criterion"
              title="Remove"
            >
              <Minus className="size-2.5" strokeWidth={1.75} aria-hidden />
            </button>

            <div className="flex min-w-0 flex-1 items-stretch">
              {/* Left: criterion type */}
              <div className="relative flex w-[min(240px,42%)] max-w-[260px] shrink-0 flex-col justify-center border-r border-outline-variant/25">
                <SelectWithChevron
                  className="min-w-0 flex-1"
                  value={row.type}
                  onChange={(e) => changeType(row.key, e.target.value as PassCriterionDraft['type'])}
                  aria-label="Criterion type"
                >
                  {CRITERION_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </SelectWithChevron>
              </div>

              {/* Right: value */}
              <div
                className={cn(
                  'flex min-w-0 flex-1 gap-2 px-2 py-1.5 pr-8 pt-1',
                  row.type === 'required_output_columns' ? 'items-start' : 'items-center',
                )}
              >
                {row.type === 'max_query_duration_ms' ? (
                  <input
                    type="number"
                    min={1}
                    className={valueInputClass}
                    value={row.maxMs}
                    onChange={(e) => updateRow(row.key, { maxMs: Number(e.target.value) || 0 })}
                    aria-label="Max runtime (ms)"
                    title="Sandbox execution time must be ≤ this value (ms)"
                  />
                ) : null}

                {row.type === 'max_explain_total_cost' ? (
                  <input
                    type="number"
                    min={1}
                    step="any"
                    className={valueInputClass}
                    value={row.maxTotalCost}
                    onChange={(e) =>
                      updateRow(row.key, { maxTotalCost: Number(e.target.value) || 0 })
                    }
                    aria-label="Max total cost (EXPLAIN)"
                    title="PostgreSQL planner total cost from EXPLAIN"
                  />
                ) : null}

                {row.type === 'requires_index_usage' ? (
                  <span
                    className="flex min-h-9 w-full items-center text-xs text-on-surface-variant"
                    title="Plan must use an index"
                  >
                    Plan uses index
                  </span>
                ) : null}

                {row.type === 'required_output_columns' ? (
                  <RequiredOutputColumnsPicker
                    groups={row.groups}
                    onChange={(groups) => updateRow(row.key, { groups })}
                    tables={columnsPickerTables}
                    disabled={columnsPickerDisabled}
                    idleHint={columnsIdleHint}
                  />
                ) : null}

                {row.type === 'required_tables_in_query' ? (
                  <>
                    <ChipTokenField
                      unframed
                      className="min-w-0 flex-1"
                      value={row.tablesRaw}
                      onChange={(next) => updateRow(row.key, { tablesRaw: next })}
                      placeholder="orders"
                      aria-label="Add table name, Enter to add chip"
                    />
                    <div className="h-8 w-px shrink-0 bg-outline-variant/25" aria-hidden />
                    <SelectWithChevron
                      className="w-[124px] shrink-0"
                      chevronClassName="right-2"
                      value={row.matchMode}
                      onChange={(e) =>
                        updateRow(row.key, { matchMode: e.target.value as 'all' | 'any' })
                      }
                      aria-label="Table match mode"
                      title="all = every table must appear in FROM/JOIN; any = at least one"
                    >
                      <option value="all">All tables</option>
                      <option value="any">Any table</option>
                    </SelectWithChevron>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

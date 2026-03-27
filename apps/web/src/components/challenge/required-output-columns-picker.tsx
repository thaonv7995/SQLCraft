'use client';

import * as React from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import type { DatabaseTable } from '@/lib/api';
import {
  type RequiredOutputColumnGroup,
  newRequiredOutputColumnGroup,
} from '@/lib/challenge-pass-criteria';
import { cn } from '@/lib/utils';

function patchGroup(
  groups: RequiredOutputColumnGroup[],
  gKey: string,
  patch: Partial<Pick<RequiredOutputColumnGroup, 'table' | 'columns'>>,
): RequiredOutputColumnGroup[] {
  return groups.map((g) => (g.key === gKey ? { ...g, ...patch } : g));
}

export function RequiredOutputColumnsPicker({
  groups,
  onChange,
  tables,
  disabled,
  idleHint,
}: {
  groups: RequiredOutputColumnGroup[];
  onChange: (next: RequiredOutputColumnGroup[]) => void;
  tables: DatabaseTable[];
  disabled?: boolean;
  idleHint: string;
}) {
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState('');

  const rootRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());

  const openGroup = openKey ? groups.find((g) => g.key === openKey) : undefined;
  const schemaTable = openGroup?.table
    ? tables.find((t) => t.name === openGroup.table)
    : undefined;

  React.useEffect(() => {
    setFilter('');
  }, [openKey]);

  React.useEffect(() => {
    if (!openKey) return;
    const onDoc = (e: MouseEvent) => {
      const el = rootRefs.current.get(openKey);
      if (el && !el.contains(e.target as Node)) {
        setOpenKey(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [openKey]);

  const toggleColumn = (gKey: string, schemaColName: string) => {
    if (disabled) return;
    const g = groups.find((x) => x.key === gKey);
    if (!g) return;
    const lower = schemaColName.toLowerCase();
    const idx = g.columns.findIndex((c) => c.toLowerCase() === lower);
    if (idx >= 0) {
      onChange(
        patchGroup(groups, gKey, {
          columns: g.columns.filter((_, i) => i !== idx),
        }),
      );
    } else {
      onChange(
        patchGroup(groups, gKey, {
          columns: [...g.columns, schemaColName],
        }),
      );
    }
  };

  const removeColumn = (gKey: string, col: string) => {
    const g = groups.find((x) => x.key === gKey);
    if (!g) return;
    onChange(
      patchGroup(groups, gKey, {
        columns: g.columns.filter((c) => c !== col),
      }),
    );
  };

  const setTable = (gKey: string, tableName: string) => {
    onChange(patchGroup(groups, gKey, { table: tableName, columns: [] }));
  };

  const addGroupRow = () => {
    onChange([...groups, newRequiredOutputColumnGroup()]);
  };

  const removeGroupRow = (gKey: string) => {
    if (groups.length <= 1) return;
    onChange(groups.filter((g) => g.key !== gKey));
    if (openKey === gKey) setOpenKey(null);
  };

  const filteredColumns =
    schemaTable?.columns.filter((c) => {
      const q = filter.trim().toLowerCase();
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) || (c.type ?? '').toLowerCase().includes(q)
      );
    }) ?? [];

  if (tables.length === 0) {
    return (
      <p className="text-xs text-on-surface-variant leading-snug" role="status">
        {idleHint}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 w-full flex-col gap-1">
      {groups.map((g, i) => {
        const table = g.table ? tables.find((t) => t.name === g.table) : undefined;
        const columnControlDisabled = !g.table || disabled;
        const isLast = i === groups.length - 1;

        return (
          <div
            key={g.key}
            className="flex min-w-0 w-full flex-wrap items-center gap-1.5"
          >
            <select
              className={cn(
                'h-9 max-w-[140px] shrink-0 rounded-md bg-surface-container-highest/50 px-2 text-sm text-on-surface',
                'ring-1 ring-outline-variant/25 outline-none focus:ring-primary/40',
                disabled && 'opacity-50',
              )}
              value={g.table}
              disabled={disabled}
              onChange={(e) => setTable(g.key, e.target.value)}
              aria-label="Bảng"
            >
              <option value="">Bảng…</option>
              {tables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>

            <div
              ref={(el) => {
                if (el) rootRefs.current.set(g.key, el);
                else rootRefs.current.delete(g.key);
              }}
              className={cn(
                'relative min-w-0 flex-1',
                columnControlDisabled && 'pointer-events-none opacity-50',
              )}
            >
              <button
                type="button"
                disabled={columnControlDisabled}
                aria-expanded={openKey === g.key}
                onClick={() => g.table && setOpenKey((k) => (k === g.key ? null : g.key))}
                className={cn(
                  'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md bg-surface-container-highest/50 px-1.5 py-1 text-left',
                  'ring-1 ring-outline-variant/25 outline-none transition-colors',
                  'hover:bg-surface-container-highest/70 focus-visible:ring-primary/40',
                  openKey === g.key && 'ring-primary/35',
                  columnControlDisabled && 'cursor-not-allowed',
                )}
              >
                {g.columns.length === 0 ? (
                  <span className="px-0.5 text-xs text-on-surface-variant">Cột…</span>
                ) : (
                  g.columns.map((col) => (
                    <span
                      key={col}
                      className="inline-flex max-w-full items-center gap-0.5 rounded bg-surface-container-highest px-1.5 py-0.5 font-mono text-[11px] text-on-surface"
                    >
                      <span className="truncate">{col}</span>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeColumn(g.key, col);
                        }}
                        className="shrink-0 rounded px-0.5 text-on-surface-variant hover:text-on-surface"
                        aria-label={`Xóa ${col}`}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
                <ChevronDown
                  className={cn(
                    'ml-auto size-4 shrink-0 text-on-surface-variant',
                    openKey === g.key && 'rotate-180',
                  )}
                  strokeWidth={2}
                  aria-hidden
                />
              </button>

              {openKey === g.key && table ? (
                <div
                  className={cn(
                    'absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md',
                    'border border-outline-variant/25 bg-surface-container-high shadow-lg',
                  )}
                  role="listbox"
                  aria-multiselectable="true"
                >
                  <div className="border-b border-outline-variant/15 p-1.5">
                    <input
                      type="search"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Lọc…"
                      className={cn(
                        'h-8 w-full rounded border-0 bg-surface-container-highest/50 px-2 text-xs text-on-surface',
                        'outline-none ring-1 ring-outline-variant/20 focus:ring-primary/40',
                      )}
                      autoFocus
                      aria-label="Lọc cột"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto py-1">
                    {filteredColumns.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-on-surface-variant">Không khớp.</p>
                    ) : (
                      filteredColumns.map((col) => {
                        const selected = g.columns.some(
                          (c) => c.toLowerCase() === col.name.toLowerCase(),
                        );
                        return (
                          <label
                            key={col.name}
                            className="flex cursor-pointer items-start gap-2 px-2 py-1.5 text-xs hover:bg-surface-container-highest/50"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 rounded border-outline-variant text-primary"
                              checked={selected}
                              disabled={disabled}
                              onChange={() => toggleColumn(g.key, col.name)}
                            />
                            <span className="min-w-0 font-mono text-on-surface">{col.name}</span>
                            <span className="text-on-surface-variant">{col.type}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {groups.length > 1 ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeGroupRow(g.key)}
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-md text-on-surface-variant',
                  'ring-1 ring-outline-variant/20 hover:bg-surface-container-highest hover:text-on-surface',
                  disabled && 'opacity-40',
                )}
                aria-label="Xóa dòng bảng"
                title="Xóa dòng"
              >
                <Minus className="size-4" strokeWidth={2} />
              </button>
            ) : null}

            {isLast ? (
              <button
                type="button"
                disabled={disabled}
                onClick={addGroupRow}
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-md text-on-surface-variant',
                  'ring-1 ring-outline-variant/20 hover:bg-surface-container-highest hover:text-primary',
                  disabled && 'opacity-40',
                )}
                aria-label="Thêm bảng"
                title="Thêm bảng"
              >
                <Plus className="size-4" strokeWidth={2} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactCodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { schemaCompletionSource, sql, PostgreSQL, type SQLNamespace } from '@codemirror/lang-sql';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { Prec } from '@codemirror/state';
import { cn } from '@/lib/utils';

// ─── Design System Theme ──────────────────────────────────────────────────────
const sqlForgeTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#1a1a1a',
      height: '100%',
      color: '#ececec',
    },
    '.cm-content': {
      fontFamily: 'var(--font-jetbrains-mono), "JetBrains Mono", monospace',
      fontSize: '13px',
      lineHeight: '1.6',
      caretColor: '#ececec',
      padding: '12px 0',
    },
    '.cm-line': {
      padding: '0 12px',
    },
    '.cm-cursor': {
      borderLeftColor: '#ececec',
      borderLeftWidth: '2px',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(255, 255, 255, 0.12) !important',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.025)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255, 255, 255, 0.025)',
      color: '#9ca3af',
    },
    '.cm-gutters': {
      backgroundColor: '#1a1a1a',
      borderRight: 'none',
      color: '#6b7280',
      minWidth: '40px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 4px',
      minWidth: '32px',
      textAlign: 'right',
    },
    '.cm-foldGutter': {
      width: '12px',
    },
    '.cm-scroller': {
      overflowX: 'auto',
    },
    // SQL syntax highlighting using design system colors
    '.tok-keyword': { color: '#ececec', fontWeight: '600' },
    '.tok-string': { color: '#a3a3a3' },
    '.tok-number': { color: '#9ca3af' },
    '.tok-comment': { color: '#6b7280', fontStyle: 'italic' },
    '.tok-name': { color: '#ececec' },
    '.tok-typeName': { color: '#c4c4c4' },
    '.tok-variableName': { color: '#9ca3af' },
    '.tok-operator': { color: '#9ca3af' },
    '.tok-punctuation': { color: '#6b7280' },
    '.tok-invalid': { color: '#c4a8a8', textDecoration: 'underline' },
    // Placeholder
    '.cm-placeholder': {
      color: '#6b7280',
      fontStyle: 'italic',
    },
  },
  { dark: true }
);

// ─── Component ────────────────────────────────────────────────────────────────

export interface SqlEditorSchemaColumn {
  name: string;
  type?: string;
  isPrimary?: boolean;
  isForeign?: boolean;
  references?: string;
}

export interface SqlEditorSchemaTable {
  name: string;
  columns: SqlEditorSchemaColumn[];
}

type SchemaCompletion = {
  label: string;
  type: 'table' | 'property';
  detail?: string;
  info?: string;
  boost?: number;
  section?: {
    name: string;
    rank: number;
  };
};

type SqlNamespaceTag = {
  self: SchemaCompletion;
  children: SQLNamespace;
};

function isNamespaceTag(value: unknown): value is SqlNamespaceTag {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'self' in value;
}

const TABLE_COMPLETION_SECTION = {
  name: 'Tables',
  rank: 1,
} as const;

const FIELD_COMPLETION_SECTION = {
  name: 'Fields',
  rank: 0,
} as const;

type SqlCompletionContextKind = 'table' | 'field' | 'any';

type SqlCompletionResult = {
  from: number;
  to?: number;
  options: readonly SchemaCompletion[];
  validFor?: RegExp | ((text: string, from: number, to: number, state: unknown) => boolean);
  filter?: boolean;
  getMatch?: (completion: SchemaCompletion, matched?: readonly number[]) => readonly number[];
  update?: (
    current: SqlCompletionResult,
    from: number,
    to: number,
    context: { state: { doc: { toString(): string } }; pos: number },
  ) => SqlCompletionResult | null;
  map?: unknown;
  commitCharacters?: readonly string[];
};

function buildColumnDetail(column: SqlEditorSchemaColumn): string | undefined {
  const parts = [column.type, column.isPrimary ? 'PK' : null, column.isForeign ? 'FK' : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function buildColumnCompletion(column: SqlEditorSchemaColumn, info?: string): SchemaCompletion {
  return {
    label: column.name,
    type: 'property',
    detail: buildColumnDetail(column),
    info,
    boost: column.isPrimary ? 100 : column.isForeign ? 98 : 96,
    section: FIELD_COMPLETION_SECTION,
  };
}

function buildTableNamespace(table: SqlEditorSchemaTable): SqlNamespaceTag {
  return {
    self: {
      label: table.name,
      type: 'table',
      detail: `${table.columns.length} cols`,
      boost: 99,
      section: TABLE_COMPLETION_SECTION,
    },
    children: table.columns.map((column) =>
      buildColumnCompletion(
        column,
        column.references ? `${table.name}.${column.name} → ${column.references}` : `${table.name}.${column.name}`,
      ),
    ),
  };
}

function buildTopLevelColumnNamespace(tables: readonly SqlEditorSchemaTable[]): Record<string, SqlNamespaceTag> {
  const columns = new Map<
    string,
    {
      sample: SqlEditorSchemaColumn;
      tables: string[];
    }
  >();

  for (const table of tables) {
    for (const column of table.columns) {
      const existing = columns.get(column.name);

      if (existing) {
        existing.tables.push(table.name);
        continue;
      }

      columns.set(column.name, {
        sample: column,
        tables: [table.name],
      });
    }
  }

  return Object.fromEntries(
    Array.from(columns.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([columnName, entry]) => [
        columnName,
        {
          self: buildColumnCompletion(
            entry.sample,
            entry.tables.length === 1
              ? `Available in ${entry.tables[0]}`
              : `Available in ${entry.tables.join(', ')}`,
          ),
          children: [],
        },
      ]),
  );
}

function buildCompletionSchema(schema?: readonly SqlEditorSchemaTable[]): SQLNamespace | undefined {
  if (!schema || schema.length === 0) {
    return undefined;
  }

  const namespace: Record<string, SQLNamespace> = {
    ...buildTopLevelColumnNamespace(schema),
  };

  for (const table of schema) {
    namespace[table.name] = buildTableNamespace(table);
  }

  return namespace;
}

function getSqlCompletionContext(value: string, cursor = value.length): SqlCompletionContextKind {
  const beforeCursor = value.slice(0, cursor);
  const currentIdentifierMatch = /(?:"[^"]*"|`[^`]*`|\[[^\]]*\]|[a-z_][\w$]*)?$/i.exec(beforeCursor);
  const contextBeforeIdentifier = currentIdentifierMatch
    ? beforeCursor.slice(0, currentIdentifierMatch.index)
    : beforeCursor;
  const trimmedContext = contextBeforeIdentifier.trimEnd();

  if (/(?:"[^"]*"|`[^`]*`|\[[^\]]*\]|[a-z_][\w$]*)\.\s*$/i.test(trimmedContext)) {
    return 'field';
  }

  if (
    /\b(?:from|join|update|into|table)\s+$/i.test(contextBeforeIdentifier) ||
    /\bdelete\s+from\s+$/i.test(contextBeforeIdentifier) ||
    /\btruncate(?:\s+table)?\s+$/i.test(contextBeforeIdentifier)
  ) {
    return 'table';
  }

  return 'any';
}

function filterCompletionOptionsForContext(
  options: readonly SchemaCompletion[],
  context: SqlCompletionContextKind,
): readonly SchemaCompletion[] {
  if (context === 'table') {
    return options.filter((option) => option.type === 'table');
  }

  if (context === 'field') {
    return options.filter((option) => option.type === 'property');
  }

  return options;
}

function filterCompletionResultForContext(
  result: SqlCompletionResult | null,
  context: SqlCompletionContextKind,
): SqlCompletionResult | null {
  if (!result) {
    return null;
  }

  const options = filterCompletionOptionsForContext(result.options, context);

  if (options.length === result.options.length) {
    return result;
  }

  if (options.length === 0) {
    return null;
  }

  return {
    ...result,
    options,
  };
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return !!value && typeof value === 'object' && 'then' in value && typeof value.then === 'function';
}

function buildSqlSchemaCompletionSource(schema?: SQLNamespace) {
  if (!schema) {
    return () => null;
  }

  const source = schemaCompletionSource({
    dialect: PostgreSQL,
    schema,
  });

  return (context: {
    state: {
      doc: {
        toString(): string;
      };
    };
    pos: number;
  }) => {
    const completionContext = getSqlCompletionContext(context.state.doc.toString(), context.pos);
    const result = source(context as never);

    if (isPromiseLike<SqlCompletionResult | null>(result)) {
      return result.then((resolved) => filterCompletionResultForContext(resolved, completionContext));
    }

    return filterCompletionResultForContext(result as SqlCompletionResult | null, completionContext);
  };
}

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute?: () => void;
  onFormat?: () => void;
  onCopy?: () => void;
  onClear?: () => void;
  notice?: 'success' | 'error' | 'info' | null;
  /** Shown when notice is error; click icon to expand */
  noticeMessage?: string | null;
  onDismissErrorNotice?: () => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  testId?: string;
  schema?: readonly SqlEditorSchemaTable[];
}

export function SqlEditor({
  value,
  onChange,
  onExecute,
  onFormat,
  onCopy,
  onClear,
  notice = null,
  noticeMessage = null,
  onDismissErrorNotice,
  placeholder = '-- Write your SQL query here...',
  readOnly = false,
  className,
  testId,
  schema,
}: SqlEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const errorPanelRef = useRef<HTMLDivElement>(null);
  const [errorDetailOpen, setErrorDetailOpen] = useState(false);
  const completionSchema = buildCompletionSchema(schema);

  useEffect(() => {
    if (!errorDetailOpen) {
      return;
    }
    const onDocMouseDown = (event: MouseEvent) => {
      const el = errorPanelRef.current;
      if (el && !el.contains(event.target as Node)) {
        setErrorDetailOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setErrorDetailOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [errorDetailOpen]);

  const extensions = useCallback(() => {
    const exts = [
      sql({ dialect: PostgreSQL }),
      sqlForgeTheme,
      EditorView.lineWrapping,
      keymap.of([indentWithTab, ...defaultKeymap]),
    ];

    if (completionSchema) {
      exts.push(
        PostgreSQL.language.data.of({
          autocomplete: buildSqlSchemaCompletionSource(completionSchema),
        }),
      );
    }

    if (onExecute) {
      exts.push(
        Prec.high(
          keymap.of([
            {
              key: 'Ctrl-Enter',
              mac: 'Cmd-Enter',
              run: () => {
                onExecute();
                return true;
              },
            },
          ])
        )
      );
    }

    return exts;
  }, [completionSchema, onExecute]);

  const hasActions = onFormat || onCopy || onClear;

  if (notice !== 'error' && errorDetailOpen) {
    setErrorDetailOpen(false);
  }

  return (
    <div data-testid={testId} className={`relative h-full overflow-hidden bg-[#1a1a1a] ${className ?? ''}`}>
      <ReactCodeMirror
        ref={editorRef}
        value={value}
        onChange={onChange}
        extensions={extensions()}
        theme="dark"
        readOnly={readOnly}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: false,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          searchKeymap: true,
          completionKeymap: true,
          lintKeymap: true,
        }}
        style={{ height: '100%' }}
        height="100%"
      />

      {/* Inline editor actions — bottom-right inside input */}
      {hasActions && (
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1">
          {onFormat && (
            <button
              type="button"
              onClick={onFormat}
              disabled={!value.trim()}
              title="Format SQL (Shift+Alt+F)"
              className="flex items-center gap-1 rounded-md bg-[#2a2a2a]/90 border border-white/10 px-2 py-1 text-[11px] font-medium text-white/60 hover:text-white hover:bg-[#333]/90 transition-colors disabled:opacity-30 backdrop-blur-sm"
            >
              <span className="material-symbols-outlined text-sm">format_align_left</span>
              Format
            </button>
          )}
          {onCopy && (
            <button
              type="button"
              onClick={onCopy}
              disabled={!value.trim()}
              title="Copy query to clipboard"
              className="flex items-center gap-1 rounded-md bg-[#2a2a2a]/90 border border-white/10 px-2 py-1 text-[11px] font-medium text-white/60 hover:text-white hover:bg-[#333]/90 transition-colors disabled:opacity-30 backdrop-blur-sm"
            >
              <span className="material-symbols-outlined text-sm">content_copy</span>
              Copy
            </button>
          )}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              disabled={!value.trim()}
              title="Clear editor and results"
              className="flex items-center gap-1 rounded-md bg-[#2a2a2a]/90 border border-white/10 px-2 py-1 text-[11px] font-medium text-white/60 hover:text-white hover:bg-[#333]/90 transition-colors disabled:opacity-30 backdrop-blur-sm"
            >
              <span className="material-symbols-outlined text-sm">delete_sweep</span>
              Clear
            </button>
          )}
        </div>
      )}

      {notice && (
        <div
          className={cn(
            'absolute right-3 top-3 z-20 flex flex-col items-end gap-1.5',
            notice === 'error' ? 'pointer-events-auto' : 'pointer-events-none',
          )}
        >
          {notice === 'error' ? (
            <div ref={errorPanelRef} className="flex flex-col items-end gap-1.5">
              <button
                type="button"
                onClick={() => setErrorDetailOpen((open) => !open)}
                className={[
                  'inline-flex h-5 w-5 items-center justify-center rounded-full border backdrop-blur-sm transition-colors',
                  'border-error/30 bg-error/15 text-error hover:bg-error/25',
                ].join(' ')}
                aria-label={errorDetailOpen ? 'Ẩn chi tiết lỗi' : 'Xem chi tiết lỗi'}
                aria-expanded={errorDetailOpen}
              >
                <span className="material-symbols-outlined text-[12px]">error</span>
              </button>
              {errorDetailOpen ? (
                <div
                  role="region"
                  aria-label="Thông báo lỗi"
                  className="w-[min(100vw-2rem,22rem)] max-h-48 overflow-auto rounded-lg border border-error/25 bg-[#252525] p-3 text-left shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
                >
                  <p className="text-[11px] font-medium uppercase tracking-wide text-error/90">
                    Lỗi thực thi
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-red-100/90">
                    {noticeMessage?.trim() || 'Không có chi tiết lỗi.'}
                  </pre>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setErrorDetailOpen(false)}
                      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
                    >
                      Thu gọn
                    </button>
                    {onDismissErrorNotice ? (
                      <button
                        type="button"
                        onClick={() => {
                          setErrorDetailOpen(false);
                          onDismissErrorNotice();
                        }}
                        className="rounded-md border border-error/30 bg-error/10 px-2 py-1 text-[11px] text-error hover:bg-error/20"
                      >
                        Ẩn icon
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <span
              className={[
                'inline-flex h-5 w-5 items-center justify-center rounded-full border backdrop-blur-sm',
                notice === 'success'
                  ? 'border-green-500/40 bg-green-500/20 text-green-400'
                  : 'border-outline-variant/30 bg-surface-container/80 text-on-surface-variant',
              ].join(' ')}
              aria-label={notice}
            >
              <span className="material-symbols-outlined text-[12px]">
                {notice === 'success' ? 'check' : 'info'}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const __private__ = {
  buildCompletionSchema,
  buildSqlSchemaCompletionSource,
  filterCompletionOptionsForContext,
  getSqlCompletionContext,
  isNamespaceTag,
};

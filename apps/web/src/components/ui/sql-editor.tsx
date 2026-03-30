'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactCodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { autocompletion } from '@codemirror/autocomplete';
import { schemaCompletionSource, sql, PostgreSQL, type SQLNamespace } from '@codemirror/lang-sql';
import { syntaxTree } from '@codemirror/language';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { Prec, type EditorState, type Text } from '@codemirror/state';
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
    '.tok-keyword': {
      color: '#ececec',
      fontWeight: '600',
      textTransform: 'uppercase',
      fontVariantLigatures: 'none',
    },
    '.tok-string': { color: '#a3a3a3' },
    '.tok-number': { color: '#9ca3af' },
    '.tok-comment': { color: '#6b7280', fontStyle: 'italic' },
    '.tok-name': { color: '#ececec' },
    '.tok-typeName': { color: '#c4c4c4', textTransform: 'uppercase', fontVariantLigatures: 'none' },
    '.tok-variableName': { color: '#9ca3af' },
    '.tok-operator': { color: '#9ca3af' },
    '.tok-punctuation': { color: '#6b7280' },
    '.tok-invalid': { color: '#c4a8a8', textDecoration: 'underline' },
    // Placeholder
    '.cm-placeholder': {
      color: '#6b7280',
      fontStyle: 'italic',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      maxHeight: 'min(50vh, 280px)',
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

const SNIPPET_SECTION = { name: 'Snippets', rank: -1 } as const;
const KEYWORD_SECTION = { name: 'SQL keywords', rank: 2 } as const;
const TYPE_SECTION = { name: 'Types', rank: 3 } as const;
const BUILTIN_SECTION = { name: 'Built-ins', rank: 4 } as const;

/** High-signal clause / DML keywords — boosted so they rank above schema identifiers when both match. */
const PG_CLAUSE_KEYWORDS = new Set(
  [
    'select',
    'insert',
    'update',
    'delete',
    'with',
    'create',
    'drop',
    'alter',
    'truncate',
    'from',
    'where',
    'join',
    'inner',
    'left',
    'right',
    'full',
    'cross',
    'on',
    'and',
    'or',
    'not',
    'group',
    'by',
    'order',
    'having',
    'limit',
    'offset',
    'fetch',
    'union',
    'all',
    'distinct',
    'except',
    'intersect',
    'case',
    'when',
    'then',
    'else',
    'end',
    'as',
    'into',
    'values',
    'set',
    'returning',
    'exists',
    'in',
    'between',
    'like',
    'ilike',
    'is',
    'null',
    'true',
    'false',
    'primary',
    'key',
    'foreign',
    'references',
    'constraint',
    'unique',
    'check',
    'default',
    'index',
    'table',
    'view',
    'if',
    'exists',
    'cascade',
    'restrict',
    'using',
    'explain',
    'analyze',
    'grant',
    'revoke',
    'asc',
    'desc',
    'nulls',
    'filter',
    'over',
    'partition',
    'window',
    'recursive',
    'vacuum',
    'commit',
    'rollback',
    'begin',
  ].map((w) => w.toLowerCase()),
);

function postgresKeywordCompletion(label: string, type: string) {
  const lower = label.toLowerCase();
  const section =
    type === 'type'
      ? TYPE_SECTION
      : type === 'variable'
        ? BUILTIN_SECTION
        : KEYWORD_SECTION;

  let boost = 74;
  if (type === 'type') {
    boost = 86;
  } else if (type === 'variable') {
    boost = 82;
  } else if (type === 'keyword' && PG_CLAUSE_KEYWORDS.has(lower)) {
    boost = 92;
  }

  return {
    label,
    type,
    boost,
    section,
    /** Prefer clause keywords when typing partial word (e.g. `sel` → SELECT). */
    sortText: type === 'keyword' ? lower : label,
  };
}

/** Snippet row shape (mirrors @codemirror/autocomplete Completion fields we use). */
type SqlSnippetCompletion = {
  label: string;
  type: 'keyword';
  detail: string;
  boost: number;
  section: typeof SNIPPET_SECTION;
  apply: string;
};

/**
 * Like @codemirror/autocomplete `prefixMatch`, for labels that are not plain \w+ (e.g. "SELECT * FROM …").
 */
function snippetPrefixMatch(options: readonly { label: string }[]): [RegExp, RegExp] {
  const first = Object.create(null) as Record<string, boolean>;
  const rest = Object.create(null) as Record<string, boolean>;
  for (const { label } of options) {
    if (!label.length) continue;
    first[label[0]!] = true;
    for (let i = 1; i < label.length; i++) {
      rest[label[i]!] = true;
    }
  }
  const toSet = (chars: Record<string, boolean>) => {
    const flat = Object.keys(chars).join('');
    const words = /\w/.test(flat);
    const stripped = words ? flat.replace(/\w/g, '') : flat;
    return `[${words ? '\\w' : ''}${stripped.replace(/[^\w\s]/g, '\\$&')}]`;
  };
  const source = toSet(first) + toSet(rest) + '*$';
  return [new RegExp(`^${source}`), new RegExp(source)];
}

const SNIPPET_BLOCK_SYNTAX_NODES = new Set([
  'QuotedIdentifier',
  'String',
  'LineComment',
  'BlockComment',
]);

const SQL_SNIPPETS: readonly SqlSnippetCompletion[] = [
  {
    label: 'SELECT * FROM …',
    type: 'keyword',
    detail: 'Snippet',
    boost: 96,
    section: SNIPPET_SECTION,
    apply: 'SELECT *\nFROM ',
  },
  {
    label: 'SELECT COUNT(*) …',
    type: 'keyword',
    detail: 'Snippet',
    boost: 95,
    section: SNIPPET_SECTION,
    apply: 'SELECT COUNT(*)\nFROM ',
  },
  {
    label: 'INSERT INTO … VALUES',
    type: 'keyword',
    detail: 'Snippet',
    boost: 94,
    section: SNIPPET_SECTION,
    apply: 'INSERT INTO ',
  },
  {
    label: 'WHERE …',
    type: 'keyword',
    detail: 'Snippet',
    boost: 90,
    section: SNIPPET_SECTION,
    apply: 'WHERE ',
  },
  {
    label: 'LEFT JOIN … ON',
    type: 'keyword',
    detail: 'Snippet',
    boost: 93,
    section: SNIPPET_SECTION,
    apply: 'LEFT JOIN ',
  },
  {
    label: 'GROUP BY …',
    type: 'keyword',
    detail: 'Snippet',
    boost: 91,
    section: SNIPPET_SECTION,
    apply: 'GROUP BY ',
  },
  {
    label: 'ORDER BY …',
    type: 'keyword',
    detail: 'Snippet',
    boost: 91,
    section: SNIPPET_SECTION,
    apply: 'ORDER BY ',
  },
];

/**
 * Snippet completions without importing `@codemirror/autocomplete` (avoids Next/Turbopack resolution issues).
 */
function sqlSnippetCompletionSource(context: {
  pos: number;
  state: EditorState;
  explicit: boolean;
  matchBefore: (expr: RegExp) => { from: number; text: string } | null;
}): { from: number; options: readonly SqlSnippetCompletion[]; validFor: RegExp } | null {
  type WalkNode = { name: string; type: { isTop: boolean }; parent: WalkNode | null };
  let node: WalkNode | null = syntaxTree(context.state).resolveInner(context.pos, -1) as WalkNode;
  while (node) {
    if (SNIPPET_BLOCK_SYNTAX_NODES.has(node.name)) {
      return null;
    }
    if (node.type.isTop) {
      break;
    }
    node = node.parent;
  }

  const options = SQL_SNIPPETS;
  const allWordLabels = options.every((o) => /^\w+$/.test(o.label));
  const [validFor, match] = allWordLabels ? [/\w*$/, /\w+$/] : snippetPrefixMatch(options);
  const token = context.matchBefore(match);
  if (!token && !context.explicit) {
    return null;
  }
  return { from: token ? token.from : context.pos, options, validFor };
}

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
    boost: column.isPrimary ? 58 : column.isForeign ? 56 : 52,
    section: FIELD_COMPLETION_SECTION,
  };
}

function buildTableNamespace(table: SqlEditorSchemaTable): SqlNamespaceTag {
  return {
    self: {
      label: table.name,
      type: 'table',
      detail: `${table.columns.length} cols`,
      boost: 64,
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

  if (/\breturning\s*$/i.test(trimmedContext)) {
    return 'field';
  }

  if (/\bupdate\s+[\w.]+\s+set\s*$/i.test(trimmedContext)) {
    return 'field';
  }

  // FROM a, | FROM a ,  → next token is a table
  if (/\bfrom\b/i.test(trimmedContext) && /,\s*$/i.test(trimmedContext)) {
    return 'table';
  }

  // … JOIN (incl. OUTER / NATURAL / CROSS)  → table name
  if (
    /\b(?:(?:inner|cross)\s+join|(?:left|right|full)(?:\s+outer)?\s+join|natural\s+join|join)\s+$/i.test(
      trimmedContext,
    )
  ) {
    return 'table';
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

/**
 * True when the cursor is still inside the first token of the current statement
 * (statement = line segment after the last `;` on this line).
 * Used to avoid fuzzy-matching column/table names against DDL/DML prefixes like `create`.
 */
function isFirstTokenOfStatement(doc: Text, pos: number): boolean {
  const line = doc.lineAt(pos);
  const beforeCursor = doc.sliceString(line.from, pos);
  const lastSemi = beforeCursor.lastIndexOf(';');
  const afterStmt = lastSemi >= 0 ? beforeCursor.slice(lastSemi + 1) : beforeCursor;
  const trimmed = afterStmt.trimStart();
  if (!trimmed) {
    return true;
  }
  return !/\s/.test(trimmed);
}

/**
 * At the first token, CodeMirror’s default fuzzy matcher surfaces irrelevant columns (e.g. `discharge_date`
 * for input `create`). Require case-insensitive prefix match for schema table/column options.
 */
function strictPrefixSchemaAtStatementStart(
  result: SqlCompletionResult | null,
  doc: Text,
  pos: number,
): SqlCompletionResult | null {
  if (!result || !isFirstTokenOfStatement(doc, pos)) {
    return result;
  }

  const from = result.from;
  const prefix = doc.sliceString(from, pos).toLowerCase();

  const options = result.options.filter((opt) => {
    const t = opt.type;
    if (t !== 'property' && t !== 'table') {
      return true;
    }
    if (!prefix.length) {
      return t === 'table';
    }
    return opt.label.toLowerCase().startsWith(prefix);
  });

  if (options.length === 0) {
    return null;
  }
  if (options.length === result.options.length) {
    return result;
  }
  return { ...result, options };
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

  return (context: { state: EditorState; pos: number }) => {
    const doc = context.state.doc;
    const completionContext = getSqlCompletionContext(doc.toString(), context.pos);
    const result = source(context as never);

    const pipe = (resolved: SqlCompletionResult | null) =>
      strictPrefixSchemaAtStatementStart(
        filterCompletionResultForContext(resolved, completionContext),
        doc,
        context.pos,
      );

    if (isPromiseLike<SqlCompletionResult | null>(result)) {
      return result.then(pipe);
    }

    return pipe(result as SqlCompletionResult | null);
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
      sql({
        dialect: PostgreSQL,
        keywordCompletion: postgresKeywordCompletion,
        /** Inserted keyword completions use UPPERCASE (library passes uppercase labels when true). */
        upperCaseKeywords: true,
      }),
      autocompletion({
        activateOnTyping: true,
        activateOnTypingDelay: 80,
        maxRenderedOptions: 56,
        selectOnOpen: true,
      }),
      PostgreSQL.language.data.of({
        autocomplete: sqlSnippetCompletionSource,
      }),
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
                aria-label={errorDetailOpen ? 'Hide error details' : 'Show error details'}
                aria-expanded={errorDetailOpen}
              >
                <span className="material-symbols-outlined text-[12px]">error</span>
              </button>
              {errorDetailOpen ? (
                <div
                  role="region"
                  aria-label="Error message"
                  className="w-[min(100vw-2rem,22rem)] max-h-48 overflow-auto rounded-lg border border-error/25 bg-[#252525] p-3 text-left shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
                >
                  <p className="text-[11px] font-medium uppercase tracking-wide text-error/90">
                    Execution error
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-red-100/90">
                    {noticeMessage?.trim() || 'No error details.'}
                  </pre>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setErrorDetailOpen(false)}
                      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
                    >
                      Collapse
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
  isFirstTokenOfStatement,
  strictPrefixSchemaAtStatementStart,
};

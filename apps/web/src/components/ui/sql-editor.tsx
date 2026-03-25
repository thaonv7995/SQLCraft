'use client';

import { useCallback, useRef } from 'react';
import ReactCodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { sql, PostgreSQL, type SQLNamespace } from '@codemirror/lang-sql';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { Prec } from '@codemirror/state';

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
};

type SqlNamespaceTag = {
  self: SchemaCompletion;
  children: SQLNamespace;
};

function isNamespaceTag(value: unknown): value is SqlNamespaceTag {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'self' in value;
}

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
  };
}

function buildTableNamespace(table: SqlEditorSchemaTable): SqlNamespaceTag {
  return {
    self: {
      label: table.name,
      type: 'table',
      detail: `${table.columns.length} cols`,
      boost: 99,
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

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute?: () => void;
  onFormat?: () => void;
  onCopy?: () => void;
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
  placeholder = '-- Write your SQL query here...',
  readOnly = false,
  className,
  testId,
  schema,
}: SqlEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const completionSchema = buildCompletionSchema(schema);

  const extensions = useCallback(() => {
    const exts = [
      sql({ dialect: PostgreSQL, schema: completionSchema }),
      sqlForgeTheme,
      EditorView.lineWrapping,
      keymap.of([indentWithTab, ...defaultKeymap]),
    ];

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

  const hasActions = onFormat || onCopy;

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

      {/* Floating action buttons — bottom-right of editor */}
      {hasActions && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1 z-10">
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
        </div>
      )}
    </div>
  );
}

export const __private__ = {
  buildCompletionSchema,
  isNamespaceTag,
};

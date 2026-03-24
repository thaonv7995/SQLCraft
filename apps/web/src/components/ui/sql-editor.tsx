'use client';

import { useCallback, useRef } from 'react';
import ReactCodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
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
}: SqlEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const extensions = useCallback(() => {
    const exts = [
      sql({ dialect: PostgreSQL }),
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
  }, [onExecute]);

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

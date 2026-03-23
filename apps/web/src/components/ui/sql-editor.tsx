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
      backgroundColor: '#0e0e0e',
      height: '100%',
      color: '#e5e2e1',
    },
    '.cm-content': {
      fontFamily: 'var(--font-jetbrains-mono), "JetBrains Mono", monospace',
      fontSize: '13px',
      lineHeight: '1.6',
      caretColor: '#bac3ff',
      padding: '12px 0',
    },
    '.cm-line': {
      padding: '0 12px',
    },
    '.cm-cursor': {
      borderLeftColor: '#bac3ff',
      borderLeftWidth: '2px',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(186, 195, 255, 0.18) !important',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.025)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255, 255, 255, 0.025)',
      color: '#8f909e',
    },
    '.cm-gutters': {
      backgroundColor: '#0e0e0e',
      borderRight: 'none',
      color: '#454652',
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
    '.tok-keyword': { color: '#bac3ff', fontWeight: '600' },
    '.tok-string': { color: '#66d9cc' },
    '.tok-number': { color: '#ffb4ab' },
    '.tok-comment': { color: '#8f909e', fontStyle: 'italic' },
    '.tok-name': { color: '#e5e2e1' },
    '.tok-typeName': { color: '#44d8f1' },
    '.tok-variableName': { color: '#c5c5d4' },
    '.tok-operator': { color: '#c5c5d4' },
    '.tok-punctuation': { color: '#8f909e' },
    '.tok-invalid': { color: '#ffb4ab', textDecoration: 'underline' },
    // Placeholder
    '.cm-placeholder': {
      color: '#454652',
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
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}

export function SqlEditor({
  value,
  onChange,
  onExecute,
  placeholder = '-- Write your SQL query here...',
  readOnly = false,
  className,
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

  return (
    <div className={`h-full bg-[#0e0e0e] overflow-hidden ${className ?? ''}`}>
      <ReactCodeMirror
        ref={editorRef}
        value={value}
        onChange={onChange}
        extensions={extensions()}
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
    </div>
  );
}

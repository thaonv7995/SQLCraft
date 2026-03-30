import { afterEach, describe, expect, it } from 'vitest';
import {
  buildNextEditorTabName,
  clearLabEditorState,
  createDefaultLabEditorState,
  createLabEditorTab,
  pruneLabEditorLocalStorage,
  readLabEditorState,
  writeLabEditorState,
} from '../lab-editor-tabs';

describe('lab-editor-tabs', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('persists editor tabs per session in localStorage', () => {
    const state = createDefaultLabEditorState('SELECT 1;');

    writeLabEditorState('session-1', state);

    expect(readLabEditorState('session-1')).toEqual(state);
    expect(readLabEditorState('session-2')).toBeNull();
  });

  it('removes storage when writing zero tabs', () => {
    const state = createDefaultLabEditorState('SELECT 1;');
    writeLabEditorState('session-1', state);
    expect(window.localStorage.getItem('sqlcraft-lab-editor:session-1')).not.toBeNull();

    writeLabEditorState('session-1', { tabs: [], activeTabId: state.activeTabId });
    expect(window.localStorage.getItem('sqlcraft-lab-editor:session-1')).toBeNull();
  });

  it('clearLabEditorState removes the session key', () => {
    const state = createDefaultLabEditorState();
    writeLabEditorState('session-1', state);
    clearLabEditorState('session-1');
    expect(readLabEditorState('session-1')).toBeNull();
  });

  it('pruneLabEditorLocalStorage removes entries older than maxAgeMs', () => {
    const now = Date.now();
    const tabOld = createLabEditorTab({ sql: 'SELECT 1' });
    const tabNew = createLabEditorTab({ sql: 'SELECT 2' });
    writeLabEditorState('session-old', {
      tabs: [{ ...tabOld, updatedAt: now - 100_000 }],
      activeTabId: tabOld.id,
    });
    writeLabEditorState('session-new', {
      tabs: [{ ...tabNew, updatedAt: now }],
      activeTabId: tabNew.id,
    });

    pruneLabEditorLocalStorage({ maxAgeMs: 50_000, maxEntries: 100 });

    expect(readLabEditorState('session-old')).toBeNull();
    expect(readLabEditorState('session-new')).not.toBeNull();
  });

  it('pruneLabEditorLocalStorage keeps only the most recent maxEntries sessions', () => {
    const base = Date.now();
    for (let i = 0; i < 5; i += 1) {
      const tab = createLabEditorTab({ sql: `SELECT ${i}` });
      writeLabEditorState(`session-${i}`, {
        tabs: [{ ...tab, updatedAt: base + i * 1000 }],
        activeTabId: tab.id,
      });
    }

    pruneLabEditorLocalStorage({ maxAgeMs: 1_000_000, maxEntries: 2 });

    expect(readLabEditorState('session-4')).not.toBeNull();
    expect(readLabEditorState('session-3')).not.toBeNull();
    expect(readLabEditorState('session-2')).toBeNull();
    expect(readLabEditorState('session-1')).toBeNull();
    expect(readLabEditorState('session-0')).toBeNull();
  });

  it('builds sequential default tab names', () => {
    expect(buildNextEditorTabName([])).toBe('query.sql');
    expect(buildNextEditorTabName([{ name: 'query.sql' }, { name: 'query-2.sql' }])).toBe(
      'query-3.sql',
    );
  });
});

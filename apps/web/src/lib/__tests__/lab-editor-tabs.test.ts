import { afterEach, describe, expect, it } from 'vitest';
import {
  buildNextEditorTabName,
  createDefaultLabEditorState,
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

  it('builds sequential default tab names', () => {
    expect(buildNextEditorTabName([])).toBe('query.sql');
    expect(buildNextEditorTabName([{ name: 'query.sql' }, { name: 'query-2.sql' }])).toBe(
      'query-3.sql',
    );
  });
});

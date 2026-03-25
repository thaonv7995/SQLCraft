import { afterEach, describe, expect, it } from 'vitest';
import { useLabStore } from './lab';
import { createLabEditorTab } from '@/lib/lab-editor-tabs';

const initialState = useLabStore.getState();

describe('useLabStore editor tabs', () => {
  afterEach(() => {
    useLabStore.setState(initialState, true);
  });

  it('hydrates tabs, switches active tab, and keeps currentQuery in sync', () => {
    const primaryTab = createLabEditorTab({ name: 'query.sql', sql: 'SELECT 1;' });
    const secondaryTab = createLabEditorTab({ name: 'variant.sql', sql: 'SELECT 2;' });

    useLabStore.getState().hydrateEditorTabs([primaryTab, secondaryTab], primaryTab.id);
    expect(useLabStore.getState().currentQuery).toBe('SELECT 1;');
    expect(useLabStore.getState().currentEditorTabName).toBe('query.sql');

    useLabStore.getState().setActiveEditorTab(secondaryTab.id);
    expect(useLabStore.getState().currentQuery).toBe('SELECT 2;');
    expect(useLabStore.getState().currentEditorTabName).toBe('variant.sql');

    useLabStore.getState().setQuery('SELECT 2 FROM products;');
    expect(
      useLabStore
        .getState()
        .editorTabs.find((tab) => tab.id === secondaryTab.id)?.sql,
    ).toBe('SELECT 2 FROM products;');
  });

  it('adds sequential tab names, renames tabs, and falls back to a neighbor when closing the active tab', () => {
    const firstTab = createLabEditorTab({ name: 'query.sql', sql: 'SELECT 1;' });
    useLabStore.getState().hydrateEditorTabs([firstTab], firstTab.id);

    useLabStore.getState().addEditorTab();
    useLabStore.getState().addEditorTab();

    expect(useLabStore.getState().editorTabs.map((tab) => tab.name)).toEqual([
      'query.sql',
      'query-2.sql',
      'query-3.sql',
    ]);

    const thirdTab = useLabStore.getState().editorTabs[2];
    useLabStore.getState().renameEditorTab(thirdTab.id, 'final-pass.sql');
    expect(useLabStore.getState().editorTabs[2]?.name).toBe('final-pass.sql');

    useLabStore.getState().setActiveEditorTab(thirdTab.id);
    useLabStore.getState().closeEditorTab(thirdTab.id);

    expect(useLabStore.getState().activeEditorTabId).toBe(useLabStore.getState().editorTabs[1]?.id);
    expect(useLabStore.getState().currentEditorTabName).toBe('query-2.sql');
  });
});

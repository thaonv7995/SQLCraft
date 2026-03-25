import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { queryApi } from '@/lib/api';
import {
  DEFAULT_LAB_QUERY,
  buildNextEditorTabName,
  createDefaultLabEditorState,
  createLabEditorTab,
  type LabEditorTab,
} from '@/lib/lab-editor-tabs';
import type {
  DatasetScale,
  LearningSession,
  QueryExecution,
  QueryResultPreview,
  QueryExecutionPlan,
} from '@/lib/api';

interface LabState {
  // Current session
  session: LearningSession | null;
  setSession: (session: LearningSession | null) => void;

  // SQL editor
  editorTabs: LabEditorTab[];
  activeEditorTabId: string;
  currentEditorTabName: string;
  currentQuery: string;
  hydrateEditorTabs: (tabs: LabEditorTab[], activeTabId?: string) => void;
  setActiveEditorTab: (tabId: string) => void;
  addEditorTab: () => void;
  renameEditorTab: (tabId: string, name: string) => void;
  closeEditorTab: (tabId: string) => void;
  setQuery: (sql: string) => void;

  // Dataset scale context
  sourceScale: DatasetScale | null;
  selectedScale: DatasetScale | null;
  availableScales: DatasetScale[];
  sourceRowCount: number | null;
  setSelectedScale: (scale: DatasetScale) => void;

  // Execution state
  isExecuting: boolean;
  isExplaining: boolean;

  // Results
  results: QueryResultPreview | null;
  executionPlan: QueryExecutionPlan | null;
  lastExecution: QueryExecution | null;
  error: string | null;

  // Query history (in-session)
  queryHistory: QueryExecution[];

  // Active tab
  activeTab: 'results' | 'plan' | 'history' | 'schema' | 'compare' | 'schemaDiff';
  setActiveTab: (tab: 'results' | 'plan' | 'history' | 'schema' | 'compare' | 'schemaDiff') => void;

  // Actions
  executeQuery: (sessionId: string) => Promise<void>;
  explainQuery: (sessionId: string) => Promise<void>;
  resetResults: () => void;
}

function deriveEditorState(
  tabs: LabEditorTab[],
  requestedActiveTabId?: string,
): Pick<LabState, 'editorTabs' | 'activeEditorTabId' | 'currentEditorTabName' | 'currentQuery'> {
  const fallback = createDefaultLabEditorState(DEFAULT_LAB_QUERY);
  const nextTabs = tabs.length > 0 ? tabs : fallback.tabs;
  const activeTab =
    nextTabs.find((tab) => tab.id === requestedActiveTabId) ??
    nextTabs[0] ??
    fallback.tabs[0];

  return {
    editorTabs: nextTabs,
    activeEditorTabId: activeTab.id,
    currentEditorTabName: activeTab.name,
    currentQuery: activeTab.sql,
  };
}

const defaultEditorState = createDefaultLabEditorState(DEFAULT_LAB_QUERY);

export const useLabStore = create<LabState>()(
  subscribeWithSelector((set, get) => ({
  session: null,
  setSession: (session) =>
    set({
      session,
      sourceScale: session?.sourceScale ?? null,
      selectedScale: session?.selectedScale ?? null,
      availableScales: session?.availableScales ?? ['tiny', 'small', 'medium', 'large'],
      sourceRowCount:
        typeof session?.sourceRowCount === 'number'
          ? session.sourceRowCount
          : typeof session?.rowCount === 'number'
            ? session.rowCount
            : null,
    }),

  ...deriveEditorState(defaultEditorState.tabs, defaultEditorState.activeTabId),
  hydrateEditorTabs: (tabs, activeTabId) =>
    set(deriveEditorState(tabs, activeTabId)),
  setActiveEditorTab: (tabId) =>
    set((state) => deriveEditorState(state.editorTabs, tabId)),
  addEditorTab: () =>
    set((state) => {
      const tab = createLabEditorTab({
        name: buildNextEditorTabName(state.editorTabs),
        sql: '',
      });
      return deriveEditorState([...state.editorTabs, tab], tab.id);
    }),
  renameEditorTab: (tabId, name) =>
    set((state) => {
      const nextName = name.trim();
      if (!nextName) {
        return state;
      }

      return deriveEditorState(
        state.editorTabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                name: nextName,
              }
            : tab,
        ),
        state.activeEditorTabId,
      );
    }),
  closeEditorTab: (tabId) =>
    set((state) => {
      if (state.editorTabs.length <= 1) {
        return state;
      }

      const tabIndex = state.editorTabs.findIndex((tab) => tab.id === tabId);
      if (tabIndex < 0) {
        return state;
      }

      const nextTabs = state.editorTabs.filter((tab) => tab.id !== tabId);
      const nextActiveTabId =
        state.activeEditorTabId === tabId
          ? nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0].id
          : state.activeEditorTabId;

      return deriveEditorState(nextTabs, nextActiveTabId);
    }),
  setQuery: (sql) =>
    set((state) => {
      const nextTabs = state.editorTabs.map((tab) =>
        tab.id === state.activeEditorTabId
          ? {
              ...tab,
              sql,
              updatedAt: Date.now(),
            }
          : tab,
      );
      return deriveEditorState(nextTabs, state.activeEditorTabId);
    }),

  sourceScale: null,
  selectedScale: null,
  availableScales: ['tiny', 'small', 'medium', 'large'],
  sourceRowCount: null,
  setSelectedScale: (scale) => set({ selectedScale: scale }),

  isExecuting: false,
  isExplaining: false,

  results: null,
  executionPlan: null,
  lastExecution: null,
  error: null,

  queryHistory: [],

  activeTab: 'results',
  setActiveTab: (tab) => set({ activeTab: tab }),

  executeQuery: async (sessionId: string) => {
    const { currentQuery } = get();
    if (!currentQuery.trim()) return;

    set({ isExecuting: true, error: null, results: null, activeTab: 'results' });

    try {
      const execution = await queryApi.execute({
        sessionId,
        sql: currentQuery,
      });

      set((state) => ({
        isExecuting: false,
        lastExecution: execution,
        results: execution.result ?? null,
        error: execution.status === 'error' ? (execution.errorMessage ?? 'Query failed') : null,
        queryHistory: [execution, ...state.queryHistory].slice(0, 100),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Query execution failed';
      set({ isExecuting: false, error: message });
    }
  },

  explainQuery: async (sessionId: string) => {
    const { currentQuery } = get();
    if (!currentQuery.trim()) return;

    set({ isExplaining: true, error: null, activeTab: 'plan' });

    try {
      const execution = await queryApi.explain({
        sessionId,
        sql: currentQuery,
      });

      set({
        isExplaining: false,
        lastExecution: execution,
        executionPlan: execution.executionPlan ?? null,
        error: execution.status === 'error' ? (execution.errorMessage ?? 'Explain failed') : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Explain query failed';
      set({ isExplaining: false, error: message });
    }
  },

  resetResults: () => {
    set({
      results: null,
      executionPlan: null,
      lastExecution: null,
      error: null,
      activeTab: 'results',
    });
  },
})));

import { create } from 'zustand';
import { queryApi } from '@/lib/api';
import type {
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
  currentQuery: string;
  setQuery: (sql: string) => void;

  // Dataset size
  datasetSize: 'tiny' | 'small' | 'medium' | 'large';
  setDatasetSize: (size: 'tiny' | 'small' | 'medium' | 'large') => void;

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
  activeTab: 'results' | 'plan' | 'history' | 'schema';
  setActiveTab: (tab: 'results' | 'plan' | 'history' | 'schema') => void;

  // Actions
  executeQuery: (sessionId: string) => Promise<void>;
  explainQuery: (sessionId: string) => Promise<void>;
  resetResults: () => void;
}

export const useLabStore = create<LabState>()((set, get) => ({
  session: null,
  setSession: (session) => set({ session }),

  currentQuery: '-- Welcome to SQLCraft!\n-- Start writing your SQL query here...\n\nSELECT * FROM employees LIMIT 10;',
  setQuery: (sql) => set({ currentQuery: sql }),

  datasetSize: 'small',
  setDatasetSize: (size) => set({ datasetSize: size }),

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
    const { currentQuery, datasetSize } = get();
    if (!currentQuery.trim()) return;

    set({ isExecuting: true, error: null, results: null, activeTab: 'results' });

    try {
      const execution = await queryApi.execute({
        sessionId,
        sql: currentQuery,
        datasetSize,
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
    const { currentQuery, datasetSize } = get();
    if (!currentQuery.trim()) return;

    set({ isExplaining: true, error: null, activeTab: 'plan' });

    try {
      const execution = await queryApi.explain({
        sessionId,
        sql: currentQuery,
        datasetSize,
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
}));

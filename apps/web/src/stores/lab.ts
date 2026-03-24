import { create } from 'zustand';
import { queryApi } from '@/lib/api';
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
  currentQuery: string;
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

export const useLabStore = create<LabState>()((set, get) => ({
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

  currentQuery: '-- Welcome to SQLCraft!\n-- Start writing your SQL query here...\n\nSELECT * FROM employees LIMIT 10;',
  setQuery: (sql) => set({ currentQuery: sql }),

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
}));

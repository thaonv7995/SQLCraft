import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryApi, sessionsApi } from '@/lib/api';
import { useLabStore } from '@/stores/lab';
import type {
  QueryExecution,
  QueryExecutionRequest,
  SessionSchemaDiffResponse,
  SessionSchemaResponse,
} from '@/lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set<QueryExecution['status']>(['success', 'error']);
const POLL_INTERVAL_MS = 600;
/** Keep ~1m beyond server `QUERY_EXECUTION_TIMEOUT_MS` default (600s). */
const DEFAULT_SERVER_STATEMENT_TIMEOUT_MS = 600_000;
const POLL_TIMEOUT_MS =
  typeof process !== 'undefined' &&
  typeof process.env.NEXT_PUBLIC_QUERY_POLL_TIMEOUT_MS === 'string' &&
  process.env.NEXT_PUBLIC_QUERY_POLL_TIMEOUT_MS.length > 0
    ? Math.max(60_000, Number(process.env.NEXT_PUBLIC_QUERY_POLL_TIMEOUT_MS) || 660_000)
    : DEFAULT_SERVER_STATEMENT_TIMEOUT_MS + 60_000;
const SCHEMA_MUTATION_SQL = /^\s*(create|alter|drop|truncate|comment|rename)\b/i;
const ACTIVE_EXECUTION_STORAGE_PREFIX = 'sqlforge.activeExecution';

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function mayAffectSchema(sql: string): boolean {
  return SCHEMA_MUTATION_SQL.test(sql);
}

function activeExecutionStorageKey(
  kind: 'execute' | 'explain',
  sessionId: string,
): string {
  return `${ACTIVE_EXECUTION_STORAGE_PREFIX}.${kind}.${sessionId}`;
}

function readActiveExecutionId(
  kind: 'execute' | 'explain',
  sessionId?: string,
): string | null {
  if (!sessionId || typeof window === 'undefined') return null;

  try {
    return window.localStorage.getItem(activeExecutionStorageKey(kind, sessionId));
  } catch {
    return null;
  }
}

function writeActiveExecutionId(
  kind: 'execute' | 'explain',
  sessionId: string | undefined,
  executionId: string,
): void {
  if (!sessionId || typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(activeExecutionStorageKey(kind, sessionId), executionId);
  } catch {
    // Losing reload recovery is acceptable if storage is unavailable.
  }
}

function clearActiveExecutionId(kind: 'execute' | 'explain', sessionId?: string): void {
  if (!sessionId || typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(activeExecutionStorageKey(kind, sessionId));
  } catch {
    // Storage cleanup is best-effort.
  }
}

async function pollUntilDone(
  executionId: string,
  signal?: AbortSignal,
): Promise<QueryExecution> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const execution = await queryApi.poll(executionId);
    if (TERMINAL_STATUSES.has(execution.status)) return execution;
    if (Date.now() > deadline) {
      throw new Error(`Query timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// ─── Execute Query ────────────────────────────────────────────────────────────

export function useExecuteQuery(sessionId?: string) {
  const queryClient = useQueryClient();
  const setActiveTab = useLabStore((s) => s.setActiveTab);
  const abortRef = useRef<AbortController | null>(null);
  const executionIdRef = useRef<string | null>(null);

  const finishExecution = useCallback(
    (data: QueryExecution, variables?: QueryExecutionRequest) => {
      clearActiveExecutionId('execute', data.sessionId || variables?.sessionId || sessionId);
      useLabStore.setState((state) => ({
        isExecuting: false,
        lastExecution: data,
        results: data.result ?? null,
        executionPlan: data.executionPlan ?? null,
        error: data.status === 'error' ? (data.errorMessage ?? 'Query failed') : null,
        queryHistory: [data, ...state.queryHistory.filter((item) => item.id !== data.id)].slice(0, 100),
      }));
      if (data.status === 'success') {
        setActiveTab('results');
      }
      queryClient.invalidateQueries({ queryKey: ['query-history'] });

      if (data.status === 'success' && variables && mayAffectSchema(variables.sql)) {
        queryClient.invalidateQueries({ queryKey: ['session-schema', variables.sessionId] });
        queryClient.invalidateQueries({ queryKey: ['session-schema-diff', variables.sessionId] });
      }
    },
    [queryClient, sessionId, setActiveTab],
  );

  const mutation = useMutation<QueryExecution, Error, QueryExecutionRequest>({
    mutationFn: async (payload) => {
      abortRef.current = new AbortController();
      executionIdRef.current = null;
      try {
        const accepted = await queryApi.execute(payload);
        executionIdRef.current = accepted.id;
        writeActiveExecutionId('execute', payload.sessionId, accepted.id);
        if (!TERMINAL_STATUSES.has(accepted.status)) {
          return await pollUntilDone(accepted.id, abortRef.current.signal);
        }
        return accepted;
      } finally {
        executionIdRef.current = null;
      }
    },
    onMutate: () => {
      useLabStore.setState({ isExecuting: true, error: null, results: null, executionPlan: null });
    },
    onSuccess: (data, variables) => {
      finishExecution(data, variables);
    },
    onError: (err) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        clearActiveExecutionId('execute', sessionId);
        useLabStore.setState({ isExecuting: false, error: null });
        return;
      }
      clearActiveExecutionId('execute', sessionId);
      useLabStore.setState({ isExecuting: false, error: err.message });
    },
  });

  useEffect(() => {
    const recoveredExecutionId = readActiveExecutionId('execute', sessionId);
    if (!sessionId || !recoveredExecutionId || mutation.isPending) {
      return;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;
    executionIdRef.current = recoveredExecutionId;
    useLabStore.setState({ isExecuting: true, error: null, activeTab: 'results' });

    void pollUntilDone(recoveredExecutionId, abortController.signal)
      .then((execution) => {
        if (!abortController.signal.aborted) {
          finishExecution(execution);
        }
      })
      .catch((err) => {
        if (abortController.signal.aborted) return;
        clearActiveExecutionId('execute', sessionId);
        const message = err instanceof Error ? err.message : 'Query execution failed';
        useLabStore.setState({ isExecuting: false, error: message });
      })
      .finally(() => {
        if (executionIdRef.current === recoveredExecutionId) {
          executionIdRef.current = null;
        }
      });

    return () => {
      abortController.abort();
      if (executionIdRef.current === recoveredExecutionId) {
        executionIdRef.current = null;
      }
    };
  }, [finishExecution, mutation.isPending, sessionId]);

  const cancelExecution = useCallback(() => {
    const id = executionIdRef.current ?? readActiveExecutionId('execute', sessionId);
    abortRef.current?.abort();
    if (id) void queryApi.cancel(id);
    clearActiveExecutionId('execute', sessionId);
    useLabStore.setState({ isExecuting: false, error: null });
  }, [sessionId]);

  return { ...mutation, cancelExecution };
}

// ─── Explain Query ────────────────────────────────────────────────────────────

export function useExplainQuery(sessionId?: string) {
  const queryClient = useQueryClient();
  const setActiveTab = useLabStore((s) => s.setActiveTab);
  const abortRef = useRef<AbortController | null>(null);
  const executionIdRef = useRef<string | null>(null);

  const finishExplain = useCallback(
    (data: QueryExecution) => {
      clearActiveExecutionId('explain', data.sessionId || sessionId);
      useLabStore.setState({
        isExplaining: false,
        lastExecution: data,
        executionPlan: data.executionPlan ?? null,
        error: data.status === 'error' ? (data.errorMessage ?? 'Explain failed') : null,
      });
      if (data.status === 'success') {
        setActiveTab('plan');
      }
      queryClient.invalidateQueries({ queryKey: ['query-history'] });
    },
    [queryClient, sessionId, setActiveTab],
  );

  const mutation = useMutation<QueryExecution, Error, QueryExecutionRequest>({
    mutationFn: async (payload) => {
      abortRef.current = new AbortController();
      executionIdRef.current = null;
      try {
        const accepted = await queryApi.explain(payload);
        executionIdRef.current = accepted.id;
        writeActiveExecutionId('explain', payload.sessionId, accepted.id);
        if (!TERMINAL_STATUSES.has(accepted.status)) {
          return await pollUntilDone(accepted.id, abortRef.current.signal);
        }
        return accepted;
      } finally {
        executionIdRef.current = null;
      }
    },
    onMutate: () => {
      useLabStore.setState({ isExplaining: true, error: null, executionPlan: null });
    },
    onSuccess: (data) => {
      finishExplain(data);
    },
    onError: (err) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        clearActiveExecutionId('explain', sessionId);
        useLabStore.setState({ isExplaining: false, error: null });
        return;
      }
      clearActiveExecutionId('explain', sessionId);
      useLabStore.setState({ isExplaining: false, error: err.message });
    },
  });

  useEffect(() => {
    const recoveredExecutionId = readActiveExecutionId('explain', sessionId);
    if (!sessionId || !recoveredExecutionId || mutation.isPending) {
      return;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;
    executionIdRef.current = recoveredExecutionId;
    useLabStore.setState({ isExplaining: true, error: null, activeTab: 'plan' });

    void pollUntilDone(recoveredExecutionId, abortController.signal)
      .then((execution) => {
        if (!abortController.signal.aborted) {
          finishExplain(execution);
        }
      })
      .catch((err) => {
        if (abortController.signal.aborted) return;
        clearActiveExecutionId('explain', sessionId);
        const message = err instanceof Error ? err.message : 'Explain query failed';
        useLabStore.setState({ isExplaining: false, error: message });
      })
      .finally(() => {
        if (executionIdRef.current === recoveredExecutionId) {
          executionIdRef.current = null;
        }
      });

    return () => {
      abortController.abort();
      if (executionIdRef.current === recoveredExecutionId) {
        executionIdRef.current = null;
      }
    };
  }, [finishExplain, mutation.isPending, sessionId]);

  const cancelExplain = useCallback(() => {
    const id = executionIdRef.current ?? readActiveExecutionId('explain', sessionId);
    abortRef.current?.abort();
    if (id) void queryApi.cancel(id);
    clearActiveExecutionId('explain', sessionId);
    useLabStore.setState({ isExplaining: false, error: null });
  }, [sessionId]);

  return { ...mutation, cancelExplain };
}

// ─── Query History ────────────────────────────────────────────────────────────

export function useQueryHistory(sessionId?: string, page = 1, limit = 50) {
  return useQuery({
    queryKey: ['query-history', sessionId, page, limit],
    queryFn: () => queryApi.history(sessionId, { page, limit }),
    staleTime: 30_000,
  });
}

// ─── Session Schema ───────────────────────────────────────────────────────────

export function useSessionSchema(sessionId: string, enabled = true) {
  return useQuery<SessionSchemaResponse>({
    queryKey: ['session-schema', sessionId],
    queryFn: () => sessionsApi.getSchema(sessionId),
    enabled: enabled && !!sessionId,
    staleTime: 60_000,
  });
}

export function useSessionSchemaDiff(sessionId: string) {
  return useQuery<SessionSchemaDiffResponse>({
    queryKey: ['session-schema-diff', sessionId],
    queryFn: () => sessionsApi.getSchemaDiff(sessionId),
    enabled: !!sessionId,
    staleTime: 10_000,
  });
}

// ─── Session Polling ──────────────────────────────────────────────────────────

const LAB_HEARTBEAT_INTERVAL_MS = 90_000;

export function useSessionStatus(sessionId: string, enabled = true) {
  const setSession = useLabStore((s) => s.setSession);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['session-status', sessionId],
    queryFn: () => sessionsApi.get(sessionId),
    enabled: enabled && !!sessionId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === 'provisioning') return 3_000;
      if (status === 'active') return 30_000;
      return false;
    },
  });

  useEffect(() => {
    if (query.data) {
      setSession(query.data);
    }
    if (query.isError) {
      setSession(null);
    }
  }, [query.data, query.isError, setSession]);

  useEffect(() => {
    if (!sessionId || query.data?.status !== 'active') return;

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void sessionsApi
        .heartbeat(sessionId)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ['session-status', sessionId] });
        })
        .catch(() => {});
    };

    const id = setInterval(tick, LAB_HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sessionId, query.data?.status, queryClient]);

  return query;
}

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryApi, sessionsApi } from '@/lib/api';
import { useLabStore } from '@/stores/lab';
import type {
  QueryExecution,
  QueryExecutionRequest,
  SessionSchemaDiffResponse,
  SessionSchemaResponse,
} from '@/lib/api';
import toast from 'react-hot-toast';
import { toastError } from '@/lib/toast-error';
import { formatDuration, formatRows } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set<QueryExecution['status']>(['success', 'error']);
const POLL_INTERVAL_MS = 600;
const POLL_TIMEOUT_MS = 35_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function pollUntilDone(executionId: string): Promise<QueryExecution> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (true) {
    const execution = await queryApi.poll(executionId);
    if (TERMINAL_STATUSES.has(execution.status)) return execution;
    if (Date.now() > deadline) {
      throw new Error(`Query timed out after ${POLL_TIMEOUT_MS / 1000}s`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// ─── Execute Query ────────────────────────────────────────────────────────────

export function useExecuteQuery() {
  const queryClient = useQueryClient();
  const setActiveTab = useLabStore((s) => s.setActiveTab);

  return useMutation<QueryExecution, Error, QueryExecutionRequest>({
    mutationFn: async (payload) => {
      const accepted = await queryApi.execute(payload);
      // Backend returns status 'accepted' immediately — poll until done
      if (!TERMINAL_STATUSES.has(accepted.status)) {
        return pollUntilDone(accepted.id);
      }
      return accepted;
    },
    onMutate: () => {
      useLabStore.setState({ isExecuting: true, error: null, results: null, executionPlan: null });
    },
    onSuccess: (data) => {
      useLabStore.setState((state) => ({
        isExecuting: false,
        lastExecution: data,
        results: data.result ?? null,
        executionPlan: data.executionPlan ?? null,
        error: data.status === 'error' ? (data.errorMessage ?? 'Query failed') : null,
        queryHistory: [data, ...state.queryHistory].slice(0, 100),
      }));
      if (data.status === 'success') {
        const msg = `Query completed in ${formatDuration(data.durationMs ?? 0)} — ${formatRows(data.rowCount ?? 0)} rows`;
        toast.success(msg, { duration: 3000 });
        setActiveTab('results');
      } else if (data.status === 'error') {
        toastError('Query failed', new Error(data.errorMessage ?? 'Server rejected query or SQL is invalid'));
      }
      queryClient.invalidateQueries({ queryKey: ['query-history'] });
    },
    onError: (err) => {
      useLabStore.setState({ isExecuting: false, error: err.message });
      toastError('Unable to execute query (network or lab session)', err);
    },
  });
}

// ─── Explain Query ────────────────────────────────────────────────────────────

export function useExplainQuery() {
  const queryClient = useQueryClient();
  const setActiveTab = useLabStore((s) => s.setActiveTab);

  return useMutation<QueryExecution, Error, QueryExecutionRequest>({
    mutationFn: async (payload) => {
      const accepted = await queryApi.explain(payload);
      if (!TERMINAL_STATUSES.has(accepted.status)) {
        return pollUntilDone(accepted.id);
      }
      return accepted;
    },
    onMutate: () => {
      useLabStore.setState({ isExplaining: true, error: null, executionPlan: null });
    },
    onSuccess: (data) => {
      useLabStore.setState({
        isExplaining: false,
        lastExecution: data,
        executionPlan: data.executionPlan ?? null,
        error: data.status === 'error' ? (data.errorMessage ?? 'Explain failed') : null,
      });
      if (data.status === 'success') {
        toast.success('Execution plan generated');
        setActiveTab('plan');
      } else {
        toastError('Explain plan failed', new Error(data.errorMessage ?? 'Could not fetch execution plan'));
      }
      queryClient.invalidateQueries({ queryKey: ['query-history'] });
    },
    onError: (err) => {
      useLabStore.setState({ isExplaining: false, error: err.message });
      toastError('Unable to fetch execution plan', err);
    },
  });
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

export function useSessionSchema(sessionId: string) {
  return useQuery<SessionSchemaResponse>({
    queryKey: ['session-schema', sessionId],
    queryFn: () => sessionsApi.getSchema(sessionId),
    enabled: !!sessionId,
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

export function useSessionStatus(sessionId: string, enabled = true) {
  const setSession = useLabStore((s) => s.setSession);

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

  return query;
}

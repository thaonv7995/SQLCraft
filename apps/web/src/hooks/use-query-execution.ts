import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryApi, sessionsApi } from '@/lib/api';
import { useLabStore } from '@/stores/lab';
import type { QueryExecution, QueryExecutionRequest } from '@/lib/api';
import toast from 'react-hot-toast';
import { formatDuration, formatRows } from '@/lib/utils';

// ─── Execute Query ────────────────────────────────────────────────────────────

export function useExecuteQuery() {
  const queryClient = useQueryClient();
  const { setActiveTab } = useLabStore();

  return useMutation<QueryExecution, Error, QueryExecutionRequest>({
    mutationFn: (payload) => queryApi.execute(payload),
    onSuccess: (data) => {
      if (data.status === 'success') {
        const msg = `Query completed in ${formatDuration(data.durationMs ?? 0)} — ${formatRows(data.rowCount ?? 0)} rows`;
        toast.success(msg, { duration: 3000 });
        setActiveTab('results');
      } else if (data.status === 'error') {
        toast.error(data.errorMessage ?? 'Query failed');
      }
      // Invalidate history
      queryClient.invalidateQueries({ queryKey: ['query-history'] });
    },
    onError: (err) => {
      toast.error(err.message ?? 'Execution failed');
    },
  });
}

// ─── Explain Query ────────────────────────────────────────────────────────────

export function useExplainQuery() {
  const queryClient = useQueryClient();
  const { setActiveTab } = useLabStore();

  return useMutation<QueryExecution, Error, QueryExecutionRequest>({
    mutationFn: (payload) => queryApi.explain(payload),
    onSuccess: (data) => {
      if (data.status === 'success') {
        toast.success('Execution plan generated');
        setActiveTab('plan');
      } else {
        toast.error(data.errorMessage ?? 'Explain failed');
      }
      queryClient.invalidateQueries({ queryKey: ['query-history'] });
    },
    onError: (err) => {
      toast.error(err.message ?? 'Explain failed');
    },
  });
}

// ─── Format SQL ───────────────────────────────────────────────────────────────

export function useFormatSql() {
  const { setQuery } = useLabStore();

  return useMutation<{ sql: string }, Error, string>({
    mutationFn: (sql) => queryApi.format(sql),
    onSuccess: (data) => {
      setQuery(data.sql);
      toast.success('SQL formatted');
    },
    onError: () => {
      toast.error('Failed to format SQL');
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

// ─── Session Polling ──────────────────────────────────────────────────────────

export function useSessionStatus(sessionId: string, enabled = true) {
  const setSession = useLabStore((s) => s.setSession);

  return useQuery({
    queryKey: ['session-status', sessionId],
    queryFn: () => sessionsApi.pollStatus(sessionId),
    enabled: enabled && !!sessionId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll every 3s while provisioning
      if (status === 'provisioning') return 3_000;
      // Poll every 30s while active
      if (status === 'ready' || status === 'active') return 30_000;
      return false;
    },
    select: (data) => {
      setSession(data);
      return data;
    },
  });
}

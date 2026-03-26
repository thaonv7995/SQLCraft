import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LabPage from './page';
import { useLabStore } from '@/stores/lab';
import { createDefaultLabEditorState } from '@/lib/lab-editor-tabs';

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  explainQuery: vi.fn(),
  replace: vi.fn(),
  refetchSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'session-1234567890' }),
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/hooks/use-query-execution', () => ({
  useExecuteQuery: () => ({ mutate: mocks.executeQuery }),
  useExplainQuery: () => ({ mutate: mocks.explainQuery }),
  useSessionStatus: () => ({
    data: {
      id: 'session-1234567890',
      userId: 'user-1',
      lessonVersionId: null,
      challengeVersionId: null,
      status: 'provisioning',
      sandboxStatus: 'provisioning',
      sourceScale: 'large',
      selectedScale: 'small',
      availableScales: ['tiny', 'small', 'large'],
      rowCount: 25_000,
      sourceRowCount: 900_000,
      startedAt: '2026-03-26T03:00:00.000Z',
      createdAt: '2026-03-26T03:00:00.000Z',
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: mocks.refetchSession,
  }),
  useSessionSchema: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
  useSessionSchemaDiff: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('@/components/ui/sql-editor', () => ({
  SqlEditor: ({ testId = 'lab-sql-editor' }: { testId?: string }) => (
    <div data-testid={testId}>sql editor stub</div>
  ),
}));

vi.mock('@/components/lab/execution-plan-tree', () => ({
  ExecutionPlanTree: () => <div data-testid="execution-plan-tree" />,
}));

function resetLabStore() {
  const editorState = createDefaultLabEditorState();
  const activeTab = editorState.tabs[0];

  useLabStore.setState({
    session: null,
    editorTabs: editorState.tabs,
    activeEditorTabId: editorState.activeTabId,
    currentEditorTabName: activeTab.name,
    currentQuery: activeTab.sql,
    sourceScale: null,
    selectedScale: null,
    availableScales: ['tiny', 'small', 'medium', 'large'],
    sourceRowCount: null,
    isExecuting: false,
    isExplaining: false,
    results: null,
    executionPlan: null,
    lastExecution: null,
    error: null,
    queryHistory: [],
    activeTab: 'results',
  });
}

function renderLabPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LabPage />
    </QueryClientProvider>,
  );
}

describe('LabPage provisioning state', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetLabStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the interactive lab visible and does not render the new provisioning overlay', () => {
    renderLabPage();

    expect(screen.queryByRole('heading', { name: /provisioning your sandbox/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('lab-sql-editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run/i })).toBeInTheDocument();
  });

  it('does not render the provisioning cancel action', () => {
    renderLabPage();

    expect(screen.queryByRole('button', { name: /cancel provisioning/i })).not.toBeInTheDocument();
  });
});

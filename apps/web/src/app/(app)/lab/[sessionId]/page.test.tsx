import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LabPage from './page-client';
import type { ClientPageProps } from '@/lib/page-props';
import { useLabStore } from '@/stores/lab';
import { createDefaultLabEditorState } from '@/lib/lab-editor-tabs';
import type { LearningSession } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  explainQuery: vi.fn(),
  replace: vi.fn(),
  refetchSession: vi.fn(),
  session: {
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
  } as LearningSession,
}));

vi.mock('next/navigation', () => ({
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
  useQueryHistory: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useSessionStatus: () => ({
    data: mocks.session,
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

async function renderLabPage(options?: { strictMode?: boolean }) {
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

  const pageProps: ClientPageProps = {
    params: { sessionId: 'session-1234567890' },
    searchParams: {},
  };

  const tree = (
    <QueryClientProvider client={queryClient}>
      <LabPage {...pageProps} />
    </QueryClientProvider>
  );

  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(options?.strictMode ? <StrictMode>{tree}</StrictMode> : tree);
  });
  return result!;
}

describe('LabPage provisioning state', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mocks.session = {
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
    } as LearningSession;
    resetLabStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the interactive lab visible and does not render the new provisioning overlay', async () => {
    await renderLabPage();

    expect(screen.queryByRole('heading', { name: /provisioning your sandbox/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('lab-sql-editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run/i })).toBeInTheDocument();
  });

  it('does not render the provisioning cancel action', async () => {
    await renderLabPage();

    expect(screen.queryByRole('button', { name: /cancel provisioning/i })).not.toBeInTheDocument();
  });

  it('treats the session as ready when the sandbox is already ready', async () => {
    mocks.session = {
      ...mocks.session,
      status: 'provisioning',
      sandboxStatus: 'ready',
      sandbox: {
        id: 'sandbox-1',
        status: 'ready',
        dbName: 'sandbox_db',
      },
    };

    await renderLabPage();

    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run/i })).not.toBeDisabled();
  });

  it('hydrates the first editor tab from the lesson starter query under StrictMode', async () => {
    const starterQuery = 'SELECT * FROM products LIMIT 10;';

    window.sessionStorage.setItem(
      'sqlcraft-lab-bootstrap:session-1234567890',
      JSON.stringify({
        mode: 'lesson',
        lessonTitle: 'Introduction to SELECT',
        starterQuery,
        starterQueryConsumed: false,
      }),
    );

    await renderLabPage({ strictMode: true });

    await waitFor(() => {
      expect(useLabStore.getState().currentQuery).toBe(starterQuery);
    });
  });
});

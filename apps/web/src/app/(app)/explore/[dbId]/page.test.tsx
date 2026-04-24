import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DatabaseDetailPage from './page-client';
import type { ClientPageProps } from '@/lib/page-props';

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  createSession: vi.fn(),
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock('@/lib/api', () => ({
  registerTokensRefreshedCallback: vi.fn(),
  databasesApi: {
    get: mocks.getDatabase,
    createSession: mocks.createSession,
  },
}));

const database = {
  id: 'warehouse-ops',
  name: 'Warehouse Ops',
  slug: 'warehouse-ops',
  description: 'Operational warehouse analytics sandbox.',
  domain: 'operations',
  scale: 'large',
  difficulty: 'intermediate',
  engine: 'PostgreSQL 15',
  domainIcon: 'inventory_2',
  tags: ['ops', 'warehouse'],
  rowCount: 1_300_000,
  sourceRowCount: 1_300_000,
  tableCount: 18,
  estimatedSizeGb: 1.4,
  sourceScale: 'large',
  selectedScale: 'large',
  availableScales: ['small', 'large'],
  region: 'us-east-1a',
  uptime: 99.95,
  schema: [],
  relationships: [],
} as const;

async function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const pageProps: ClientPageProps = {
    params: { dbId: 'warehouse-ops' },
    searchParams: {},
  };

  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={queryClient}>
        <DatabaseDetailPage {...pageProps} />
      </QueryClientProvider>,
    );
  });
  return result!;
}

describe('DatabaseDetailPage launch flow', () => {
  beforeEach(() => {
    mocks.getDatabase.mockResolvedValue(database);
    mocks.createSession.mockResolvedValue({ id: 'session-abc123' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens the legacy provisioning modal while the sandbox launch is pending', async () => {
    const user = userEvent.setup();
    const pendingSession = {
      resolve: undefined as (((value: { id: string }) => void) | undefined),
    };

    mocks.createSession.mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          pendingSession.resolve = resolve;
        }),
    );

    await renderPage();

    const launchButtons = await screen.findAllByRole('button', { name: /launch sandbox/i });

    await user.click(launchButtons[0]);

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith('warehouse-ops', 'small');
    });

    expect(screen.getByText(/environment progress/i)).toBeInTheDocument();
    expect(screen.getByText(/spinning up a 50k\s*-\s*1m rows sandbox on postgresql 15/i)).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();

    expect(pendingSession.resolve).toBeDefined();
    pendingSession.resolve!({ id: 'session-abc123' });

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith('/lab/session-abc123');
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Sandbox ready. Opening SQL Lab.');
  });
});

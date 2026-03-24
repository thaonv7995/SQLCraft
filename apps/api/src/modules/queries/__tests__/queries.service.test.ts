import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../../../db/repositories', () => ({
  queriesRepository: {
    findSessionById: vi.fn(),
    findSandboxBySessionId: vi.fn(),
    createExecution: vi.fn(),
    findById: vi.fn(),
    getExecutionPlans: vi.fn(),
    listBySession: vi.fn(),
    listByUser: vi.fn(),
    updateSessionActivity: vi.fn(),
  },
}));

vi.mock('../../../services/query-executor', () => ({
  validateSql: vi.fn(),
}));

vi.mock('../../../lib/queue', () => ({
  enqueueExecuteQuery: vi.fn(),
}));

import { queriesRepository } from '../../../db/repositories';
import { validateSql } from '../../../services/query-executor';
import * as queue from '../../../lib/queue';
import { submitQuery, getQueryExecution, getSandboxStatus } from '../queries.service';
import { NotFoundError, ForbiddenError } from '../../../lib/errors';
import { ApiCode } from '@sqlcraft/types';
import type {
  SessionRow,
  SandboxRow,
  QueryExecutionRow,
  QueryExecutionPlanRow,
} from '../../../db/repositories';

const makeSession = (overrides = {}): SessionRow => ({
  id: 'session-1',
  userId: 'user-1',
  status: 'active',
  lessonVersionId: 'lv-1',
  challengeVersionId: null,
  startedAt: new Date(),
  endedAt: null,
  lastActivityAt: null,
  createdAt: new Date(),
  ...overrides,
});

const makeSandbox = (overrides = {}): SandboxRow => ({
  id: 'sandbox-1',
  learningSessionId: 'session-1',
  status: 'ready',
  dbName: 'sandbox_db_1',
  containerRef: null,
  schemaTemplateId: null,
  datasetTemplateId: null,
  expiresAt: new Date(Date.now() + 3600_000),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeExecution = (overrides = {}): QueryExecutionRow => ({
  id: 'exec-1',
  learningSessionId: 'session-1',
  userId: 'user-1',
  sandboxInstanceId: null,
  sqlText: 'SELECT 1',
  normalizedSql: null,
  status: 'accepted',
  durationMs: null,
  rowsReturned: null,
  rowsScanned: null,
  resultPreview: null,
  errorMessage: null,
  errorCode: null,
  submittedAt: new Date(),
  ...overrides,
});

const makeExecutionPlan = (overrides = {}): QueryExecutionPlanRow => ({
  id: 'plan-1',
  queryExecutionId: 'exec-1',
  planMode: 'explain',
  rawPlan: { Plan: { 'Node Type': 'Seq Scan', 'Total Cost': 12 } },
  planSummary: { totalCost: 12, actualTime: 2.5 },
  createdAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getSandboxStatus ─────────────────────────────────────────────────────────

describe('getSandboxStatus()', () => {
  it('returns sandbox when found', async () => {
    vi.mocked(queriesRepository.findSandboxBySessionId).mockResolvedValue(makeSandbox());
    const result = await getSandboxStatus('session-1');
    expect(result?.status).toBe('ready');
  });

  it('returns null when sandbox does not exist', async () => {
    vi.mocked(queriesRepository.findSandboxBySessionId).mockResolvedValue(null);
    expect(await getSandboxStatus('session-x')).toBeNull();
  });
});

// ─── submitQuery ──────────────────────────────────────────────────────────────

describe('submitQuery()', () => {
  const validBody = {
    learningSessionId: 'session-1',
    sql: 'SELECT * FROM users',
    explainPlan: false,
    planMode: 'explain' as const,
  };

  it('returns blocked outcome when validateSql fails', async () => {
    vi.mocked(validateSql).mockReturnValue({ valid: false, reason: 'DROP not allowed' });
    vi.mocked(queriesRepository.findSessionById).mockResolvedValue(makeSession());
    vi.mocked(queriesRepository.findSandboxBySessionId).mockResolvedValue(makeSandbox());
    vi.mocked(queriesRepository.createExecution).mockResolvedValue(
      makeExecution({ status: 'blocked' })
    );
    vi.mocked(queriesRepository.updateSessionActivity).mockResolvedValue(undefined);
    vi.mocked(queue.enqueueExecuteQuery).mockResolvedValue(undefined);

    const outcome = await submitQuery('user-1', validBody);
    expect(outcome.blocked).toBe(true);
    if (outcome.blocked) {
      expect(outcome.code).toBe(ApiCode.QUERY_BLOCKED);
      expect(outcome.reason).toMatch(/drop/i);
    }
  });

  it('returns non-blocked outcome for a valid SQL', async () => {
    const execution = makeExecution({ status: 'accepted' });
    vi.mocked(validateSql).mockReturnValue({ valid: true });
    vi.mocked(queriesRepository.findSessionById).mockResolvedValue(makeSession());
    vi.mocked(queriesRepository.findSandboxBySessionId).mockResolvedValue(makeSandbox());
    vi.mocked(queriesRepository.createExecution).mockResolvedValue(execution);
    vi.mocked(queriesRepository.updateSessionActivity).mockResolvedValue(undefined);
    vi.mocked(queue.enqueueExecuteQuery).mockResolvedValue(undefined);

    const outcome = await submitQuery('user-1', validBody);
    expect(outcome.blocked).toBe(false);
    if (!outcome.blocked) {
      expect(outcome.data.status).toBe('accepted');
      expect(outcome.data.sessionId).toBe('session-1');
      expect(outcome.data.sql).toBe('SELECT 1');
      expect(outcome.data.createdAt).toBe(execution.submittedAt.toISOString());
    }
  });

  it('throws NotFoundError when session does not exist', async () => {
    vi.mocked(validateSql).mockReturnValue({ valid: true });
    vi.mocked(queriesRepository.findSessionById).mockResolvedValue(null);

    await expect(submitQuery('user-1', validBody)).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when session belongs to a different user', async () => {
    vi.mocked(validateSql).mockReturnValue({ valid: true });
    vi.mocked(queriesRepository.findSessionById).mockResolvedValue(
      makeSession({ userId: 'other-user' })
    );

    await expect(submitQuery('user-1', validBody)).rejects.toThrow(ForbiddenError);
  });
});

// ─── getQueryExecution ────────────────────────────────────────────────────────

describe('getQueryExecution()', () => {
  it('returns the execution for the correct user', async () => {
    vi.mocked(queriesRepository.findById).mockResolvedValue(makeExecution());
    vi.mocked(queriesRepository.getExecutionPlans).mockResolvedValue([]);

    const result = await getQueryExecution('exec-1', 'user-1', false);
    expect(result.id).toBe('exec-1');
  });

  it('normalizes result preview and exposes the preferred execution plan', async () => {
    vi.mocked(queriesRepository.findById).mockResolvedValue(
      makeExecution({
        status: 'succeeded',
        rowsReturned: 2,
        resultPreview: {
          columns: ['id', 'email'],
          rows: [
            [1, 'a@example.com'],
            [2, 'b@example.com'],
          ],
          truncated: false,
        },
      }),
    );
    vi.mocked(queriesRepository.getExecutionPlans).mockResolvedValue([
      makeExecutionPlan({
        id: 'plan-explain',
        planMode: 'explain',
        rawPlan: { Plan: { 'Node Type': 'Seq Scan', 'Total Cost': 80 } },
        planSummary: { totalCost: 80 },
        createdAt: new Date('2026-03-24T01:00:00.000Z'),
      }),
      makeExecutionPlan({
        id: 'plan-analyze',
        planMode: 'explain_analyze',
        rawPlan: { Plan: { 'Node Type': 'Index Scan', 'Total Cost': 20 } },
        planSummary: { totalCost: 20, actualTime: 4.5 },
        createdAt: new Date('2026-03-24T01:05:00.000Z'),
      }),
    ]);

    const result = await getQueryExecution('exec-1', 'user-1', false);

    expect(result.result).toEqual({
      columns: [
        { name: 'id', dataType: 'unknown', nullable: true },
        { name: 'email', dataType: 'unknown', nullable: true },
      ],
      rows: [
        { id: 1, email: 'a@example.com' },
        { id: 2, email: 'b@example.com' },
      ],
      totalRows: 2,
      truncated: false,
    });
    expect(result.executionPlan).toEqual({
      type: 'json',
      plan: { Plan: { 'Node Type': 'Index Scan', 'Total Cost': 20 } },
      totalCost: 20,
      actualTime: 4.5,
      mode: 'explain_analyze',
    });
    expect(result.plans).toHaveLength(2);
  });

  it('throws NotFoundError when execution does not exist', async () => {
    vi.mocked(queriesRepository.findById).mockResolvedValue(null);
    await expect(getQueryExecution('missing', 'user-1', false)).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when non-admin accesses another user execution', async () => {
    vi.mocked(queriesRepository.findById).mockResolvedValue(
      makeExecution({ userId: 'other-user' })
    );
    await expect(getQueryExecution('exec-1', 'user-1', false)).rejects.toThrow(ForbiddenError);
  });

  it('allows admin to access any execution', async () => {
    vi.mocked(queriesRepository.findById).mockResolvedValue(
      makeExecution({ userId: 'other-user' })
    );
    vi.mocked(queriesRepository.getExecutionPlans).mockResolvedValue([]);

    const result = await getQueryExecution('exec-1', 'admin-id', true);
    expect(result.id).toBe('exec-1');
  });
});

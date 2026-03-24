import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authApi,
  normalizeAvailableDatasetScales,
  normalizeQueryExecutionItem,
  resolveDatasetScaleContext,
} from './api';
import api from './api';

function makeAxiosError(
  status: number,
  message: string,
): {
  isAxiosError: true;
  message: string;
  config: Record<string, unknown>;
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    config: Record<string, unknown>;
    data: {
      success: false;
      code: string;
      message: string;
      data: null;
    };
  };
} {
  const config: Record<string, unknown> = {};

  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    config,
    response: {
      status,
      statusText: status === 401 ? 'Unauthorized' : 'Error',
      headers: {},
      config,
      data: {
        success: false,
        code: status === 401 ? '1005' : '0001',
        message,
        data: null,
      },
    },
  };
}

afterEach(() => {
  api.defaults.adapter = undefined;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('normalizeQueryExecutionItem', () => {
  it('maps the accepted submit-query payload using sessionId/sql/createdAt', () => {
    const execution = normalizeQueryExecutionItem({
      id: 'exec-submit',
      sessionId: 'session-1',
      sql: 'SELECT 1',
      status: 'accepted',
      createdAt: '2026-03-24T14:00:00.000Z',
    });

    expect(execution).toEqual({
      id: 'exec-submit',
      sessionId: 'session-1',
      sql: 'SELECT 1',
      status: 'pending',
      durationMs: undefined,
      rowCount: undefined,
      errorMessage: undefined,
      result: undefined,
      executionPlan: undefined,
      createdAt: '2026-03-24T14:00:00.000Z',
    });
  });

  it('maps accepted/detail responses using the normalized result and executionPlan fields', () => {
    const execution = normalizeQueryExecutionItem({
      id: 'exec-1',
      learningSessionId: 'session-1',
      sqlText: 'SELECT id, email FROM users',
      status: 'succeeded',
      durationMs: 24,
      rowsReturned: 2,
      submittedAt: '2026-03-24T14:00:00.000Z',
      result: {
        columns: [
          { name: 'id', dataType: 'integer', nullable: false },
          { name: 'email', dataType: 'text', nullable: false },
        ],
        rows: [
          { id: 1, email: 'a@example.com' },
          { id: 2, email: 'b@example.com' },
        ],
        totalRows: 2,
        truncated: false,
      },
      executionPlan: {
        type: 'json',
        plan: { Plan: { 'Node Type': 'Index Scan', 'Total Cost': 12 } },
        totalCost: 12,
        actualTime: 1.5,
        mode: 'explain_analyze',
      },
    });

    expect(execution).toEqual({
      id: 'exec-1',
      sessionId: 'session-1',
      sql: 'SELECT id, email FROM users',
      status: 'success',
      durationMs: 24,
      rowCount: 2,
      errorMessage: undefined,
      result: {
        columns: [
          { name: 'id', dataType: 'integer', nullable: false },
          { name: 'email', dataType: 'text', nullable: false },
        ],
        rows: [
          { id: 1, email: 'a@example.com' },
          { id: 2, email: 'b@example.com' },
        ],
        totalRows: 2,
        truncated: false,
      },
      executionPlan: {
        type: 'json',
        plan: { Plan: { 'Node Type': 'Index Scan', 'Total Cost': 12 } },
        totalCost: 12,
        actualTime: 1.5,
        mode: 'explain_analyze',
      },
      createdAt: '2026-03-24T14:00:00.000Z',
    });
  });

  it('does not read legacy resultPreview or plans payloads anymore', () => {
    const execution = normalizeQueryExecutionItem({
      id: 'exec-legacy',
      learningSessionId: 'session-legacy',
      sqlText: 'SELECT 1',
      status: 'succeeded',
      submittedAt: '2026-03-24T14:00:00.000Z',
      resultPreview: {
        columns: ['id'],
        rows: [[1]],
        truncated: false,
      },
      plans: [
        {
          planMode: 'explain_analyze',
          rawPlan: { Plan: { 'Node Type': 'Seq Scan' } },
          planSummary: { totalCost: 99, actualTime: 12 },
        },
      ],
    });

    expect(execution.result).toBeUndefined();
    expect(execution.executionPlan).toBeUndefined();
  });
});

describe('dataset scale context helpers', () => {
  it('normalizes available scales, enforces downscale-only against source scale, and sorts', () => {
    const scales = normalizeAvailableDatasetScales(
      ['medium', 'tiny', 'large', 'small', 'small'],
      'medium',
    );

    expect(scales).toEqual(['tiny', 'small', 'medium']);
  });

  it('maps legacy massive scale to large and resolves selected scale from available list', () => {
    const context = resolveDatasetScaleContext({
      scale: 'massive',
      selectedScale: 'large',
      availableScales: ['small', 'tiny', 'large'],
      rowCount: 2_000_000,
    });

    expect(context).toEqual({
      sourceScale: 'large',
      selectedScale: 'large',
      availableScales: ['tiny', 'small', 'large'],
      rowCount: 2_000_000,
      sourceRowCount: 2_000_000,
    });
  });

  it('falls back to source scale when selected scale is invalid for the source', () => {
    const context = resolveDatasetScaleContext({
      sourceScale: 'small',
      selectedScale: 'large',
      availableScales: ['tiny', 'small', 'medium'],
      sourceRowCount: 25_000,
    });

    expect(context).toEqual({
      sourceScale: 'small',
      selectedScale: 'small',
      availableScales: ['tiny', 'small'],
      rowCount: undefined,
      sourceRowCount: 25_000,
    });
  });

  it('reads nested dataset summaries returned by the session API', () => {
    const context = resolveDatasetScaleContext({
      dataset: {
        sourceScale: 'large',
        selectedScale: 'small',
        availableScales: ['tiny', 'small', 'large'],
        totalRows: 10_000,
        sourceTotalRows: 10_000_000,
      },
    });

    expect(context).toEqual({
      sourceScale: 'large',
      selectedScale: 'small',
      availableScales: ['tiny', 'small', 'large'],
      rowCount: 10_000,
      sourceRowCount: 10_000_000,
    });
  });
});

describe('auth redirect behavior', () => {
  it('does not redirect the page when login returns 401', async () => {
    localStorage.setItem(
      'sqlcraft-auth',
      JSON.stringify({ state: { tokens: { accessToken: 'stale-token' } } }),
    );

    api.defaults.adapter = async (config) =>
      Promise.reject({
        ...makeAxiosError(401, 'Invalid email or password'),
        config: {
          ...config,
          skipAuthRedirect: true,
        },
        response: {
          ...makeAxiosError(401, 'Invalid email or password').response,
          config: {
            ...config,
            skipAuthRedirect: true,
          },
        },
      });

    await expect(
      authApi.login({ email: 'admin@sqlcraft.dev', password: 'wrong-pass' }),
    ).rejects.toMatchObject({
      message: 'Invalid email or password',
      status: 401,
    });

    expect(localStorage.getItem('sqlcraft-auth')).not.toBeNull();
  });

  it('still redirects to login on 401 for protected requests', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.setItem(
      'sqlcraft-auth',
      JSON.stringify({ state: { tokens: { accessToken: 'expired-token' } } }),
    );

    api.defaults.adapter = async (config) =>
      Promise.reject({
        ...makeAxiosError(401, 'Unauthorized'),
        config,
        response: {
          ...makeAxiosError(401, 'Unauthorized').response,
          config,
        },
      });

    await expect(authApi.me()).rejects.toMatchObject({
      message: 'Unauthorized',
      status: 401,
    });

    expect(localStorage.getItem('sqlcraft-auth')).toBeNull();
    consoleErrorSpy.mockRestore();
  });
});

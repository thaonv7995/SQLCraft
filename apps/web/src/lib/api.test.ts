import { describe, expect, it } from 'vitest';
import { normalizeQueryExecutionItem } from './api';

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

import { z } from 'zod';

export const SubmitQuerySchema = z.object({
  learningSessionId: z.string().uuid(),
  sql: z.string().min(1).max(10_000),
  explainPlan: z.boolean().optional().default(false),
  planMode: z.enum(['explain', 'explain_analyze']).optional().default('explain'),
});

export const QueryHistoryQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const QueryExecutionParamsSchema = z.object({
  id: z.string().uuid(),
});

export const QueryHistoryParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export type SubmitQueryBody = z.infer<typeof SubmitQuerySchema>;
export type QueryHistoryQuerystring = z.infer<typeof QueryHistoryQuerySchema>;
export type QueryExecutionParams = z.infer<typeof QueryExecutionParamsSchema>;
export type QueryHistoryParams = z.infer<typeof QueryHistoryParamsSchema>;

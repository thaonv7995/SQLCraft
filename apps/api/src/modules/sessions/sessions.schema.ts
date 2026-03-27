import { z } from 'zod';

export const CreateSessionSchema = z.object({
  challengeVersionId: z.string().uuid(),
});

export const SessionParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export const RevertSchemaDiffChangeBodySchema = z.object({
  resourceType: z.enum(['indexes', 'views', 'materializedViews', 'functions', 'partitions']),
  changeType: z.enum(['added', 'removed', 'changed']),
  name: z.string().min(1),
  tableName: z.string().min(1).optional(),
  signature: z.string().min(1).optional(),
});

export type CreateSessionBody = z.infer<typeof CreateSessionSchema>;
export type SessionParams = z.infer<typeof SessionParamsSchema>;
export type RevertSchemaDiffChangeBody = z.infer<typeof RevertSchemaDiffChangeBodySchema>;

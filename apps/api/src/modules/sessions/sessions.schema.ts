import { z } from 'zod';

export const CreateSessionSchema = z.object({
  challengeVersionId: z.string().uuid(),
  datasetSize: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
  scale: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
});

export const SessionParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export type CreateSessionBody = z.infer<typeof CreateSessionSchema>;
export type SessionParams = z.infer<typeof SessionParamsSchema>;

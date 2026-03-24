import { z } from 'zod';

export const CreateSessionSchema = z.object({
  lessonVersionId: z.string().uuid(),
  challengeVersionId: z.string().uuid().optional(),
  datasetSize: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
  scale: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
});

export const SessionParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export type CreateSessionBody = z.infer<typeof CreateSessionSchema>;
export type SessionParams = z.infer<typeof SessionParamsSchema>;

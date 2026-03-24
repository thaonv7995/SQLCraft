import { z } from 'zod';

// Param schemas
export const ChallengeAttemptParamsSchema = z.object({
  id: z.string().uuid(),
});

export const ChallengeVersionParamsSchema = z.object({
  id: z.string().uuid(),
});

export const AdminChallengeVersionParamsSchema = z.object({
  id: z.string().uuid(),
});

export const ChallengeAttemptsQuerySchema = z.object({
  challengeVersionId: z.string().uuid(),
});

export const ChallengeLeaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// Body schemas
export const SubmitAttemptSchema = z.object({
  learningSessionId: z.string().uuid(),
  challengeVersionId: z.string().uuid(),
  queryExecutionId: z.string().uuid(),
});

export const CreateChallengeSchema = z
  .object({
    lessonId: z.string().uuid(),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
    sortOrder: z.number().int().default(0),
    points: z.number().int().min(10).max(1000).default(100),
    problemStatement: z.string().min(1),
    hintText: z.string().optional(),
    expectedResultColumns: z.array(z.string()).optional(),
    referenceSolution: z.string().optional(),
    validatorType: z.string().default('result_set'),
    validatorConfig: z.record(z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.validatorType === 'result_set' && !value.referenceSolution?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceSolution'],
        message: 'referenceSolution is required for result_set challenges',
      });
    }
  });

// Inferred types
export type ChallengeAttemptParams = z.infer<typeof ChallengeAttemptParamsSchema>;
export type ChallengeVersionParams = z.infer<typeof ChallengeVersionParamsSchema>;
export type AdminChallengeVersionParams = z.infer<typeof AdminChallengeVersionParamsSchema>;
export type ChallengeAttemptsQuery = z.infer<typeof ChallengeAttemptsQuerySchema>;
export type ChallengeLeaderboardQuery = z.infer<typeof ChallengeLeaderboardQuerySchema>;
export type SubmitAttemptBody = z.infer<typeof SubmitAttemptSchema>;
export type CreateChallengeBody = z.infer<typeof CreateChallengeSchema>;

import { z } from 'zod';

/** Stored on `challenge_versions.validator_config`; drives pass/fail for time + planner cost. */
export const ChallengeValidatorConfigSchema = z.object({
  baselineDurationMs: z.coerce.number().positive(),
  maxTotalCost: z.coerce.number().positive(),
  requiresIndexOptimization: z.boolean().optional(),
});

export type ChallengeValidatorConfig = z.infer<typeof ChallengeValidatorConfigSchema>;

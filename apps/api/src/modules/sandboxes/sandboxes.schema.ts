import { z } from 'zod';

export const SandboxParamsSchema = z.object({
  sandboxId: z.string().uuid(),
});

export const SandboxResetParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export const SandboxResetBodySchema = z.object({
  datasetSize: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
  scale: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
  selectedScale: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
});

export type SandboxParams = z.infer<typeof SandboxParamsSchema>;
export type SandboxResetParams = z.infer<typeof SandboxResetParamsSchema>;
export type SandboxResetBody = z.infer<typeof SandboxResetBodySchema>;

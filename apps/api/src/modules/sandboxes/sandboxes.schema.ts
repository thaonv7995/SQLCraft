import { z } from 'zod';

export const SandboxParamsSchema = z.object({
  sandboxId: z.string().uuid(),
});

export const SandboxResetParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export type SandboxParams = z.infer<typeof SandboxParamsSchema>;
export type SandboxResetParams = z.infer<typeof SandboxResetParamsSchema>;

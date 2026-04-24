import { z } from 'zod';
import { aiProviderValues } from '../../db/schema';

export const AiProviderSchema = z.enum(aiProviderValues);

const optionalUrl = z
  .string()
  .trim()
  .url('Base URL must be a valid URL')
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' ? undefined : v));

export const UpsertAiProviderSettingSchema = z.object({
  provider: AiProviderSchema,
  name: z.string().trim().min(1).max(100).optional(),
  baseUrl: optionalUrl,
  model: z.string().trim().min(1).max(160),
  apiKey: z.string().trim().min(1).optional(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const CreateAiProviderSettingSchema = UpsertAiProviderSettingSchema.extend({
  apiKey: z.string().trim().min(1),
});

export const UpdateAiProviderSettingSchema = UpsertAiProviderSettingSchema.partial();

export const AiChatSchema = z.object({
  settingId: z.string().uuid().optional(),
  feature: z.enum(['sql-explain', 'query-optimize', 'general']).default('general'),
  prompt: z.string().trim().min(1).max(20_000),
  sql: z.string().max(50_000).optional(),
  context: z.string().max(50_000).optional(),
});

export type AiProvider = z.infer<typeof AiProviderSchema>;
export type CreateAiProviderSettingBody = z.infer<typeof CreateAiProviderSettingSchema>;
export type UpdateAiProviderSettingBody = z.infer<typeof UpdateAiProviderSettingSchema>;
export type AiChatBody = z.infer<typeof AiChatSchema>;

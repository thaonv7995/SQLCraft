import { z } from 'zod';

/**
 * Each entry is one pass rule. On submit, every criterion must pass (AND).
 * Stored on `challenge_versions.validator_config`.
 */
export const PassCriterionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('max_query_duration_ms'),
    maxMs: z.coerce.number().positive(),
  }),
  z.object({
    type: z.literal('max_explain_total_cost'),
    maxTotalCost: z.coerce.number().positive(),
  }),
  z.object({
    type: z.literal('requires_index_usage'),
  }),
  z.object({
    type: z.literal('required_output_columns'),
    columns: z.array(z.string().trim().min(1)).min(1),
    /** Admin UI: which schema tables/columns were chosen; optional for legacy payloads. */
    selections: z
      .array(
        z.object({
          table: z.string(),
          column: z.string().trim().min(1),
        }),
      )
      .optional(),
  }),
  z.object({
    type: z.literal('required_tables_in_query'),
    tables: z.array(z.string().trim().min(1)).min(1),
    matchMode: z.enum(['all', 'any']).default('all'),
  }),
]);

export const ChallengeValidatorConfigSchema = z.object({
  passCriteria: z
    .array(PassCriterionSchema)
    .min(1, 'Add at least one pass criterion (e.g. max runtime or max planner cost).'),
});

export type PassCriterion = z.infer<typeof PassCriterionSchema>;
export type ChallengeValidatorConfig = z.infer<typeof ChallengeValidatorConfigSchema>;

/** Legacy flat keys → criteria list (read path / migration). */
export function migrateLegacyValidatorConfig(
  raw: Record<string, unknown>,
): ChallengeValidatorConfig['passCriteria'] {
  const out: ChallengeValidatorConfig['passCriteria'] = [];
  const b = raw.baselineDurationMs;
  const maxMs =
    typeof b === 'number' && Number.isFinite(b) && b > 0
      ? b
      : typeof b === 'string'
        ? Number(b)
        : NaN;
  if (Number.isFinite(maxMs) && maxMs > 0) {
    out.push({ type: 'max_query_duration_ms', maxMs });
  }
  const c = raw.maxTotalCost;
  const maxCost =
    typeof c === 'number' && Number.isFinite(c) && c > 0
      ? c
      : typeof c === 'string'
        ? Number(c)
        : NaN;
  if (Number.isFinite(maxCost) && maxCost > 0) {
    out.push({ type: 'max_explain_total_cost', maxTotalCost: maxCost });
  }
  if (raw.requiresIndexOptimization === true) {
    out.push({ type: 'requires_index_usage' });
  }
  return out;
}

export function parseValidatorConfigWithLegacy(value: unknown): ChallengeValidatorConfig | null {
  const parsed = ChallengeValidatorConfigSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  if (value && typeof value === 'object') {
    const legacy = migrateLegacyValidatorConfig(value as Record<string, unknown>);
    if (legacy.length > 0) {
      return { passCriteria: legacy };
    }
  }
  return null;
}

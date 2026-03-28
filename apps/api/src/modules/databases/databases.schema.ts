import { normalizeSchemaSqlEngine, SCHEMA_SQL_DIALECT_VALUES } from '@sqlcraft/types';
import { z } from 'zod';

const schemaSqlDialectTuple = SCHEMA_SQL_DIALECT_VALUES as unknown as [
  (typeof SCHEMA_SQL_DIALECT_VALUES)[number],
  ...(typeof SCHEMA_SQL_DIALECT_VALUES)[number][],
];

const dialectEnum = z.enum(schemaSqlDialectTuple);
/** Querystring may repeat keys, use first value; normalize legacy aliases. */
const listDialectSchema = z.preprocess((val) => {
  if (val === undefined || val === null || val === '') return undefined;
  const raw = Array.isArray(val) ? val[0] : val;
  if (raw === undefined || raw === null || raw === '') return undefined;
  return normalizeSchemaSqlEngine(String(raw));
}, dialectEnum.optional());

export const ListDatabasesQuerySchema = z.object({
  domain: z.enum(['ecommerce', 'fintech', 'health', 'iot', 'social', 'analytics', 'other']).optional(),
  scale: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  dialect: listDialectSchema,
  /** Case-insensitive substring match on name, slug, description, engine label, and tags. */
  q: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(200).optional(),
  ),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const DatabaseParamsSchema = z.object({
  databaseId: z.string().min(1),
});

export const CreateDatabaseSessionBodySchema = z.object({
  databaseId: z.string().min(1),
  scale: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
});

export type ListDatabasesQuery = z.infer<typeof ListDatabasesQuerySchema>;
export type DatabaseParams = z.infer<typeof DatabaseParamsSchema>;
export type CreateDatabaseSessionBody = z.infer<typeof CreateDatabaseSessionBodySchema>;

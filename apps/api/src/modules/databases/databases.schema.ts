import { z } from 'zod';

export const ListDatabasesQuerySchema = z.object({
  domain: z.enum(['ecommerce', 'fintech', 'health', 'iot', 'social', 'analytics', 'other']).optional(),
  scale: z.enum(['tiny', 'small', 'medium', 'large']).optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
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

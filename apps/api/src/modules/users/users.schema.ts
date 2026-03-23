import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  displayName: z.string().max(100).optional(),
  bio: z.string().max(1000).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type UpdateProfileBody = z.infer<typeof UpdateProfileSchema>;
export type PaginationQuery = z.infer<typeof PaginationSchema>;

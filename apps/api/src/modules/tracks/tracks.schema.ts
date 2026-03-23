import { z } from 'zod';

// Query schemas
export const ListTracksQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// Body schemas
export const CreateTrackSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  coverUrl: z.string().url().optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  sortOrder: z.number().int().default(0),
});

export const UpdateTrackSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  coverUrl: z.string().url().optional().nullable(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  sortOrder: z.number().int().optional(),
});

// Param schemas
export const TrackParamsSchema = z.object({
  trackId: z.string().uuid(),
});

export const AdminTrackParamsSchema = z.object({
  id: z.string().uuid(),
});

// Inferred types
export type ListTracksQuery = z.infer<typeof ListTracksQuerySchema>;
export type CreateTrackBody = z.infer<typeof CreateTrackSchema>;
export type UpdateTrackBody = z.infer<typeof UpdateTrackSchema>;
export type TrackParams = z.infer<typeof TrackParamsSchema>;
export type AdminTrackParams = z.infer<typeof AdminTrackParamsSchema>;

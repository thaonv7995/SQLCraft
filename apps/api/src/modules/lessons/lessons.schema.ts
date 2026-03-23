import { z } from 'zod';

// Param schemas
export const LessonParamsSchema = z.object({
  lessonId: z.string().uuid(),
});

export const LessonVersionParamsSchema = z.object({
  versionId: z.string().uuid(),
});

export const AdminLessonVersionParamsSchema = z.object({
  id: z.string().uuid(),
});

// Body schemas
export const CreateLessonSchema = z.object({
  trackId: z.string().uuid(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  sortOrder: z.number().int().default(0),
  estimatedMinutes: z.number().int().positive().optional(),
});

export const CreateLessonVersionSchema = z.object({
  lessonId: z.string().uuid(),
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  starterQuery: z.string().optional(),
  schemaTemplateId: z.string().uuid().optional(),
  datasetTemplateId: z.string().uuid().optional(),
});

// Inferred types
export type LessonParams = z.infer<typeof LessonParamsSchema>;
export type LessonVersionParams = z.infer<typeof LessonVersionParamsSchema>;
export type AdminLessonVersionParams = z.infer<typeof AdminLessonVersionParamsSchema>;
export type CreateLessonBody = z.infer<typeof CreateLessonSchema>;
export type CreateLessonVersionBody = z.infer<typeof CreateLessonVersionSchema>;

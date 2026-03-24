import { z } from 'zod';

// ─── Tracks ───────────────────────────────────────────────────────────────────

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

// ─── Lessons ──────────────────────────────────────────────────────────────────

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

// ─── Challenges ───────────────────────────────────────────────────────────────

export const CreateChallengeSchema = z
  .object({
    lessonId: z.string().uuid(),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
    sortOrder: z.number().int().default(0),
    points: z.number().int().min(10).max(1000).default(100),
    problemStatement: z.string().min(1),
    hintText: z.string().optional(),
    expectedResultColumns: z.array(z.string()).optional(),
    referenceSolution: z.string().optional(),
    validatorType: z.string().default('result_set'),
    validatorConfig: z.record(z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.validatorType === 'result_set' && !value.referenceSolution?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceSolution'],
        message: 'referenceSolution is required for result_set challenges',
      });
    }
  });

// ─── Users ────────────────────────────────────────────────────────────────────

export const ListUsersQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['active', 'disabled', 'invited']).optional(),
  search: z.string().optional(),
  role: z.enum(['learner', 'contributor', 'admin']).optional(),
});

export const UpdateUserStatusSchema = z.object({
  status: z.enum(['active', 'disabled', 'invited']),
});

export const UpdateUserRoleSchema = z.object({
  role: z.enum(['learner', 'contributor', 'admin']),
});

// ─── Database Imports & Jobs ─────────────────────────────────────────────────

export const ImportCanonicalDatabaseSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  definition: z.record(z.unknown()),
  canonicalDataset: z.object({
    name: z.string().min(1).max(100).optional(),
    rowCounts: z.record(z.string(), z.coerce.number().int().min(0)),
    artifactUrl: z.string().url().optional().nullable(),
  }),
  generateDerivedDatasets: z.boolean().default(true),
  status: z.enum(['draft', 'published', 'archived']).default('published'),
});

export const ListSystemJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'retrying']).optional(),
  type: z.string().min(1).max(100).optional(),
});

// ─── Params ───────────────────────────────────────────────────────────────────

export const AdminIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type CreateTrackBody = z.infer<typeof CreateTrackSchema>;
export type UpdateTrackBody = z.infer<typeof UpdateTrackSchema>;
export type CreateLessonBody = z.infer<typeof CreateLessonSchema>;
export type CreateLessonVersionBody = z.infer<typeof CreateLessonVersionSchema>;
export type CreateChallengeBody = z.infer<typeof CreateChallengeSchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
export type UpdateUserStatusBody = z.infer<typeof UpdateUserStatusSchema>;
export type UpdateUserRoleBody = z.infer<typeof UpdateUserRoleSchema>;
export type ImportCanonicalDatabaseBody = z.infer<typeof ImportCanonicalDatabaseSchema>;
export type ListSystemJobsQuery = z.infer<typeof ListSystemJobsQuerySchema>;
export type AdminIdParams = z.infer<typeof AdminIdParamsSchema>;

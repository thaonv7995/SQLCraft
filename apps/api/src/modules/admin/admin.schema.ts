import { normalizeSchemaSqlEngine, SCHEMA_SQL_DIALECT_VALUES } from '@sqlcraft/types';
import { z } from 'zod';
import { ChallengeValidatorConfigSchema } from '../challenges/challenge-validator-config.schema';

const schemaSqlDialectTuple = SCHEMA_SQL_DIALECT_VALUES as unknown as [
  (typeof SCHEMA_SQL_DIALECT_VALUES)[number],
  ...(typeof SCHEMA_SQL_DIALECT_VALUES)[number][],
];
const schemaSqlDialectEnum = z.enum(schemaSqlDialectTuple);

/** Accepts engine family or legacy aliases (e.g. postgresql-16). */
export const SchemaSqlDialectSchema = z
  .union([schemaSqlDialectEnum, z.string()])
  .transform((v) => normalizeSchemaSqlEngine(typeof v === 'string' ? v : v))
  .pipe(schemaSqlDialectEnum);

export const OptionalSchemaSqlDialectSchema = z
  .union([schemaSqlDialectEnum, z.string()])
  .optional()
  .transform((v) => (v === undefined ? undefined : normalizeSchemaSqlEngine(typeof v === 'string' ? v : v)))
  .pipe(schemaSqlDialectEnum.optional());

export const SchemaSqlDialectDefaultPostgresqlSchema = z
  .union([schemaSqlDialectEnum, z.string()])
  .default('postgresql')
  .transform((v) => normalizeSchemaSqlEngine(typeof v === 'string' ? v : v))
  .pipe(schemaSqlDialectEnum);

/** Optional engine version from dump header (e.g. 16.2) or admin override; null/omit = platform default. */
export const EngineVersionFieldSchema = z
  .string()
  .max(64)
  .nullable()
  .optional()
  .transform((v) => {
    if (v == null) return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  });

// ─── Challenges ───────────────────────────────────────────────────────────────

export const CreateChallengeSchema = z
  .object({
    databaseId: z.string().uuid(),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
    sortOrder: z.number().int().default(0),
    points: z.number().int().min(10).max(1000).default(100),
    datasetScale: z.enum(['tiny', 'small', 'medium', 'large']).default('small'),
    problemStatement: z.string().min(1),
    hintText: z.string().optional(),
    expectedResultColumns: z.array(z.string()).optional(),
    referenceSolution: z.string().optional(),
    validatorType: z.string().default('result_set'),
    validatorConfig: ChallengeValidatorConfigSchema,
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
  role: z.enum(['user', 'admin']).optional(),
});

export const UpdateUserStatusSchema = z.object({
  status: z.enum(['active', 'disabled', 'invited']),
});

export const UpdateUserRoleSchema = z.object({
  role: z.enum(['user', 'admin']),
});

export const CreateAdminUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50),
  password: z.string().min(8).max(100),
  displayName: z.string().min(1).max(100).optional(),
  bio: z.string().max(2000).optional().nullable(),
  role: z.enum(['user', 'admin']).default('user'),
  status: z.enum(['active', 'disabled', 'invited']).default('active'),
});

export const UpdateAdminUserSchema = z
  .object({
    email: z.string().email().optional(),
    username: z.string().min(3).max(50).optional(),
    password: z.string().min(8).max(100).optional(),
    displayName: z.string().min(1).max(100).optional().nullable(),
    bio: z.string().max(2000).optional().nullable(),
    role: z.enum(['user', 'admin']).optional(),
    status: z.enum(['active', 'disabled', 'invited']).optional(),
  })
  .refine(
    (value) =>
      value.email !== undefined ||
      value.username !== undefined ||
      value.password !== undefined ||
      value.displayName !== undefined ||
      value.bio !== undefined ||
      value.role !== undefined ||
      value.status !== undefined,
    {
      message: 'At least one field must be provided',
    },
  );

// ─── Database Imports & Jobs ─────────────────────────────────────────────────

export const AdminDatabaseDomainSchema = z.enum([
  'ecommerce',
  'fintech',
  'health',
  'iot',
  'social',
  'analytics',
  'other',
]);

export const DirectCanonicalDatabaseImportSchema = z.object({
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
  dialect: SchemaSqlDialectDefaultPostgresqlSchema,
  engineVersion: EngineVersionFieldSchema,
});

export const SqlDumpScanImportSchema = z.object({
  scanId: z.string().uuid(),
  schemaName: z.string().min(1).max(100),
  domain: AdminDatabaseDomainSchema,
  datasetScale: z.enum(['tiny', 'small', 'medium', 'large']).optional().nullable(),
  description: z.string().optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  /** When set, overrides {@link SqlDumpScanResult.inferredDialect} from the scan step. */
  dialect: OptionalSchemaSqlDialectSchema,
  /** When set, overrides inferred engine version from the dump scan. */
  engineVersion: EngineVersionFieldSchema,
});

export const ImportCanonicalDatabaseSchema = z.union([
  DirectCanonicalDatabaseImportSchema,
  SqlDumpScanImportSchema,
]);

export const ListSystemJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'retrying']).optional(),
  type: z.string().min(1).max(100).optional(),
});

export const ListAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().min(1).max(100).optional(),
  resourceType: z.string().min(1).max(50).optional(),
});

export const ListPendingScansQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

// ─── Admin Config ────────────────────────────────────────────────────────────

const AdminPlatformConfigSchema = z.object({
  defaultDialect: SchemaSqlDialectSchema,
  defaultChallengePoints: z.string().min(1).max(20),
  sessionTimeoutMinutes: z.string().min(1).max(20),
  dailyQueryBudget: z.string().min(1).max(20),
  starterSchemaVisibility: z.enum(['schema-only', 'schema-and-sample', 'delayed-sample']),
  enableExplainHints: z.boolean(),
  allowSampleDataDownloads: z.boolean(),
  operatorNote: z.string().max(2000),
});

const AdminRankingConfigSchema = z.object({
  globalWindow: z.enum(['all-time', 'seasonal', 'rolling-30']),
  globalLeaderboardSize: z.string().min(1).max(20),
  challengeLeaderboardSize: z.string().min(1).max(20),
  tieBreaker: z.enum(['completion-speed', 'accuracy-first', 'recent-activity']),
  refreshInterval: z.enum(['1m', '5m', '15m']),
  displayProvisionalRanks: z.boolean(),
  highlightRecentMovers: z.boolean(),
});

const AdminModerationConfigSchema = z.object({
  requireDraftValidation: z.boolean(),
  blockDangerousSql: z.boolean(),
  autoHoldHighPointSubmissions: z.boolean(),
  manualReviewSlaHours: z.string().min(1).max(20),
  publishChecklist: z.string().max(4000),
  rejectionTemplate: z.string().max(4000),
});

const AdminInfrastructureConfigSchema = z.object({
  queryWorkerConcurrency: z.string().min(1).max(20),
  evaluationWorkerConcurrency: z.string().min(1).max(20),
  sandboxWarmPool: z.string().min(1).max(20),
  runRetentionDays: z.string().min(1).max(20),
  objectStorageClass: z.enum(['standard', 'infrequent', 'archive']),
  warningThresholdGb: z.string().min(1).max(20),
  keepExecutionSnapshots: z.boolean(),
  enableNightlyExports: z.boolean(),
});

const AdminFeatureFlagsSchema = z.object({
  globalRankings: z.boolean(),
  challengeRankings: z.boolean(),
  submissionQueue: z.boolean(),
  explanationPanel: z.boolean(),
  snapshotExports: z.boolean(),
});

export const AdminConfigSchema = z.object({
  platform: AdminPlatformConfigSchema,
  rankings: AdminRankingConfigSchema,
  moderation: AdminModerationConfigSchema,
  infrastructure: AdminInfrastructureConfigSchema,
  flags: AdminFeatureFlagsSchema,
});

export const DEFAULT_ADMIN_CONFIG = {
  platform: {
    defaultDialect: 'postgresql',
    defaultChallengePoints: '100',
    sessionTimeoutMinutes: '35',
    dailyQueryBudget: '800',
    starterSchemaVisibility: 'schema-only',
    enableExplainHints: true,
    allowSampleDataDownloads: false,
    operatorNote:
      'Keep the default SQL practice experience stable for new users and admins.',
  },
  rankings: {
    globalWindow: 'all-time',
    globalLeaderboardSize: '100',
    challengeLeaderboardSize: '50',
    tieBreaker: 'completion-speed',
    refreshInterval: '5m',
    displayProvisionalRanks: true,
    highlightRecentMovers: true,
  },
  moderation: {
    requireDraftValidation: true,
    blockDangerousSql: true,
    autoHoldHighPointSubmissions: true,
    manualReviewSlaHours: '24',
    publishChecklist:
      'Reference SQL returns stable rows.\nFixed points match challenge difficulty.\nReview leaderboard impact before publishing.',
    rejectionTemplate:
      'Please run draft validation again, confirm fixed points, and resubmit after resolving review notes.',
  },
  infrastructure: {
    queryWorkerConcurrency: '12',
    evaluationWorkerConcurrency: '6',
    sandboxWarmPool: '8',
    runRetentionDays: '14',
    objectStorageClass: 'standard',
    warningThresholdGb: '120',
    keepExecutionSnapshots: true,
    enableNightlyExports: true,
  },
  flags: {
    globalRankings: true,
    challengeRankings: true,
    submissionQueue: true,
    explanationPanel: false,
    snapshotExports: true,
  },
} satisfies z.infer<typeof AdminConfigSchema>;

// ─── Params ───────────────────────────────────────────────────────────────────

export const AdminIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const SqlDumpScanIdParamsSchema = z.object({
  scanId: z.string().uuid(),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type CreateChallengeBody = z.infer<typeof CreateChallengeSchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
export type UpdateUserStatusBody = z.infer<typeof UpdateUserStatusSchema>;
export type UpdateUserRoleBody = z.infer<typeof UpdateUserRoleSchema>;
export type CreateAdminUserBody = z.infer<typeof CreateAdminUserSchema>;
export type UpdateAdminUserBody = z.infer<typeof UpdateAdminUserSchema>;
export type ImportCanonicalDatabaseBody = z.infer<typeof ImportCanonicalDatabaseSchema>;
export type DirectCanonicalDatabaseImportBody = z.infer<typeof DirectCanonicalDatabaseImportSchema>;
export type SqlDumpScanImportBody = z.infer<typeof SqlDumpScanImportSchema>;
export type ListSystemJobsQuery = z.infer<typeof ListSystemJobsQuerySchema>;
export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuerySchema>;
export type AdminConfigBody = z.infer<typeof AdminConfigSchema>;
export type AdminIdParams = z.infer<typeof AdminIdParamsSchema>;
export type ListPendingScansQuery = z.infer<typeof ListPendingScansQuerySchema>;
export type SqlDumpScanIdParams = z.infer<typeof SqlDumpScanIdParamsSchema>;

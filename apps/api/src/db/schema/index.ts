import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  bigint,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Enums
export const userStatusEnum = pgEnum('user_status', ['active', 'disabled', 'invited']);
export const contentStatusEnum = pgEnum('content_status', ['draft', 'published', 'archived']);
export const difficultyEnum = pgEnum('difficulty', ['beginner', 'intermediate', 'advanced']);
export const sessionStatusEnum = pgEnum('session_status', [
  'provisioning',
  'active',
  'paused',
  'ended',
  'expired',
  'failed',
]);
export const sandboxStatusEnum = pgEnum('sandbox_status', [
  'requested',
  'provisioning',
  'ready',
  'busy',
  'resetting',
  'expiring',
  'destroyed',
  'failed',
]);
export const queryStatusEnum = pgEnum('query_status', [
  'accepted',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'blocked',
]);
export const attemptStatusEnum = pgEnum('attempt_status', ['pending', 'passed', 'failed', 'error']);
export const planModeEnum = pgEnum('plan_mode', ['explain', 'explain_analyze']);
export const datasetSizeEnum = pgEnum('dataset_size', ['tiny', 'small', 'medium', 'large']);
export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'retrying',
]);

// Users & Auth
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: varchar('email', { length: 255 }).notNull(),
    username: varchar('username', { length: 50 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }),
    displayName: varchar('display_name', { length: 100 }),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    status: userStatusEnum('status').notNull().default('active'),
    provider: varchar('provider', { length: 50 }).default('email'),
    providerId: varchar('provider_id', { length: 255 }),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at').notNull().default(sql`now()`),
  },
  (table) => ({
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
    usernameIdx: uniqueIndex('users_username_idx').on(table.username),
  }),
);

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
});

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  grantedAt: timestamp('granted_at').notNull().default(sql`now()`),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').notNull().default(sql`now()`),
  },
  (table) => ({
    tokenHashIdx: index('refresh_tokens_hash_idx').on(table.tokenHash),
    userIdIdx: index('refresh_tokens_user_id_idx').on(table.userId),
  }),
);

// Learning Content
export const tracks = pgTable(
  'tracks',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    slug: varchar('slug', { length: 100 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    difficulty: difficultyEnum('difficulty').notNull().default('beginner'),
    status: contentStatusEnum('status').notNull().default('draft'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at').notNull().default(sql`now()`),
  },
  (table) => ({
    slugIdx: uniqueIndex('tracks_slug_idx').on(table.slug),
    statusSortIdx: index('tracks_status_sort_idx').on(table.status, table.sortOrder),
  }),
);

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    trackId: uuid('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 100 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    difficulty: difficultyEnum('difficulty').notNull().default('beginner'),
    status: contentStatusEnum('status').notNull().default('draft'),
    sortOrder: integer('sort_order').notNull().default(0),
    estimatedMinutes: integer('estimated_minutes'),
    publishedVersionId: uuid('published_version_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at').notNull().default(sql`now()`),
  },
  (table) => ({
    trackSlugIdx: uniqueIndex('lessons_track_slug_idx').on(table.trackId, table.slug),
    trackSortIdx: index('lessons_track_sort_idx').on(table.trackId, table.sortOrder),
  }),
);

export const lessonVersions = pgTable(
  'lesson_versions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull().default(1),
    title: varchar('title', { length: 255 }).notNull(),
    content: text('content').notNull(),
    starterQuery: text('starter_query'),
    isPublished: boolean('is_published').notNull().default(false),
    schemaTemplateId: uuid('schema_template_id').references(() => schemaTemplates.id),
    datasetTemplateId: uuid('dataset_template_id').references(() => datasetTemplates.id),
    publishedAt: timestamp('published_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().default(sql`now()`),
  },
  (table) => ({
    lessonVersionIdx: uniqueIndex('lesson_versions_lesson_version_idx').on(
      table.lessonId,
      table.versionNo,
    ),
  }),
);

export const challenges = pgTable(
  'challenges',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 100 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    difficulty: difficultyEnum('difficulty').notNull().default('beginner'),
    sortOrder: integer('sort_order').notNull().default(0),
    points: integer('points').notNull().default(100),
    status: contentStatusEnum('status').notNull().default('draft'),
    publishedVersionId: uuid('published_version_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at').notNull().default(sql`now()`),
  },
  (table) => ({
    lessonSlugIdx: uniqueIndex('challenges_lesson_slug_idx').on(table.lessonId, table.slug),
  }),
);

export const challengeVersions = pgTable('challenge_versions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  challengeId: uuid('challenge_id')
    .notNull()
    .references(() => challenges.id, { onDelete: 'cascade' }),
  versionNo: integer('version_no').notNull().default(1),
  problemStatement: text('problem_statement').notNull(),
  hintText: text('hint_text'),
  expectedResultColumns: jsonb('expected_result_columns'),
  referenceSolution: text('reference_solution'),
  validatorType: varchar('validator_type', { length: 50 }).notNull().default('result_set'),
  validatorConfig: jsonb('validator_config'),
  isPublished: boolean('is_published').notNull().default(false),
  publishedAt: timestamp('published_at'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
});

// Templates
export const schemaTemplates = pgTable('schema_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  version: integer('version').notNull().default(1),
  definition: jsonb('definition').notNull(),
  status: contentStatusEnum('status').notNull().default('draft'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at').notNull().default(sql`now()`),
});

export const datasetTemplates = pgTable('dataset_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  schemaTemplateId: uuid('schema_template_id')
    .notNull()
    .references(() => schemaTemplates.id),
  name: varchar('name', { length: 100 }).notNull(),
  size: datasetSizeEnum('size').notNull(),
  rowCounts: jsonb('row_counts').notNull(),
  artifactUrl: text('artifact_url'),
  status: contentStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
});

// Runtime
export const learningSessions = pgTable(
  'learning_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    lessonVersionId: uuid('lesson_version_id')
      .notNull()
      .references(() => lessonVersions.id),
    challengeVersionId: uuid('challenge_version_id').references(() => challengeVersions.id),
    status: sessionStatusEnum('status').notNull().default('provisioning'),
    startedAt: timestamp('started_at').notNull().default(sql`now()`),
    lastActivityAt: timestamp('last_activity_at'),
    endedAt: timestamp('ended_at'),
    createdAt: timestamp('created_at').notNull().default(sql`now()`),
  },
  (table) => ({
    userStatusIdx: index('sessions_user_status_idx').on(
      table.userId,
      table.status,
      table.startedAt,
    ),
  }),
);

export const sandboxInstances = pgTable('sandbox_instances', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  learningSessionId: uuid('learning_session_id')
    .notNull()
    .references(() => learningSessions.id),
  schemaTemplateId: uuid('schema_template_id').references(() => schemaTemplates.id),
  datasetTemplateId: uuid('dataset_template_id').references(() => datasetTemplates.id),
  status: sandboxStatusEnum('status').notNull().default('requested'),
  containerRef: varchar('container_ref', { length: 255 }),
  dbName: varchar('db_name', { length: 100 }),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at').notNull().default(sql`now()`),
});

// Query Execution
export const queryExecutions = pgTable(
  'query_executions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    learningSessionId: uuid('learning_session_id')
      .notNull()
      .references(() => learningSessions.id),
    sandboxInstanceId: uuid('sandbox_instance_id').references(() => sandboxInstances.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sqlText: text('sql_text').notNull(),
    normalizedSql: text('normalized_sql'),
    status: queryStatusEnum('status').notNull().default('accepted'),
    durationMs: integer('duration_ms'),
    rowsReturned: integer('rows_returned'),
    rowsScanned: bigint('rows_scanned', { mode: 'number' }),
    resultPreview: jsonb('result_preview'),
    errorMessage: text('error_message'),
    errorCode: varchar('error_code', { length: 50 }),
    submittedAt: timestamp('submitted_at').notNull().default(sql`now()`),
  },
  (table) => ({
    sessionIdx: index('qe_session_idx').on(table.learningSessionId, table.submittedAt),
    userIdx: index('qe_user_idx').on(table.userId, table.submittedAt),
  }),
);

export const queryExecutionPlans = pgTable('query_execution_plans', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  queryExecutionId: uuid('query_execution_id')
    .notNull()
    .references(() => queryExecutions.id, { onDelete: 'cascade' }),
  planMode: planModeEnum('plan_mode').notNull(),
  rawPlan: jsonb('raw_plan').notNull(),
  planSummary: jsonb('plan_summary'),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
});

export const challengeAttempts = pgTable('challenge_attempts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  learningSessionId: uuid('learning_session_id')
    .notNull()
    .references(() => learningSessions.id),
  challengeVersionId: uuid('challenge_version_id')
    .notNull()
    .references(() => challengeVersions.id),
  queryExecutionId: uuid('query_execution_id')
    .notNull()
    .references(() => queryExecutions.id),
  attemptNo: integer('attempt_no').notNull().default(1),
  status: attemptStatusEnum('status').notNull().default('pending'),
  score: integer('score'),
  evaluation: jsonb('evaluation'),
  submittedAt: timestamp('submitted_at').notNull().default(sql`now()`),
});

// Platform Ops
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: uuid('resource_id'),
  payload: jsonb('payload'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
});

export const systemJobs = pgTable('system_jobs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  type: varchar('type', { length: 100 }).notNull(),
  status: jobStatusEnum('status').notNull().default('pending'),
  payload: jsonb('payload'),
  result: jsonb('result'),
  errorMessage: text('error_message'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  scheduledAt: timestamp('scheduled_at').notNull().default(sql`now()`),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
});

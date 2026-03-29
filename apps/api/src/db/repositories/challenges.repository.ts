import { and, asc, count, desc, eq, exists, gte, inArray, or, sql } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export type ChallengeRow = InferSelectModel<typeof schema.challenges>;
export type ChallengeVersionRow = InferSelectModel<typeof schema.challengeVersions>;
export type ChallengeAttemptRow = InferSelectModel<typeof schema.challengeAttempts>;
export type QueryExecutionRow = InferSelectModel<typeof schema.queryExecutions>;
export type InsertChallenge = InferInsertModel<typeof schema.challenges>;
export type InsertChallengeVersion = InferInsertModel<typeof schema.challengeVersions>;
export type InsertChallengeAttempt = InferInsertModel<typeof schema.challengeAttempts>;

export interface PublishedChallengeVersionRow {
  id: string;
  challengeId: string;
  challengeVisibility: ChallengeRow['visibility'];
  challengeCreatedBy: string | null;
  versionNo: number;
  problemStatement: string;
  hintText: string | null;
  expectedResultColumns: unknown;
  referenceSolution: string | null;
  validatorType: string;
  validatorConfig: unknown;
  isPublished: boolean;
  publishedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  points: number;
}

export interface PublishedChallengeVersionDetailRow {
  id: string;
  challengeId: string;
  visibility: ChallengeRow['visibility'];
  challengeCreatedBy: string | null;
  databaseId?: string | null;
  databaseName?: string | null;
  slug: string;
  title: string;
  description: string | null;
  difficulty: ChallengeRow['difficulty'];
  sortOrder: number;
  points: number;
  problemStatement: string;
  hintText: string | null;
  expectedResultColumns: unknown;
  validatorType: string;
  validatorConfig: unknown;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface ChallengeAttemptWithExecutionRow {
  id: string;
  learningSessionId: string;
  challengeVersionId: string;
  queryExecutionId: string;
  attemptNo: number;
  status: ChallengeAttemptRow['status'];
  score: number | null;
  evaluation: unknown;
  submittedAt: Date;
  sqlText: string;
  queryStatus: QueryExecutionRow['status'];
  rowsReturned: number | null;
  durationMs: number | null;
}

export interface ChallengeLeaderboardAttemptRow {
  attemptId: string;
  queryExecutionId: string;
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  sqlText: string;
  durationMs: number | null;
  score: number | null;
  status: ChallengeAttemptRow['status'];
  evaluation: unknown;
  submittedAt: Date;
}

export interface GlobalLeaderboardAttemptRow {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  challengeId: string;
  points: number;
  submittedAt: Date;
}

export interface SessionExecutionSummaryRow {
  id: string;
  sqlText: string;
  status: QueryExecutionRow['status'];
  durationMs: number | null;
  submittedAt: Date;
}

export interface SessionSubmissionContextRow {
  userId: string;
  challengeVersionId: string | null;
}

export interface ChallengeCatalogRow {
  id: string;
  databaseId?: string | null;
  databaseName?: string | null;
  databaseSlug?: string | null;
  slug: string;
  title: string;
  description: string | null;
  difficulty: ChallengeRow['difficulty'];
  sortOrder: number;
  visibility: ChallengeRow['visibility'];
  status: ChallengeRow['status'];
  points: number;
  datasetScale: ChallengeRow['datasetScale'];
  publishedVersionId: string | null;
  latestVersionId: string | null;
  latestVersionNo: number | null;
  validatorType: string | null;
  latestVersionReviewStatus: ChallengeVersionRow['reviewStatus'] | null;
  latestVersionReviewNotes: string | null;
  latestVersionReviewedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface ReviewChallengeRow extends ChallengeCatalogRow {
  createdById: string | null;
  createdByUsername: string | null;
  createdByDisplayName: string | null;
}

export interface EditableChallengeDetailRow {
  id: string;
  databaseId?: string | null;
  databaseName?: string | null;
  slug: string;
  title: string;
  description: string | null;
  difficulty: ChallengeRow['difficulty'];
  sortOrder: number;
  points: number;
  datasetScale: ChallengeRow['datasetScale'];
  visibility: ChallengeRow['visibility'];
  status: ChallengeRow['status'];
  publishedVersionId: string | null;
  createdBy: string | null;
  updatedAt: Date;
  createdAt: Date;
  versionId: string;
  versionNo: number;
  problemStatement: string;
  hintText: string | null;
  expectedResultColumns: unknown;
  referenceSolution: string | null;
  validatorType: string;
  validatorConfig: unknown;
  isPublished: boolean;
  reviewStatus: ChallengeVersionRow['reviewStatus'];
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  publishedAt: Date | null;
  versionCreatedAt: Date;
}

export class ChallengesRepository {
  private get db() {
    return getDb();
  }

  private async getVersionMetadataMap(
    versionIds: string[],
  ): Promise<
    Map<
      string,
      Pick<
        ChallengeVersionRow,
        | 'id'
        | 'versionNo'
        | 'validatorType'
        | 'reviewStatus'
        | 'reviewNotes'
        | 'reviewedAt'
      >
    >
  > {
    if (versionIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .select({
        id: schema.challengeVersions.id,
        versionNo: schema.challengeVersions.versionNo,
        validatorType: schema.challengeVersions.validatorType,
        reviewStatus: schema.challengeVersions.reviewStatus,
        reviewNotes: schema.challengeVersions.reviewNotes,
        reviewedAt: schema.challengeVersions.reviewedAt,
      })
      .from(schema.challengeVersions)
      .where(inArray(schema.challengeVersions.id, versionIds));

    return new Map(rows.map((row) => [row.id, row]));
  }

  private async getLatestVersionMap(
    challengeIds: string[],
  ): Promise<
    Map<
      string,
      Pick<
        ChallengeVersionRow,
        | 'id'
        | 'challengeId'
        | 'versionNo'
        | 'validatorType'
        | 'isPublished'
        | 'reviewStatus'
        | 'reviewNotes'
        | 'reviewedAt'
      >
    >
  > {
    if (challengeIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .select({
        id: schema.challengeVersions.id,
        challengeId: schema.challengeVersions.challengeId,
        versionNo: schema.challengeVersions.versionNo,
        validatorType: schema.challengeVersions.validatorType,
        isPublished: schema.challengeVersions.isPublished,
        reviewStatus: schema.challengeVersions.reviewStatus,
        reviewNotes: schema.challengeVersions.reviewNotes,
        reviewedAt: schema.challengeVersions.reviewedAt,
      })
      .from(schema.challengeVersions)
      .where(inArray(schema.challengeVersions.challengeId, challengeIds))
      .orderBy(desc(schema.challengeVersions.versionNo), desc(schema.challengeVersions.createdAt));

    const latest = new Map<
      string,
      Pick<
        ChallengeVersionRow,
        | 'id'
        | 'challengeId'
        | 'versionNo'
        | 'validatorType'
        | 'isPublished'
        | 'reviewStatus'
        | 'reviewNotes'
        | 'reviewedAt'
      >
    >();

    for (const row of rows) {
      if (!latest.has(row.challengeId)) {
        latest.set(row.challengeId, row);
      }
    }

    return latest;
  }

  async findPublishedVersionById(id: string): Promise<PublishedChallengeVersionRow | null> {
    const [row] = await this.db
      .select({
        id: schema.challengeVersions.id,
        challengeId: schema.challengeVersions.challengeId,
        challengeVisibility: schema.challenges.visibility,
        challengeCreatedBy: schema.challenges.createdBy,
        versionNo: schema.challengeVersions.versionNo,
        problemStatement: schema.challengeVersions.problemStatement,
        hintText: schema.challengeVersions.hintText,
        expectedResultColumns: schema.challengeVersions.expectedResultColumns,
        referenceSolution: schema.challengeVersions.referenceSolution,
        validatorType: schema.challengeVersions.validatorType,
        validatorConfig: schema.challengeVersions.validatorConfig,
        isPublished: schema.challengeVersions.isPublished,
        publishedAt: schema.challengeVersions.publishedAt,
        createdBy: schema.challengeVersions.createdBy,
        createdAt: schema.challengeVersions.createdAt,
        points: schema.challenges.points,
      })
      .from(schema.challengeVersions)
      .innerJoin(
        schema.challenges,
        eq(schema.challengeVersions.challengeId, schema.challenges.id),
      )
      .where(
        and(
          eq(schema.challengeVersions.id, id),
          eq(schema.challengeVersions.isPublished, true),
          eq(schema.challenges.status, 'published'),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async findVersionById(id: string): Promise<ChallengeVersionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.challengeVersions)
      .where(eq(schema.challengeVersions.id, id))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<ChallengeRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.challenges)
      .where(eq(schema.challenges.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByDatabaseAndSlug(databaseId: string, slug: string): Promise<ChallengeRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.challenges)
      .where(and(eq(schema.challenges.databaseId, databaseId), eq(schema.challenges.slug, slug)))
      .limit(1);
    return row ?? null;
  }

  async getLatestVersionNo(challengeId: string): Promise<number> {
    const [row] = await this.db
      .select({ versionNo: schema.challengeVersions.versionNo })
      .from(schema.challengeVersions)
      .where(eq(schema.challengeVersions.challengeId, challengeId))
      .orderBy(desc(schema.challengeVersions.versionNo))
      .limit(1);

    return row?.versionNo ?? 0;
  }

  async findPublishedVersionDetailById(id: string): Promise<PublishedChallengeVersionDetailRow | null> {
    const [row] = await this.db
      .select({
        id: schema.challengeVersions.id,
        challengeId: schema.challengeVersions.challengeId,
        visibility: schema.challenges.visibility,
        challengeCreatedBy: schema.challenges.createdBy,
        databaseId: schema.challenges.databaseId,
        databaseName: schema.schemaTemplates.name,
        slug: schema.challenges.slug,
        title: schema.challenges.title,
        description: schema.challenges.description,
        difficulty: schema.challenges.difficulty,
        sortOrder: schema.challenges.sortOrder,
        points: schema.challenges.points,
        problemStatement: schema.challengeVersions.problemStatement,
        hintText: schema.challengeVersions.hintText,
        expectedResultColumns: schema.challengeVersions.expectedResultColumns,
        validatorType: schema.challengeVersions.validatorType,
        validatorConfig: schema.challengeVersions.validatorConfig,
        publishedAt: schema.challengeVersions.publishedAt,
        createdAt: schema.challengeVersions.createdAt,
      })
      .from(schema.challengeVersions)
      .innerJoin(
        schema.challenges,
        eq(schema.challengeVersions.challengeId, schema.challenges.id),
      )
      .leftJoin(
        schema.schemaTemplates,
        eq(schema.challenges.databaseId, schema.schemaTemplates.id),
      )
      .where(
        and(
          eq(schema.challengeVersions.id, id),
          eq(schema.challengeVersions.isPublished, true),
          eq(schema.challenges.status, 'published'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findQueryExecution(
    id: string,
    sessionId: string,
    userId: string,
  ): Promise<QueryExecutionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.queryExecutions)
      .where(
        and(
          eq(schema.queryExecutions.id, id),
          eq(schema.queryExecutions.learningSessionId, sessionId),
          eq(schema.queryExecutions.userId, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listSessionExecutions(
    sessionId: string,
    userId: string,
  ): Promise<SessionExecutionSummaryRow[]> {
    return this.db
      .select({
        id: schema.queryExecutions.id,
        sqlText: schema.queryExecutions.sqlText,
        status: schema.queryExecutions.status,
        durationMs: schema.queryExecutions.durationMs,
        submittedAt: schema.queryExecutions.submittedAt,
      })
      .from(schema.queryExecutions)
      .where(
        and(
          eq(schema.queryExecutions.learningSessionId, sessionId),
          eq(schema.queryExecutions.userId, userId),
        ),
      )
      .orderBy(asc(schema.queryExecutions.submittedAt));
  }

  async findSessionSubmissionContext(sessionId: string): Promise<SessionSubmissionContextRow | null> {
    const [row] = await this.db
      .select({
        userId: schema.learningSessions.userId,
        challengeVersionId: schema.learningSessions.challengeVersionId,
      })
      .from(schema.learningSessions)
      .where(eq(schema.learningSessions.id, sessionId))
      .limit(1);

    return row ?? null;
  }

  async countAttempts(sessionId: string, challengeVersionId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(schema.challengeAttempts)
      .where(
        and(
          eq(schema.challengeAttempts.learningSessionId, sessionId),
          eq(schema.challengeAttempts.challengeVersionId, challengeVersionId),
        ),
      );
    return row?.count ?? 0;
  }

  async createAttempt(data: Omit<InsertChallengeAttempt, 'id' | 'submittedAt'>): Promise<ChallengeAttemptRow> {
    const [row] = await this.db.insert(schema.challengeAttempts).values(data).returning();
    return row;
  }

  async findAttemptById(id: string): Promise<ChallengeAttemptRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.challengeAttempts)
      .where(eq(schema.challengeAttempts.id, id))
      .limit(1);
    return row ?? null;
  }

  async findAttemptByQueryExecutionId(queryExecutionId: string): Promise<ChallengeAttemptRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.challengeAttempts)
      .where(eq(schema.challengeAttempts.queryExecutionId, queryExecutionId))
      .limit(1);

    return row ?? null;
  }

  async listAttemptsForUser(
    userId: string,
    challengeVersionId: string,
  ): Promise<ChallengeAttemptWithExecutionRow[]> {
    return this.db
      .select({
        id: schema.challengeAttempts.id,
        learningSessionId: schema.challengeAttempts.learningSessionId,
        challengeVersionId: schema.challengeAttempts.challengeVersionId,
        queryExecutionId: schema.challengeAttempts.queryExecutionId,
        attemptNo: schema.challengeAttempts.attemptNo,
        status: schema.challengeAttempts.status,
        score: schema.challengeAttempts.score,
        evaluation: schema.challengeAttempts.evaluation,
        submittedAt: schema.challengeAttempts.submittedAt,
        sqlText: schema.queryExecutions.sqlText,
        queryStatus: schema.queryExecutions.status,
        rowsReturned: schema.queryExecutions.rowsReturned,
        durationMs: schema.queryExecutions.durationMs,
      })
      .from(schema.challengeAttempts)
      .innerJoin(
        schema.learningSessions,
        eq(schema.challengeAttempts.learningSessionId, schema.learningSessions.id),
      )
      .innerJoin(
        schema.queryExecutions,
        eq(schema.challengeAttempts.queryExecutionId, schema.queryExecutions.id),
      )
      .where(
        and(
          eq(schema.learningSessions.userId, userId),
          eq(schema.challengeAttempts.challengeVersionId, challengeVersionId),
        ),
      )
      .orderBy(desc(schema.challengeAttempts.submittedAt));
  }

  async listAttemptsForChallengeVersion(
    challengeVersionId: string,
  ): Promise<ChallengeLeaderboardAttemptRow[]> {
    return this.db
      .select({
        attemptId: schema.challengeAttempts.id,
        queryExecutionId: schema.challengeAttempts.queryExecutionId,
        userId: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        sqlText: schema.queryExecutions.sqlText,
        durationMs: schema.queryExecutions.durationMs,
        score: schema.challengeAttempts.score,
        status: schema.challengeAttempts.status,
        evaluation: schema.challengeAttempts.evaluation,
        submittedAt: schema.challengeAttempts.submittedAt,
      })
      .from(schema.challengeAttempts)
      .innerJoin(
        schema.learningSessions,
        eq(schema.challengeAttempts.learningSessionId, schema.learningSessions.id),
      )
      .innerJoin(
        schema.queryExecutions,
        eq(schema.challengeAttempts.queryExecutionId, schema.queryExecutions.id),
      )
      .innerJoin(schema.users, eq(schema.learningSessions.userId, schema.users.id))
      .where(eq(schema.challengeAttempts.challengeVersionId, challengeVersionId))
      .orderBy(desc(schema.challengeAttempts.submittedAt));
  }

  async listPassedAttemptsForGlobalLeaderboard(
    since?: Date,
  ): Promise<GlobalLeaderboardAttemptRow[]> {
    const filters = [
      eq(schema.challengeAttempts.status, 'passed'),
      eq(schema.challenges.visibility, 'public'),
      since ? gte(schema.challengeAttempts.submittedAt, since) : null,
    ].filter((value): value is NonNullable<typeof value> => value !== null);

    return this.db
      .select({
        userId: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        challengeId: schema.challenges.id,
        points: schema.challenges.points,
        submittedAt: schema.challengeAttempts.submittedAt,
      })
      .from(schema.challengeAttempts)
      .innerJoin(
        schema.learningSessions,
        eq(schema.challengeAttempts.learningSessionId, schema.learningSessions.id),
      )
      .innerJoin(schema.users, eq(schema.learningSessions.userId, schema.users.id))
      .innerJoin(
        schema.challengeVersions,
        eq(schema.challengeAttempts.challengeVersionId, schema.challengeVersions.id),
      )
      .innerJoin(schema.challenges, eq(schema.challengeVersions.challengeId, schema.challenges.id))
      .where(filters.length === 1 ? filters[0] : and(...filters))
      .orderBy(desc(schema.challengeAttempts.submittedAt));
  }

  async getSessionUserId(sessionId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: schema.learningSessions.userId })
      .from(schema.learningSessions)
      .where(eq(schema.learningSessions.id, sessionId))
      .limit(1);
    return row?.userId ?? null;
  }

  async listPublishedChallenges(viewerUserId: string): Promise<ChallengeCatalogRow[]> {
    const privateAccess = and(
      eq(schema.challenges.visibility, 'private'),
      or(
        eq(schema.challenges.createdBy, viewerUserId),
        exists(
          this.db
            .select({ v: sql`1` })
            .from(schema.challengeInvites)
            .where(
              and(
                eq(schema.challengeInvites.challengeId, schema.challenges.id),
                eq(schema.challengeInvites.userId, viewerUserId),
              ),
            ),
        ),
      ),
    );

    const accessFilter = or(eq(schema.challenges.visibility, 'public'), privateAccess);

    const rows = await this.db
      .select({
        id: schema.challenges.id,
        databaseId: schema.challenges.databaseId,
        databaseName: schema.schemaTemplates.name,
        databaseSlug: schema.schemaTemplates.name,
        slug: schema.challenges.slug,
        title: schema.challenges.title,
        description: schema.challenges.description,
        difficulty: schema.challenges.difficulty,
        sortOrder: schema.challenges.sortOrder,
        visibility: schema.challenges.visibility,
        status: schema.challenges.status,
        points: schema.challenges.points,
        datasetScale: schema.challenges.datasetScale,
        publishedVersionId: schema.challenges.publishedVersionId,
        updatedAt: schema.challenges.updatedAt,
        createdAt: schema.challenges.createdAt,
      })
      .from(schema.challenges)
      .leftJoin(
        schema.schemaTemplates,
        eq(schema.challenges.databaseId, schema.schemaTemplates.id),
      )
      .where(and(eq(schema.challenges.status, 'published'), accessFilter))
      .orderBy(asc(schema.challenges.sortOrder));

    const publishedVersionMap = await this.getVersionMetadataMap(
      rows
        .map((row) => row.publishedVersionId)
        .filter((versionId): versionId is string => typeof versionId === 'string'),
    );

    return rows.map((row) => {
      const publishedVersion = row.publishedVersionId
        ? publishedVersionMap.get(row.publishedVersionId)
        : null;
      return {
        ...row,
        latestVersionId: publishedVersion?.id ?? null,
        latestVersionNo: publishedVersion?.versionNo ?? null,
        validatorType: publishedVersion?.validatorType ?? null,
        latestVersionReviewStatus: publishedVersion?.reviewStatus ?? null,
        latestVersionReviewNotes: publishedVersion?.reviewNotes ?? null,
        latestVersionReviewedAt: publishedVersion?.reviewedAt ?? null,
      };
    });
  }

  async listChallengesForUser(userId: string): Promise<ChallengeCatalogRow[]> {
    const rows = await this.db
      .select({
        id: schema.challenges.id,
        databaseId: schema.challenges.databaseId,
        databaseName: schema.schemaTemplates.name,
        databaseSlug: schema.schemaTemplates.name,
        slug: schema.challenges.slug,
        title: schema.challenges.title,
        description: schema.challenges.description,
        difficulty: schema.challenges.difficulty,
        sortOrder: schema.challenges.sortOrder,
        visibility: schema.challenges.visibility,
        status: schema.challenges.status,
        points: schema.challenges.points,
        datasetScale: schema.challenges.datasetScale,
        publishedVersionId: schema.challenges.publishedVersionId,
        updatedAt: schema.challenges.updatedAt,
        createdAt: schema.challenges.createdAt,
      })
      .from(schema.challenges)
      .leftJoin(
        schema.schemaTemplates,
        eq(schema.challenges.databaseId, schema.schemaTemplates.id),
      )
      .where(eq(schema.challenges.createdBy, userId))
      .orderBy(desc(schema.challenges.updatedAt));

    const latestVersionMap = await this.getLatestVersionMap(rows.map((row) => row.id));

    return rows.map((row) => {
      const latestVersion = latestVersionMap.get(row.id);
      return {
        ...row,
        latestVersionId: latestVersion?.id ?? null,
        latestVersionNo: latestVersion?.versionNo ?? null,
        validatorType: latestVersion?.validatorType ?? null,
        latestVersionReviewStatus: latestVersion?.reviewStatus ?? null,
        latestVersionReviewNotes: latestVersion?.reviewNotes ?? null,
        latestVersionReviewedAt: latestVersion?.reviewedAt ?? null,
      };
    });
  }

  async listChallengesForReview(): Promise<ReviewChallengeRow[]> {
    const rows = await this.db
      .select({
        id: schema.challenges.id,
        databaseId: schema.challenges.databaseId,
        databaseName: schema.schemaTemplates.name,
        databaseSlug: schema.schemaTemplates.name,
        slug: schema.challenges.slug,
        title: schema.challenges.title,
        description: schema.challenges.description,
        difficulty: schema.challenges.difficulty,
        sortOrder: schema.challenges.sortOrder,
        visibility: schema.challenges.visibility,
        status: schema.challenges.status,
        points: schema.challenges.points,
        datasetScale: schema.challenges.datasetScale,
        publishedVersionId: schema.challenges.publishedVersionId,
        createdById: schema.users.id,
        createdByUsername: schema.users.username,
        createdByDisplayName: schema.users.displayName,
        updatedAt: schema.challenges.updatedAt,
        createdAt: schema.challenges.createdAt,
      })
      .from(schema.challenges)
      .leftJoin(
        schema.schemaTemplates,
        eq(schema.challenges.databaseId, schema.schemaTemplates.id),
      )
      .leftJoin(schema.users, eq(schema.challenges.createdBy, schema.users.id))
      .where(and(eq(schema.challenges.status, 'draft'), eq(schema.challenges.visibility, 'public')))
      .orderBy(desc(schema.challenges.updatedAt));

    const latestVersionMap = await this.getLatestVersionMap(rows.map((row) => row.id));

    return rows.map((row) => {
      const latestVersion = latestVersionMap.get(row.id);
      return {
        ...row,
        latestVersionId: latestVersion?.id ?? null,
        latestVersionNo: latestVersion?.versionNo ?? null,
        validatorType: latestVersion?.validatorType ?? null,
        latestVersionReviewStatus: latestVersion?.reviewStatus ?? null,
        latestVersionReviewNotes: latestVersion?.reviewNotes ?? null,
        latestVersionReviewedAt: latestVersion?.reviewedAt ?? null,
      };
    }).filter(
      (row) =>
        row.latestVersionId !== null &&
        row.latestVersionReviewStatus === 'pending' &&
        row.publishedVersionId !== row.latestVersionId,
    );
  }

  /**
   * Paginated admin list of all challenges (any status), optional filter by schema template ids.
   */
  async listChallengesAdmin(options: {
    limit: number;
    offset: number;
    databaseIdsIn?: string[];
    status?: ChallengeRow['status'];
  }): Promise<{ items: ReviewChallengeRow[]; total: number }> {
    if (options.databaseIdsIn !== undefined && options.databaseIdsIn.length === 0) {
      return { items: [], total: 0 };
    }

    const conditions: ReturnType<typeof eq>[] = [];
    if (options.databaseIdsIn !== undefined && options.databaseIdsIn.length > 0) {
      conditions.push(inArray(schema.challenges.databaseId, options.databaseIdsIn));
    }
    if (options.status) {
      conditions.push(eq(schema.challenges.status, options.status));
    }

    const whereExpr =
      conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);

    const countBase = this.db.select({ count: count() }).from(schema.challenges);
    const [countRow] = whereExpr ? await countBase.where(whereExpr) : await countBase;
    const total = Number(countRow?.count ?? 0);

    if (total === 0) {
      return { items: [], total: 0 };
    }

    const listBase = this.db
      .select({
        id: schema.challenges.id,
        databaseId: schema.challenges.databaseId,
        databaseName: schema.schemaTemplates.name,
        databaseSlug: schema.schemaTemplates.name,
        slug: schema.challenges.slug,
        title: schema.challenges.title,
        description: schema.challenges.description,
        difficulty: schema.challenges.difficulty,
        sortOrder: schema.challenges.sortOrder,
        visibility: schema.challenges.visibility,
        status: schema.challenges.status,
        points: schema.challenges.points,
        datasetScale: schema.challenges.datasetScale,
        publishedVersionId: schema.challenges.publishedVersionId,
        createdById: schema.users.id,
        createdByUsername: schema.users.username,
        createdByDisplayName: schema.users.displayName,
        updatedAt: schema.challenges.updatedAt,
        createdAt: schema.challenges.createdAt,
      })
      .from(schema.challenges)
      .leftJoin(
        schema.schemaTemplates,
        eq(schema.challenges.databaseId, schema.schemaTemplates.id),
      )
      .leftJoin(schema.users, eq(schema.challenges.createdBy, schema.users.id));

    const filteredList = whereExpr ? listBase.where(whereExpr) : listBase;

    const rows = await filteredList
      .orderBy(desc(schema.challenges.updatedAt))
      .limit(options.limit)
      .offset(options.offset);

    const latestVersionMap = await this.getLatestVersionMap(rows.map((row) => row.id));

    const items: ReviewChallengeRow[] = rows.map((row) => {
      const latestVersion = latestVersionMap.get(row.id);
      return {
        ...row,
        latestVersionId: latestVersion?.id ?? null,
        latestVersionNo: latestVersion?.versionNo ?? null,
        validatorType: latestVersion?.validatorType ?? null,
        latestVersionReviewStatus: latestVersion?.reviewStatus ?? null,
        latestVersionReviewNotes: latestVersion?.reviewNotes ?? null,
        latestVersionReviewedAt: latestVersion?.reviewedAt ?? null,
      };
    });

    return { items, total };
  }

  async createChallenge(data: Omit<InsertChallenge, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChallengeRow> {
    const [row] = await this.db.insert(schema.challenges).values(data).returning();
    return row;
  }

  async updateChallenge(
    id: string,
    data: Partial<Omit<InsertChallenge, 'id' | 'createdAt' | 'createdBy'>>,
  ): Promise<ChallengeRow | null> {
    const [row] = await this.db
      .update(schema.challenges)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.challenges.id, id))
      .returning();

    return row ?? null;
  }

  async createVersion(data: Omit<InsertChallengeVersion, 'id' | 'createdAt'>): Promise<ChallengeVersionRow> {
    const [row] = await this.db.insert(schema.challengeVersions).values(data).returning();
    return row;
  }

  async reviewVersion(
    versionId: string,
    reviewStatus: ChallengeVersionRow['reviewStatus'],
    reviewNotes: string | null,
    reviewedBy: string,
  ): Promise<ChallengeVersionRow | null> {
    const [row] = await this.db
      .update(schema.challengeVersions)
      .set({
        reviewStatus,
        reviewNotes,
        reviewedBy,
        reviewedAt: new Date(),
      })
      .where(eq(schema.challengeVersions.id, versionId))
      .returning();

    return row ?? null;
  }

  async publishVersion(
    versionId: string,
    challengeId: string,
    review?: {
      reviewedBy?: string;
      reviewNotes?: string | null;
    },
  ): Promise<ChallengeVersionRow | null> {
    const now = new Date();

    await this.db
      .update(schema.challengeVersions)
      .set({ isPublished: false })
      .where(eq(schema.challengeVersions.challengeId, challengeId));

    const [published] = await this.db
      .update(schema.challengeVersions)
      .set({
        isPublished: true,
        publishedAt: now,
        reviewStatus: 'approved',
        reviewNotes: review?.reviewNotes ?? null,
        reviewedBy: review?.reviewedBy ?? null,
        reviewedAt: review?.reviewedBy ? now : null,
      })
      .where(eq(schema.challengeVersions.id, versionId))
      .returning();

    await this.db
      .update(schema.challenges)
      .set({ publishedVersionId: versionId, status: 'published', updatedAt: now })
      .where(eq(schema.challenges.id, challengeId));

    return published ?? null;
  }

  async findEditableChallengeById(id: string): Promise<EditableChallengeDetailRow | null> {
    const [row] = await this.db
      .select({
        id: schema.challenges.id,
        databaseId: schema.challenges.databaseId,
        databaseName: schema.schemaTemplates.name,
        slug: schema.challenges.slug,
        title: schema.challenges.title,
        description: schema.challenges.description,
        difficulty: schema.challenges.difficulty,
        sortOrder: schema.challenges.sortOrder,
        points: schema.challenges.points,
        datasetScale: schema.challenges.datasetScale,
        visibility: schema.challenges.visibility,
        status: schema.challenges.status,
        publishedVersionId: schema.challenges.publishedVersionId,
        createdBy: schema.challenges.createdBy,
        updatedAt: schema.challenges.updatedAt,
        createdAt: schema.challenges.createdAt,
        versionId: schema.challengeVersions.id,
        versionNo: schema.challengeVersions.versionNo,
        problemStatement: schema.challengeVersions.problemStatement,
        hintText: schema.challengeVersions.hintText,
        expectedResultColumns: schema.challengeVersions.expectedResultColumns,
        referenceSolution: schema.challengeVersions.referenceSolution,
        validatorType: schema.challengeVersions.validatorType,
        validatorConfig: schema.challengeVersions.validatorConfig,
        isPublished: schema.challengeVersions.isPublished,
        reviewStatus: schema.challengeVersions.reviewStatus,
        reviewNotes: schema.challengeVersions.reviewNotes,
        reviewedBy: schema.challengeVersions.reviewedBy,
        reviewedAt: schema.challengeVersions.reviewedAt,
        publishedAt: schema.challengeVersions.publishedAt,
        versionCreatedAt: schema.challengeVersions.createdAt,
      })
      .from(schema.challengeVersions)
      .innerJoin(
        schema.challenges,
        eq(schema.challengeVersions.challengeId, schema.challenges.id),
      )
      .leftJoin(
        schema.schemaTemplates,
        eq(schema.challenges.databaseId, schema.schemaTemplates.id),
      )
      .where(eq(schema.challenges.id, id))
      .orderBy(desc(schema.challengeVersions.versionNo), desc(schema.challengeVersions.createdAt))
      .limit(1);

    return row ?? null;
  }

  async countAttemptsForChallenge(challengeId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(schema.challengeAttempts)
      .innerJoin(
        schema.challengeVersions,
        eq(schema.challengeAttempts.challengeVersionId, schema.challengeVersions.id),
      )
      .where(eq(schema.challengeVersions.challengeId, challengeId));
    return Number(row?.n ?? 0);
  }

  async listChallengeInviteUserIds(challengeId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: schema.challengeInvites.userId })
      .from(schema.challengeInvites)
      .where(eq(schema.challengeInvites.challengeId, challengeId));
    return rows.map((r) => r.userId);
  }

  async isUserInvitedToChallenge(challengeId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.challengeInvites.id })
      .from(schema.challengeInvites)
      .where(
        and(
          eq(schema.challengeInvites.challengeId, challengeId),
          eq(schema.challengeInvites.userId, userId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async countUsersWithIds(userIds: string[]): Promise<number> {
    if (userIds.length === 0) {
      return 0;
    }
    const [row] = await this.db
      .select({ n: count() })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds));
    return Number(row?.n ?? 0);
  }

  async replaceChallengeInvites(
    challengeId: string,
    userIds: string[],
    invitedBy: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.challengeInvites)
        .where(eq(schema.challengeInvites.challengeId, challengeId));
      if (userIds.length === 0) {
        return;
      }
      await tx.insert(schema.challengeInvites).values(
        userIds.map((userId) => ({
          challengeId,
          userId,
          invitedBy,
        })),
      );
    });
  }

  async deleteChallenge(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.challenges)
      .where(eq(schema.challenges.id, id))
      .returning({ id: schema.challenges.id });
    return deleted.length > 0;
  }

  async updateVersion(
    versionId: string,
    data: Partial<{
      problemStatement: string;
      hintText: string | null;
      expectedResultColumns: unknown;
      referenceSolution: string | null;
      validatorType: string;
      validatorConfig: unknown;
    }>,
  ): Promise<ChallengeVersionRow | null> {
    const [row] = await this.db
      .update(schema.challengeVersions)
      .set(data)
      .where(eq(schema.challengeVersions.id, versionId))
      .returning();
    return row ?? null;
  }
}

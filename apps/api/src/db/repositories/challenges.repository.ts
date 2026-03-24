import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export type ChallengeRow = InferSelectModel<typeof schema.challenges>;
export type ChallengeVersionRow = InferSelectModel<typeof schema.challengeVersions>;
export type ChallengeAttemptRow = InferSelectModel<typeof schema.challengeAttempts>;
export type QueryExecutionRow = InferSelectModel<typeof schema.queryExecutions>;
export type InsertChallenge = InferInsertModel<typeof schema.challenges>;
export type InsertChallengeVersion = InferInsertModel<typeof schema.challengeVersions>;
export type InsertChallengeAttempt = InferInsertModel<typeof schema.challengeAttempts>;

export interface PublishedChallengeVersionRow extends ChallengeVersionRow {
  points: number;
}

export interface PublishedChallengeVersionDetailRow {
  id: string;
  challengeId: string;
  lessonId: string;
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
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  score: number | null;
  status: ChallengeAttemptRow['status'];
  submittedAt: Date;
}

export interface SessionExecutionSummaryRow {
  id: string;
  sqlText: string;
  status: QueryExecutionRow['status'];
  durationMs: number | null;
  submittedAt: Date;
}

export interface ChallengeCatalogRow {
  id: string;
  lessonId: string;
  lessonSlug: string;
  lessonTitle: string;
  trackId: string;
  trackSlug: string;
  trackTitle: string;
  slug: string;
  title: string;
  description: string | null;
  difficulty: ChallengeRow['difficulty'];
  sortOrder: number;
  status: ChallengeRow['status'];
  points: number;
  publishedVersionId: string | null;
  latestVersionId: string | null;
  latestVersionNo: number | null;
  validatorType: string | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface ReviewChallengeRow extends ChallengeCatalogRow {
  createdById: string | null;
  createdByUsername: string | null;
  createdByDisplayName: string | null;
}

export class ChallengesRepository {
  private get db() {
    return getDb();
  }

  private async getLatestVersionMap(
    challengeIds: string[],
  ): Promise<
    Map<
      string,
      Pick<ChallengeVersionRow, 'id' | 'challengeId' | 'versionNo' | 'validatorType'>
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
      })
      .from(schema.challengeVersions)
      .where(inArray(schema.challengeVersions.challengeId, challengeIds))
      .orderBy(desc(schema.challengeVersions.versionNo), desc(schema.challengeVersions.createdAt));

    const latest = new Map<
      string,
      Pick<ChallengeVersionRow, 'id' | 'challengeId' | 'versionNo' | 'validatorType'>
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

  async findPublishedVersionDetailById(id: string): Promise<PublishedChallengeVersionDetailRow | null> {
    const [row] = await this.db
      .select({
        id: schema.challengeVersions.id,
        challengeId: schema.challengeVersions.challengeId,
        lessonId: schema.challenges.lessonId,
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
        publishedAt: schema.challengeVersions.publishedAt,
        createdAt: schema.challengeVersions.createdAt,
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
        userId: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        score: schema.challengeAttempts.score,
        status: schema.challengeAttempts.status,
        submittedAt: schema.challengeAttempts.submittedAt,
      })
      .from(schema.challengeAttempts)
      .innerJoin(
        schema.learningSessions,
        eq(schema.challengeAttempts.learningSessionId, schema.learningSessions.id),
      )
      .innerJoin(schema.users, eq(schema.learningSessions.userId, schema.users.id))
      .where(eq(schema.challengeAttempts.challengeVersionId, challengeVersionId))
      .orderBy(desc(schema.challengeAttempts.score), desc(schema.challengeAttempts.submittedAt));
  }

  async getSessionUserId(sessionId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: schema.learningSessions.userId })
      .from(schema.learningSessions)
      .where(eq(schema.learningSessions.id, sessionId))
      .limit(1);
    return row?.userId ?? null;
  }

  async listPublishedChallenges(): Promise<ChallengeCatalogRow[]> {
    const rows = await this.db
      .select({
        id: schema.challenges.id,
        lessonId: schema.lessons.id,
        lessonSlug: schema.lessons.slug,
        lessonTitle: schema.lessons.title,
        trackId: schema.tracks.id,
        trackSlug: schema.tracks.slug,
        trackTitle: schema.tracks.title,
        slug: schema.challenges.slug,
        title: schema.challenges.title,
        description: schema.challenges.description,
        difficulty: schema.challenges.difficulty,
        sortOrder: schema.challenges.sortOrder,
        status: schema.challenges.status,
        points: schema.challenges.points,
        publishedVersionId: schema.challenges.publishedVersionId,
        updatedAt: schema.challenges.updatedAt,
        createdAt: schema.challenges.createdAt,
      })
      .from(schema.challenges)
      .innerJoin(schema.lessons, eq(schema.challenges.lessonId, schema.lessons.id))
      .innerJoin(schema.tracks, eq(schema.lessons.trackId, schema.tracks.id))
      .where(eq(schema.challenges.status, 'published'))
      .orderBy(
        asc(schema.tracks.sortOrder),
        asc(schema.lessons.sortOrder),
        asc(schema.challenges.sortOrder),
      );

    const latestVersionMap = await this.getLatestVersionMap(rows.map((row) => row.id));

    return rows.map((row) => {
      const latestVersion = latestVersionMap.get(row.id);
      return {
        ...row,
        latestVersionId: latestVersion?.id ?? null,
        latestVersionNo: latestVersion?.versionNo ?? null,
        validatorType: latestVersion?.validatorType ?? null,
      };
    });
  }

  async listChallengesForUser(userId: string): Promise<ChallengeCatalogRow[]> {
    const rows = await this.db
      .select({
        id: schema.challenges.id,
        lessonId: schema.lessons.id,
        lessonSlug: schema.lessons.slug,
        lessonTitle: schema.lessons.title,
        trackId: schema.tracks.id,
        trackSlug: schema.tracks.slug,
        trackTitle: schema.tracks.title,
        slug: schema.challenges.slug,
        title: schema.challenges.title,
        description: schema.challenges.description,
        difficulty: schema.challenges.difficulty,
        sortOrder: schema.challenges.sortOrder,
        status: schema.challenges.status,
        points: schema.challenges.points,
        publishedVersionId: schema.challenges.publishedVersionId,
        updatedAt: schema.challenges.updatedAt,
        createdAt: schema.challenges.createdAt,
      })
      .from(schema.challenges)
      .innerJoin(schema.lessons, eq(schema.challenges.lessonId, schema.lessons.id))
      .innerJoin(schema.tracks, eq(schema.lessons.trackId, schema.tracks.id))
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
      };
    });
  }

  async listChallengesForReview(): Promise<ReviewChallengeRow[]> {
    const rows = await this.db
      .select({
        id: schema.challenges.id,
        lessonId: schema.lessons.id,
        lessonSlug: schema.lessons.slug,
        lessonTitle: schema.lessons.title,
        trackId: schema.tracks.id,
        trackSlug: schema.tracks.slug,
        trackTitle: schema.tracks.title,
        slug: schema.challenges.slug,
        title: schema.challenges.title,
        description: schema.challenges.description,
        difficulty: schema.challenges.difficulty,
        sortOrder: schema.challenges.sortOrder,
        status: schema.challenges.status,
        points: schema.challenges.points,
        publishedVersionId: schema.challenges.publishedVersionId,
        createdById: schema.users.id,
        createdByUsername: schema.users.username,
        createdByDisplayName: schema.users.displayName,
        updatedAt: schema.challenges.updatedAt,
        createdAt: schema.challenges.createdAt,
      })
      .from(schema.challenges)
      .innerJoin(schema.lessons, eq(schema.challenges.lessonId, schema.lessons.id))
      .innerJoin(schema.tracks, eq(schema.lessons.trackId, schema.tracks.id))
      .leftJoin(schema.users, eq(schema.challenges.createdBy, schema.users.id))
      .where(eq(schema.challenges.status, 'draft'))
      .orderBy(desc(schema.challenges.updatedAt));

    const latestVersionMap = await this.getLatestVersionMap(rows.map((row) => row.id));

    return rows.map((row) => {
      const latestVersion = latestVersionMap.get(row.id);
      return {
        ...row,
        latestVersionId: latestVersion?.id ?? null,
        latestVersionNo: latestVersion?.versionNo ?? null,
        validatorType: latestVersion?.validatorType ?? null,
      };
    });
  }

  async createChallenge(data: Omit<InsertChallenge, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChallengeRow> {
    const [row] = await this.db.insert(schema.challenges).values(data).returning();
    return row;
  }

  async createVersion(data: Omit<InsertChallengeVersion, 'id' | 'createdAt'>): Promise<ChallengeVersionRow> {
    const [row] = await this.db.insert(schema.challengeVersions).values(data).returning();
    return row;
  }

  async publishVersion(versionId: string, challengeId: string): Promise<ChallengeVersionRow | null> {
    const now = new Date();

    await this.db
      .update(schema.challengeVersions)
      .set({ isPublished: false })
      .where(eq(schema.challengeVersions.challengeId, challengeId));

    const [published] = await this.db
      .update(schema.challengeVersions)
      .set({ isPublished: true, publishedAt: now })
      .where(eq(schema.challengeVersions.id, versionId))
      .returning();

    await this.db
      .update(schema.challenges)
      .set({ publishedVersionId: versionId, status: 'published', updatedAt: now })
      .where(eq(schema.challenges.id, challengeId));

    return published ?? null;
  }
}

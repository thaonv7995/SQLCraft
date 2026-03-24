import { eq, and, count, desc } from 'drizzle-orm';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export type ChallengeRow = InferSelectModel<typeof schema.challenges>;
export type ChallengeVersionRow = InferSelectModel<typeof schema.challengeVersions>;
export type ChallengeAttemptRow = InferSelectModel<typeof schema.challengeAttempts>;
export type QueryExecutionRow = InferSelectModel<typeof schema.queryExecutions>;
export type InsertChallenge = InferInsertModel<typeof schema.challenges>;
export type InsertChallengeVersion = InferInsertModel<typeof schema.challengeVersions>;
export type InsertChallengeAttempt = InferInsertModel<typeof schema.challengeAttempts>;

export interface PublishedChallengeVersionDetailRow {
  id: string;
  challengeId: string;
  lessonId: string;
  slug: string;
  title: string;
  description: string | null;
  difficulty: ChallengeRow['difficulty'];
  sortOrder: number;
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

export class ChallengesRepository {
  private get db() {
    return getDb();
  }

  async findPublishedVersionById(id: string): Promise<ChallengeVersionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.challengeVersions)
      .where(and(eq(schema.challengeVersions.id, id), eq(schema.challengeVersions.isPublished, true)))
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

export const challengesRepository = new ChallengesRepository();

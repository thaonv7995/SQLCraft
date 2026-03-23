import { eq, and, count } from 'drizzle-orm';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export type ChallengeRow = InferSelectModel<typeof schema.challenges>;
export type ChallengeVersionRow = InferSelectModel<typeof schema.challengeVersions>;
export type ChallengeAttemptRow = InferSelectModel<typeof schema.challengeAttempts>;
export type QueryExecutionRow = InferSelectModel<typeof schema.queryExecutions>;
export type InsertChallenge = InferInsertModel<typeof schema.challenges>;
export type InsertChallengeVersion = InferInsertModel<typeof schema.challengeVersions>;
export type InsertChallengeAttempt = InferInsertModel<typeof schema.challengeAttempts>;

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

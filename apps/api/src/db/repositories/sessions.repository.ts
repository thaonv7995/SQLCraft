import { eq, and } from 'drizzle-orm';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export type SessionRow = InferSelectModel<typeof schema.learningSessions>;
export type SandboxRow = InferSelectModel<typeof schema.sandboxInstances>;
export type InsertSession = InferInsertModel<typeof schema.learningSessions>;
export type InsertSandbox = InferInsertModel<typeof schema.sandboxInstances>;
export type LessonVersionRow = InferSelectModel<typeof schema.lessonVersions>;
export type ChallengeVersionRow = InferSelectModel<typeof schema.challengeVersions>;

export class SessionsRepository {
  private get db() {
    return getDb();
  }

  async findPublishedLessonVersion(id: string): Promise<LessonVersionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.lessonVersions)
      .where(and(eq(schema.lessonVersions.id, id), eq(schema.lessonVersions.isPublished, true)))
      .limit(1);
    return row ?? null;
  }

  async findPublishedChallengeVersion(id: string): Promise<ChallengeVersionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.challengeVersions)
      .where(and(eq(schema.challengeVersions.id, id), eq(schema.challengeVersions.isPublished, true)))
      .limit(1);
    return row ?? null;
  }

  async createSession(data: Omit<InsertSession, 'id' | 'createdAt' | 'startedAt'>): Promise<SessionRow> {
    const [row] = await this.db.insert(schema.learningSessions).values(data).returning();
    return row;
  }

  async findById(id: string): Promise<SessionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.learningSessions)
      .where(eq(schema.learningSessions.id, id))
      .limit(1);
    return row ?? null;
  }

  async endSession(id: string): Promise<Pick<SessionRow, 'id' | 'status' | 'endedAt'> | null> {
    const now = new Date();
    const [row] = await this.db
      .update(schema.learningSessions)
      .set({ status: 'ended', endedAt: now, lastActivityAt: now })
      .where(eq(schema.learningSessions.id, id))
      .returning({
        id: schema.learningSessions.id,
        status: schema.learningSessions.status,
        endedAt: schema.learningSessions.endedAt,
      });
    return row ?? null;
  }

  async updateActivity(id: string): Promise<void> {
    await this.db
      .update(schema.learningSessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(schema.learningSessions.id, id));
  }

  async createSandbox(data: Omit<InsertSandbox, 'id' | 'createdAt' | 'updatedAt'>): Promise<SandboxRow> {
    const [row] = await this.db.insert(schema.sandboxInstances).values(data).returning();
    return row;
  }

  async getSandboxBySessionId(
    sessionId: string,
  ): Promise<Pick<SandboxRow, 'id' | 'status' | 'dbName' | 'expiresAt' | 'updatedAt'> | null> {
    const [row] = await this.db
      .select({
        id: schema.sandboxInstances.id,
        status: schema.sandboxInstances.status,
        dbName: schema.sandboxInstances.dbName,
        expiresAt: schema.sandboxInstances.expiresAt,
        updatedAt: schema.sandboxInstances.updatedAt,
      })
      .from(schema.sandboxInstances)
      .where(eq(schema.sandboxInstances.learningSessionId, sessionId))
      .limit(1);
    return row ?? null;
  }

  async expireSandboxBySessionId(sessionId: string): Promise<void> {
    await this.db
      .update(schema.sandboxInstances)
      .set({ status: 'expiring', updatedAt: new Date() })
      .where(eq(schema.sandboxInstances.learningSessionId, sessionId));
  }

  async enqueueJob(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.db.insert(schema.systemJobs).values({
      type,
      status: 'pending',
      payload,
    });
  }
}

export const sessionsRepository = new SessionsRepository();

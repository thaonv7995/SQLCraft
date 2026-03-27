import { eq, and, desc, inArray, lte, sql } from 'drizzle-orm';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export type SchemaTemplateRow = InferSelectModel<typeof schema.schemaTemplates>;
export type DatasetTemplateRow = InferSelectModel<typeof schema.datasetTemplates>;

export type SessionRow = InferSelectModel<typeof schema.learningSessions>;
export type SandboxRow = InferSelectModel<typeof schema.sandboxInstances>;
export type InsertSession = InferInsertModel<typeof schema.learningSessions>;
export type InsertSandbox = InferInsertModel<typeof schema.sandboxInstances>;
export type ChallengeVersionRow = InferSelectModel<typeof schema.challengeVersions>;
export type ChallengeVersionWithDatabaseRow = ChallengeVersionRow & {
  databaseId: string;
};

export class SessionsRepository {
  private get db() {
    return getDb();
  }

  async findPublishedChallengeVersion(id: string): Promise<ChallengeVersionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.challengeVersions)
      .where(and(eq(schema.challengeVersions.id, id), eq(schema.challengeVersions.isPublished, true)))
      .limit(1);
    return row ?? null;
  }

  async findPublishedChallengeVersionWithDatabase(
    id: string,
  ): Promise<ChallengeVersionWithDatabaseRow | null> {
    const [row] = await this.db
      .select({
        id: schema.challengeVersions.id,
        challengeId: schema.challengeVersions.challengeId,
        databaseId: schema.challenges.databaseId,
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
        createdAt: schema.challengeVersions.createdAt,
        createdBy: schema.challengeVersions.createdBy,
      })
      .from(schema.challengeVersions)
      .innerJoin(schema.challenges, eq(schema.challenges.id, schema.challengeVersions.challengeId))
      .where(
        and(
          eq(schema.challengeVersions.id, id),
          eq(schema.challengeVersions.isPublished, true),
          eq(schema.challenges.status, 'published'),
          eq(schema.challenges.publishedVersionId, id),
        ),
      )
      .limit(1);

    return row && row.databaseId ? { ...row, databaseId: row.databaseId } : null;
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

  async expireSession(
    id: string,
  ): Promise<Pick<SessionRow, 'id' | 'status' | 'endedAt' | 'lastActivityAt'> | null> {
    const now = new Date();
    const [row] = await this.db
      .update(schema.learningSessions)
      .set({ status: 'expired', endedAt: now, lastActivityAt: now })
      .where(eq(schema.learningSessions.id, id))
      .returning({
        id: schema.learningSessions.id,
        status: schema.learningSessions.status,
        endedAt: schema.learningSessions.endedAt,
        lastActivityAt: schema.learningSessions.lastActivityAt,
      });

    return row ?? null;
  }

  async updateActivity(id: string): Promise<void> {
    await this.db
      .update(schema.learningSessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(schema.learningSessions.id, id));
  }

  /**
   * Sliding TTL: bump session activity and extend sandbox `expires_at` (ready sandboxes only).
   */
  async touchActivityAndExtendSandboxExpiry(sessionId: string, expiresAt: Date): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.learningSessions)
        .set({ lastActivityAt: now })
        .where(eq(schema.learningSessions.id, sessionId));

      await tx
        .update(schema.sandboxInstances)
        .set({ expiresAt, updatedAt: now })
        .where(
          and(
            eq(schema.sandboxInstances.learningSessionId, sessionId),
            eq(schema.sandboxInstances.status, 'ready'),
          ),
        );
    });
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

  async findByUserId(
    userId: string,
    limit = 20,
  ): Promise<
    Array<
      SessionRow & {
        sandboxStatus: string | null;
        schemaTemplateName: string | null;
      }
    >
  > {
    const rows = await this.db
      .select({
        id: schema.learningSessions.id,
        userId: schema.learningSessions.userId,
        challengeVersionId: schema.learningSessions.challengeVersionId,
        status: schema.learningSessions.status,
        startedAt: schema.learningSessions.startedAt,
        lastActivityAt: schema.learningSessions.lastActivityAt,
        endedAt: schema.learningSessions.endedAt,
        createdAt: schema.learningSessions.createdAt,
        sandboxStatus: schema.sandboxInstances.status,
        schemaTemplateName: schema.schemaTemplates.name,
      })
      .from(schema.learningSessions)
      .leftJoin(
        schema.sandboxInstances,
        eq(schema.sandboxInstances.learningSessionId, schema.learningSessions.id),
      )
      .leftJoin(
        schema.schemaTemplates,
        eq(schema.schemaTemplates.id, schema.sandboxInstances.schemaTemplateId),
      )
      .where(eq(schema.learningSessions.userId, userId))
      .orderBy(desc(schema.learningSessions.startedAt))
      .limit(limit);

    return rows as Array<
      SessionRow & {
        sandboxStatus: string | null;
        schemaTemplateName: string | null;
      }
    >;
  }

  async findStaleSessions(
    cutoff: Date,
    statuses: SessionRow['status'][],
    limit = 100,
  ): Promise<SessionRow[]> {
    return this.db
      .select()
      .from(schema.learningSessions)
      .where(
        and(
          inArray(schema.learningSessions.status, statuses),
          lte(
            sql`coalesce(${schema.learningSessions.lastActivityAt}, ${schema.learningSessions.startedAt}, ${schema.learningSessions.createdAt})`,
            cutoff,
          ),
        ),
      )
      .orderBy(desc(schema.learningSessions.startedAt))
      .limit(limit);
  }

  async expireSandboxBySessionId(sessionId: string): Promise<void> {
    await this.db
      .update(schema.sandboxInstances)
      .set({ status: 'expiring', updatedAt: new Date() })
      .where(eq(schema.sandboxInstances.learningSessionId, sessionId));
  }

  async findDetailedSandboxBySessionId(sessionId: string): Promise<SandboxRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.sandboxInstances)
      .where(eq(schema.sandboxInstances.learningSessionId, sessionId))
      .limit(1);

    return row ?? null;
  }

  async listPublishedDatasetTemplatesBySchema(
    schemaTemplateId: string,
  ): Promise<DatasetTemplateRow[]> {
    return this.db
      .select()
      .from(schema.datasetTemplates)
      .where(
        and(
          eq(schema.datasetTemplates.schemaTemplateId, schemaTemplateId),
          eq(schema.datasetTemplates.status, 'published'),
        ),
      );
  }

  async findDatasetTemplateById(datasetTemplateId: string): Promise<DatasetTemplateRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.datasetTemplates)
      .where(eq(schema.datasetTemplates.id, datasetTemplateId))
      .limit(1);

    return row ?? null;
  }

  async findSchemaTemplateById(schemaTemplateId: string): Promise<SchemaTemplateRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.schemaTemplates)
      .where(eq(schema.schemaTemplates.id, schemaTemplateId))
      .limit(1);

    return row ?? null;
  }

}

export const sessionsRepository = new SessionsRepository();

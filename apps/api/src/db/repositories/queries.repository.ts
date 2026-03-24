import { eq, desc, count } from 'drizzle-orm';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export type QueryExecutionRow = InferSelectModel<typeof schema.queryExecutions>;
export type QueryExecutionPlanRow = InferSelectModel<typeof schema.queryExecutionPlans>;
export type InsertQueryExecution = InferInsertModel<typeof schema.queryExecutions>;
export type SessionRow = InferSelectModel<typeof schema.learningSessions>;
export type SandboxRow = InferSelectModel<typeof schema.sandboxInstances>;

export class QueriesRepository {
  private get db() {
    return getDb();
  }

  async findSessionById(id: string): Promise<SessionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.learningSessions)
      .where(eq(schema.learningSessions.id, id))
      .limit(1);
    return row ?? null;
  }

  async findSandboxBySessionId(sessionId: string): Promise<SandboxRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.sandboxInstances)
      .where(eq(schema.sandboxInstances.learningSessionId, sessionId))
      .limit(1);
    return row ?? null;
  }

  async createExecution(data: Omit<InsertQueryExecution, 'id' | 'submittedAt'>): Promise<QueryExecutionRow> {
    const [row] = await this.db.insert(schema.queryExecutions).values(data).returning();
    return row;
  }

  async findById(id: string): Promise<QueryExecutionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.queryExecutions)
      .where(eq(schema.queryExecutions.id, id))
      .limit(1);
    return row ?? null;
  }

  async getExecutionPlans(queryExecutionId: string): Promise<QueryExecutionPlanRow[]> {
    return this.db
      .select()
      .from(schema.queryExecutionPlans)
      .where(eq(schema.queryExecutionPlans.queryExecutionId, queryExecutionId));
  }

  async listBySession(
    sessionId: string,
    page: number,
    limit: number,
  ): Promise<Pick<QueryExecutionRow, 'id' | 'sqlText' | 'status' | 'durationMs' | 'rowsReturned' | 'errorMessage' | 'submittedAt'>[]> {
    const offset = (page - 1) * limit;
    return this.db
      .select({
        id: schema.queryExecutions.id,
        sqlText: schema.queryExecutions.sqlText,
        status: schema.queryExecutions.status,
        durationMs: schema.queryExecutions.durationMs,
        rowsReturned: schema.queryExecutions.rowsReturned,
        errorMessage: schema.queryExecutions.errorMessage,
        submittedAt: schema.queryExecutions.submittedAt,
      })
      .from(schema.queryExecutions)
      .where(eq(schema.queryExecutions.learningSessionId, sessionId))
      .orderBy(desc(schema.queryExecutions.submittedAt))
      .limit(limit)
      .offset(offset);
  }

  async countByUser(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(schema.queryExecutions)
      .where(eq(schema.queryExecutions.userId, userId));
    return Number(row?.count ?? 0);
  }

  async listByUser(
    userId: string,
    page: number,
    limit: number,
  ): Promise<Pick<QueryExecutionRow, 'id' | 'learningSessionId' | 'sqlText' | 'status' | 'durationMs' | 'rowsReturned' | 'errorMessage' | 'submittedAt'>[]> {
    const offset = (page - 1) * limit;
    return this.db
      .select({
        id: schema.queryExecutions.id,
        learningSessionId: schema.queryExecutions.learningSessionId,
        sqlText: schema.queryExecutions.sqlText,
        status: schema.queryExecutions.status,
        durationMs: schema.queryExecutions.durationMs,
        rowsReturned: schema.queryExecutions.rowsReturned,
        errorMessage: schema.queryExecutions.errorMessage,
        submittedAt: schema.queryExecutions.submittedAt,
      })
      .from(schema.queryExecutions)
      .where(eq(schema.queryExecutions.userId, userId))
      .orderBy(desc(schema.queryExecutions.submittedAt))
      .limit(limit)
      .offset(offset);
  }

  async updateSessionActivity(sessionId: string): Promise<void> {
    await this.db
      .update(schema.learningSessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(schema.learningSessions.id, sessionId));
  }

  async enqueueJob(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.db.insert(schema.systemJobs).values({
      type,
      status: 'pending',
      payload,
    });
  }
}

export const queriesRepository = new QueriesRepository();

import { and, eq } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export type SandboxRow = InferSelectModel<typeof schema.sandboxInstances>;
export type SessionRow = InferSelectModel<typeof schema.learningSessions>;
export type DatasetTemplateRow = InferSelectModel<typeof schema.datasetTemplates>;

export class SandboxesRepository {
  private get db() {
    return getDb();
  }

  async findById(id: string): Promise<SandboxRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.sandboxInstances)
      .where(eq(schema.sandboxInstances.id, id))
      .limit(1);
    return row ?? null;
  }

  async findBySessionId(sessionId: string): Promise<SandboxRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.sandboxInstances)
      .where(eq(schema.sandboxInstances.learningSessionId, sessionId))
      .limit(1);
    return row ?? null;
  }

  async findSessionById(id: string): Promise<SessionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.learningSessions)
      .where(eq(schema.learningSessions.id, id))
      .limit(1);
    return row ?? null;
  }

  async getSessionUserIdBySandbox(sandboxId: string): Promise<string | null> {
    const sandbox = await this.findById(sandboxId);
    if (!sandbox) return null;
    const session = await this.findSessionById(sandbox.learningSessionId);
    return session?.userId ?? null;
  }

  async setResetting(id: string): Promise<void> {
    await this.db
      .update(schema.sandboxInstances)
      .set({ status: 'resetting', updatedAt: new Date() })
      .where(eq(schema.sandboxInstances.id, id));
  }

  async updateDatasetTemplate(id: string, datasetTemplateId: string | null): Promise<void> {
    await this.db
      .update(schema.sandboxInstances)
      .set({ datasetTemplateId, updatedAt: new Date() })
      .where(eq(schema.sandboxInstances.id, id));
  }

  async findDatasetTemplateById(id: string): Promise<DatasetTemplateRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.datasetTemplates)
      .where(eq(schema.datasetTemplates.id, id))
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
          eq(schema.datasetTemplates.sandboxGoldenStatus, 'ready'),
        ),
      );
  }

}

export const sandboxesRepository = new SandboxesRepository();

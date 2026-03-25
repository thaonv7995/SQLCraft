import { and, count, desc, eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export interface SystemHealthStats {
  users: number;
  tracks: number;
  lessons: number;
  activeSessions: number;
  pendingJobs: number;
}

export type SchemaTemplateRow = InferSelectModel<typeof schema.schemaTemplates>;
export type DatasetTemplateRow = InferSelectModel<typeof schema.datasetTemplates>;
export type SystemJobRow = InferSelectModel<typeof schema.systemJobs>;
export type AdminConfigRow = InferSelectModel<typeof schema.adminConfigs>;
export type InsertSchemaTemplate = InferInsertModel<typeof schema.schemaTemplates>;
export type InsertDatasetTemplate = InferInsertModel<typeof schema.datasetTemplates>;
export type InsertSystemJob = InferInsertModel<typeof schema.systemJobs>;
export type InsertAdminConfig = InferInsertModel<typeof schema.adminConfigs>;

export class AdminRepository {
  private get db() {
    return getDb();
  }

  async getSystemHealthStats(): Promise<SystemHealthStats> {
    const [
      userCount,
      trackCount,
      lessonCount,
      activeSessionCount,
      pendingJobCount,
    ] = await Promise.all([
      this.db.select({ count: count() }).from(schema.users),
      this.db.select({ count: count() }).from(schema.tracks),
      this.db.select({ count: count() }).from(schema.lessons),
      this.db
        .select({ count: count() })
        .from(schema.learningSessions)
        .where(eq(schema.learningSessions.status, 'active')),
      this.db
        .select({ count: count() })
        .from(schema.systemJobs)
        .where(eq(schema.systemJobs.status, 'pending')),
    ]);

    return {
      users: userCount[0]?.count ?? 0,
      tracks: trackCount[0]?.count ?? 0,
      lessons: lessonCount[0]?.count ?? 0,
      activeSessions: activeSessionCount[0]?.count ?? 0,
      pendingJobs: pendingJobCount[0]?.count ?? 0,
    };
  }

  async findLatestSchemaTemplateByName(name: string): Promise<SchemaTemplateRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.schemaTemplates)
      .where(eq(schema.schemaTemplates.name, name))
      .orderBy(desc(schema.schemaTemplates.version), desc(schema.schemaTemplates.createdAt))
      .limit(1);

    return row ?? null;
  }

  async createSchemaTemplate(
    data: Omit<InsertSchemaTemplate, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SchemaTemplateRow> {
    const [row] = await this.db.insert(schema.schemaTemplates).values(data).returning();
    return row;
  }

  async findDatasetTemplateBySchemaAndSize(
    schemaTemplateId: string,
    size: DatasetTemplateRow['size'],
  ): Promise<DatasetTemplateRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.datasetTemplates)
      .where(
        and(
          eq(schema.datasetTemplates.schemaTemplateId, schemaTemplateId),
          eq(schema.datasetTemplates.size, size),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async createDatasetTemplate(
    data: Omit<InsertDatasetTemplate, 'id' | 'createdAt'>,
  ): Promise<DatasetTemplateRow> {
    const [row] = await this.db.insert(schema.datasetTemplates).values(data).returning();
    return row;
  }

  async updateDatasetTemplate(
    id: string,
    data: Partial<Pick<InsertDatasetTemplate, 'name' | 'rowCounts' | 'artifactUrl' | 'status'>>,
  ): Promise<DatasetTemplateRow | null> {
    const [row] = await this.db
      .update(schema.datasetTemplates)
      .set(data)
      .where(eq(schema.datasetTemplates.id, id))
      .returning();

    return row ?? null;
  }

  async createSystemJob(
    data: Omit<InsertSystemJob, 'id' | 'createdAt'>,
  ): Promise<SystemJobRow> {
    const [row] = await this.db.insert(schema.systemJobs).values(data).returning();
    return row;
  }

  async findAdminConfig(scope: string): Promise<AdminConfigRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.adminConfigs)
      .where(eq(schema.adminConfigs.scope, scope))
      .limit(1);

    return row ?? null;
  }

  async createAdminConfig(
    data: Omit<InsertAdminConfig, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<AdminConfigRow> {
    const [row] = await this.db.insert(schema.adminConfigs).values(data).returning();
    return row;
  }

  async updateAdminConfig(
    scope: string,
    data: Partial<Pick<InsertAdminConfig, 'config' | 'updatedBy'>>,
  ): Promise<AdminConfigRow | null> {
    const [row] = await this.db
      .update(schema.adminConfigs)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.adminConfigs.scope, scope))
      .returning();

    return row ?? null;
  }

  async listSystemJobs(options: {
    limit: number;
    status?: SystemJobRow['status'];
    type?: string;
  }): Promise<SystemJobRow[]> {
    const filters = [
      options.status ? eq(schema.systemJobs.status, options.status) : null,
      options.type ? eq(schema.systemJobs.type, options.type) : null,
    ].filter((value): value is NonNullable<typeof value> => value !== null);

    const baseQuery = this.db.select().from(schema.systemJobs);
    const filteredQuery =
      filters.length === 0
        ? baseQuery
        : baseQuery.where(filters.length === 1 ? filters[0] : and(...filters));

    return filteredQuery.orderBy(desc(schema.systemJobs.createdAt)).limit(options.limit);
  }
}

export const adminRepository = new AdminRepository();

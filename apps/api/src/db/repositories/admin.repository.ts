import { and, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export interface SystemHealthStats {
  users: number;
  databases: number;
  challenges: number;
  activeSessions: number;
  pendingJobs: number;
}

export interface DatabaseReferenceSummary {
  challengeCount: number;
  sandboxInstanceCount: number;
}

export type SchemaTemplateRow = InferSelectModel<typeof schema.schemaTemplates>;
export type DatasetTemplateRow = InferSelectModel<typeof schema.datasetTemplates>;
export type SystemJobRow = InferSelectModel<typeof schema.systemJobs>;
export type AdminConfigRow = InferSelectModel<typeof schema.adminConfigs>;
export type InsertSchemaTemplate = InferInsertModel<typeof schema.schemaTemplates>;
export type InsertDatasetTemplate = InferInsertModel<typeof schema.datasetTemplates>;
export type InsertSystemJob = InferInsertModel<typeof schema.systemJobs>;
export type InsertAdminConfig = InferInsertModel<typeof schema.adminConfigs>;
export type InsertAuditLog = InferInsertModel<typeof schema.auditLogs>;

export class AdminRepository {
  private get db() {
    return getDb();
  }

  async getSystemHealthStats(): Promise<SystemHealthStats> {
    const [userCount, databaseCount, challengeCount, activeSessionCount, pendingJobCount] =
      await Promise.all([
      this.db.select({ count: count() }).from(schema.users),
      this.db.select({ count: count() }).from(schema.schemaTemplates),
      this.db.select({ count: count() }).from(schema.challenges),
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
      databases: databaseCount[0]?.count ?? 0,
      challenges: challengeCount[0]?.count ?? 0,
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

  async findSchemaTemplateById(id: string): Promise<SchemaTemplateRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.schemaTemplates)
      .where(eq(schema.schemaTemplates.id, id))
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

  async listDatasetTemplatesBySchemaTemplateId(
    schemaTemplateId: string,
  ): Promise<DatasetTemplateRow[]> {
    return this.db
      .select()
      .from(schema.datasetTemplates)
      .where(eq(schema.datasetTemplates.schemaTemplateId, schemaTemplateId));
  }

  async getDatabaseReferenceSummary(
    schemaTemplateId: string,
    datasetTemplateIds: string[],
  ): Promise<DatabaseReferenceSummary> {
    const challengeFilter =
      datasetTemplateIds.length > 0
        ? or(
            eq(schema.challenges.databaseId, schemaTemplateId),
            inArray(schema.sandboxInstances.datasetTemplateId, datasetTemplateIds),
          )
        : eq(schema.challenges.databaseId, schemaTemplateId);

    const sandboxInstanceFilter =
      datasetTemplateIds.length > 0
        ? or(
            eq(schema.sandboxInstances.schemaTemplateId, schemaTemplateId),
            inArray(schema.sandboxInstances.datasetTemplateId, datasetTemplateIds),
          )
        : eq(schema.sandboxInstances.schemaTemplateId, schemaTemplateId);

    const [challengeCount, sandboxInstanceCount] = await Promise.all([
      this.db.select({ count: count() }).from(schema.challenges).where(challengeFilter),
      this.db
        .select({ count: count() })
        .from(schema.sandboxInstances)
        .where(sandboxInstanceFilter),
    ]);

    return {
      challengeCount: challengeCount[0]?.count ?? 0,
      sandboxInstanceCount: sandboxInstanceCount[0]?.count ?? 0,
    };
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

  async deleteDatasetTemplatesBySchemaTemplateId(schemaTemplateId: string): Promise<number> {
    const deletedRows = await this.db
      .delete(schema.datasetTemplates)
      .where(eq(schema.datasetTemplates.schemaTemplateId, schemaTemplateId))
      .returning({ id: schema.datasetTemplates.id });

    return deletedRows.length;
  }

  async deleteSchemaTemplateById(id: string): Promise<SchemaTemplateRow | null> {
    const [row] = await this.db
      .delete(schema.schemaTemplates)
      .where(eq(schema.schemaTemplates.id, id))
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

  async insertAuditLog(
    data: Omit<InsertAuditLog, 'id' | 'createdAt'>,
  ): Promise<void> {
    await this.db.insert(schema.auditLogs).values(data);
  }

  async listAuditLogsPaginated(options: {
    page: number;
    limit: number;
    action?: string;
    resourceType?: string;
  }): Promise<{
    rows: Array<{
      id: string;
      userId: string | null;
      action: string;
      resourceType: string | null;
      resourceId: string | null;
      payload: unknown;
      ipAddress: string | null;
      userAgent: string | null;
      createdAt: Date;
      actorUsername: string | null;
      actorEmail: string | null;
    }>;
    total: number;
  }> {
    const filters: SQL[] = [];
    if (options.action) {
      filters.push(eq(schema.auditLogs.action, options.action));
    }
    if (options.resourceType) {
      filters.push(eq(schema.auditLogs.resourceType, options.resourceType));
    }
    const whereClause: SQL | undefined =
      filters.length === 0 ? undefined : filters.length === 1 ? filters[0]! : and(...filters);

    const countBase = this.db.select({ total: count() }).from(schema.auditLogs);
    const [countRow] = whereClause ? await countBase.where(whereClause) : await countBase;
    const total = Number(countRow?.total ?? 0);

    const offset = (options.page - 1) * options.limit;
    const listBase = this.db
      .select({
        id: schema.auditLogs.id,
        userId: schema.auditLogs.userId,
        action: schema.auditLogs.action,
        resourceType: schema.auditLogs.resourceType,
        resourceId: schema.auditLogs.resourceId,
        payload: schema.auditLogs.payload,
        ipAddress: schema.auditLogs.ipAddress,
        userAgent: schema.auditLogs.userAgent,
        createdAt: schema.auditLogs.createdAt,
        actorUsername: schema.users.username,
        actorEmail: schema.users.email,
      })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.auditLogs.userId, schema.users.id))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(options.limit)
      .offset(offset);

    const rows = whereClause ? await listBase.where(whereClause) : await listBase;

    return { rows, total };
  }

  /** Scan IDs already linked from a published SQL import (`definition.metadata.scanId`). */
  async getDistinctSqlDumpScanIdsFromTemplates(): Promise<Set<string>> {
    const result = await this.db.execute(sql`
      SELECT DISTINCT TRIM(BOTH FROM definition->'metadata'->>'scanId') AS sid
      FROM schema_templates
      WHERE definition->'metadata'->>'scanId' IS NOT NULL
        AND TRIM(BOTH FROM definition->'metadata'->>'scanId') <> ''
    `);
    const set = new Set<string>();
    const rows = (result as unknown as { rows: Array<{ sid: string | null }> }).rows;
    for (const row of rows) {
      const v = row.sid?.trim().toLowerCase();
      if (v) set.add(v);
    }
    return set;
  }
}

export const adminRepository = new AdminRepository();

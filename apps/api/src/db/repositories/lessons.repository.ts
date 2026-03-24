import { eq, and, asc, desc } from 'drizzle-orm';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export type LessonRow = InferSelectModel<typeof schema.lessons>;
export type LessonVersionRow = InferSelectModel<typeof schema.lessonVersions>;
export type InsertLesson = InferInsertModel<typeof schema.lessons>;
export type InsertLessonVersion = InferInsertModel<typeof schema.lessonVersions>;
export type SchemaTemplateRow = InferSelectModel<typeof schema.schemaTemplates>;
export type ChallengeSummaryRow = Pick<
  InferSelectModel<typeof schema.challenges>,
  'id' | 'slug' | 'title' | 'description' | 'difficulty' | 'sortOrder' | 'publishedVersionId'
>;

export type LessonVersionSummaryRow = Pick<
  LessonVersionRow,
  | 'id'
  | 'lessonId'
  | 'versionNo'
  | 'title'
  | 'isPublished'
  | 'schemaTemplateId'
  | 'datasetTemplateId'
  | 'publishedAt'
  | 'createdAt'
>;

export class LessonsRepository {
  private get db() {
    return getDb();
  }

  async findPublishedById(id: string): Promise<Pick<LessonRow, 'id' | 'trackId' | 'slug' | 'title' | 'description' | 'difficulty' | 'status' | 'sortOrder' | 'estimatedMinutes' | 'publishedVersionId' | 'createdAt' | 'updatedAt'> | null> {
    const [row] = await this.db
      .select({
        id: schema.lessons.id,
        trackId: schema.lessons.trackId,
        slug: schema.lessons.slug,
        title: schema.lessons.title,
        description: schema.lessons.description,
        difficulty: schema.lessons.difficulty,
        status: schema.lessons.status,
        sortOrder: schema.lessons.sortOrder,
        estimatedMinutes: schema.lessons.estimatedMinutes,
        publishedVersionId: schema.lessons.publishedVersionId,
        createdAt: schema.lessons.createdAt,
        updatedAt: schema.lessons.updatedAt,
      })
      .from(schema.lessons)
      .where(and(eq(schema.lessons.id, id), eq(schema.lessons.status, 'published')))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<Pick<LessonRow, 'id' | 'trackId' | 'slug' | 'title' | 'difficulty' | 'estimatedMinutes'> | null> {
    const [row] = await this.db
      .select({
        id: schema.lessons.id,
        trackId: schema.lessons.trackId,
        slug: schema.lessons.slug,
        title: schema.lessons.title,
        difficulty: schema.lessons.difficulty,
        estimatedMinutes: schema.lessons.estimatedMinutes,
      })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, id))
      .limit(1);
    return row ?? null;
  }

  async existsById(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.lessons.id })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, id))
      .limit(1);
    return !!row;
  }

  async findPublishedVersionById(versionId: string): Promise<Pick<LessonVersionRow, 'id' | 'lessonId' | 'versionNo' | 'title' | 'content' | 'starterQuery' | 'isPublished' | 'schemaTemplateId' | 'datasetTemplateId' | 'publishedAt' | 'createdAt'> | null> {
    const [row] = await this.db
      .select({
        id: schema.lessonVersions.id,
        lessonId: schema.lessonVersions.lessonId,
        versionNo: schema.lessonVersions.versionNo,
        title: schema.lessonVersions.title,
        content: schema.lessonVersions.content,
        starterQuery: schema.lessonVersions.starterQuery,
        isPublished: schema.lessonVersions.isPublished,
        schemaTemplateId: schema.lessonVersions.schemaTemplateId,
        datasetTemplateId: schema.lessonVersions.datasetTemplateId,
        publishedAt: schema.lessonVersions.publishedAt,
        createdAt: schema.lessonVersions.createdAt,
      })
      .from(schema.lessonVersions)
      .where(and(eq(schema.lessonVersions.id, versionId), eq(schema.lessonVersions.isPublished, true)))
      .limit(1);
    return row ?? null;
  }

  async getPublishedChallenges(lessonId: string): Promise<ChallengeSummaryRow[]> {
    return this.db
      .select({
        id: schema.challenges.id,
        slug: schema.challenges.slug,
        title: schema.challenges.title,
        description: schema.challenges.description,
        difficulty: schema.challenges.difficulty,
        sortOrder: schema.challenges.sortOrder,
        publishedVersionId: schema.challenges.publishedVersionId,
      })
      .from(schema.challenges)
      .where(and(eq(schema.challenges.lessonId, lessonId), eq(schema.challenges.status, 'published')))
      .orderBy(asc(schema.challenges.sortOrder));
  }

  async findSchemaTemplateById(id: string): Promise<SchemaTemplateRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.schemaTemplates)
      .where(eq(schema.schemaTemplates.id, id))
      .limit(1);
    return row ?? null;
  }

  async createLesson(data: Omit<InsertLesson, 'id' | 'createdAt' | 'updatedAt'>): Promise<LessonRow> {
    const [row] = await this.db.insert(schema.lessons).values(data).returning();
    return row;
  }

  async getLatestVersionNo(lessonId: string): Promise<number> {
    const [row] = await this.db
      .select({ versionNo: schema.lessonVersions.versionNo })
      .from(schema.lessonVersions)
      .where(eq(schema.lessonVersions.lessonId, lessonId))
      .orderBy(desc(schema.lessonVersions.versionNo))
      .limit(1);
    return row?.versionNo ?? 0;
  }

  async createVersion(data: Omit<InsertLessonVersion, 'id' | 'createdAt'>): Promise<LessonVersionRow> {
    const [row] = await this.db.insert(schema.lessonVersions).values(data).returning();
    return row;
  }

  async publishVersion(versionId: string, lessonId: string): Promise<LessonVersionRow | null> {
    const now = new Date();

    await this.db
      .update(schema.lessonVersions)
      .set({ isPublished: false })
      .where(eq(schema.lessonVersions.lessonId, lessonId));

    const [published] = await this.db
      .update(schema.lessonVersions)
      .set({ isPublished: true, publishedAt: now })
      .where(eq(schema.lessonVersions.id, versionId))
      .returning();

    await this.db
      .update(schema.lessons)
      .set({ publishedVersionId: versionId, status: 'published', updatedAt: now })
      .where(eq(schema.lessons.id, lessonId));

    return published ?? null;
  }

  async findVersionById(versionId: string): Promise<LessonVersionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.lessonVersions)
      .where(eq(schema.lessonVersions.id, versionId))
      .limit(1);
    return row ?? null;
  }

  async listVersionsForLesson(lessonId: string): Promise<LessonVersionSummaryRow[]> {
    return this.db
      .select({
        id: schema.lessonVersions.id,
        lessonId: schema.lessonVersions.lessonId,
        versionNo: schema.lessonVersions.versionNo,
        title: schema.lessonVersions.title,
        isPublished: schema.lessonVersions.isPublished,
        schemaTemplateId: schema.lessonVersions.schemaTemplateId,
        datasetTemplateId: schema.lessonVersions.datasetTemplateId,
        publishedAt: schema.lessonVersions.publishedAt,
        createdAt: schema.lessonVersions.createdAt,
      })
      .from(schema.lessonVersions)
      .where(eq(schema.lessonVersions.lessonId, lessonId))
      .orderBy(desc(schema.lessonVersions.versionNo), desc(schema.lessonVersions.createdAt));
  }
}

export const lessonsRepository = new LessonsRepository();

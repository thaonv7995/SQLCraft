import { eq, and, asc, count } from 'drizzle-orm';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export type TrackRow = InferSelectModel<typeof schema.tracks>;
export type InsertTrack = InferInsertModel<typeof schema.tracks>;
export type LessonSummaryRow = Pick<
  InferSelectModel<typeof schema.lessons>,
  'id' | 'slug' | 'title' | 'description' | 'difficulty' | 'sortOrder' | 'estimatedMinutes' | 'publishedVersionId' | 'createdAt'
>;

export class TracksRepository {
  private get db() {
    return getDb();
  }

  async listPublished(
    page: number,
    limit: number,
  ): Promise<{ items: Omit<TrackRow, 'createdBy'>[];  total: number }> {
    const offset = (page - 1) * limit;

    const [items, countRows] = await Promise.all([
      this.db
        .select({
          id: schema.tracks.id,
          slug: schema.tracks.slug,
          title: schema.tracks.title,
          description: schema.tracks.description,
          coverUrl: schema.tracks.coverUrl,
          difficulty: schema.tracks.difficulty,
          status: schema.tracks.status,
          sortOrder: schema.tracks.sortOrder,
          createdAt: schema.tracks.createdAt,
          updatedAt: schema.tracks.updatedAt,
        })
        .from(schema.tracks)
        .where(eq(schema.tracks.status, 'published'))
        .orderBy(asc(schema.tracks.sortOrder))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.tracks)
        .where(eq(schema.tracks.status, 'published')),
    ]);

    return { items, total: countRows[0]?.count ?? 0 };
  }

  async findPublishedById(id: string): Promise<TrackRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.tracks)
      .where(and(eq(schema.tracks.id, id), eq(schema.tracks.status, 'published')))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<TrackRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .limit(1);
    return row ?? null;
  }

  async getLessonCountsByTrackIds(trackIds: string[]): Promise<Record<string, number>> {
    if (trackIds.length === 0) return {};

    const rows = await this.db
      .select({
        trackId: schema.lessons.trackId,
        lessonCount: count(),
      })
      .from(schema.lessons)
      .where(eq(schema.lessons.status, 'published'))
      .groupBy(schema.lessons.trackId);

    const map: Record<string, number> = {};
    for (const row of rows) {
      if (trackIds.includes(row.trackId)) {
        map[row.trackId] = row.lessonCount;
      }
    }
    return map;
  }

  async getPublishedLessons(trackId: string): Promise<LessonSummaryRow[]> {
    return this.db
      .select({
        id: schema.lessons.id,
        slug: schema.lessons.slug,
        title: schema.lessons.title,
        description: schema.lessons.description,
        difficulty: schema.lessons.difficulty,
        sortOrder: schema.lessons.sortOrder,
        estimatedMinutes: schema.lessons.estimatedMinutes,
        publishedVersionId: schema.lessons.publishedVersionId,
        createdAt: schema.lessons.createdAt,
      })
      .from(schema.lessons)
      .where(and(eq(schema.lessons.trackId, trackId), eq(schema.lessons.status, 'published')))
      .orderBy(asc(schema.lessons.sortOrder));
  }

  async create(data: Omit<InsertTrack, 'id' | 'createdAt' | 'updatedAt'>): Promise<TrackRow> {
    const [row] = await this.db.insert(schema.tracks).values(data).returning();
    return row;
  }

  async update(id: string, data: Partial<InsertTrack>): Promise<TrackRow | null> {
    const [row] = await this.db
      .update(schema.tracks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.tracks.id, id))
      .returning();
    return row ?? null;
  }
}

export const tracksRepository = new TracksRepository();

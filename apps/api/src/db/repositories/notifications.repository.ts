import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '../index';

export class NotificationsRepository {
  private get db() {
    return getDb();
  }

  async insert(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(schema.userNotifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        metadata: input.metadata ?? null,
      })
      .returning({ id: schema.userNotifications.id });
    if (!row) {
      throw new Error('Failed to insert notification');
    }
    return row;
  }

  async countUnread(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.userNotifications)
      .where(and(eq(schema.userNotifications.userId, userId), isNull(schema.userNotifications.readAt)));
    return row?.n ?? 0;
  }

  async list(
    userId: string,
    opts: { page: number; limit: number; unreadOnly: boolean },
  ): Promise<{ items: typeof schema.userNotifications.$inferSelect[]; total: number }> {
    const offset = (opts.page - 1) * opts.limit;
    const whereBase = eq(schema.userNotifications.userId, userId);
    const whereClause = opts.unreadOnly
      ? and(whereBase, isNull(schema.userNotifications.readAt))
      : whereBase;

    const countRows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.userNotifications)
      .where(whereClause);
    const total = countRows[0]?.n ?? 0;

    const items = await this.db
      .select()
      .from(schema.userNotifications)
      .where(whereClause)
      .orderBy(desc(schema.userNotifications.createdAt))
      .limit(opts.limit)
      .offset(offset);

    return { items, total };
  }

  async markRead(userId: string, notificationId: string): Promise<boolean> {
    const [row] = await this.db
      .update(schema.userNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.userNotifications.id, notificationId),
          eq(schema.userNotifications.userId, userId),
          isNull(schema.userNotifications.readAt),
        ),
      )
      .returning({ id: schema.userNotifications.id });
    return !!row;
  }

  async markAllRead(userId: string): Promise<number> {
    const updated = await this.db
      .update(schema.userNotifications)
      .set({ readAt: new Date() })
      .where(and(eq(schema.userNotifications.userId, userId), isNull(schema.userNotifications.readAt)))
      .returning({ id: schema.userNotifications.id });
    return updated.length;
  }
}

export const notificationsRepository = new NotificationsRepository();

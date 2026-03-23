import { eq, count } from 'drizzle-orm';
import { getDb, schema } from '../index';

export interface SystemHealthStats {
  users: number;
  tracks: number;
  lessons: number;
  activeSessions: number;
  pendingJobs: number;
}

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
}

export const adminRepository = new AdminRepository();

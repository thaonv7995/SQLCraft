import { eq, and, isNull, desc, ilike, or, sql, count } from 'drizzle-orm';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { getDb, schema } from '../index';

export type UserRow = InferSelectModel<typeof schema.users>;
export type InsertUser = InferInsertModel<typeof schema.users>;
export type RefreshTokenRow = InferSelectModel<typeof schema.refreshTokens>;

export class UsersRepository {
  private get db() {
    return getDb();
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByUsername(username: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);
    return row ?? null;
  }

  async emailExists(email: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    return !!row;
  }

  async usernameExists(username: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);
    return !!row;
  }

  async create(data: InsertUser): Promise<UserRow> {
    const [row] = await this.db.insert(schema.users).values(data).returning();
    return row;
  }

  async update(id: string, data: Partial<InsertUser>): Promise<UserRow | null> {
    const [row] = await this.db
      .update(schema.users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
    return row ?? null;
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, id));
  }

  async getRoleNames(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: schema.roles.name })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(eq(schema.userRoles.userId, userId));
    return rows.map((r) => r.name);
  }

  async findRoleByName(name: string): Promise<{ id: string; name: string } | null> {
    const [row] = await this.db
      .select({ id: schema.roles.id, name: schema.roles.name })
      .from(schema.roles)
      .where(eq(schema.roles.name, name))
      .limit(1);
    return row ?? null;
  }

  async assignRole(userId: string, roleId: string): Promise<void> {
    await this.db.insert(schema.userRoles).values({ userId, roleId });
  }

  async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db.insert(schema.refreshTokens).values({ userId, tokenHash, expiresAt });
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async revokeRefreshTokenById(id: string): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.refreshTokens.id, id));
  }

  async revokeRefreshTokenByHash(tokenHash: string): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.refreshTokens.tokenHash, tokenHash), isNull(schema.refreshTokens.revokedAt)));
  }

  async revokeRefreshTokensByUserId(userId: string): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)));
  }

  async listUsers(
    page: number,
    limit: number,
    options?: {
      status?: 'active' | 'disabled' | 'invited';
      search?: string;
      role?: string;
    },
  ): Promise<{
    items: (Pick<UserRow, 'id' | 'email' | 'username' | 'displayName' | 'status' | 'provider' | 'lastLoginAt' | 'createdAt'> & { roles: string[] })[];
    total: number;
  }> {
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof eq>[] = [];
    if (options?.status) conditions.push(eq(schema.users.status, options.status));
    if (options?.search) {
      const pattern = `%${options.search}%`;
      conditions.push(
        or(
          ilike(schema.users.email, pattern),
          ilike(schema.users.username, pattern),
          ilike(schema.users.displayName, pattern),
        ) as ReturnType<typeof eq>,
      );
    }

    // Role filter: `user` means any non-admin account, including legacy rows that still
    // carry old role names in the database.
    let userIdsWithRole: string[] | undefined;
    if (options?.role) {
      if (options.role === 'admin') {
        const roleRows = await this.db
          .select({ userId: schema.userRoles.userId })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
          .where(eq(schema.roles.name, 'admin'));
        userIdsWithRole = roleRows.map((r) => r.userId);
        if (userIdsWithRole.length === 0) return { items: [], total: 0 };
        conditions.push(
          sql`${schema.users.id} = ANY(ARRAY[${sql.raw(userIdsWithRole.map((id) => `'${id}'`).join(','))}]::uuid[])` as unknown as ReturnType<typeof eq>,
        );
      } else if (options.role === 'user') {
        const adminRoleRows = await this.db
          .select({ userId: schema.userRoles.userId })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
          .where(eq(schema.roles.name, 'admin'));
        const adminUserIds = adminRoleRows.map((r) => r.userId);

        if (adminUserIds.length > 0) {
          conditions.push(
            sql`NOT (${schema.users.id} = ANY(ARRAY[${sql.raw(adminUserIds.map((id) => `'${id}'`).join(','))}]::uuid[]))` as unknown as ReturnType<typeof eq>,
          );
        }
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countRows] = await Promise.all([
      this.db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          username: schema.users.username,
          displayName: schema.users.displayName,
          status: schema.users.status,
          provider: schema.users.provider,
          lastLoginAt: schema.users.lastLoginAt,
          createdAt: schema.users.createdAt,
        })
        .from(schema.users)
        .where(where)
        .orderBy(desc(schema.users.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(schema.users)
        .where(where),
    ]);

    // Fetch roles for all returned users in one query
    const ids = rows.map((r) => r.id);
    let rolesMap: Record<string, string[]> = {};
    if (ids.length > 0) {
      const roleRows = await this.db
        .select({ userId: schema.userRoles.userId, roleName: schema.roles.name })
        .from(schema.userRoles)
        .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
        .where(sql`${schema.userRoles.userId} = ANY(ARRAY[${sql.raw(ids.map((id) => `'${id}'`).join(','))}]::uuid[])`);
      rolesMap = roleRows.reduce<Record<string, string[]>>((acc, r) => {
        (acc[r.userId] ??= []).push(r.roleName);
        return acc;
      }, {});
    }

    const items = rows.map((r) => ({ ...r, roles: rolesMap[r.id] ?? [] }));
    return { items, total: countRows[0]?.total ?? 0 };
  }

  async getUserStats(userId: string): Promise<{
    queriesRun: number;
    completedChallenges: number;
    activeSessions: number;
    totalPoints: number;
    currentStreak: number;
  }> {
    const db = this.db;

    const [queriesResult, challengesResult, sessionsResult] = await Promise.all([
      // Count queries run via sessions owned by user
      db
        .select({ total: count() })
        .from(schema.queryExecutions)
        .innerJoin(schema.learningSessions, eq(schema.queryExecutions.learningSessionId, schema.learningSessions.id))
        .where(eq(schema.learningSessions.userId, userId)),

      // Count passed challenge attempts
      db
        .select({ total: count() })
        .from(schema.challengeAttempts)
        .innerJoin(schema.learningSessions, eq(schema.challengeAttempts.learningSessionId, schema.learningSessions.id))
        .where(and(eq(schema.learningSessions.userId, userId), eq(schema.challengeAttempts.status, 'passed'))),

      // Count active learning sessions
      db
        .select({ total: count() })
        .from(schema.learningSessions)
        .where(and(eq(schema.learningSessions.userId, userId), eq(schema.learningSessions.status, 'active'))),
    ]);

    return {
      queriesRun: queriesResult[0]?.total ?? 0,
      completedChallenges: challengesResult[0]?.total ?? 0,
      activeSessions: sessionsResult[0]?.total ?? 0,
      totalPoints: 0,
      currentStreak: 0,
    };
  }

  async clearUserRoles(userId: string): Promise<void> {
    await this.db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
  }

  async setUserRole(userId: string, roleName: string): Promise<void> {
    const role = await this.findRoleByName(roleName);
    if (!role) throw new Error(`Role '${roleName}' not found`);
    await this.clearUserRoles(userId);
    await this.assignRole(userId, role.id);
  }

  async updateStatus(id: string, status: 'active' | 'disabled' | 'invited'): Promise<Pick<UserRow, 'id' | 'email' | 'username' | 'status' | 'updatedAt'> | null> {
    const [row] = await this.db
      .update(schema.users)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        username: schema.users.username,
        status: schema.users.status,
        updatedAt: schema.users.updatedAt,
      });
    return row ?? null;
  }
}

export const usersRepository = new UsersRepository();

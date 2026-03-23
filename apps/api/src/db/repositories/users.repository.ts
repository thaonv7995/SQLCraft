import { eq, and, isNull, desc } from 'drizzle-orm';
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

  async listUsers(
    page: number,
    limit: number,
    status?: 'active' | 'disabled' | 'invited',
  ): Promise<{
    items: Pick<UserRow, 'id' | 'email' | 'username' | 'displayName' | 'status' | 'provider' | 'lastLoginAt' | 'createdAt'>[];
    total: number;
  }> {
    const offset = (page - 1) * limit;
    const where = status ? eq(schema.users.status, status) : undefined;

    const [items, countRows] = await Promise.all([
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
        .select({ count: schema.users.id })
        .from(schema.users)
        .where(where),
    ]);

    return { items, total: countRows.length };
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

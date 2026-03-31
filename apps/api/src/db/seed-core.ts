import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, or } from 'drizzle-orm';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import * as schema from './schema/index';
import {
  ADMIN_ROLE_NAME,
  CONTRIBUTOR_ROLE_NAME,
  DEFAULT_USER_ROLE_NAME,
} from '../lib/roles';

export function createSeedContext() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export function getFirstAdminConfig() {
  return {
    email: process.env.FIRST_ADMIN_EMAIL?.trim() || 'admin@sqlcraft.dev',
    username: process.env.FIRST_ADMIN_USERNAME?.trim() || 'admin',
    password: process.env.FIRST_ADMIN_PASSWORD?.trim() || 'admin123',
  };
}

export async function seedBootstrapCore(db: ReturnType<typeof createSeedContext>['db']) {
  const firstAdmin = getFirstAdminConfig();

  console.log('Creating roles...');
  const existingRoles = await db.select().from(schema.roles);

  let adminRole = existingRoles.find((r) => r.name === ADMIN_ROLE_NAME);
  let learnerRole = existingRoles.find((r) => r.name === DEFAULT_USER_ROLE_NAME);
  let contributorRole = existingRoles.find((r) => r.name === CONTRIBUTOR_ROLE_NAME);

  if (!adminRole) {
    const [r] = await db
      .insert(schema.roles)
      .values({ name: ADMIN_ROLE_NAME, description: 'Platform administrator' })
      .returning();
    adminRole = r;
    console.log('  Created admin role');
  }

  if (!learnerRole) {
    const [r] = await db
      .insert(schema.roles)
      .values({ name: DEFAULT_USER_ROLE_NAME, description: 'SQL learner' })
      .returning();
    learnerRole = r;
    console.log('  Created learner role');
  }

  if (!contributorRole) {
    const [r] = await db
      .insert(schema.roles)
      .values({
        name: CONTRIBUTOR_ROLE_NAME,
        description: 'Content contributor — can submit lessons, databases, and challenges for review',
      })
      .returning();
    contributorRole = r;
    console.log('  Created contributor role');
  }

  console.log('Creating admin user...');
  const adminPasswordHash = await bcrypt.hash(firstAdmin.password, 12);
  let adminUser = (
    await db
      .select()
      .from(schema.users)
      .where(or(eq(schema.users.email, firstAdmin.email), eq(schema.users.username, firstAdmin.username)))
      .limit(1)
  )[0];

  if (!adminUser) {
    const [u] = await db
      .insert(schema.users)
      .values({
        email: firstAdmin.email,
        username: firstAdmin.username,
        passwordHash: adminPasswordHash,
        displayName: 'SQLCraft Admin',
        status: 'active',
        provider: 'email',
      })
      .returning();
    adminUser = u;
    console.log(`  Created admin user: ${firstAdmin.email} / ${firstAdmin.password}`);
  } else {
    const [u] = await db
      .update(schema.users)
      .set({
        email: firstAdmin.email,
        username: firstAdmin.username,
        passwordHash: adminPasswordHash,
        displayName: 'SQLCraft Admin',
        status: 'active',
        provider: 'email',
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, adminUser.id))
      .returning();
    adminUser = u;
    console.log(`  Updated admin user: ${firstAdmin.email} / ${firstAdmin.password}`);
  }

  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminUser.id));
  await db.insert(schema.userRoles).values({
    userId: adminUser.id,
    roleId: adminRole.id,
  });

  return {
    adminUser,
    learnerRole,
    firstAdmin,
  };
}

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq, or, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import * as schema from './schema/index';
import { NotificationType } from '../modules/notifications/notifications.types';
import { createSeedContext, seedBootstrapCore } from './seed-core';

async function seed() {
  const { pool, db } = createSeedContext();

  console.log('Seeding database...');
  const { adminUser, learnerRole, firstAdmin } = await seedBootstrapCore(db);
  const firstAdminEmail = firstAdmin.email;
  const firstAdminUsername = firstAdmin.username;
  const firstAdminPassword = firstAdmin.password;

  // 2. Create standard test user
  console.log('Creating standard test user...');
  const userPasswordHash = await bcrypt.hash('user12345', 12);
  let standardUser = (
    await db
      .select()
      .from(schema.users)
      .where(or(eq(schema.users.email, 'user@sqlcraft.dev'), eq(schema.users.username, 'testuser')))
      .limit(1)
  )[0];

  if (!standardUser) {
    const [u] = await db
      .insert(schema.users)
      .values({
        email: 'user@sqlcraft.dev',
        username: 'testuser',
        passwordHash: userPasswordHash,
        displayName: 'SQLCraft User',
        status: 'active',
        provider: 'email',
      })
      .returning();
    standardUser = u;
    console.log('  Created standard user: user@sqlcraft.dev / user12345');
  } else {
    const [u] = await db
      .update(schema.users)
      .set({
        email: 'user@sqlcraft.dev',
        username: 'testuser',
        passwordHash: userPasswordHash,
        displayName: 'SQLCraft User',
        status: 'active',
        provider: 'email',
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, standardUser.id))
      .returning();
    standardUser = u;
    console.log('  Updated standard user: user@sqlcraft.dev / user12345');
  }

  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, standardUser.id));
  await db.insert(schema.userRoles).values({
    userId: standardUser.id,
    roleId: learnerRole.id,
  });

  // 3. Create schema template for ecommerce
  console.log('Creating ecommerce schema template...');
  let ecommerceSchema = (
    await db
      .select()
      .from(schema.schemaTemplates)
      .where(eq(schema.schemaTemplates.name, 'Ecommerce'))
      .limit(1)
  )[0];

  if (!ecommerceSchema) {
    const ecommerceDefinition = {
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'SERIAL PRIMARY KEY' },
            { name: 'email', type: 'VARCHAR(255) NOT NULL UNIQUE' },
            { name: 'name', type: 'VARCHAR(100) NOT NULL' },
            { name: 'created_at', type: 'TIMESTAMP DEFAULT NOW()' },
          ],
        },
        {
          name: 'categories',
          columns: [
            { name: 'id', type: 'SERIAL PRIMARY KEY' },
            { name: 'name', type: 'VARCHAR(100) NOT NULL' },
            { name: 'slug', type: 'VARCHAR(100) NOT NULL UNIQUE' },
            { name: 'parent_id', type: 'INTEGER REFERENCES categories(id)' },
          ],
        },
        {
          name: 'products',
          columns: [
            { name: 'id', type: 'SERIAL PRIMARY KEY' },
            { name: 'name', type: 'VARCHAR(255) NOT NULL' },
            { name: 'description', type: 'TEXT' },
            { name: 'price', type: 'DECIMAL(10,2) NOT NULL' },
            { name: 'stock_quantity', type: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'category_id', type: 'INTEGER REFERENCES categories(id)' },
            { name: 'created_at', type: 'TIMESTAMP DEFAULT NOW()' },
          ],
        },
        {
          name: 'orders',
          columns: [
            { name: 'id', type: 'SERIAL PRIMARY KEY' },
            { name: 'user_id', type: 'INTEGER NOT NULL REFERENCES users(id)' },
            { name: 'status', type: "VARCHAR(50) NOT NULL DEFAULT 'pending'" },
            { name: 'total_amount', type: 'DECIMAL(10,2) NOT NULL' },
            { name: 'created_at', type: 'TIMESTAMP DEFAULT NOW()' },
            { name: 'updated_at', type: 'TIMESTAMP DEFAULT NOW()' },
          ],
        },
        {
          name: 'order_items',
          columns: [
            { name: 'id', type: 'SERIAL PRIMARY KEY' },
            { name: 'order_id', type: 'INTEGER NOT NULL REFERENCES orders(id)' },
            { name: 'product_id', type: 'INTEGER NOT NULL REFERENCES products(id)' },
            { name: 'quantity', type: 'INTEGER NOT NULL' },
            { name: 'unit_price', type: 'DECIMAL(10,2) NOT NULL' },
          ],
        },
      ],
    };

    const ecommerceTemplateId = randomUUID();
    const [tmpl] = await db
      .insert(schema.schemaTemplates)
      .values({
        id: ecommerceTemplateId,
        name: 'Ecommerce',
        description: 'A sample ecommerce database with users, products, orders, and categories',
        version: 1,
        catalogAnchorId: ecommerceTemplateId,
        definition: ecommerceDefinition,
        status: 'published',
        createdBy: adminUser.id,
      })
      .returning();
    ecommerceSchema = tmpl;
    console.log('  Created ecommerce schema template');
  }

  // 4. Create dataset templates
  console.log('Creating dataset templates...');
  const datasetSizes: Array<{
    size: 'tiny' | 'small' | 'medium' | 'large';
    rowCounts: Record<string, number>;
  }> = [
    { size: 'tiny', rowCounts: { users: 10, categories: 5, products: 20, orders: 15, order_items: 30 } },
    { size: 'small', rowCounts: { users: 100, categories: 20, products: 200, orders: 150, order_items: 400 } },
    { size: 'medium', rowCounts: { users: 1000, categories: 50, products: 2000, orders: 3000, order_items: 8000 } },
    { size: 'large', rowCounts: { users: 20000, categories: 200, products: 150000, orders: 250000, order_items: 900000 } },
  ];

  const existingDatasets = await db
    .select()
    .from(schema.datasetTemplates)
    .where(eq(schema.datasetTemplates.schemaTemplateId, ecommerceSchema.id));

  for (const ds of datasetSizes) {
    const existing = existingDatasets.find((e) => e.size === ds.size);
    if (!existing) {
      await db.insert(schema.datasetTemplates).values({
        schemaTemplateId: ecommerceSchema.id,
        name: `Ecommerce ${ds.size.charAt(0).toUpperCase() + ds.size.slice(1)}`,
        size: ds.size,
        rowCounts: ds.rowCounts,
        requestedRowCounts: null,
        status: 'published',
        sandboxGoldenStatus: 'ready',
      });
      console.log(`  Created ${ds.size} dataset template`);
      continue;
    }

    await db
      .update(schema.datasetTemplates)
      .set({
        name: `Ecommerce ${ds.size.charAt(0).toUpperCase() + ds.size.slice(1)}`,
        rowCounts: ds.rowCounts,
        status: 'published',
        sandboxGoldenStatus: 'ready',
      })
      .where(eq(schema.datasetTemplates.id, existing.id));
    console.log(`  Updated ${ds.size} dataset template`);
  }

  // 5. Create sample challenge + published version
  console.log('Creating sample challenge...');
  let challenge = (
    await db
      .select()
      .from(schema.challenges)
      .where(eq(schema.challenges.slug, 'top-10-expensive-products'))
      .limit(1)
  )[0];

  if (!challenge) {
    const [createdChallenge] = await db
      .insert(schema.challenges)
      .values({
        databaseId: ecommerceSchema.id,
        slug: 'top-10-expensive-products',
        title: 'Top 10 most expensive products',
        description: 'Return top 10 products ordered by price descending.',
        difficulty: 'beginner',
        sortOrder: 1,
        points: 100,
        datasetScale: 'small',
        status: 'draft',
        createdBy: adminUser.id,
      })
      .returning();
    challenge = createdChallenge;
  }

  const [existingPublishedVersion] = await db
    .select()
    .from(schema.challengeVersions)
    .where(eq(schema.challengeVersions.challengeId, challenge.id))
    .limit(1);

  if (!existingPublishedVersion) {
    const [version] = await db
      .insert(schema.challengeVersions)
      .values({
        challengeId: challenge.id,
        versionNo: 1,
        problemStatement: 'Write a query to return top 10 products by price.',
        hintText: 'Use ORDER BY with DESC and LIMIT.',
        expectedResultColumns: ['id', 'name', 'price'],
        referenceSolution: 'SELECT id, name, price FROM products ORDER BY price DESC LIMIT 10;',
        validatorType: 'result_set',
        validatorConfig: {
          passCriteria: [
            { type: 'max_query_duration_ms', maxMs: 10_000 },
            { type: 'max_explain_total_cost', maxTotalCost: 100_000 },
          ],
        },
        isPublished: true,
        reviewStatus: 'approved',
        publishedAt: new Date(),
        createdBy: adminUser.id,
      })
      .returning();

    await db
      .update(schema.challenges)
      .set({ publishedVersionId: version.id, status: 'published', updatedAt: new Date() })
      .where(eq(schema.challenges.id, challenge.id));
  }

  // 6. Demo in-app notifications for first admin (navbar / Settings)
  console.log('Seeding demo notifications for admin...');
  await db.execute(
    sql`DELETE FROM user_notifications WHERE user_id = ${adminUser.id} AND COALESCE(metadata->>'seed', '') = 'true'`,
  );

  const demoDatasetId = ecommerceSchema.catalogAnchorId;
  await db.insert(schema.userNotifications).values([
    {
      userId: adminUser.id,
      type: NotificationType.DATASET_REVIEW_PENDING,
      title: 'Database submitted for review',
      body: '“Demo public upload” is pending catalog approval. You’ll get another notice when it’s approved or rejected.',
      metadata: {
        seed: true,
        databaseId: demoDatasetId,
        schemaTemplateId: ecommerceSchema.id,
      },
      readAt: null,
    },
    {
      userId: adminUser.id,
      type: NotificationType.DATASET_REVIEW_APPROVED,
      title: 'Database approved',
      body: '“Ecommerce” is now on the public catalog (pending golden snapshot if not ready yet).',
      metadata: { seed: true, databaseId: demoDatasetId },
      readAt: new Date(),
    },
    {
      userId: adminUser.id,
      type: NotificationType.GOLDEN_READY,
      title: 'Golden snapshot ready',
      body: 'Sandbox restores for “Ecommerce Tiny” can use the golden snapshot.',
      metadata: {
        seed: true,
        databaseId: demoDatasetId,
        datasetTemplateId: randomUUID(),
        schemaTemplateId: ecommerceSchema.id,
      },
      readAt: null,
    },
    {
      userId: adminUser.id,
      type: NotificationType.GOLDEN_FAILED,
      title: 'Golden snapshot failed',
      body: 'Timeout while restoring artifact (demo seed).',
      metadata: {
        seed: true,
        databaseId: demoDatasetId,
        error: 'demo seed',
        datasetTemplateId: randomUUID(),
      },
      readAt: null,
    },
  ]);
  console.log('  Inserted 4 demo notifications (3 unread, 1 read)');

  console.log('\nSeed completed successfully!');
  console.log('First admin credentials:');
  console.log(`  email: ${firstAdminEmail}`);
  console.log(`  username: ${firstAdminUsername}`);
  console.log(`  password: ${firstAdminPassword}`);
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

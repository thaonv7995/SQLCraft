import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, or } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import * as schema from './schema/index';

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  console.log('Seeding database...');

  // 1. Create roles
  console.log('Creating roles...');
  const existingRoles = await db.select().from(schema.roles);

  let adminRole = existingRoles.find((r) => r.name === 'admin');
  let userRole = existingRoles.find((r) => r.name === 'user');

  if (!adminRole) {
    const [r] = await db
      .insert(schema.roles)
      .values({ name: 'admin', description: 'Platform administrator' })
      .returning();
    adminRole = r;
    console.log('  Created admin role');
  }

  if (!userRole) {
    const [r] = await db
      .insert(schema.roles)
      .values({ name: 'user', description: 'Standard platform user' })
      .returning();
    userRole = r;
    console.log('  Created user role');
  }

  // 2. Create admin user
  console.log('Creating admin user...');
  const adminPasswordHash = await bcrypt.hash('admin123', 12);
  let adminUser = (
    await db
      .select()
      .from(schema.users)
      .where(or(eq(schema.users.email, 'admin@sqlcraft.dev'), eq(schema.users.username, 'admin')))
      .limit(1)
  )[0];

  if (!adminUser) {
    const [u] = await db
      .insert(schema.users)
      .values({
        email: 'admin@sqlcraft.dev',
        username: 'admin',
        passwordHash: adminPasswordHash,
        displayName: 'SQLCraft Admin',
        status: 'active',
        provider: 'email',
      })
      .returning();
    adminUser = u;
    console.log('  Created admin user: admin@sqlcraft.dev / admin123');
  } else {
    const [u] = await db
      .update(schema.users)
      .set({
        email: 'admin@sqlcraft.dev',
        username: 'admin',
        passwordHash: adminPasswordHash,
        displayName: 'SQLCraft Admin',
        status: 'active',
        provider: 'email',
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, adminUser.id))
      .returning();
    adminUser = u;
    console.log('  Updated admin user: admin@sqlcraft.dev / admin123');
  }

  // Assign admin role
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminUser.id));
  await db.insert(schema.userRoles).values({
    userId: adminUser.id,
    roleId: adminRole.id,
  });

  // 3. Create standard test user
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
    roleId: userRole.id,
  });

  // 4. Create schema template for ecommerce
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

    const [tmpl] = await db
      .insert(schema.schemaTemplates)
      .values({
        name: 'Ecommerce',
        description: 'A sample ecommerce database with users, products, orders, and categories',
        version: 1,
        definition: ecommerceDefinition,
        status: 'published',
        createdBy: adminUser.id,
      })
      .returning();
    ecommerceSchema = tmpl;
    console.log('  Created ecommerce schema template');
  }

  // 5. Create dataset templates
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
        status: 'published',
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
      })
      .where(eq(schema.datasetTemplates.id, existing.id));
    console.log(`  Updated ${ds.size} dataset template`);
  }

  // 6. Create tracks
  console.log('Creating tracks...');

  let fundamentalsTrack = (
    await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.slug, 'sql-fundamentals'))
      .limit(1)
  )[0];

  if (!fundamentalsTrack) {
    const [t] = await db
      .insert(schema.tracks)
      .values({
        slug: 'sql-fundamentals',
        title: 'SQL Fundamentals',
        description:
          'Master the basics of SQL from SELECT queries to JOINs and aggregations. Perfect for beginners.',
        difficulty: 'beginner',
        status: 'published',
        sortOrder: 1,
        createdBy: adminUser.id,
      })
      .returning();
    fundamentalsTrack = t;
    console.log('  Created SQL Fundamentals track');
  }

  let optimizationTrack = (
    await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.slug, 'query-optimization'))
      .limit(1)
  )[0];

  if (!optimizationTrack) {
    const [t] = await db
      .insert(schema.tracks)
      .values({
        slug: 'query-optimization',
        title: 'Query Optimization',
        description:
          'Learn how to write efficient SQL queries, understand execution plans, and optimize database performance.',
        difficulty: 'advanced',
        status: 'published',
        sortOrder: 2,
        createdBy: adminUser.id,
      })
      .returning();
    optimizationTrack = t;
    console.log('  Created Query Optimization track');
  }

  // 6. Create lessons for SQL Fundamentals
  console.log('Creating lessons...');

  const lessonsData = [
    {
      slug: 'intro-to-select',
      title: 'Introduction to SELECT',
      description: 'Learn the most fundamental SQL command - SELECT - to retrieve data from tables.',
      sortOrder: 1,
      estimatedMinutes: 15,
      content: `# Introduction to SELECT

The \`SELECT\` statement is the foundation of SQL. It allows you to retrieve data from one or more tables.

## Basic Syntax

\`\`\`sql
SELECT column1, column2
FROM table_name;
\`\`\`

## Selecting All Columns

Use \`*\` to select all columns:

\`\`\`sql
SELECT * FROM products;
\`\`\`

## Selecting Specific Columns

\`\`\`sql
SELECT name, price FROM products;
\`\`\`

## Try It

Query the products table to see all available products.`,
      starterQuery: 'SELECT * FROM products LIMIT 10;',
    },
    {
      slug: 'filtering-with-where',
      title: 'Filtering with WHERE',
      description: 'Use the WHERE clause to filter rows based on conditions.',
      sortOrder: 2,
      estimatedMinutes: 20,
      content: `# Filtering with WHERE

The \`WHERE\` clause filters rows based on a condition.

## Basic Syntax

\`\`\`sql
SELECT columns
FROM table
WHERE condition;
\`\`\`

## Comparison Operators

- \`=\` equals
- \`<>\` or \`!=\` not equals
- \`>\`, \`<\`, \`>=\`, \`<=\` comparison
- \`BETWEEN\` range
- \`LIKE\` pattern matching
- \`IN\` list of values

## Examples

\`\`\`sql
SELECT * FROM products WHERE price > 50;
SELECT * FROM orders WHERE status = 'completed';
SELECT * FROM products WHERE price BETWEEN 10 AND 100;
\`\`\``,
      starterQuery: "SELECT * FROM products WHERE price > 50 ORDER BY price;",
    },
    {
      slug: 'sorting-with-order-by',
      title: 'Sorting with ORDER BY',
      description: 'Sort query results using ORDER BY clause.',
      sortOrder: 3,
      estimatedMinutes: 15,
      content: `# Sorting with ORDER BY

Use \`ORDER BY\` to sort your results.

## Syntax

\`\`\`sql
SELECT columns
FROM table
ORDER BY column1 [ASC|DESC], column2 [ASC|DESC];
\`\`\`

## Examples

\`\`\`sql
-- Sort by price ascending (default)
SELECT * FROM products ORDER BY price;

-- Sort by price descending
SELECT * FROM products ORDER BY price DESC;

-- Sort by multiple columns
SELECT * FROM orders ORDER BY status, created_at DESC;
\`\`\``,
      starterQuery: 'SELECT name, price FROM products ORDER BY price DESC;',
    },
    {
      slug: 'aggregations-and-grouping',
      title: 'Aggregations and GROUP BY',
      description: 'Learn to summarize data with aggregate functions and GROUP BY.',
      sortOrder: 4,
      estimatedMinutes: 30,
      content: `# Aggregations and GROUP BY

Aggregate functions compute a single result from multiple rows.

## Common Aggregate Functions

- \`COUNT()\` - number of rows
- \`SUM()\` - sum of values
- \`AVG()\` - average value
- \`MIN()\` - minimum value
- \`MAX()\` - maximum value

## GROUP BY

Use \`GROUP BY\` to group rows sharing a property:

\`\`\`sql
SELECT category_id, COUNT(*) as product_count, AVG(price) as avg_price
FROM products
GROUP BY category_id;
\`\`\`

## HAVING

Use \`HAVING\` to filter groups (like WHERE but for groups):

\`\`\`sql
SELECT category_id, COUNT(*) as product_count
FROM products
GROUP BY category_id
HAVING COUNT(*) > 5;
\`\`\``,
      starterQuery: 'SELECT status, COUNT(*) as count FROM orders GROUP BY status;',
    },
  ];

  for (const lessonData of lessonsData) {
    const existingLesson = await db
      .select()
      .from(schema.lessons)
      .where(eq(schema.lessons.slug, lessonData.slug))
      .limit(1);

    if (existingLesson.length > 0) {
      console.log(`  Lesson '${lessonData.slug}' already exists, skipping`);
      continue;
    }

    const [lesson] = await db
      .insert(schema.lessons)
      .values({
        trackId: fundamentalsTrack.id,
        slug: lessonData.slug,
        title: lessonData.title,
        description: lessonData.description,
        difficulty: 'beginner',
        status: 'draft',
        sortOrder: lessonData.sortOrder,
        estimatedMinutes: lessonData.estimatedMinutes,
        createdBy: adminUser.id,
      })
      .returning();

    // Create lesson version
    const [version] = await db
      .insert(schema.lessonVersions)
      .values({
        lessonId: lesson.id,
        versionNo: 1,
        title: lessonData.title,
        content: lessonData.content,
        starterQuery: lessonData.starterQuery,
        schemaTemplateId: ecommerceSchema.id,
        isPublished: true,
        publishedAt: new Date(),
        createdBy: adminUser.id,
      })
      .returning();

    // Set published version on lesson and mark as published
    await db
      .update(schema.lessons)
      .set({ publishedVersionId: version.id, status: 'published' })
      .where(eq(schema.lessons.id, lesson.id));

    console.log(`  Created lesson: ${lessonData.title}`);
  }

  console.log('\nSeed completed successfully!');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

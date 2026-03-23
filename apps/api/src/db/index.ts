import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../lib/config';
import * as schema from './schema/index';

let db: ReturnType<typeof drizzle<typeof schema>>;

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    const pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_MAX_CONNECTIONS,
    });
    db = drizzle(pool, { schema });
  }
  return db;
}

export { schema };
export type Db = ReturnType<typeof getDb>;

import { Pool } from 'pg';
import mysql from 'mysql2/promise';
import sql from 'mssql';
import { normalizeSchemaSqlEngine } from '@sqlcraft/types';
import { getSandboxConnectionParams } from '../../services/sandbox-schema';
import { ValidationError } from '../../lib/errors';

function buildPostgresConnectionString(params: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): string {
  const user = encodeURIComponent(params.user);
  const password = encodeURIComponent(params.password);
  return `postgresql://${user}:${password}@${params.host}:${params.port}/${params.database}`;
}

export async function executeSchemaRevert(params: {
  dialect: string;
  dbName: string;
  containerRef: string | null;
  sandboxDbPort: number;
  statements: string[];
}): Promise<void> {
  const engine = normalizeSchemaSqlEngine(params.dialect);
  const connParams = getSandboxConnectionParams({
    dbName: params.dbName,
    containerRef: params.containerRef,
    dialect: params.dialect,
    sandboxDbPort: params.sandboxDbPort,
  });

  if (engine === 'postgresql') {
    const pool = new Pool({
      connectionString: buildPostgresConnectionString(connParams),
      max: 1,
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const statement of params.statements) {
        await client.query(statement);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
    return;
  }

  if (engine === 'mysql' || engine === 'mariadb') {
    const conn = await mysql.createConnection({
      host: connParams.host,
      port: connParams.port,
      user: connParams.user,
      password: connParams.password,
      database: connParams.database,
      multipleStatements: true,
    });
    try {
      await conn.beginTransaction();
      for (const statement of params.statements) {
        await conn.query(statement);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      await conn.end();
    }
    return;
  }

  if (engine === 'sqlserver') {
    const pool = new sql.ConnectionPool({
      server: connParams.host,
      port: connParams.port,
      user: connParams.user,
      password: connParams.password,
      database: connParams.database,
      options: {
        encrypt: true,
        trustServerCertificate: true,
      },
    });
    await pool.connect();
    const transaction = new sql.Transaction(pool);
    try {
      await transaction.begin();
      const request = new sql.Request(transaction);
      for (const statement of params.statements) {
        await request.query(statement);
      }
      await transaction.commit();
    } catch (error) {
      try {
        await transaction.rollback();
      } catch {
        // ignore rollback failure after a failed statement
      }
      throw error;
    } finally {
      await pool.close();
    }
    return;
  }

  throw new ValidationError('Unsupported database engine for schema revert');
}

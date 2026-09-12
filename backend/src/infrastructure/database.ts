import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getDatabasePool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      min: config.DB_POOL_MIN,
      max: config.DB_POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
    });
  }

  return pool;
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const db = getDatabasePool();
    const result = await db.query('SELECT 1 as healthy');
    return result.rows[0]?.healthy === 1;
  } catch (err) {
    logger.error({ err }, 'Database health check failed');
    return false;
  }
}

export async function closeDatabasePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Closed PostgreSQL connection pool');
  }
}

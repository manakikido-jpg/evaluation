import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

/** node-postgres でも PGlite（テスト）でも使える DB 型 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

const MIGRATION_LOCK = 72_025_925;

export async function connectDb(databaseUrl: string): Promise<{ db: NodePgDatabase<typeof schema>; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  // BOT と管理画面が同時に起動しても、マイグレーションは 1 つずつ
  const lock = await pool.connect();
  try {
    await lock.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await migrate(db, { migrationsFolder });
  } finally {
    await lock.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    lock.release();
  }
  return { db, close: () => pool.end() };
}

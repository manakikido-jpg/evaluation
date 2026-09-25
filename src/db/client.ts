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

export async function connectDb(databaseUrl: string): Promise<{ db: NodePgDatabase<typeof schema>; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => pool.end() };
}

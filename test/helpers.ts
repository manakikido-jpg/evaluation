import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { parseGuildConfig, type GuildConfig } from '../src/config.js';
import { migrationsFolder, type Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';

/** テスト用: メモリ上の PostgreSQL（PGlite）にマイグレーションを当てた DB */
export async function makeDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}

export const ROLE = {
  sanpaisha: '100000000000000001',
  ujiko: '100000000000000002',
  sewayaku: '100000000000000003',
  sodai: '100000000000000004',
  shinshoku: '100000000000000005',
  guji: '100000000000000006',
  yakudoshi: '100000000000000009',
} as const;

export const cfg: GuildConfig = parseGuildConfig({
  guildId: '900000000000000000',
  channels: { keiji: '900000000000000001', log: '900000000000000002' },
  roles: { yakudoshi: ROLE.yakudoshi },
  ranks: [
    { key: 'sanpaisha', name: '参拝者', emoji: '🔰', roleId: ROLE.sanpaisha, weight: 1, auto: true, requiredGoen: 0 },
    { key: 'ujiko', name: '氏子', emoji: '🍃', roleId: ROLE.ujiko, weight: 2, auto: true, requiredGoen: 20 },
    { key: 'sewayaku', name: '世話役', emoji: '🎋', roleId: ROLE.sewayaku, weight: 3, auto: true, requiredGoen: 100 },
    { key: 'sodai', name: '総代', emoji: '🏮', roleId: ROLE.sodai, weight: 4, auto: true, requiredGoen: 300 },
    { key: 'shinshoku', name: '神職', emoji: '🎐', roleId: ROLE.shinshoku, weight: 5, auto: false },
    { key: 'guji', name: '宮司', emoji: '⛩', roleId: ROLE.guji, weight: 10, auto: false },
  ],
});

export function member(id: string, ...roleIds: string[]) {
  return { id, isBot: false, roleIds };
}

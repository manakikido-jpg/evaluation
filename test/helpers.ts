import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { parseGuildConfig, type GuildConfig } from '../src/config.js';
import { migrationsFolder, type Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { existsSync, readFileSync } from 'node:fs';
import { templatePath } from './dbTemplate.js';

/** テスト用: メモリ上の PostgreSQL（PGlite）にマイグレーションを当てた DB */
export async function makeDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  // マイグレーション済みの写し（test/dbTemplate.ts）があれば、そこから読みこむ（毎回マイグレーションするより 5 倍ほど速い）
  const template = loadTemplate();
  const client = template ? new PGlite({ loadDataDir: template }) : new PGlite();
  const db = drizzle(client, { schema });
  if (!template) await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}

let templateBlob: Blob | null | undefined;
function loadTemplate(): Blob | null {
  if (templateBlob !== undefined) return templateBlob;
  const path = templatePath();
  templateBlob = existsSync(path) ? new Blob([readFileSync(path)]) : null;
  return templateBlob;
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

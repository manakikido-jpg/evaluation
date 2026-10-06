import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrationsFolder } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';

/**
 * テストを速くするための「マイグレーション済みの DB の写し」。
 * 空の PGlite を作るだけで 2 秒近くかかるので、マイグレーションまで済ませたものを 1 回だけ作って保存し、
 * テストごとにそこから読みこむ（0.5 秒ほど）。マイグレーションが変わると名前が変わって作り直す
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, 'node_modules', '.cache', 'pglite');

/** マイグレーションの中身から作る名前（足したり直したりすると変わる） */
function templateKey(): string {
  const h = createHash('sha256');
  for (const f of readdirSync(migrationsFolder).filter((x) => x.endsWith('.sql')).sort()) h.update(f).update(readFileSync(join(migrationsFolder, f)));
  return h.digest('hex').slice(0, 16);
}

export const templatePath = () => join(cacheDir, `template-${templateKey()}.tar`);

/** 写しを作る（もうあれば何もしない）。vitest の globalSetup から 1 回だけ呼ぶ */
export async function buildTemplate(): Promise<string> {
  const path = templatePath();
  if (existsSync(path)) return path;
  const client = new PGlite();
  await migrate(drizzle(client, { schema }), { migrationsFolder });
  const dump = await client.dumpDataDir('none');
  await client.close();
  mkdirSync(cacheDir, { recursive: true });
  // 途中で止まっても壊れた写しが残らないように、書き終えてから名前を変える
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, Buffer.from(await dump.arrayBuffer()));
  renameSync(tmp, path);
  return path;
}

export default async function setup(): Promise<void> {
  await buildTemplate();
}

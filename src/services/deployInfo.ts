import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';

/**
 * 🚀 本番に反映した時間。
 * BOT・社務所Web が起動したときに「いま動いている版（commit）と起動した時間」を残し、
 * 更新履歴のうち、まだ時間が残っていないものに「反映した時間」を付ける。
 */
const RUN_KEY = (proc: DeployProc) => `deploy.${proc}`;
const REFLECTED_KEY = 'changelog.reflected';
export type DeployProc = 'bot' | 'web';
const runSchema = z.object({ commit: z.string().max(40).default(''), startedAt: z.string() });
export type DeployRun = { commit: string; startedAt: Date };
/** 更新履歴の id → 反映した時間（ISO）。null は「記録を始める前からあった」 */
const reflectedSchema = z.record(z.string(), z.string().nullable());

/** イメージに入れた commit（update.sh が組み立てのときに入れる。なければ空） */
export const runningCommit = (env: NodeJS.ProcessEnv = process.env) => (/^[0-9a-f]{7,40}$/.test(env.GIT_COMMIT ?? '') ? env.GIT_COMMIT!.slice(0, 7) : '');

export async function recordDeploy(db: Db, proc: DeployProc, changeIds: readonly string[], commit: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    // BOT と社務所Web が同時に起動しても、記録が食い違わないように
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${REFLECTED_KEY}))`);
    const run = { commit, startedAt: now.toISOString() };
    await tx.insert(settings).values({ key: RUN_KEY(proc), value: run, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value: run, updatedBy: 'system', updatedAt: now } });
    const [row] = await tx.select().from(settings).where(eq(settings.key, REFLECTED_KEY));
    const parsed = reflectedSchema.safeParse(row?.value);
    const first = !row || !parsed.success;
    const map: Record<string, string | null> = first ? {} : { ...parsed.data };
    let changed = first;
    changeIds.forEach((id, i) => {
      if (id in map) return;
      // はじめて記録するときは、前からあったものに時間を付けない（いちばん新しい 1 つだけ、いま反映したことにする）
      map[id] = first && i > 0 ? null : now.toISOString();
      changed = true;
    });
    if (changed) await tx.insert(settings).values({ key: REFLECTED_KEY, value: map, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value: map, updatedBy: 'system', updatedAt: now } });
  });
}

/** 更新履歴の id ごとの、反映した時間 */
export async function reflectedTimes(db: Db): Promise<Map<string, Date>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, REFLECTED_KEY));
  const parsed = reflectedSchema.safeParse(row?.value ?? {});
  return new Map(parsed.success ? Object.entries(parsed.data).flatMap(([id, at]) => (at ? [[id, new Date(at)] as const] : [])) : []);
}

/** いま動いている BOT・社務所Web の版と、起動した時間 */
export async function deployRuns(db: Db): Promise<Partial<Record<DeployProc, DeployRun>>> {
  const out: Partial<Record<DeployProc, DeployRun>> = {};
  for (const proc of ['bot', 'web'] as const) {
    const [row] = await db.select().from(settings).where(eq(settings.key, RUN_KEY(proc)));
    const p = runSchema.safeParse(row?.value);
    if (p.success) out[proc] = { commit: p.data.commit, startedAt: new Date(p.data.startedAt) };
  }
  return out;
}

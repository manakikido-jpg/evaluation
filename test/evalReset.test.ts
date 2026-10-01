import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members, shuin } from '../src/db/schema.js';
import { demoteTargets, resetState, runDemotions, startEvaluationReset, undoShuinReset } from '../src/services/evalReset.js';
import { recordJoin } from '../src/services/members.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const M = (n: number) => `80000000000000000${n}`;
const NOW = new Date('2026-10-01T12:00:00+09:00');
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  const roleSets = [[ROLE.sanpaisha], [ROLE.ujiko], [ROLE.sanpaisha, ROLE.sewayaku], [ROLE.guji, ROLE.sodai], [ROLE.shinshoku], [ROLE.sodai]];
  for (const [i, roleIds] of roleSets.entries()) {
    await recordJoin(db, { id: M(i + 1), username: `u${i}`, displayName: `u${i}`, avatarUrl: null, roleIds, isBot: false, joinedAt: new Date('2026-09-01T00:00:00Z') });
  }
  // 6 番目の人は抜けている
  await db.update(members).set({ leftAt: new Date('2026-09-20T00:00:00Z') }).where(eq(members.id, M(6)));
  for (const [g, r] of [[1, 2], [2, 3], [3, 1], [4, 2]] as const) await db.insert(shuin).values({ giverId: M(g), receiverId: M(r), weight: 3, giverRank: 'ujiko' });
  // もう取り消してあった朱印
  await db.insert(shuin).values({ giverId: M(5), receiverId: M(1), weight: 3, giverRank: 'ujiko', revokedAt: new Date('2026-09-25T00:00:00Z') });
});
afterEach(async () => {
  await close();
});

describe('🔄 評価のリセット', () => {
  it('役職を戻す人: いちばん下より上の自動の役職を持っている人だけ（任命制はそのまま）', () => {
    const t = demoteTargets(cfg.ranks, [
      { id: 'a', roleIds: [ROLE.sanpaisha] },
      { id: 'b', roleIds: [ROLE.ujiko] },
      { id: 'c', roleIds: [ROLE.sanpaisha, ROLE.sewayaku, ROLE.ujiko] },
      { id: 'd', roleIds: [ROLE.shinshoku] },
    ]);
    expect(t).toEqual([
      { id: 'b', remove: [ROLE.ujiko], add: ROLE.sanpaisha },
      { id: 'c', remove: [ROLE.ujiko, ROLE.sewayaku], add: null },
    ]);
  });

  it('朱印は全部取り消し（記録は残る）、役職は少しずつ戻す。一度だけ。朱印だけ戻せる', async () => {
    const r = await startEvaluationReset(db, cfg, M(4), NOW);
    expect(r.status).toBe('ok');
    expect(r.state.revoked).toBe(4);
    expect(r.state.targets.map((x) => x.id).sort()).toEqual([M(2), M(3), M(4)]);
    const rows = await db.select().from(shuin);
    expect(rows).toHaveLength(5);
    expect(rows.every((x) => x.revokedAt)).toBe(true);
    expect((await startEvaluationReset(db, cfg, M(4), NOW)).status).toBe('already');
    // Discord に頼む（1 回に 2 人まで）
    const calls: string[] = [];
    const discord = {
      addRole: async (_g: string, u: string, role: string) => void calls.push(`+${u}:${role}`),
      removeRole: async (_g: string, u: string, role: string) => {
        if (u === M(4)) throw new Error('403');
        calls.push(`-${u}:${role}`);
      },
    };
    expect(await runDemotions(db, cfg, discord, 2, NOW)).toBe(false);
    expect(await runDemotions(db, cfg, discord, 2, NOW)).toBe(true);
    expect(calls).toContain(`+${M(2)}:${ROLE.sanpaisha}`);
    expect(calls).toContain(`-${M(2)}:${ROLE.ujiko}`);
    expect(calls).toContain(`-${M(3)}:${ROLE.sewayaku}`);
    const [m2] = await db.select().from(members).where(eq(members.id, M(2)));
    expect(m2!.roleIds).toEqual([ROLE.sanpaisha]);
    const st = await resetState(db);
    expect(st).toMatchObject({ done: 3, failed: [M(4)] });
    expect(st!.finishedAt).toBeTruthy();
    // 押し直したもの（1→2）はそのまま、リセットで取り消した分だけ戻す（前から取り消してあったものは戻さない）
    await db.update(shuin).set({ revokedAt: null }).where(eq(shuin.giverId, M(1)));
    expect(await undoShuinReset(db, M(4), NOW)).toBe(3);
    const after = await db.select().from(shuin);
    expect(after.filter((x) => !x.revokedAt)).toHaveLength(4);
    expect(await undoShuinReset(db, M(4), NOW)).toBe(0);
  });
});

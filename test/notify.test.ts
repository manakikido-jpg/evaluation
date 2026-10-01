import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
import { panelMessage } from '../src/discord/panels.js';
import { recordJoin } from '../src/services/members.js';
import { resolveMention } from '../src/services/notices.js';
import { notifyCounts, notifyOf, notifySetupState, pingRoleIds, runNotifySetup, setNotify, startNotifySetup } from '../src/services/notify.js';
import { recruitMentionRoleIds } from '../src/services/recruit.js';
import { cfg as baseCfg, makeDb, ROLE } from './helpers.js';

const OK = '870000000000000001';
const NG = '870000000000000002';
const cfg: GuildConfig = { ...baseCfg, notify: { okRoleId: OK, ngRoleId: NG } };
const M = (n: number) => `87000000000000010${n}`;

let db: Db;
let close: () => Promise<void>;
let calls: string[];
const discord = {
  addRole: async (_g: string, u: string, r: string) => {
    if (u === M(4)) throw new Error('403');
    calls.push(`add ${u} ${r}`);
  },
  removeRole: async (_g: string, u: string, r: string) => void calls.push(`remove ${u} ${r}`),
};
beforeEach(async () => {
  ({ db, close } = await makeDb());
  calls = [];
  const sets = [[ROLE.sanpaisha], [ROLE.ujiko, NG], [ROLE.sanpaisha, OK], [ROLE.ujiko], [], [ROLE.sanpaisha]];
  for (const [i, roleIds] of sets.entries()) {
    await recordJoin(db, { id: M(i + 1), username: `u${i}`, displayName: `u${i}`, avatarUrl: null, roleIds, isBot: false, joinedAt: null });
  }
  await db.update(members).set({ leftAt: new Date() }).where(eq(members.id, M(6)));
});
afterEach(async () => {
  await close();
});

describe('🔔 通知 OK／NG', () => {
  it('用意していなければ、今まで通り役職のロール全部を鳴らす。用意したら通知 OK だけ', () => {
    const ranks = [...new Set(baseCfg.ranks.map((r) => r.roleId))];
    expect(pingRoleIds(baseCfg)).toEqual(ranks);
    expect(recruitMentionRoleIds(baseCfg)).toEqual(ranks);
    expect(pingRoleIds(cfg)).toEqual([OK]);
    expect(recruitMentionRoleIds(cfg)).toEqual([OK]);
    expect(resolveMention('ranks', pingRoleIds(cfg))).toBe(OK);
    expect(notifyOf(cfg, [OK])).toBe('ok');
    expect(notifyOf(cfg, [OK, NG])).toBe('ng');
    expect(notifyOf(cfg, [])).toBeUndefined();
  });

  it('切り替え: 選んだほうを付けて、もう片方を外す。用意していなければ何もしない', async () => {
    const ctx = { cfg, discord };
    expect(await setNotify(ctx, M(3), 'ng', [ROLE.sanpaisha, OK])).toBe('ok');
    expect(calls).toEqual([`add ${M(3)} ${NG}`, `remove ${M(3)} ${OK}`]);
    calls = [];
    await setNotify(ctx, M(2), 'ok', [ROLE.ujiko, NG]);
    expect(calls).toEqual([`add ${M(2)} ${OK}`, `remove ${M(2)} ${NG}`]);
    calls = [];
    // もう OK で NG がなければ、何もしない
    await setNotify(ctx, M(3), 'ok', [OK]);
    expect(calls).toEqual([]);
    expect(await setNotify({ cfg: baseCfg, discord }, M(1), 'ok')).toBe('disabled');
  });

  it('用意したとき: 役職のある今いる人で、まだどちらもない人に通知 OK を少しずつ付ける', async () => {
    expect(await notifyCounts(db, cfg)).toEqual({ ok: 1, ng: 1, none: 2 });
    const st = await startNotifySetup(db, cfg, 'guji');
    // 1: 参拝者 / 4: 氏子（付けられない）。2 は NG・3 は OK・5 は役職なし・6 は抜けた
    expect(st.targets.sort()).toEqual([M(1), M(4)]);
    expect(await runNotifySetup(db, cfg, discord, 1)).toBe(false);
    expect(await runNotifySetup(db, cfg, discord, 10)).toBe(true);
    expect(calls).toEqual([`add ${M(1)} ${OK}`]);
    const done = await notifySetupState(db);
    expect(done).toMatchObject({ done: 2, failed: [M(4)] });
    expect(done?.finishedAt).toBeTruthy();
    expect(await notifyCounts(db, cfg)).toEqual({ ok: 2, ng: 1, none: 1 });
    // 押し直すと、まだの人だけ
    expect((await startNotifySetup(db, cfg, 'guji')).targets).toEqual([M(4)]);
  });

  it('ボタン（🔔 通知OK／🔕 通知NG）', () => {
    const p = panelMessage('notify');
    expect(p.components[0]!.components.map((b) => b.custom_id)).toEqual(['notify:ok', 'notify:ng']);
    expect(p.embeds[0]!.title).toContain('通知');
  });
});

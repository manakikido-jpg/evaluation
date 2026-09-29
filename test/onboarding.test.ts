import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { activityDaily, members, omikuji, shuin } from '../src/db/schema.js';
import { walletOf } from '../src/services/economy.js';
import { recordJoin } from '../src/services/members.js';
import { claimOnboarding, onboardingOf, onboardingText, onboardingTick } from '../src/services/onboarding.js';
import { cfg as baseCfg, makeDb, ROLE } from './helpers.js';

const NEW = '860000000000000001';
const OLD = '860000000000000002';
const OTHER = '860000000000000003';
const NOW = new Date('2026-09-26T12:00:00Z');
const cfg: GuildConfig = {
  ...baseCfg,
  economy: { ...baseCfg.economy, onboardingReward: 300 },
};

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  const join = (id: string, joinedAt: Date, roleIds: string[]) =>
    recordJoin(db, { id, username: id, displayName: id, avatarUrl: null, roleIds, isBot: false, joinedAt });
  await join(NEW, new Date('2026-09-20T00:00:00Z'), [ROLE.sanpaisha]);
  await join(OLD, new Date('2026-01-01T00:00:00Z'), [ROLE.ujiko]);
  await join(OTHER, new Date('2026-09-20T00:00:00Z'), [ROLE.sanpaisha]);
});
afterEach(async () => {
  await close();
});

const doAll = async (id: string) => {
  await db.insert(omikuji).values({ memberId: id, date: '2026-09-21', fortune: 'kichi', amount: 10 });
  await db.insert(shuin).values({ giverId: id, receiverId: OTHER === id ? NEW : OTHER, weight: 1, giverRank: 'sanpaisha' });
  await db.insert(activityDaily).values([
    { memberId: id, date: '2026-09-21', vcMinutes: 6 },
    { memberId: id, date: '2026-09-22', vcMinutes: 4 },
  ]);
};

describe('はじめての参拝', () => {
  it('はじめは全部まだ。やったものから ✅ になる。通話は合わせて 10 分', async () => {
    const p0 = await onboardingOf(db, cfg, NEW);
    expect(p0.steps.map((s) => [s.key, s.done])).toEqual([
      ['omikuji', false],
      ['shuin', false],
      ['voice', false],
    ]);
    expect(onboardingText(cfg, p0)).toContain('（0/3）');
    await db.insert(activityDaily).values({ memberId: NEW, date: '2026-09-20', vcMinutes: 9 });
    expect((await onboardingOf(db, cfg, NEW)).steps.find((s) => s.key === 'voice')).toMatchObject({ done: false, hint: expect.stringContaining('9/10') });
    await doAll(NEW);
    const p = await onboardingOf(db, cfg, NEW);
    expect(p.allDone).toBe(true);
  });

  it('全部できたらお祝い（1 回だけ）。まだなら渡さない', async () => {
    expect(await claimOnboarding(db, cfg, NEW)).toEqual({ status: 'not_yet' });
    await doAll(NEW);
    expect(await claimOnboarding(db, cfg, NEW)).toEqual({ status: 'rewarded', amount: 300 });
    expect(await claimOnboarding(db, cfg, NEW)).toEqual({ status: 'already' });
    expect((await walletOf(db, NEW)).balance).toBe(300);
    expect(onboardingText(cfg, await onboardingOf(db, cfg, NEW))).toContain('全部できています');
  });

  it('10 分ごと: 最近入った参拝者以上で、全部できた人にだけお祝いと DM', async () => {
    await doAll(NEW);
    await doAll(OLD);
    const dms: string[] = [];
    const done = await onboardingTick({ db, cfg, discord: { sendDm: async (u, c) => (dms.push(`${u} ${c}`), true) } }, NOW);
    expect(done).toEqual([NEW]);
    expect(dms[0]).toContain('お祝いに 🪙銭 を 300 枚');
    expect(await onboardingTick({ db, cfg, discord: { sendDm: async () => true } }, NOW)).toEqual([]);
  });
});

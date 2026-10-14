import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { keibaHorses } from '../src/db/schema.js';
import type { Rng } from '../src/services/casino/cards.js';
import { newStable, seeded as seededFloat, type KbStable } from '../src/services/casino/keiba.js';
import { BIG_HOST, formatBigRaces, keibaBigTick, parseBigRaces, startOf } from '../src/services/casino/keibaBig.js';
import { addHorse } from '../src/services/casino/keibaStable.js';
import { bigField, keiba, type KbState } from '../src/services/casino/tables/keiba.js';
import { tableById } from '../src/services/casino/tables/service.js';
import type { Ctx } from '../src/services/casino/tables/types.js';
import { cfg, makeDb } from './helpers.js';
import { inArray } from 'drizzle-orm';

const rngOf = (seed: number): Rng => {
  let x = seed;
  return (n) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return Math.floor((x / 2147483648) * n);
  };
};
const tcfg: GuildConfig = { ...cfg, casino: { ...cfg.casino, dailyBetLimit: 0 } };
const OWNER = '760000000000000002';
const horse = (id: number, starts: number, wins: number, ownerId: string | null = null): KbStable => ({ ...newStable(seededFloat(id)), id, name: `H${id}`, starts, wins, ownerId });
const ctx = (now: number, roster: KbStable[]): Ctx => ({ now, rng: rngOf(1), cfg: tcfg, roster });

describe('🏆 大レース（卓）', () => {
  it('出られるのは馬主のいるオープンの馬だけ。4 頭そろわなければ開かない', () => {
    const roster = [horse(1, 20, 6, OWNER), horse(2, 20, 7, OWNER), horse(3, 20, 6, null), horse(4, 5, 2, OWNER), horse(5, 30, 9, OWNER)];
    expect(bigField(roster).map((h) => h.id)).toEqual([5, 2, 1]);
    const t0 = Date.parse('2026-10-04T12:50:00Z');
    expect(keiba.create(BIG_HOST, { big: '1', cls: '8', title: '大賞典', at: String(t0 + 600_000) }, ctx(t0, roster))).toEqual({ ok: false, error: 'too_few' });
    // ふつうの人は big を付けても大レースにならない・G1 は選べない
    const normal = keiba.create({ id: OWNER, name: 'もみじ' }, { big: '1', cls: '8' }, ctx(t0, roster));
    expect(normal.ok && (normal.state.big === undefined && normal.state.race.cls !== 8)).toBe(true);
  });

  it('5 頭立てで走り、馬券を買っていない馬主にも満額の最低保証。1 回で閉じる', () => {
    const roster = [6, 7, 8, 9, 10].map((id) => horse(id, 20, 6, OWNER));
    const t0 = Date.parse('2026-10-04T12:50:00Z');
    const at = t0 + 600_000;
    const c = keiba.create(BIG_HOST, { big: '1', cls: '8', title: '咲楽ノ宮大賞典', at: String(at), key: 'k' }, ctx(t0, roster));
    if (!c.ok) throw new Error(c.error);
    let s: KbState = c.state;
    expect(s.horses).toHaveLength(5);
    expect(s.race.cls).toBe(8);
    expect(s.race.name).toContain('G1');
    expect(s.deadline).toBe(at);
    // 6 番の馬はいない
    const A = { id: '760000000000000001', name: 'さくら' };
    s = (keiba.join(s, A, {}, ctx(t0, roster)) as { state: KbState }).state;
    expect(keiba.act(s, A.id, { action: 'bet', type: 'win', a: '6', bet: '100' }, ctx(t0, roster))).toEqual({ ok: false, error: 'invalid' });
    expect(keiba.act(s, A.id, { action: 'bets', type: 'trifecta', h: ['1', '2', '3'], bet: '10' }, ctx(t0, roster)).ok).toBe(true);
    expect(keiba.tick(s, ctx(at - 1, roster))).toBeNull();
    s = (keiba.tick(s, ctx(at, roster)) as { state: KbState }).state;
    expect(s.phase).toBe('racing');
    const fin = keiba.tick(s, ctx(s.deadline, roster));
    if (!fin || !fin.ok) throw new Error('no finish');
    const purse = (fin.fx?.credits ?? []).filter((x) => x.memberId === OWNER && x.reason === 'keiba_prize');
    expect(purse.some((x) => x.cap)).toBe(false);
    expect(fin.state.prizes![0]).toBeGreaterThanOrEqual(tcfg.casino.keibaPurse[8]!);
    s = fin.state;
    const end = keiba.tick(s, ctx(s.deadline, roster));
    expect(end && end.ok && end.state.seats).toEqual([]);
    expect(keiba.closed(end && end.ok ? end.state : s, s.deadline)).toBe(true);
  });
});

describe('🏆 大レースの日程', () => {
  it('書き方の読み書き', () => {
    expect(formatBigRaces(cfg.casino.keibaBigRaces)).toBe('毎日 21:00 G2 咲楽ノ宮記念\n日 22:00 G1 咲楽ノ宮大賞典');
    expect(parseBigRaces('毎日 21:00 G2 咲楽ノ宮記念\n日曜 9:30 G1 春の大賞典\n')).toEqual([
      { name: '咲楽ノ宮記念', day: -1, time: '21:00', cls: 7 },
      { name: '春の大賞典', day: 0, time: '09:30', cls: 8 },
    ]);
    expect(parseBigRaces('')).toEqual([]);
    expect(parseBigRaces('毎日 25:00 G1 ダメ')).toBeUndefined();
    expect(parseBigRaces('毎日 21:00 G3 ダメ')).toBeUndefined();
    // 2026-10-04 は日曜
    expect(startOf({ name: 'x', day: 0, time: '22:00', cls: 8 }, new Date('2026-10-04T03:00:00Z'))?.toISOString()).toBe('2026-10-04T13:00:00.000Z');
    expect(startOf({ name: 'x', day: 1, time: '22:00', cls: 8 }, new Date('2026-10-04T03:00:00Z'))).toBeUndefined();
  });

  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => {
    await close();
  });

  it('30 分前に予告、10 分前に卓を開いて知らせる。そろわなければ中止を知らせる', async () => {
    const c: GuildConfig = { ...tcfg, casino: { ...tcfg.casino, keibaAnnounceChannelId: '760000000000000900', keibaBigRaces: [{ name: '咲楽ノ宮大賞典', day: 0, time: '22:00', cls: 8 }] } };
    const log: string[] = [];
    const discord = { sendMessage: async (_ch: string, b: { content?: string }) => { log.push(b.content ?? ''); return { id: '1' }; } };
    const at = Date.parse('2026-10-04T13:00:00Z');
    // まだ馬がいない → 中止
    await keibaBigTick({ db, cfg: c, discord, baseUrl: 'https://x.example' }, new Date(at - 30 * 60_000));
    await keibaBigTick({ db, cfg: c, discord, baseUrl: 'https://x.example' }, new Date(at - 10 * 60_000));
    expect(log[0]).toContain('そろっていません');
    expect(log[1]).toContain('中止');
    // 馬主のいるオープンの馬を 4 頭
    const ids: number[] = [];
    for (let k = 0; k < 4; k++) ids.push((await addHorse(db, `オオモノ${k}`, undefined, OWNER))!.id);
    await db.update(keibaHorses).set({ starts: 20, wins: 6 }).where(inArray(keibaHorses.id, ids));
    log.length = 0;
    await keibaBigTick({ db, cfg: c, discord, baseUrl: 'https://x.example' }, new Date(at - 30 * 60_000 + 15_000));
    expect(log[0]).toContain('30 分後');
    expect(log[0]).toContain('オオモノ0');
    await keibaBigTick({ db, cfg: c, discord, baseUrl: 'https://x.example' }, new Date(at - 10 * 60_000));
    expect(log[1]).toContain('受付をはじめました');
    const id = Number(/\/casino\/t\/(\d+)/.exec(log[1]!)![1]);
    const t = await tableById(db, id);
    const st = t!.state as KbState;
    expect(st.big?.key).toContain('咲楽ノ宮大賞典');
    expect(st.horses).toHaveLength(4);
    expect(st.deadline).toBe(at);
    // 同じ分にもう一度呼んでも、2 つ目は開かない
    await keibaBigTick({ db, cfg: c, discord, baseUrl: 'https://x.example' }, new Date(at - 10 * 60_000 + 30_000));
    expect(log).toHaveLength(2);
    // ほかの時刻は何もしない
    await keibaBigTick({ db, cfg: c, discord }, new Date(at - 20 * 60_000));
    expect(log).toHaveLength(2);
  });
});

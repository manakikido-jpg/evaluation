import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import type { ShopItem } from '../src/db/schema.js';
import { DiscordHttpError, type DiscordActions } from '../src/lib/discordRest.js';
import { boostDm, currentBoosters, processBoosters, thankBooster, updateBoard } from '../src/services/boost.js';
import { recentCoinTx, walletOf } from '../src/services/economy.js';
import { getMember, recordJoin, upsertMember, type MemberSnapshot } from '../src/services/members.js';
import { priceOf } from '../src/services/shop.js';
import { cfg, makeDb } from './helpers.js';

const A = '800000000000000001';
const B = '800000000000000002';
const BANZUKE = '910000000000000077';
const DAY = 86_400_000;
const T0 = new Date('2026-09-01T00:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const withBanzuke: GuildConfig = { ...cfg, channels: { ...cfg.channels, banzuke: BANZUKE } };

let db: Db;
let close: () => Promise<void>;
let log: string[];
let messages: Map<string, string>;
let seq: number;
const discord: DiscordActions = {
  addRole: async () => undefined,
  removeRole: async () => undefined,
  sendDm: async (u, text) => (log.push(`dm ${u} ${text}`), true),
  ban: async () => undefined,
  unban: async () => undefined,
  kick: async () => undefined,
  editMessage: async (c, m, b) => {
    if (!messages.has(m)) throw new DiscordHttpError('Unknown Message', 404);
    messages.set(m, b.embeds?.[0]?.description ?? '');
    log.push(`edit ${c} ${m}`);
  },
  sendMessage: async (c, b) => {
    const id = `m${++seq}`;
    messages.set(id, b.embeds?.[0]?.description ?? '');
    log.push(`send ${c} ${id} ${b.embeds?.[0]?.description ?? ''}`);
    return { id };
  },
  deleteMessage: async () => undefined,
  pinMessage: async () => undefined,
  guildChannels: async () => [],
  guildRoles: async () => [],
  editChannel: async () => undefined,
  setChannelOverwrite: async () => undefined,
};

const snap = (id: string, boostingSince: Date | null): MemberSnapshot => ({
  id,
  username: id,
  displayName: `name${id.slice(-1)}`,
  avatarUrl: null,
  roleIds: [],
  isBot: false,
  joinedAt: T0,
  boostingSince,
});

beforeEach(async () => {
  ({ db, close } = await makeDb());
  log = [];
  messages = new Map();
  seq = 0;
});
afterEach(async () => {
  await close();
});

describe('お礼の花びら', () => {
  it('始めたらお知らせ＋花びら。続けている間は 30 日ごと。同じ日に何度呼んでも 1 回', async () => {
    const since = at(0);
    expect(await thankBooster(db, cfg, A, since, at(0))).toEqual({ kind: 'new', granted: 1500 });
    expect(await thankBooster(db, cfg, A, since, at(0.01))).toEqual({ kind: 'none', granted: 0 });
    expect(await thankBooster(db, cfg, A, since, at(29.9))).toEqual({ kind: 'none', granted: 0 });
    expect(await thankBooster(db, cfg, A, since, at(30))).toEqual({ kind: 'monthly', granted: 1500 });
    expect((await walletOf(db, A)).balance).toBe(3000);
    expect((await recentCoinTx(db, A))[0]).toMatchObject({ reason: 'boost', amount: 1500 });
  });

  it('やめてすぐ始め直すと、お知らせはするが花びらは 30 日たつまで贈らない', async () => {
    await thankBooster(db, cfg, A, at(0), at(0));
    expect(await thankBooster(db, cfg, A, at(5), at(5))).toEqual({ kind: 'new', granted: 0 });
    expect(await thankBooster(db, cfg, A, at(5), at(10))).toEqual({ kind: 'none', granted: 0 });
    expect(await thankBooster(db, cfg, A, at(5), at(30))).toEqual({ kind: 'monthly', granted: 1500 });
    expect((await walletOf(db, A)).balance).toBe(3000);
  });

  it('お礼を 0 にすると、お知らせだけで花びらは贈らない', async () => {
    const zero: GuildConfig = { ...cfg, economy: { ...cfg.economy, boostThanks: 0 } };
    expect(await thankBooster(db, zero, A, at(0), at(0))).toEqual({ kind: 'new', granted: 0 });
    expect(await thankBooster(db, zero, A, at(0), at(40))).toEqual({ kind: 'none', granted: 0 });
    expect((await walletOf(db, A)).balance).toBe(0);
  });
});

describe('お知らせ・DM・奉納板', () => {
  it('#慶事 にお知らせ、本人に DM（花びらと割引の案内つき）。2 回目は何もしない', async () => {
    await recordJoin(db, snap(A, at(0)));
    await recordJoin(db, snap(B, null));
    expect(await processBoosters({ db, cfg, discord }, at(0))).toEqual({ announced: 1, granted: 1 });
    const announce = log.find((l) => l.startsWith(`send ${cfg.channels.keiji}`))!;
    expect(announce).toContain(`<@${A}>`);
    expect(announce).toContain('奉納');
    const dm = log.find((l) => l.startsWith(`dm ${A}`))!;
    expect(dm).toContain('1,500 枚');
    expect(dm).toContain('20% 引き');
    expect(log.some((l) => l.includes(B))).toBe(false);

    log.length = 0;
    expect(await processBoosters({ db, cfg, discord }, at(1))).toEqual({ announced: 0, granted: 0 });
    expect(log).toEqual([]);
    // 30 日後: 「今月も」の DM だけ
    await processBoosters({ db, cfg, discord }, at(30));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^dm .*今月も/);
  });

  it('DM: 割引 0 なら割引の案内を出さない。文面は設定で変えられる', () => {
    const c: GuildConfig = { ...cfg, economy: { ...cfg.economy, boostDiscountPercent: 0 }, boost: { ...cfg.boost, dmText: '{名前} さん、ありがとう！' } };
    const text = boostDm(A, c, { kind: 'new', granted: 1500 });
    expect(text.startsWith(`<@${A}> さん、ありがとう！`)).toBe(true);
    expect(text).not.toContain('引き');
  });

  it('奉納板: 今奉納している人を載せる。変わらなければ書き換えず、やめたら外す。消されたら貼り直す', async () => {
    const ctx = { db, cfg: withBanzuke, discord };
    expect(await updateBoard(ctx)).toBe('posted');
    expect(messages.get('m1')).toContain('いまはいません');
    await recordJoin(db, snap(A, at(0)));
    expect(await updateBoard(ctx)).toBe('edited');
    expect(messages.get('m1')).toContain(`<@${A}> … 2026年9月から`);
    expect(await updateBoard(ctx)).toBe('unchanged');
    await upsertMember(db, snap(A, null));
    expect(await updateBoard(ctx)).toBe('edited');
    expect(messages.get('m1')).not.toContain(A);
    messages.clear();
    await recordJoin(db, snap(B, at(3)));
    expect(await updateBoard(ctx)).toBe('posted');
  });

  it('奉納の日時は Discord から来たときだけ変える（来なければそのまま）', async () => {
    await recordJoin(db, snap(A, at(0)));
    const { boostingSince: _drop, ...noBoost } = snap(A, null);
    await upsertMember(db, noBoost);
    expect((await getMember(db, A))?.boostingSince?.toISOString()).toBe(at(0).toISOString());
    expect((await currentBoosters(db)).map((b) => b.id)).toEqual([A]);
  });
});

describe('奉納割引', () => {
  const item = (kind: ShopItem['kind'], price: number) => ({ id: 1, kind, price }) as ShopItem;
  it('授与品は割引（切り上げ）。免罪符・贈り物は割引しない。0% なら元の値段', () => {
    const e = cfg.economy;
    expect(priceOf(item('role', 1500), e, true)).toBe(1200);
    expect(priceOf(item('hanafubuki', 333), e, true)).toBe(267);
    expect(priceOf(item('role', 1500), e, false)).toBe(1500);
    expect(priceOf(item('menzaifu', 0), e, true)).toBe(e.menzaifuPrice);
    expect(priceOf(item('role', 1500), { ...e, boostDiscountPercent: 0 }, true)).toBe(1500);
  });
});

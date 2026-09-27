import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import type { ShopItem } from '../src/db/schema.js';
import { DiscordHttpError, type DiscordActions } from '../src/lib/discordRest.js';
import { boostCatchupSince, boostCountOf, boostDm, currentBoosters, endBoosterOnlyRoles, processBoosters, thankBoostMessage, thankBooster, updateBoard } from '../src/services/boost.js';
import { addCoins, recentCoinTx, walletOf } from '../src/services/economy.js';
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
  removeRole: async (_g, u, r) => void log.push(`removeRole ${u} ${r}`),
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
  editRole: async () => undefined,
  editChannel: async () => undefined,
  createChannel: async (_g, b) => ({ id: '0', name: b.name, type: b.type, parent_id: b.parent_id ?? null, position: 0 }),
  deleteChannel: async () => undefined,
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

describe('奉納の記録', () => {
  it('始めたらお知らせ（同じ奉納は 1 回だけ）。お金（花びら）は渡さない', async () => {
    const since = at(0);
    expect(await thankBooster(db, A, since, at(0))).toEqual({ kind: 'new' });
    expect(await thankBooster(db, A, since, at(30))).toEqual({ kind: 'none' });
    // やめて始め直すと、また新しい奉納
    expect(await thankBooster(db, A, at(40), at(40))).toEqual({ kind: 'new' });
    expect((await walletOf(db, A)).balance).toBe(0);
  });
});

describe('お知らせ・DM・奉納板', () => {
  it('#慶事 にお知らせ、本人に DM（特典の案内つき・花びらはなし）。2 回目は何もしない', async () => {
    await recordJoin(db, snap(A, at(0)));
    await recordJoin(db, snap(B, null));
    expect(await processBoosters({ db, cfg, discord }, at(0))).toEqual({ announced: 1 });
    const announce = log.find((l) => l.startsWith(`send ${cfg.channels.keiji}`))!;
    expect(announce).toContain(`<@${A}>`);
    expect(announce).toContain('奉納');
    const dm = log.find((l) => l.startsWith(`dm ${A}`))!;
    expect(dm).toContain('20% 引き');
    expect(dm).toContain('奉納板');
    expect(dm).not.toContain('枚');
    expect(log.some((l) => l.includes(B))).toBe(false);
    expect((await walletOf(db, A)).balance).toBe(0);

    log.length = 0;
    expect(await processBoosters({ db, cfg, discord }, at(40))).toEqual({ announced: 0 });
    expect(log).toEqual([]);
  });

  it('DM: 割引 0 なら割引の案内を出さない。文面は設定で変えられる', () => {
    const c: GuildConfig = { ...cfg, economy: { ...cfg.economy, boostDiscountPercent: 0 }, boost: { ...cfg.boost, dmText: '{名前} さん、ありがとう！' } };
    const text = boostDm(A, c, { kind: 'new' });
    expect(text.startsWith(`<@${A}> さん、ありがとう！`)).toBe(true);
    expect(text).not.toContain('引き');
  });

  it('奉納板: 今奉納している人を載せる。変わらなければ書き換えず、やめたら外す。消されたら貼り直す', async () => {
    const ctx = { db, cfg: withBanzuke, discord };
    expect(await updateBoard(ctx)).toBe('posted');
    expect(messages.get('m1')).toContain('いまはいません');
    await recordJoin(db, snap(A, at(0)));
    expect(await updateBoard(ctx)).toBe('edited');
    expect(messages.get('m1')).toContain(`<@${A}> … 2026年9月から・ブースト 1 回`);
    // 「ブーストしました」で数えた回数（今の奉納の分だけ）
    await thankBoostMessage({ db, cfg, discord }, { messageId: 'old', memberId: A, count: 5 }, at(-30));
    await thankBoostMessage({ db, cfg, discord }, { messageId: 'b1', memberId: A, count: 1 }, at(0));
    await thankBoostMessage({ db, cfg, discord }, { messageId: 'b2', memberId: A, count: 2 }, at(1));
    expect(await updateBoard(ctx)).toBe('edited');
    expect(messages.get('m1')).toContain(`<@${A}> … 2026年9月から・ブースト 3 回`);
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

describe('ブースト 1 回ごとのお礼', () => {
  it('「ブーストしました」1 件ごとにお知らせと DM（花びらはなし）。同じメッセージでは 2 回出さない', async () => {
    const ctx = { db, cfg, discord };
    expect(await thankBoostMessage(ctx, { messageId: '1', memberId: A, count: 1 }, at(0))).toEqual({ status: 'ok' });
    expect(await thankBoostMessage(ctx, { messageId: '2', memberId: A, count: 2 }, at(0))).toEqual({ status: 'ok' });
    expect(await thankBoostMessage(ctx, { messageId: '2', memberId: A, count: 2 }, at(0))).toEqual({ status: 'duplicate' });
    expect((await walletOf(db, A)).balance).toBe(0);
    expect(log.filter((l) => l.startsWith(`send ${cfg.channels.keiji}`))).toHaveLength(2);
    expect(log.find((l) => l.includes('ブースト 2 回分'))).toBeDefined();
  });

  it('メッセージで数えるときは、始めたときに重ねてお知らせしない', async () => {
    const ctx = { db, cfg, discord };
    await recordJoin(db, snap(A, at(0)));
    await thankBoostMessage(ctx, { messageId: '1', memberId: A, count: 1 }, at(0));
    log.length = 0;
    expect(await processBoosters(ctx, at(0), undefined, { byMessage: true })).toEqual({ announced: 0 });
    expect(log).toEqual([]);
  });

  it('回数は本文から（空なら 1 回）。読み直すのは動き始めた時より後だけ', async () => {
    expect(boostCountOf('')).toBe(1);
    expect(boostCountOf('3')).toBe(3);
    expect(boostCountOf('abc')).toBe(1);
    const first = await boostCatchupSince(db, at(0));
    expect(first.toISOString()).toBe(at(0).toISOString());
    expect((await boostCatchupSince(db, at(5))).toISOString()).toBe(at(0).toISOString());
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

describe('奉納限定のロール', () => {
  it('奉納をやめた人の奉納限定ロールは外す（買ってすぐは外さない）。奉納中の人・ふつうの品物はそのまま', async () => {
    const { seedDefaultItems, listItems, buyRole } = await import('../src/services/shop.js');
    const KIN = '960000000000000077';
    const SAKURA = '960000000000000078';
    await seedDefaultItems(db, { colors: [{ roleId: KIN, name: '金色', emoji: '🏮', boosterOnly: true }, { roleId: SAKURA, name: '桜', emoji: '🌸' }], titles: [] });
    const items = await listItems(db);
    const kin = items.find((i) => i.roleId === KIN)!;
    expect(kin).toMatchObject({ boosterOnly: true, price: 0, durationDays: null });
    await recordJoin(db, snap(A, at(0)));
    await recordJoin(db, snap(B, at(0)));
    // B は桜を買ってから金色に（同じ色守りなので桜は外れる）
    await addCoins(db, B, 2000, 'adjust');
    await buyRole(db, items.find((i) => i.roleId === SAKURA)!, B);
    await buyRole(db, kin, A);
    await buyRole(db, kin, B);
    // B は奉納をやめた
    await upsertMember(db, snap(B, null));
    const ctx = { db, cfg, discord };
    // 買った時刻は本当の今
    const later = (min: number) => new Date(Date.now() + min * 60_000);
    expect(await endBoosterOnlyRoles(ctx, later(1))).toBe(0);
    expect(await endBoosterOnlyRoles(ctx, later(20))).toBe(1);
    expect(log.filter((l) => l.startsWith('removeRole'))).toEqual([`removeRole ${B} ${KIN}`]);
    expect(await endBoosterOnlyRoles(ctx, later(30))).toBe(0);
  });
});


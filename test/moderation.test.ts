import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { listAudit } from '../src/services/audit.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { recordJoin } from '../src/services/members.js';
import { clearYaku, giveYaku, instantBan, kickMember, purchaseMenzaifu, writeMemo, type Actor, type ModCtx } from '../src/services/moderation.js';
import { activeYakuCount, memosOf, membersWithYaku, yakuHistory } from '../src/services/yaku.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const STAFF = '820000000000000001';
const STAFF2 = '820000000000000002';
const GUJI = '820000000000000003';
const U = '820000000000000010';

type Call = [string, ...string[]];
let db: Db;
let close: () => Promise<void>;
let calls: Call[];
let dmOk: boolean;
let ctx: ModCtx;

const shinshoku: Actor = { id: STAFF, level: 'shinshoku', via: 'web' };
const guji: Actor = { id: GUJI, level: 'guji', via: 'discord' };

beforeEach(async () => {
  ({ db, close } = await makeDb());
  calls = [];
  dmOk = true;
  const discord: DiscordActions = {
    addRole: async (_g, u, r) => void calls.push(['addRole', u, r]),
    removeRole: async (_g, u, r) => void calls.push(['removeRole', u, r]),
    sendDm: async (u, content) => {
      calls.push(['dm', u, content]);
      return dmOk;
    },
    ban: async (_g, u, reason) => void calls.push(['ban', u, reason]),
    kick: async (_g, u, reason) => void calls.push(['kick', u, reason]),
    editMessage: async () => undefined,
    sendMessage: async () => ({ id: '0' }),
    deleteMessage: async () => undefined,
    guildChannels: async () => [],
  };
  ctx = { db, cfg, discord };
  const join = (id: string, roleIds: string[]) =>
    recordJoin(db, { id, username: id, displayName: id, avatarUrl: null, roleIds, isBot: false, joinedAt: null });
  await join(STAFF, [ROLE.shinshoku]);
  await join(STAFF2, [ROLE.shinshoku]);
  await join(GUJI, [ROLE.guji]);
  await join(U, [ROLE.ujiko]);
});
afterEach(async () => {
  await close();
});

const kinds = () => calls.map((c) => c[0]);

describe('厄', () => {
  it('1 つ目: 注意（厄年ロール + 本人に DM、神職の名前は出さない）', async () => {
    const r = await giveYaku(ctx, shinshoku, U, '誹謗中傷', false);
    expect(r).toEqual({ status: 'warned', dmSent: true, roleOk: true });
    expect(calls).toContainEqual(['addRole', U, ROLE.yakudoshi]);
    const dm = calls.find((c) => c[0] === 'dm')![2]!;
    expect(dm).toContain('誹謗中傷');
    expect(dm).toContain('もう 1 つ厄が付くと BAN');
    expect(dm).toContain('/menzaifu');
    expect(dm).not.toContain(STAFF);
    expect(await activeYakuCount(db, U)).toBe(1);
    expect((await listAudit(db)).map((a) => a.action)).toContain('yaku.add');
  });

  it('2 つ目は確認が必要。確認すると BAN（BAN の前に DM）', async () => {
    await giveYaku(ctx, shinshoku, U, '誹謗中傷', false);
    calls = [];
    expect(await giveYaku(ctx, shinshoku, U, 'スパム・宣伝', false)).toEqual({ status: 'needs_confirm', active: 1 });
    expect(calls).toEqual([]);
    expect(await activeYakuCount(db, U)).toBe(1);

    const r = await giveYaku(ctx, shinshoku, U, 'スパム・宣伝', true);
    expect(r).toEqual({ status: 'banned', dmSent: true, banOk: true });
    expect(kinds()).toEqual(['dm', 'ban']);
    expect((await listAudit(db, { action: 'member.ban' }))[0]?.detail).toMatchObject({ rule: 'yaku2' });
  });

  it('2 人の神職が同時に 1 つ目を付けても、ルールどおり 2 つ目で BAN になる', async () => {
    const actor2: Actor = { id: STAFF2, level: 'shinshoku', via: 'discord' };
    const results = await Promise.all([giveYaku(ctx, shinshoku, U, 'A', false), giveYaku(ctx, actor2, U, 'B', false)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(['banned', 'warned']);
  });

  it('DM が届かなくても処理は進む', async () => {
    dmOk = false;
    expect(await giveYaku(ctx, shinshoku, U, '誹謗中傷', false)).toMatchObject({ status: 'warned', dmSent: false });
  });

  it('神職は神職・宮司に、自分自身に厄を付けられない。宮司は神職に付けられる', async () => {
    expect(await giveYaku(ctx, shinshoku, STAFF2, 'x', false)).toEqual({ status: 'denied', reason: 'protected' });
    expect(await giveYaku(ctx, shinshoku, GUJI, 'x', false)).toEqual({ status: 'denied', reason: 'protected' });
    expect(await giveYaku(ctx, shinshoku, STAFF, 'x', false)).toEqual({ status: 'denied', reason: 'self' });
    expect(await giveYaku(ctx, shinshoku, '820000000000000099', 'x', false)).toEqual({ status: 'denied', reason: 'not_found' });
    expect((await giveYaku(ctx, guji, STAFF, 'x', false)).status).toBe('warned');
  });

  it('神職による取り消しで厄年ロールが外れる', async () => {
    await giveYaku(ctx, shinshoku, U, '誹謗中傷', false);
    calls = [];
    expect(await clearYaku(ctx, shinshoku, U, '間違えて付けた')).toEqual({ status: 'cleared', remaining: 0 });
    expect(calls).toContainEqual(['removeRole', U, ROLE.yakudoshi]);
    expect(await clearYaku(ctx, shinshoku, U, 'x')).toEqual({ status: 'none' });
    const [h] = await yakuHistory(db, U);
    expect(h).toMatchObject({ clearedReason: 'staff', clearedBy: STAFF, clearedNote: '間違えて付けた' });
  });

  it('厄が付いている人の一覧', async () => {
    await giveYaku(ctx, shinshoku, U, '誹謗中傷', false);
    const list = await membersWithYaku(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ memberId: U, active: 1, displayName: U });
  });
});

describe('一発 BAN', () => {
  it('厄を経ずに BAN。理由とメモが残る', async () => {
    const r = await instantBan(ctx, shinshoku, U, '個人情報の晒し', '住所を投稿');
    expect(r).toEqual({ status: 'banned', dmSent: true, banOk: true });
    expect(kinds()).toEqual(['dm', 'ban']);
    expect(calls[1]![2]).toContain('個人情報の晒し（住所を投稿）');
    const [h] = await yakuHistory(db, U);
    expect(h?.kind).toBe('instant_ban');
    // 一発 BAN は「今ついている厄」には数えない
    expect(await activeYakuCount(db, U)).toBe(0);
  });

  it('神職を一発 BAN できるのは宮司だけ', async () => {
    expect(await instantBan(ctx, shinshoku, STAFF2, '個人情報の晒し', '')).toEqual({ status: 'denied', reason: 'protected' });
  });
});

describe('免罪符', () => {
  beforeEach(async () => {
    await giveYaku(ctx, shinshoku, U, '誹謗中傷', false);
    calls = [];
  });

  it('花びらが足りないと買えない', async () => {
    await addCoins(db, U, cfg.economy.menzaifuPrice - 1, 'adjust');
    expect(await purchaseMenzaifu(ctx, U)).toEqual({
      status: 'insufficient',
      price: cfg.economy.menzaifuPrice,
      balance: cfg.economy.menzaifuPrice - 1,
    });
    expect(await activeYakuCount(db, U)).toBe(1);
  });

  it('買うと厄が祓われ、厄年ロールが外れ、花びらが減る', async () => {
    await addCoins(db, U, cfg.economy.menzaifuPrice + 10, 'adjust');
    expect(await purchaseMenzaifu(ctx, U)).toEqual({ status: 'ok', remaining: 0, price: cfg.economy.menzaifuPrice });
    expect((await walletOf(db, U)).balance).toBe(10);
    expect(calls).toContainEqual(['removeRole', U, ROLE.yakudoshi]);
    expect(await activeYakuCount(db, U)).toBe(0);
  });

  it('1 人 1 回まで', async () => {
    await addCoins(db, U, cfg.economy.menzaifuPrice * 3, 'adjust');
    await purchaseMenzaifu(ctx, U);
    await giveYaku(ctx, shinshoku, U, 'スパム・宣伝', false);
    expect(await purchaseMenzaifu(ctx, U)).toEqual({ status: 'used_up', max: 1 });
  });

  it('厄がなければ買えない', async () => {
    await clearYaku(ctx, shinshoku, U, 'x');
    expect(await purchaseMenzaifu(ctx, U)).toEqual({ status: 'no_yaku' });
  });

  it('同時に 2 回押しても 1 回分しか払わない', async () => {
    await addCoins(db, U, cfg.economy.menzaifuPrice * 2, 'adjust');
    const r = await Promise.all([purchaseMenzaifu(ctx, U), purchaseMenzaifu(ctx, U)]);
    expect(r.filter((x) => x.status === 'ok')).toHaveLength(1);
    expect((await walletOf(db, U)).balance).toBe(cfg.economy.menzaifuPrice);
  });
});

describe('キック・メモ', () => {
  it('キック（DM → キック → 記録）', async () => {
    expect(await kickMember(ctx, shinshoku, U, '迷惑行為（通話）')).toEqual({ status: 'kicked', dmSent: true, kickOk: true });
    expect(kinds()).toEqual(['dm', 'kick']);
    expect((await listAudit(db, { action: 'member.kick' }))).toHaveLength(1);
  });

  it('メモ', async () => {
    expect(await writeMemo(ctx, shinshoku, U, '通話で少し強い言い方が気になった')).toBe('ok');
    expect((await memosOf(db, U))[0]).toMatchObject({ body: '通話で少し強い言い方が気になった', authorId: STAFF });
    expect(await writeMemo(ctx, shinshoku, '820000000000000099', 'x')).toBe('not_found');
  });
});

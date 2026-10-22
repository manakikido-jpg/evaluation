import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OtoshidamaApp } from '../src/discord/otoshidama.js';
import type { Interaction } from 'discord.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import type { Db } from '../src/db/client.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { bagMessage, bagState, claimBag, expireBags, parseCount, putBag, putStaffBag, splitShares, undoBag } from '../src/services/otoshidama.js';
import { activeMyColor, buyMyColor, createItem, parseHexColor, setPurchaseRole, undoMyColor } from '../src/services/shop.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const OWNER = '860000000000000001';
const A = '860000000000000002';
const B = '860000000000000003';
const NEWBIE = '860000000000000004';
const CH = '910000000000000009';
const T0 = new Date('2026-09-29T12:00:00Z');
const coin = { name: '銭', emoji: '🪙' };

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

const base = { ownerId: OWNER, roleIds: [ROLE.ujiko], channelId: CH, note: 'あけおめ', fee: 50, itemId: 1, itemName: 'お年玉袋' };

describe('🧧 お年玉袋', () => {
  it('運営の袋: 置いた人の財布は減らない・受け取れる・残りは運営に戻る（置いた人に入らない）・出せなければ元どおり', async () => {
    const who = (id: string) => ({ id, roleIds: [ROLE.sanpaisha], voiceChannelId: CH });
    expect((await putStaffBag(db, { by: OWNER, channelId: CH, total: 50, count: 2, note: '' }, T0)).status).toBe('bad_amount');
    const r = await putStaffBag(db, { by: OWNER, channelId: CH, total: 1000, count: 3, note: 'おめでとう' }, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.bag.fromStaff).toBe(true);
    expect((await walletOf(db, OWNER)).balance).toBe(0);
    expect(bagMessage(r.bag, [], coin, T0).embeds[0]!.description).toContain('⛩ 運営からのお年玉！');
    const got = await claimBag(db, cfg, r.bag.id, who(A), T0);
    if (got.status !== 'ok') throw new Error(got.status);
    expect((await walletOf(db, A)).balance).toBe(got.amount);
    const [closed] = await expireBags(db, new Date(T0.getTime() + 25 * 3_600_000));
    expect(closed!.refunded).toBe(1000 - got.amount);
    expect((await walletOf(db, OWNER)).balance).toBe(0);
    expect(bagMessage(closed!, [], coin, T0).embeds[0]!.description).toContain('⛩ 運営に戻りました');
    const u = await putStaffBag(db, { by: OWNER, channelId: CH, total: 500, count: 2, note: '' }, T0);
    if (u.status !== 'ok') throw new Error(u.status);
    await undoBag(db, u.bag, 0);
    expect((await walletOf(db, OWNER)).balance).toBe(0);
  });

  it('分け方: 合わせると入れた量ちょうど・1 人 1 枚以上', () => {
    for (const [total, count] of [
      [100, 2],
      [1000, 7],
      [20, 20],
      [10_000, 20],
    ] as const) {
      const s = splitShares(total, count);
      expect(s).toHaveLength(count);
      expect(s.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(1);
    }
    expect(parseCount('１，０００枚')).toBe(1000);
    expect(parseCount('abc')).toBeNaN();
  });

  it('置く: 氏子以上・量と人数の範囲・入れた量と手数料を払う', async () => {
    await addCoins(db, OWNER, 2000, 'adjust');
    expect((await putBag(db, cfg, { ...base, total: 50, count: 5 }, T0)).status).toBe('bad_amount');
    expect((await putBag(db, cfg, { ...base, total: 500, count: 1 }, T0)).status).toBe('bad_amount');
    expect(await putBag(db, cfg, { ...base, total: 1990, count: 5 }, T0)).toMatchObject({ status: 'insufficient', need: 2040 });
    const r = await putBag(db, cfg, { ...base, total: 1000, count: 3 }, T0);
    expect(r.status).toBe('ok');
    expect((await walletOf(db, OWNER)).balance).toBe(950);
    // 投稿できなかったら全部戻す
    if (r.status === 'ok') await undoBag(db, r.bag, 50);
    expect((await walletOf(db, OWNER)).balance).toBe(2000);
    // 運営は役職の段に関係なく置ける
    expect((await putBag(db, cfg, { ...base, roleIds: [ROLE.shinshoku], total: 100, count: 2 }, T0)).status).toBe('ok');
  });

  it('受け取る: 先着・1 人 1 回・置いた人と未承認の人は受け取れない。空になったら閉じる', async () => {
    await addCoins(db, OWNER, 1000, 'adjust');
    const r = await putBag(db, cfg, { ...base, fee: 0, total: 300, count: 2 }, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    const id = r.bag.id;
    const who = (memberId: string, roleIds: string[] = [ROLE.sanpaisha]) => ({ id: memberId, roleIds, voiceChannelId: CH });
    expect((await claimBag(db, cfg, id, who(OWNER, [ROLE.ujiko]), T0)).status).toBe('own');
    expect((await claimBag(db, cfg, id, who(NEWBIE, []), T0)).status).toBe('not_member');
    const a = await claimBag(db, cfg, id, who(A), T0);
    expect(a).toMatchObject({ status: 'ok', order: 1, left: 1, amount: r.bag.shares[0] });
    expect((await claimBag(db, cfg, id, who(A), T0)).status).toBe('already');
    const b = await claimBag(db, cfg, id, who(B), T0);
    expect(b).toMatchObject({ status: 'ok', order: 2, left: 0 });
    expect((await walletOf(db, A)).balance + (await walletOf(db, B)).balance).toBe(300);
    expect((await claimBag(db, cfg, id, who('860000000000000009'), T0)).status).toBe('ended');
    const st = (await bagState(db, id))!;
    expect(st.bag.endedAt).not.toBeNull();
    const view = bagMessage(st.bag, st.claims, coin, T0);
    expect(view.embeds[0]!.description).toContain('空になりました');
    expect(JSON.stringify(view.components)).toContain('"disabled":true');
  });

  it('締め切り: 残りを置いた人に戻して閉じる（受け取れなくなる）', async () => {
    await addCoins(db, OWNER, 1000, 'adjust');
    const r = await putBag(db, cfg, { ...base, fee: 0, total: 500, count: 5 }, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    await claimBag(db, cfg, r.bag.id, { id: A, roleIds: [ROLE.sanpaisha], voiceChannelId: CH }, T0);
    const open = bagMessage(r.bag, [], coin, T0);
    expect(open.embeds[0]!.description).toContain('残り **5** 袋');
    expect(await expireBags(db, new Date(T0.getTime() + 60_000))).toEqual([]);
    const later = new Date(T0.getTime() + 24 * 3_600_000);
    const closed = await expireBags(db, later);
    expect(closed).toHaveLength(1);
    const got = (await walletOf(db, A)).balance;
    expect(closed[0]!.refunded).toBe(500 - got);
    expect((await walletOf(db, OWNER)).balance).toBe(1000 - got);
    expect((await claimBag(db, cfg, r.bag.id, { id: B, roleIds: [ROLE.sanpaisha], voiceChannelId: CH }, later)).status).toBe('ended');
    const st = (await bagState(db, r.bag.id))!;
    expect(bagMessage(st.bag, st.claims, coin, later).embeds[0]!.description).toContain('期限が来ました');
    // 2 回目は何もしない
    expect(await expireBags(db, new Date(later.getTime() + 60_000))).toEqual([]);
  });
});

describe('🎨 自分だけの色', () => {
  it('色コードを読む', () => {
    expect(parseHexColor('#ff88aa')).toBe(0xff88aa);
    expect(parseHexColor('F8A')).toBe(0xff88aa);
    expect(parseHexColor('＃00ff00')).toBe(0x00ff00);
    expect(parseHexColor('#000000')).toBe(0x010101);
    expect(parseHexColor('red')).toBeUndefined();
  });

  it('買う・もう一度で期間が延びる・ロールを作れなければ戻す（延ばしたときは期間も戻す）', async () => {
    const item = await createItem(db, { kind: 'mycolor', name: '自分だけの色', emoji: '🎨', description: '', price: 5000, durationDays: 30 });
    await addCoins(db, A, 12_000, 'adjust');
    const r = await buyMyColor(db, item, A, 0xff88aa, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.extended).toBe(false);
    expect(r.purchase.expiresAt).toEqual(new Date(T0.getTime() + 30 * 86_400_000));
    await setPurchaseRole(db, r.purchase.id, '980000000000000123');
    expect((await activeMyColor(db, A))?.roleId).toBe('980000000000000123');
    const again = await buyMyColor(db, item, A, 0x00ff00, T0);
    if (again.status !== 'ok') throw new Error(again.status);
    expect(again.extended).toBe(true);
    expect(again.purchase.expiresAt).toEqual(new Date(T0.getTime() + 60 * 86_400_000));
    expect((await walletOf(db, A)).balance).toBe(2000);
    await undoMyColor(db, again, 5000);
    expect((await activeMyColor(db, A))?.expiresAt).toEqual(new Date(T0.getTime() + 30 * 86_400_000));
    expect((await walletOf(db, A)).balance).toBe(7000);
    expect(await buyMyColor(db, item, B, 0x123456, T0)).toMatchObject({ status: 'insufficient', price: 5000 });
    // はじめて買って作れなかった: 記録も終わる
    await undoMyColor(db, r, 5000);
    expect(await activeMyColor(db, A)).toBeUndefined();
    expect((await walletOf(db, A)).balance).toBe(12_000);
  });

  it('参拝者（1段目の役職）は置けず、支払いも発生しない', async () => {
    await addCoins(db, OWNER, 2000, 'adjust');
    const r = await putBag(db, cfg, { ...base, roleIds: [ROLE.sanpaisha], total: 500, count: 5 }, T0);
    expect(r.status).toBe('rank_too_low');
    expect((await walletOf(db, OWNER)).balance).toBe(2000);
  });
});


it('参拝者・未承認では置けず、銭や袋の記録も動かさない。上位の役職は置ける', async () => {
  await addCoins(db, OWNER, 1000, 'adjust');
  for (const roleIds of [[], [ROLE.sanpaisha]]) {
    expect(await putBag(db, cfg, { ...base, roleIds, total: 100, count: 2 }, T0)).toEqual({ status: 'rank_too_low' });
  }
  expect((await walletOf(db, OWNER)).balance).toBe(1000);
  const { otoshidamaBags } = await import('../src/db/schema.js');
  expect(await db.select().from(otoshidamaBags)).toHaveLength(0);
  expect((await putBag(db, cfg, { ...base, roleIds: [ROLE.sewayaku], total: 100, count: 2 }, T0)).status).toBe('ok');
});


describe('お年玉は受取時に通話中だけ', () => {
  it.each([false, true])('運営袋=%s: 通話にいない間は銭も残り袋も変わらず、参加後は受け取れる', async (staff) => {
    await addCoins(db, OWNER, 1000, 'adjust');
    const made = staff
      ? await putStaffBag(db, { by: OWNER, channelId: CH, total: 300, count: 2, note: '' }, T0)
      : await putBag(db, cfg, { ...base, fee: 0, total: 300, count: 2 }, T0);
    if (made.status !== 'ok') throw Error(made.status);
    const who = { id: A, roleIds: [ROLE.sanpaisha], voiceChannelId: null };
    expect((await claimBag(db, cfg, made.bag.id, who, T0)).status).toBe('not_in_voice');
    expect((await walletOf(db, A)).balance).toBe(0);
    expect((await bagState(db, made.bag.id))!.claims).toHaveLength(0);
    const joined = { ...who, voiceChannelId: '910000000000000088' };
    const results = await Promise.all([claimBag(db, cfg, made.bag.id, joined, T0), claimBag(db, cfg, made.bag.id, joined, T0)]);
    expect(results.map(r => r.status).sort()).toEqual(['already', 'ok']);
    expect((await bagState(db, made.bag.id))!.claims).toHaveLength(1);
    expect((await walletOf(db, A)).balance).toBe(made.bag.shares[0]);
    expect(bagMessage(made.bag, [], coin, T0).embeds[0]!.description).toContain('今このサーバーの通話にいる人だけ');
  });

  it('ボタンはサーバーの現在の通話状態を見る。参加・退出が次の操作に反映される', async () => {
    const made = await putStaffBag(db, { by: OWNER, channelId: CH, total: 300, count: 2, note: '' });
    if (made.status !== 'ok') throw Error(made.status);
    const states = new Map<string, {channelId: string}>();
    const app = new OtoshidamaApp(db, () => cfg, {} as DiscordActions);
    const interaction = () => ({
      isButton: () => true, inCachedGuild: () => true, guildId: cfg.guildId,
      customId: `otoshi:claim:${made.bag.id}`, user: {id: A, bot: false},
      member: {roles: {cache: new Map([[ROLE.sanpaisha, {}]])}, voice: {channelId: CH}},
      guild: {voiceStates: {cache: states}}, reply: vi.fn(), update: vi.fn(), followUp: vi.fn(),
    });
    const offline = interaction();
    await app.onInteraction(offline as unknown as Interaction);
    expect(offline.reply).toHaveBeenCalledWith(expect.objectContaining({content: expect.stringContaining('通話に入ってから')}));
    expect((await bagState(db, made.bag.id))!.claims).toHaveLength(0);
    states.set(A, {channelId: CH});
    const online = interaction();
    await app.onInteraction(online as unknown as Interaction);
    expect(online.update).toHaveBeenCalledTimes(1);
    expect(online.followUp).toHaveBeenCalledTimes(1);
    states.delete(A);
    const left = interaction();
    await app.onInteraction(left as unknown as Interaction);
    expect(left.reply).toHaveBeenCalledWith(expect.objectContaining({content: expect.stringContaining('通話に入ってから')}));
    expect((await bagState(db, made.bag.id))!.claims).toHaveLength(1);
  });
});

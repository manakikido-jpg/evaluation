import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { createCustomTicket, customHoldingsOf } from '../src/services/customTickets.js';
import { walletOf } from '../src/services/economy.js';
import { giftAnnouncement, giftItemLabel, giftTargets, giftToAll, parseGiftItem, recentGifts, validGiftCount } from '../src/services/gifts.js';
import { recordJoin, recordLeave } from '../src/services/members.js';
import { ticketsOf } from '../src/services/tickets.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const A = '850000000000000001';
const B = '850000000000000002';
const NEWBIE = '850000000000000003';
const GONE = '850000000000000004';
const BOT = '850000000000000005';
const GUJI = '850000000000000009';
const EVENT_ROLE = '850000000000000099';
const snap = (id: string, roleIds: string[], isBot = false) => ({ id, username: id, displayName: id, avatarUrl: null, roleIds, isBot, joinedAt: null });
const ranks = cfg.ranks.map((r) => r.roleId);
const coin = { name: '銭', emoji: '🪙' };

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await recordJoin(db, snap(A, [ROLE.sanpaisha, EVENT_ROLE]));
  await recordJoin(db, snap(B, [ROLE.ujiko]));
  await recordJoin(db, snap(NEWBIE, []));
  await recordJoin(db, snap(GONE, [ROLE.sanpaisha]));
  await recordLeave(db, GONE);
  await recordJoin(db, snap(BOT, [ROLE.sanpaisha], true));
});
afterEach(async () => {
  await close();
});

describe('🎁 全員にプレゼント', () => {
  it('相手は役職のある今いる人（BOT・退出・未承認は除く）。ロールで絞れる', async () => {
    expect((await giftTargets(db, ranks)).sort()).toEqual([A, B]);
    expect(await giftTargets(db, ranks, EVENT_ROLE)).toEqual([A]);
  });

  it('贈るものを読む（銭・券・自由な券）。数の上限', async () => {
    const t = await createCustomTicket(db, { emoji: '🎤', name: 'リクエスト曲券', note: '' });
    expect(await parseGiftItem(db, 'coins')).toEqual({ kind: 'coins' });
    expect(await parseGiftItem(db, 'fuku')).toEqual({ kind: 'ticket', ticket: 'fuku' });
    expect(await parseGiftItem(db, `custom:${t.id}`)).toEqual({ kind: 'custom', id: t.id, label: '🎤リクエスト曲券' });
    expect(await parseGiftItem(db, 'custom:999')).toBeUndefined();
    expect(await parseGiftItem(db, 'nitro')).toBeUndefined();
    expect(giftItemLabel({ kind: 'ticket', ticket: 'fuku' }, coin)).toBe('🧧福の札');
    expect(giftItemLabel({ kind: 'coins' }, coin)).toBe('🪙銭');
    expect(validGiftCount({ kind: 'coins' }, 3000)).toBe(true);
    expect(validGiftCount({ kind: 'ticket', ticket: 'fuku' }, 101)).toBe(false);
    expect(validGiftCount({ kind: 'ticket', ticket: 'fuku' }, 0)).toBe(false);
  });

  it('券・自由な券・銭を全員に。同じ送信は 1 回だけ', async () => {
    const targets = await giftTargets(db, ranks);
    const base = { note: '1 周年', memberIds: targets, by: GUJI };
    const r = await giftToAll(db, { ...base, item: { kind: 'ticket', ticket: 'fuku' }, label: '🧧福の札', count: 2, nonce: '00000000-0000-0000-0000-000000000001' });
    expect(r).toMatchObject({ status: 'ok', batch: { recipients: 2, item: 'fuku', count: 2 } });
    expect((await ticketsOf(db, A)).fuku).toBe(2);
    expect((await ticketsOf(db, B)).fuku).toBe(2);
    expect((await ticketsOf(db, NEWBIE)).fuku).toBe(0);
    expect(await giftToAll(db, { ...base, item: { kind: 'ticket', ticket: 'fuku' }, label: '🧧福の札', count: 2, nonce: '00000000-0000-0000-0000-000000000001' })).toEqual({
      status: 'duplicate',
    });
    expect((await ticketsOf(db, A)).fuku).toBe(2);

    const t = await createCustomTicket(db, { emoji: '📞', name: '運営と通話券', note: '' });
    await giftToAll(db, { ...base, item: { kind: 'custom', id: t.id, label: '📞運営と通話券' }, label: '📞運営と通話券', count: 1, nonce: '00000000-0000-0000-0000-000000000002' });
    expect(await customHoldingsOf(db, B)).toMatchObject([{ ticket: { id: t.id }, count: 1 }]);

    await giftToAll(db, { ...base, item: { kind: 'coins' }, label: '🪙銭', count: 3000, nonce: '00000000-0000-0000-0000-000000000003' });
    expect(await walletOf(db, A)).toMatchObject({ balance: 3000 });
    expect((await recentGifts(db)).map((g) => g.label)).toEqual(['🪙銭', '📞運営と通話券', '🧧福の札']);

    expect(await giftToAll(db, { ...base, item: { kind: 'coins' }, label: '🪙銭', count: 1, note: ' ', nonce: '00000000-0000-0000-0000-000000000004' })).toEqual({
      status: 'invalid',
    });
  });

  it('お知らせの文面', () => {
    expect(giftAnnouncement('🧧福の札', 1, '1 周年', '枚')).toBe('🎁 **運営からみなさんへプレゼント！**\n🧧福の札 を **1 枚** ずつお渡ししました。\n> 1 周年');
    expect(giftAnnouncement('🪙銭', 3000, '', '枚', 'イベント参加者')).toContain('運営から@イベント参加者 のみなさんへ');
  });

  it('授与品（ロールの品物）: 1 人 1 つ。期間のある品はのばし、期間のない品は持っている人に贈らない。付けるロールを返す', async () => {
    const { createItem, activeRolePurchases } = await import('../src/services/shop.js');
    const { applyGiftRoles } = await import('../src/services/gifts.js');
    const color = await createItem(db, { kind: 'role', name: '色守り（桜）', emoji: '🌸', description: '', price: 1500, roleId: '100000000000000081', roleGroup: 'color', durationDays: 30 });
    const title = await createItem(db, { kind: 'role', name: '称号', emoji: '🏷', description: '', price: 1500, roleId: '100000000000000082' });
    const hana = await createItem(db, { kind: 'hanafubuki', name: '花吹雪', emoji: '🌸', description: '', price: 300 });
    expect(await parseGiftItem(db, `shop:${color.id}`)).toEqual({ kind: 'shop', id: color.id, label: '🌸色守り（桜）' });
    expect(await parseGiftItem(db, `shop:${hana.id}`)).toBeUndefined();
    expect(validGiftCount({ kind: 'shop', id: color.id, label: '' }, 2)).toBe(false);
    const T0 = new Date('2026-09-28T00:00:00Z');
    const targets = await giftTargets(db, ranks);
    const base = { note: '記念', memberIds: targets, by: GUJI, count: 1 };
    const r = await giftToAll(db, { ...base, item: { kind: 'shop', id: color.id, label: '🌸色守り（桜）' }, label: '🌸色守り（桜）', nonce: '00000000-0000-0000-0000-00000000aa01' }, T0);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.batch.item).toBe(`shop:${color.id}`);
    expect(r.roles.map((x) => x.memberId).sort()).toEqual([A, B]);
    expect((await activeRolePurchases(db, A))[0]!.expiresAt).toEqual(new Date(T0.getTime() + 30 * 86_400_000));
    // 2 回目: 期間がのびる
    await giftToAll(db, { ...base, item: { kind: 'shop', id: color.id, label: '' }, label: '', nonce: '00000000-0000-0000-0000-00000000aa02' }, T0);
    expect((await activeRolePurchases(db, A))[0]!.expiresAt).toEqual(new Date(T0.getTime() + 60 * 86_400_000));
    // 期間のない品: 2 回目は贈らない
    const t1 = await giftToAll(db, { ...base, item: { kind: 'shop', id: title.id, label: '' }, label: '', nonce: '00000000-0000-0000-0000-00000000aa03' }, T0);
    const t2 = await giftToAll(db, { ...base, item: { kind: 'shop', id: title.id, label: '' }, label: '', nonce: '00000000-0000-0000-0000-00000000aa04' }, T0);
    expect(t1.status === 'ok' && t1.roles.length).toBe(2);
    expect(t2.status === 'ok' && t2.roles.length).toBe(0);
    // Discord に付ける（失敗した人は数えない）
    const log: string[] = [];
    const discord = {
      addRole: async (_g: string, u: string, role: string) => {
        if (u === B) throw new Error('403');
        log.push(`add ${u} ${role}`);
      },
      removeRole: async (_g: string, u: string, role: string) => void log.push(`remove ${u} ${role}`),
    };
    expect(await applyGiftRoles(discord, cfg.guildId, [{ memberId: A, roleId: 'R1', removeRoleIds: ['R0'] }, { memberId: B, roleId: 'R1', removeRoleIds: [] }])).toBe(1);
    expect(log).toEqual([`remove ${A} R0`, `add ${A} R1`]);
  });
});

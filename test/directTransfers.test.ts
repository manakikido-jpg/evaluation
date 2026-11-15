import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Interaction } from 'discord.js';
import { coinTx, members, wallets } from '../src/db/schema.js';
import { prepareTransfer, confirmTransfer, cancelTransfer, transferQuote, ownedTransfer, TransferError } from '../src/services/directTransfers.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { giftSentToday } from '../src/services/shop.js';
import { setStaffAlt } from '../src/services/staffAlts.js';
import { recordJoin } from '../src/services/members.js';
import { SokinApp, directTransferConfirm } from '../src/discord/sokin.js';
import { cfg, makeDb, ROLE } from './helpers.js';
import type { Db } from '../src/db/client.js';

const A = '700000000000000101', B = '700000000000000102', C = '700000000000000103';
const request = '800000000000000001', second = '800000000000000002';
const from = { id: A, roleIds: [ROLE.sewayaku] }, to = { id: B, roleIds: [ROLE.sanpaisha] };
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const u of [from, to, { ...to, id: C }]) await recordJoin(db, { ...u, username: u.id, displayName: '確認用', avatarUrl: null, isBot: false, joinedAt: new Date() });
  await addCoins(db, A, 10000, 'adjust');
});
afterEach(async () => { vi.restoreAllMocks(); await close(); });
const prepare = (id = request, amount = 1000) => prepareTransfer(db, cfg, { id, from, to, amount, note: 'お礼' });

describe('手数料50％の直接送金', () => {
  it('確認時は銭を動かさず、1000受取/500手数料/1500支払を保存・表示する', async () => {
    const draft = await prepare();
    expect(draft).toMatchObject({ amount: 1000, fee: 500, total: 1500, status: 'pending' });
    expect((await walletOf(db, A)).balance).toBe(10000);
    expect((await walletOf(db, B)).balance).toBe(0);
    const message = directTransferConfirm(cfg.economy, draft);
    expect(message.embeds[0]!.description).toContain('相手の受取額：**1,000 銭**');
    expect(message.embeds[0]!.description).toContain('手数料（50％）：**500 銭**');
    expect(message.embeds[0]!.description).toContain('あなたの支払総額：**1,500 銭**');
    expect(message.allowedMentions.parse).toEqual([]);
    expect(await prepare()).toEqual(draft);
  });

  it('確定は原資/手数料/受取/監査を一緒に記録し、同時連打・再起動後も一度だけ', async () => {
    await prepare();
    const results = await Promise.all([confirmTransfer(db, cfg, request, from, to), confirmTransfer(db, cfg, request, from, to)]);
    expect(results.filter(r => !r.repeated)).toHaveLength(1);
    expect((await walletOf(db, A)).balance).toBe(8500);
    expect((await walletOf(db, B)).balance).toBe(1000);
    expect((await confirmTransfer(db, cfg, request, from, to)).repeated).toBe(true);
    const rows = (await db.select().from(coinTx)).filter(r => r.detail.transferId === request);
    expect(rows.map(r => [r.reason, r.amount]).sort()).toEqual([['gift_fee', -500], ['gift_receive', 1000], ['gift_send', -1000]]);
    const { listAudit } = await import('../src/services/audit.js');
    expect(await listAudit(db, { action: 'transfer.send' })).toHaveLength(1);
    expect(await giftSentToday(db, A)).toBe(1000);
    expect((await ownedTransfer(db, request, A))!.status).toBe('sent');
  });

  it('奇数は切上げ、整数でない額・大きすぎる額は拒否する', () => {
    expect(transferQuote(11)).toEqual({ amount: 11, fee: 6, total: 17 });
    for (const n of [0, -1, NaN, Infinity, 1.5, 1000000001, Number.MAX_SAFE_INTEGER]) expect(() => transferQuote(n)).toThrow(TransferError);
  });

  it('運営の直接送金は手数料・送付額上限の免除を維持する', async () => {
    const staff = { ...from, roleIds: [ROLE.guji] };
    await prepareTransfer(db, cfg, { id: request, from: staff, to, amount: 3000 });
    const r = await confirmTransfer(db, cfg, request, staff, to);
    expect(r.transfer.fee).toBe(0);
    expect(r.balance).toBe(7000);
    expect((await walletOf(db, B)).balance).toBe(3000);
    expect(directTransferConfirm(cfg.economy, r.transfer).embeds[0]!.description).toContain('運営のため免除');
  });

  it('小判と同じく、社務所で指定した運営ロールにも免除を適用する', async () => {
    const role = '100000000000000099';
    const custom = { ...cfg, admin: { ...cfg.admin, gujiRoleIds: [role], shinshokuRoleIds: [] } };
    const operator = { ...from, roleIds: [role] };
    const draft = await prepareTransfer(db, custom, { id: request, from: operator, to, amount: 1000 });
    expect(draft.fee).toBe(0);
    expect((await confirmTransfer(db, custom, request, operator, to)).balance).toBe(9000);
  });

  it('参拝者/氏子の上限を引き継ぎ、手数料は日次の送付額に数えない', async () => {
    const visitor = { ...from, roleIds: [ROLE.sanpaisha] };
    await prepareTransfer(db, cfg, { id: request, from: visitor, to, amount: 125 });
    await confirmTransfer(db, cfg, request, visitor, to);
    expect(await giftSentToday(db, A)).toBe(125);
    await expect(prepareTransfer(db, cfg, { id: second, from: visitor, to, amount: 10 })).rejects.toThrow('あと0銭');
    // 日本時間の前日分へ移すと、今日の上限を使わない。
    await db.update(coinTx).set({ at: new Date(Date.now() - 2 * 86400000) }).where(eq(coinTx.memberId, A));
    expect((await prepareTransfer(db, cfg, { id: second, from: visitor, to, amount: 125 })).status).toBe('pending');
    const ujiko = { ...from, roleIds: [ROLE.ujiko] };
    await expect(prepareTransfer(db, cfg, { id: '800000000000000003', from: ujiko, to, amount: 151 })).rejects.toThrow('あと150銭');
  });

  it('確認を複数開いても、同時確定時の日次上限を超えない', async () => {
    await prepare(request, 600); await prepare(second, 600);
    const results = await Promise.allSettled([confirmTransfer(db, cfg, request, from, to), confirmTransfer(db, cfg, second, from, to)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await giftSentToday(db, A)).toBe(600);
    expect((await walletOf(db, A)).balance).toBe(9100);
    expect((await walletOf(db, B)).balance).toBe(600);
  });

  it('相手・額の差替えや他人の確定/取り消しを拒否する', async () => {
    await prepare();
    await expect(prepareTransfer(db, cfg, { id: request, from, to: { ...to, id: C }, amount: 1000, note: 'お礼' })).rejects.toThrow('確認番号');
    await expect(prepare(request, 500)).rejects.toThrow('確認番号');
    await expect(confirmTransfer(db, cfg, request, { ...from, id: C }, to)).rejects.toThrow('使えません');
    await expect(confirmTransfer(db, cfg, request, from, { ...to, id: C })).rejects.toThrow('使えません');
    await expect(cancelTransfer(db, request, C)).rejects.toThrow('使えません');
    expect((await walletOf(db, A)).balance).toBe(10000);
  });

  it('不足・確認後の不足・期限切れ・取消では銭を動かさない。残高回復後は同じ確認を使える', async () => {
    await db.update(wallets).set({ balance: 1499 }).where(eq(wallets.memberId, A));
    await expect(prepare()).rejects.toThrow('1,500銭必要');
    await addCoins(db, A, 1, 'adjust'); await prepare();
    await db.update(wallets).set({ balance: 1499 }).where(eq(wallets.memberId, A));
    await expect(confirmTransfer(db, cfg, request, from, to)).rejects.toThrow('足りません');
    expect((await walletOf(db, A)).balance).toBe(1499);
    expect((await ownedTransfer(db, request, A))!.status).toBe('pending');
    await addCoins(db, A, 1, 'adjust');
    await confirmTransfer(db, cfg, request, from, to);
    await expect(cancelTransfer(db, request, A)).rejects.toThrow('確定済み');
    await addCoins(db, A, 100, 'adjust');
    const tomorrow = new Date(Date.now() + 86400000);
    await prepareTransfer(db, cfg, { id: second, from: { ...from, roleIds: [ROLE.guji] }, to, amount: 10 });
    await expect(confirmTransfer(db, cfg, second, from, to, tomorrow)).rejects.toThrow('終了');
    await cancelTransfer(db, second, A);
    await expect(confirmTransfer(db, cfg, second, from, to)).rejects.toThrow('終了');
  });

  it('受取人の上限超過・自己・BOT・退出・未承認・サブから/への送付を拒否する', async () => {
    await expect(prepareTransfer(db, cfg, { id: request, from, to: from, amount: 10 })).rejects.toThrow('自分以外');
    for (const target of [{ ...to, bot: true }, { ...to, roleIds: [] }]) await expect(prepareTransfer(db, cfg, { id: request, from, to: target, amount: 10 })).rejects.toThrow('BOTや');
    await expect(prepareTransfer(db, cfg, { id: request, from: { ...from, roleIds: [] }, to, amount: 10 })).rejects.toThrow('以上');
    await db.update(members).set({ leftAt: new Date() }).where(eq(members.id, B));
    await expect(prepare()).rejects.toThrow('在籍中');
    await db.update(members).set({ leftAt: null }).where(eq(members.id, B));
    await setStaffAlt(db, B, true, A);
    await expect(prepare()).rejects.toThrow('サブアカウント');
    await setStaffAlt(db, B, false, A);
    await prepare();
    await setStaffAlt(db, B, true, A);
    await expect(confirmTransfer(db, cfg, request, from, to)).rejects.toThrow('サブアカウント');
    expect((await walletOf(db, A)).balance).toBe(10000);
    await setStaffAlt(db, B, false, A);
    await db.insert(wallets).values({ memberId: B, balance: 2147483600, lifetimeEarned: 2147483600 }).onConflictDoUpdate({ target: wallets.memberId, set: { balance: 2147483600, lifetimeEarned: 2147483600 } });
    await expect(confirmTransfer(db, cfg, request, from, to)).rejects.toThrow('残高が多い');
    await setStaffAlt(db, A, true, C);
    await expect(prepare(second, 10)).rejects.toThrow();
    expect((await walletOf(db, B)).balance).toBe(2147483600);
  });

  it('確認後に免除条件・役職・在籍が変わったら、同意していない額を徴収しない', async () => {
    await prepare();
    await expect(confirmTransfer(db, cfg, request, { ...from, roleIds: [ROLE.guji] }, to)).rejects.toThrow('条件が変わりました');
    await expect(confirmTransfer(db, cfg, request, { ...from, roleIds: [] }, to)).rejects.toThrow('以上');
    await db.update(members).set({ leftAt: new Date() }).where(eq(members.id, B));
    await expect(confirmTransfer(db, cfg, request, from, to)).rejects.toThrow('在籍中');
    expect((await walletOf(db, A)).balance).toBe(10000);
    expect((await walletOf(db, B)).balance).toBe(0);
  });

  it('取消と確定が同時でも、取消か1回の送金のどちらかだけになる', async () => {
    await prepare();
    await Promise.allSettled([cancelTransfer(db, request, A), confirmTransfer(db, cfg, request, from, to)]);
    const state = await ownedTransfer(db, request, A);
    expect(['cancelled', 'sent']).toContain(state!.status);
    const sent = state!.status === 'sent';
    expect((await walletOf(db, A)).balance).toBe(sent ? 8500 : 10000);
    expect((await walletOf(db, B)).balance).toBe(sent ? 1000 : 0);
  });

  it('手数料500銭は既存の経済集計で運営回収、原資1000銭は送付として数える', async () => {
    await prepare(); await confirmTransfer(db, cfg, request, from, to);
    const { economyOverview } = await import('../src/services/economyStats.js');
    const result = await economyOverview(db, '30d', new Date());
    expect(result.incomeLines).toContainEqual(expect.objectContaining({ label: '送金・贈り物の手数料', amount: 500 }));
    expect(result.giftVolume).toBe(1000);
  });

  it('手数料の記録が失敗したら原資も戻り、同じ確認から再実行できる', async () => {
    await prepare();
    await db.execute(sql`CREATE FUNCTION fail_transfer_fee() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason = 'gift_fee' THEN RAISE EXCEPTION 'test fee failure'; END IF; RETURN NEW; END; $$`);
    await db.execute(sql`CREATE TRIGGER fail_transfer_fee BEFORE INSERT ON coin_tx FOR EACH ROW EXECUTE FUNCTION fail_transfer_fee()`);
    await expect(confirmTransfer(db, cfg, request, from, to)).rejects.toThrow();
    expect((await walletOf(db, A)).balance).toBe(10000);
    expect((await walletOf(db, B)).balance).toBe(0);
    expect((await ownedTransfer(db, request, A))!.status).toBe('pending');
    await db.execute(sql`DROP TRIGGER fail_transfer_fee ON coin_tx`);
    await confirmTransfer(db, cfg, request, from, to);
    expect((await walletOf(db, A)).balance).toBe(8500);
  });
});

it('Discordはコマンド→確認→確定。新しいインスタンスでも重複確定・DMの二重送信を防ぐ', async () => {
  const guildMember = (id: string) => ({ id, displayName: '確認用', roles: { cache: new Map((id === A ? from.roleIds : to.roleIds).map(r => [r, {}])) }, user: { bot: false } });
  const guild = { members: { fetch: vi.fn(async ({ user }: { user: string }) => guildMember(user)) } };
  const sendDm = vi.fn(async () => false);
  const handler = () => new SokinApp(db, () => cfg, { sendDm });
  const command = { id: request, inCachedGuild: () => true, guildId: cfg.guildId, isChatInputCommand: () => true, commandName: 'sokin', isRepliable: () => true, guild, user: { id: A },
    options: { getUser: () => ({ id: B }), getInteger: () => 1000, getString: () => 'お礼' }, deferReply: vi.fn(), editReply: vi.fn(), reply: vi.fn() };
  await handler().onInteraction(command as unknown as Interaction);
  expect(command.deferReply).toHaveBeenCalled();
  expect(command.editReply.mock.calls[0]![0].embeds[0].description).toContain('1,500 銭');
  expect((await walletOf(db, A)).balance).toBe(10000);
  const button = (who = A, customId = `sokin:confirm:${request}`) => ({ inCachedGuild: () => true, guildId: cfg.guildId, isChatInputCommand: () => false, isButton: () => true, isRepliable: () => true, customId, guild, user: { id: who }, deferUpdate: vi.fn(), editReply: vi.fn(), reply: vi.fn() });
  const wrong = button(C); await handler().onInteraction(wrong as unknown as Interaction); expect(wrong.reply).toHaveBeenCalled();
  const once = button(); await handler().onInteraction(once as unknown as Interaction);
  expect(once.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('DMは届きませんでした') }));
  const again = button(); await handler().onInteraction(again as unknown as Interaction);
  expect(again.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('追加の支払いはありません') }));
  expect(sendDm).toHaveBeenCalledTimes(1);
  expect((await walletOf(db, A)).balance).toBe(8500);
  const old = button(A, 'sokin:send:old'); await handler().onInteraction(old as unknown as Interaction);
  expect(old.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('方法が変わりました') }));
  expect((await walletOf(db, A)).balance).toBe(8500);
});


it('確定後の返信に失敗しても、完了した結果を案内し直し、二重徴収しない', async () => {
  await prepare();
  const guild = { members: { fetch: async ({ user }: { user: string }) => ({ id: user, displayName: '確認用', user: { bot: false }, roles: { cache: new Map((user === A ? from.roleIds : to.roleIds).map(r => [r, {}])) } }) } };
  const reply = vi.fn().mockRejectedValueOnce(new Error('test response lost')).mockResolvedValue(undefined);
  const button = { inCachedGuild: () => true, guildId: cfg.guildId, isChatInputCommand: () => false, isButton: () => true, isRepliable: () => true, customId: `sokin:confirm:${request}`, guild, user: { id: A }, deferred: true, deferUpdate: vi.fn(), editReply: reply };
  await new SokinApp(db, () => cfg).onInteraction(button as unknown as Interaction);
  expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('送金は確定しています') }));
  expect((await walletOf(db, A)).balance).toBe(8500);
  expect((await walletOf(db, B)).balance).toBe(1000);
  expect((await confirmTransfer(db, cfg, request, from, to)).repeated).toBe(true);
});

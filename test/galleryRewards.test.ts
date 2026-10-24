import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { coinTx, galleryRewards, members } from '../src/db/schema.js';
import { DiscordHttpError, type DiscordActions, type GalleryMessage } from '../src/lib/discordRest.js';
import { cancelGalleryPost, galleryPeriod, invalidateGalleryPosts, loadGalleryPrices, registerGalleryPost, saveGalleryPrices, settleGalleryRewards, type GalleryKind } from '../src/services/galleryRewards.js';
import { walletOf } from '../src/services/economy.js';
import { flowOf } from '../src/services/economyStats.js';
import { GalleryRewardsApp } from '../src/discord/galleryRewards.js';
import { cfg, makeDb } from './helpers.js';
const A = '700000000000000001', B = '700000000000000002', PHOTO = '710000000000000001', VIDEO = '710000000000000002';
const channels = [{ id: PHOTO, name: '📷｜写真館', type: 0, parent_id: null, position: 0 }, { id: VIDEO, name: '🎤｜動画館', type: 0, parent_id: null, position: 1 }];
const sunday = new Date('2026-10-25T23:59:59+09:00'), monday = new Date('2026-10-26T00:00:00+09:00');
let db: Db, close: () => Promise<void>, discord: DiscordActions, messages: Map<string, GalleryMessage>, fail: Set<string>, n: number;
beforeEach(async () => {
  ({ db, close } = await makeDb()); messages = new Map(); fail = new Set(); n = 0;
  await db.insert(members).values([A, B].map(id => ({ id, username: id, displayName: '投稿者' })));
  discord = { galleryMessage: async (_c, id) => {
    if (fail.has(id)) throw new DiscordHttpError('forbidden', 403);
    const m = messages.get(id); if (!m) throw new DiscordHttpError('missing', 404); return structuredClone(m);
  } } as DiscordActions;
});
afterEach(async () => close());
async function register(day: number, kind: GalleryKind = 'full', member = A, time = '12:00:00') {
  const id = String(720000000000000000n + BigInt(++n));
  const channel = kind === 'full' || kind === 'half' ? PHOTO : VIDEO;
  const m: GalleryMessage = { id, channel_id: channel, timestamp: new Date(`2026-10-${day}T${time}+09:00`).toISOString(), author: { id: member }, attachments: [{ id: `attachment-${id}`, content_type: channel === PHOTO ? 'image/png' : 'audio/ogg' }] };
  messages.set(id, m);
  await registerGalleryPost(db, discord, cfg.guildId, channels, `https://discord.com/channels/${cfg.guildId}/${channel}/${id}`, kind, 'staff', sunday);
  return id;
}
const rows = () => db.select().from(galleryRewards);
it('日本時間の月曜開始・金曜終了・日曜終了の境界と年越し', () => {
  expect(galleryPeriod(new Date('2026-10-23T23:59:59.999+09:00'))).toMatchObject({ eligible: true, day: '2026-10-23', week: '2026-10-19', dueAt: monday });
  expect(galleryPeriod(new Date('2026-10-24T00:00:00+09:00')).eligible).toBe(false);
  expect(galleryPeriod(new Date('2026-10-25T23:59:59.999+09:00')).eligible).toBe(false);
  expect(galleryPeriod(monday)).toMatchObject({ eligible: true, week: '2026-10-26' });
  expect(galleryPeriod(new Date('2027-01-01T12:00:00+09:00')).week).toBe('2026-12-28');
});
it('初期4価格、金額だけ保存・通常設定と独立、登録済み価格は固定', async () => {
  expect(await loadGalleryPrices(db)).toEqual({ full: 150, half: 75, song: 150, voice: 150 });
  const first = await register(19);
  await saveGalleryPrices(db, { full: 250, half: 100, song: 300, voice: 200 }, 'staff');
  await register(20);
  expect((await rows()).find(r => r.messageId === first)?.amount).toBe(150);
  expect((await rows()).map(r => r.amount)).toEqual([150, 250]);
  await expect(saveGalleryPrices(db, { full: 150, deadline: 'saturday' }, 'staff')).rejects.toThrow();
  await expect(saveGalleryPrices(db, { full: -1 }, 'staff')).rejects.toThrow();
  await expect(saveGalleryPrices(db, { full: 1.5 }, 'staff')).rejects.toThrow();
  expect(flowOf('gallery_reward')).toBe('issue');
});
it('週末の新規投稿、締切後の登録、別鯖、外部URL、区分偽装・違う場所を拒否', async () => {
  await expect(register(24)).rejects.toThrow('月曜');
  const id = await register(23);
  const link = `https://discord.com/channels/${cfg.guildId}/${PHOTO}/${id}`;
  await expect(registerGalleryPost(db, discord, cfg.guildId, channels, link, 'half', 'staff', monday)).rejects.toThrow('日曜');
  await expect(registerGalleryPost(db, discord, cfg.guildId, channels, link.replace(cfg.guildId, A), 'half', 'staff', sunday)).rejects.toThrow('このサーバー');
  await expect(registerGalleryPost(db, discord, cfg.guildId, channels, 'https://example.com', 'half', 'staff', sunday)).rejects.toThrow();
  await expect(registerGalleryPost(db, discord, cfg.guildId, channels, link, 'song', 'staff', sunday)).rejects.toThrow('写真館');
  await expect(registerGalleryPost(db, discord, cfg.guildId, channels, link, 'bad' as GalleryKind, 'staff', sunday)).rejects.toThrow('区分');
});
it('添付なし・BOT・未来・未在籍の投稿と0銭を登録しない', async () => {
  const id = await register(19); await db.delete(galleryRewards);
  const m = messages.get(id)!;
  const send = () => registerGalleryPost(db, discord, cfg.guildId, channels, `https://discord.com/channels/${cfg.guildId}/${PHOTO}/${id}`, 'full', 'staff', sunday);
  m.attachments = []; await expect(send()).rejects.toThrow('添付');
  m.attachments = [{ id: 'a', content_type: 'image/png' }]; m.author.bot = true; await expect(send()).rejects.toThrow();
  m.author.bot = false; m.timestamp = '2026-10-26T12:00:00+09:00'; await expect(send()).rejects.toThrow();
  m.timestamp = '2026-10-19T12:00:00+09:00';
  await db.update(members).set({ leftAt: sunday }).where(eq(members.id, A)); await expect(send()).rejects.toThrow('在籍');
  await db.update(members).set({ leftAt: null }).where(eq(members.id, A));
  await saveGalleryPrices(db, { full: 0 }, 'staff'); await expect(send()).rejects.toThrow('0銭');
});
it('金曜も日曜の最後も払わず、月曜0時に4区分を払い再実行しても増えない', async () => {
  await register(19, 'full'); await register(20, 'half'); await register(21, 'song', B); await register(22, 'voice', B);
  await settleGalleryRewards(db, discord, new Date('2026-10-23T23:59:59+09:00'));
  await settleGalleryRewards(db, discord, new Date(monday.getTime() - 1));
  expect((await walletOf(db, A)).balance).toBe(0);
  await settleGalleryRewards(db, discord, monday);
  expect((await walletOf(db, A)).balance).toBe(225); expect((await walletOf(db, B)).balance).toBe(300);
  await settleGalleryRewards(db, discord, monday);
  expect((await db.select().from(coinTx))).toHaveLength(4);
});
it('写真・動画を合計して1日1件・週2日まで高額優先。同額は先の投稿', async () => {
  const half = await register(19, 'half'); const full = await register(19, 'full', A, '13:00:00');
  const song = await register(20, 'song'); const voice = await register(21, 'voice');
  await settleGalleryRewards(db, discord, monday);
  const list = await rows();
  expect(list.find(r => r.messageId === half)?.status).toBe('daily_limit');
  expect(list.find(r => r.messageId === full)?.status).toBe('paid');
  expect(list.find(r => r.messageId === song)?.status).toBe('paid');
  expect(list.find(r => r.messageId === voice)?.status).toBe('weekly_limit');
  expect((await walletOf(db, A)).balance).toBe(300);
});
it('消した投稿・確認した添付を外した投稿は除外し、次の有効な日を採用', async () => {
  const gone = await register(19); const changed = await register(20); const ok = await register(21, 'half');
  messages.delete(gone); messages.get(changed)!.attachments = [{ id: 'new', content_type: 'image/png' }];
  await settleGalleryRewards(db, discord, monday);
  expect((await walletOf(db, A)).balance).toBe(75);
  expect((await rows()).filter(r => r.status === 'removed')).toHaveLength(2);
  expect((await rows()).find(r => r.messageId === ok)?.status).toBe('paid');
});
it('土日の削除イベント・添付変更・運営取消は復旧や再登録で払い直さない', async () => {
  const gone = await register(19); const changed = await register(20); const cancelled = await register(21);
  await invalidateGalleryPosts(db, [gone], sunday);
  messages.get(changed)!.attachments = [];
  await new GalleryRewardsApp(db, discord).onUpdate(changed);
  messages.get(changed)!.attachments = [{ id: `attachment-${changed}`, content_type: 'image/png' }];
  await cancelGalleryPost(db, cancelled, 'staff', sunday);
  await settleGalleryRewards(db, discord, monday);
  expect((await walletOf(db, A)).balance).toBe(0);
  const link = `https://discord.com/channels/${cfg.guildId}/${PHOTO}/${gone}`;
  await expect(registerGalleryPost(db, discord, cfg.guildId, channels, link, 'full', 'staff', sunday)).rejects.toThrow('登録済み');
});
it('403は未払いのまま再試行し、別の人は支払う。高額候補が確認できるまで低額だけ先払いしない', async () => {
  const high = await register(19); await register(20, 'half'); await register(21, 'song', B); fail.add(high);
  await settleGalleryRewards(db, discord, monday);
  expect((await walletOf(db, A)).balance).toBe(0); expect((await walletOf(db, B)).balance).toBe(150);
  expect((await rows()).filter(r => r.memberId === A).every(r => r.status === 'pending')).toBe(true);
  fail.clear(); await settleGalleryRewards(db, discord, monday);
  expect((await walletOf(db, A)).balance).toBe(225);
});
it('再起動・並行実行でも二重払いせず、次の週は別枠', async () => {
  await register(19); await register(20, 'song'); await register(21);
  await Promise.all([settleGalleryRewards(db, discord, monday), settleGalleryRewards(db, discord, monday)]);
  expect((await walletOf(db, A)).balance).toBe(300);
  await expect(register(26, 'full')).rejects.toThrow('月曜'); // 次週の時点で登録し直す
  const m = [...messages.values()].at(-1)!;
  await registerGalleryPost(db, discord, cfg.guildId, channels, `https://discord.com/channels/${cfg.guildId}/${PHOTO}/${m.id}`, 'full', 'staff', new Date('2026-11-01T12:00:00+09:00'));
  await settleGalleryRewards(db, discord, new Date('2026-11-02T00:00:00+09:00'));
  expect((await walletOf(db, A)).balance).toBe(450);
});
it('支払いの途中失敗は財布・台帳・投稿状態を全部戻し、再試行できる', async () => {
  await register(19);
  await db.execute(sql`ALTER TABLE coin_tx ADD CONSTRAINT gallery_test_fail CHECK (reason <> 'gallery_reward')`);
  await settleGalleryRewards(db, discord, monday);
  expect((await walletOf(db, A)).balance).toBe(0); expect((await rows())[0]?.status).toBe('pending');
  expect(await db.select().from(coinTx)).toHaveLength(0);
  await db.execute(sql`ALTER TABLE coin_tx DROP CONSTRAINT gallery_test_fail`);
  await settleGalleryRewards(db, discord, monday);
  expect((await walletOf(db, A)).balance).toBe(150);
});
it('支払う前に退会した人は対象外。支払い済みは後日の削除でも再処理しない', async () => {
  const a = await register(19); const b = await register(20, 'half', B);
  await db.update(members).set({ leftAt: sunday }).where(eq(members.id, A));
  await settleGalleryRewards(db, discord, monday);
  await invalidateGalleryPosts(db, [a, b]);
  expect((await rows()).find(r => r.messageId === a)?.status).toBe('removed');
  expect((await rows()).find(r => r.messageId === b)?.status).toBe('paid');
  expect((await walletOf(db, B)).balance).toBe(75);
});

import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cfg, makeDb } from './helpers.js';
import { keibaWinningNotices } from '../src/db/schema.js';
import { winningNoticeTick } from '../src/services/casino/keibaWinningNotice.js';
import { winningTicketSvg, renderWinningTicket } from '../src/services/casino/keibaWinningTicket.js';
import type { KeibaWinningSlip } from '../src/services/casino/tables/types.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import sharp from 'sharp';
let db: Awaited<ReturnType<typeof makeDb>>['db'], close: () => Promise<void>;
const now = new Date('2026-10-15T03:00:00Z');
const slip: KeibaWinningSlip = { raceNo: 8, race: '桜花奉納競走', dist: 2000, surface: '芝', memberId: '760000000000000001', name: 'さくら', bet: 600, payout: 12000, hits: [{ memberId: '760000000000000001', race: '桜花奉納競走', cls: 8, type: 'trifecta', key: '3>1>5', names: '馬', amount: 100, odds: 1200, payout: 12000 }] };
const config = { ...cfg, casino: { ...cfg.casino, keibaWinningChannelId: '900000000000000001', keibaWinningMinPayout: 5000 } };
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });
const add = (data = slip, availableAt = now) => db.insert(keibaWinningNotices).values({ tableId: 1, raceNo: data.raceNo, memberId: data.memberId, channelId: config.casino.keibaWinningChannelId, payload: data, coinName: '銭', availableAt }).onConflictDoNothing();
it('紙のPNGに実際の買い目・個別額・レース合計を表示し、名前をエスケープする', async () => {
  const svg = winningTicketSvg({ ...slip, name: '<script>bad</script>' }, '銭', now);
  expect(svg).not.toContain('<script>'); expect(svg).toContain('&lt;script');
  expect(svg).toContain('12,000'); expect(svg).toContain('11,400'); expect(svg).toContain('購入 100'); expect(svg).toContain('600銭');
  const meta = await sharp(renderWinningTicket(slip, '銭', now)).metadata();
  expect(meta.format).toBe('png'); expect(meta.width).toBe(1200); expect(meta.height).toBe(740); expect(meta.hasAlpha).toBe(true);
});
it('並行実行と同じレースの登録を重ねても1回だけ投稿する', async () => {
  await add(); await add();
  const sendMessage = vi.fn(async () => ({ id: 'm1' }));
  const ctx = { db, cfg: config, discord: { sendMessage } };
  await Promise.all([winningNoticeTick(ctx, now), winningNoticeTick(ctx, now)]); await winningNoticeTick(ctx, now);
  expect(sendMessage).toHaveBeenCalledTimes(1);
  const [row] = await db.select().from(keibaWinningNotices); expect(row!.status).toBe('sent'); expect(row!.messageId).toBe('m1');
  const body = sendMessage.mock.calls[0] as unknown as [string, { content: string; allowed_mentions: unknown; files: { data: Buffer }[] }];
  expect(body[1].allowed_mentions).toEqual({ parse: [] }); expect(body[1].content).toContain('購入 600銭'); expect(body[1].content).toContain('+11,400銭'); expect(body[1].files[0]!.data.length).toBeGreaterThan(1000);
});
it('演出前と通知停止中は送らない', async () => {
  await add(slip, new Date(now.getTime() + 6800)); const sendMessage = vi.fn(async () => ({ id: 'm' }));
  await winningNoticeTick({ db, cfg: config, discord: { sendMessage } }, now); expect(sendMessage).not.toHaveBeenCalled();
  await winningNoticeTick({ db, cfg, discord: { sendMessage } }, new Date(now.getTime() + 7000)); expect(sendMessage).not.toHaveBeenCalled();
});
it('送信失敗を記録し、結果が不明な送信を自動再送しない', async () => {
  await add(); const sendMessage = vi.fn(async () => { throw Error('timeout'); });const ctx = { db, cfg: config, discord: { sendMessage } };
  await winningNoticeTick(ctx, now); await winningNoticeTick(ctx, now); expect(sendMessage).toHaveBeenCalledTimes(1);
  expect((await db.select().from(keibaWinningNotices))[0]!.status).toBe('failed');
});
it('設定上書きと別の設定の保存で通知設定を保持する', () => {
  const overrides = overridesSchema.parse({ casino: { keibaWinningChannelId: config.casino.keibaWinningChannelId, keibaWinningMinPayout: 5000 } });
  const result = applyOverrides(cfg, overrides); expect(result.casino.keibaWinningMinPayout).toBe(5000); expect(result.casino.keibaWinningChannelId).toBe(config.casino.keibaWinningChannelId);
});

it('払戻5000以上の境界と黒字を、はずれ券も含む全体収支で判定する', async () => {
  const { winningSlipsForRace } = await import('../src/services/casino/tables/keiba.js');
  const { makeRace } = await import('../src/services/casino/keiba.js');
  const { race } = makeRace((n) => Math.floor(n / 2), 8, { dist: 2000 });
  const state = { race, seats: [{ id: slip.memberId, name: slip.name, lastActive: 0 }] };
  const hit = slip.hits[0]!;
  const select = (payout: number, lost = 0) => winningSlipsForRace(state, [{ ...hit, payout }, { ...hit, key: '1>2>3', amount: lost, payout: 0 }], config.casino);
  expect(select(4999)).toHaveLength(0); expect(select(5000)).toHaveLength(1);
  expect(select(5000, 4900)).toHaveLength(0); expect(select(5000, 5000)).toHaveLength(0);
  const sum = winningSlipsForRace(state, [{ ...hit, payout: 2500 }, { ...hit, key: '1>2>3', payout: 2500 }], config.casino);
  expect(sum).toHaveLength(1); expect(sum[0]!.payout).toBe(5000); expect(sum[0]!.bet).toBe(200);
  expect(winningSlipsForRace(state, [{ ...hit, payout: 5000 }], cfg.casino)).toHaveLength(0);
  expect(winningSlipsForRace(state, [{ ...hit, memberId: 'bot:1', payout: 5000 }], config.casino)).toHaveLength(0);
});

it('通知待ちは清算トランザクションで保存され、失敗した清算では残らない', async () => {
  const { createTable, onTable } = await import('../src/services/casino/tables/service.js');
  const made = await createTable(db, config, 'keiba', { id: slip.memberId, name: slip.name }, {}, now, (n) => Math.floor(n / 2));
  expect(made.status).toBe('ok'); if (!('table' in made) || !made.table) throw Error('table missing'); const id = made.table.id;
  await expect(onTable(db, config, id, (_engine, state) => ({ ok: true, state: structuredClone(state), fx: { keibaWinningSlips: [slip], records: [{ memberId: slip.memberId, game: 'keiba', bet: null as unknown as number, payout: 1 }] } }), now)).rejects.toThrow();
  expect(await db.select().from(keibaWinningNotices)).toHaveLength(0);
  await onTable(db, config, id, (_engine, state) => ({ ok: true, state: structuredClone(state), fx: { keibaWinningSlips: [slip] } }), now);
  await onTable(db, config, id, (_engine, state) => ({ ok: true, state: structuredClone(state), fx: { keibaWinningSlips: [slip] } }), now);
  const rows = await db.select().from(keibaWinningNotices); expect(rows).toHaveLength(1);
  expect(rows[0]!.availableAt.getTime()).toBe(now.getTime() + 6800);
});

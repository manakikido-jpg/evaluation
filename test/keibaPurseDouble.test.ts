import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import type { GuildConfig } from '../src/config.js';
import { members, settings } from '../src/db/schema.js';
import { newStable, seeded } from '../src/services/casino/keiba.js';
import { keiba, type KbState } from '../src/services/casino/tables/keiba.js';
import { payCredit } from '../src/services/casino/tables/service.js';
import type { Ctx, Credit } from '../src/services/casino/tables/types.js';
import { applyOverrides, loadOverrides } from '../src/services/settings.js';
import { walletOf } from '../src/services/economy.js';
import { keibaPurseGuide } from '../src/web/views/keibaPurseGuide.js';
import { cfg, makeDb } from './helpers.js';

const A = { id: '760000000000000801', name: '馬主' };
const B = { id: '760000000000000802', name: '共同所有者' };
const policy = { keibaBetPurseMult: 2, keibaPurseMinBet: 1, keibaPurseOthersMin: 0, keibaBetDailyCap: 1000, keibaEntryFee: 50 };

/** 結果精算の検証。抽選後に所有者を割り当て、1着・複数頭の受取を比較する。 */
function settle(bet: number, options: { allOwned?: boolean; shares?: boolean; cls?: number; bigKey?: string; config?: GuildConfig } = {}) {
  const config = options.config ?? cfg;
  const roster = Array.from({ length: 8 }, (_, i) => ({ ...newStable(seeded(i + 1)), id: i + 1, name: `H${i + 1}`, starts: 0, wins: 0, ownerId: null }));
  let n = 7;
  const ctx = (now: number): Ctx => ({ now, cfg: config, roster, rng: k => (n = (n * 1103515245 + 12345) % 2147483648) % k });
  const now = Date.parse('2026-10-30T03:00:00Z');
  const created = keiba.create(A, { cls: '0' }, ctx(now));
  if (!created.ok) throw new Error(created.error);
  let s: KbState = created.state;
  if (bet) {
    const bought = keiba.act(s, A.id, { action: 'bet', type: 'win', a: '1', bet: String(bet) }, ctx(now));
    if (!bought.ok) throw new Error(bought.error);
    s = bought.state;
  }
  const started = keiba.act(s, A.id, { action: 'start' }, ctx(now));
  if (!started.ok) throw new Error(started.error);
  s = started.state;
  s.race.cls = options.cls ?? 0;
  if (options.bigKey) s.big = { key: options.bigKey };
  for (const h of s.horses) {
    h.ownerId = options.allOwned || h.no === s.run!.order[0] ? A.id : null;
    if (h.ownerId && options.shares) h.shares = [{ memberId: A.id, units: 6 }, { memberId: B.id, units: 4 }];
  }
  const result = keiba.tick(s, ctx(s.deadline));
  if (!result?.ok) throw new Error('no finish');
  return { state: result.state, credits: (result.fx?.credits ?? []).filter(x => x.reason === 'keiba_prize') };
}

describe('本人の賭けだけで、保証の上乗せを2倍までにする', () => {
  it.each([[10, 20, 0], [100, 201, 151], [300, 300, 250], [500, 300, 251]])('新馬・本人の賭け%s：賞金目安%s・出走料後%s（馬券払戻は別）', (bet, prize, paid) => {
    expect(cfg.casino).toMatchObject(policy);
    const r = settle(bet);
    expect(r.state.prizes![0]).toBe(prize);
    expect(r.credits.reduce((sum, c) => sum + c.amount, 0)).toBe(paid);
    expect(r.credits.every(c => !c.cap || c.cap === 'keiba_purse_bet')).toBe(true);
  });

  it.each([100, 300, 500])('G1・%sの賭けはクラス保証額に届かなくても上乗せ2倍で止まる', bet => {
    const r = settle(bet, { cls: 8 });
    const base = Math.floor(Math.floor(bet * 8 / 100 * 50 / 100) * 150 / 100);
    expect(r.state.prizes![0]).toBe(base + bet * 2);
    expect(r.credits.reduce((sum, c) => sum + c.amount, 0)).toBeLessThanOrEqual(base + bet * 2);
  });

  it('同じ馬主の複数頭で保証予算を共有し、1頭ごとに2倍を足さない', () => {
    const r = settle(100, { allOwned: true });
    expect(r.state.prizes!.slice(0, 5)).toEqual([201, 0, 0, 0, 0]);
    expect(r.credits.reduce((sum, c) => sum + c.amount, 0)).toBe(151);
  });

  it('賭けなしは少額保証50のまま。出走料を超えて財布から引かない', () => {
    const r = settle(0);
    expect(r.state.prizes![0]).toBe(50);
    expect(r.credits).toEqual([]);
  });

  it('定時大レースは従来の例外、イベント大会は通常の上限と出走料', () => {
    const normal = settle(100, { cls: 8 });
    expect(settle(100, { cls: 8, bigKey: 'event:12' }).credits).toEqual(normal.credits);
    const big = settle(0, { cls: 8, bigKey: 'scheduled' });
    expect(big.state.prizes![0]).toBe(5000);
    expect(big.credits).toEqual([{ memberId: A.id, amount: 5000, reason: 'keiba_prize' }]);
  });

  it('案内は設定に追従し、必ず倍額をもらえると誤解させない', () => {
    const text = keibaPurseGuide(cfg.casino);
    expect(text).toContain('ほかの人の賭けは不要');
    expect(text).toContain('必ず2倍もらえる意味ではありません');
    expect(text).toContain('1日1,000まで（日本時間0時区切り）');
    const custom = keibaPurseGuide({ ...cfg.casino, keibaPurseMinBet: 500, keibaPurseOthersMin: 100, keibaBetPurseMult: 3, keibaBetDailyCap: 0 });
    expect(custom).toContain('500以上');
    expect(custom).toContain('ほかの人の賭け合計も100以上');
    expect(custom).toContain('3倍');
    expect(custom).toContain('日額上限はありません');
  });
});

describe('保存設定の移行と実際の入金', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });
  const migration = readFileSync(new URL('../drizzle/0148_keiba_purse_double.sql', import.meta.url), 'utf8');

  it.each([undefined, {}, { casino: { keibaBetPurseMult: 10, keibaPurseMinBet: 500, keibaPurseOthersMin: 500, keibaBetDailyCap: 3000, keibaEntryFee: 70, keibaFanPct: 7 }, extra: { keep: true } }])('保存済みの対象5項目だけ更新し、ほかの設定を残す：%j', async original => {
    const made = await makeDb(); close = made.close;
    const db = made.db;
    await db.delete(settings).where(eq(settings.key, 'overrides'));
    if (original) await db.insert(settings).values({ key: 'overrides', value: original, updatedBy: A.id });
    await db.execute(sql.raw(migration));
    const [saved] = await db.select().from(settings).where(eq(settings.key, 'overrides'));
    expect(saved!.value).toEqual({ ...original, casino: { ...original?.casino, ...policy } });
    const oldConfig = { ...cfg, casino: { ...cfg.casino, keibaBetPurseMult: 10, keibaPurseOthersMin: 500 } };
    const effective = applyOverrides(oldConfig, await loadOverrides(db));
    expect(effective.casino).toMatchObject(policy);
    // 保存後も既定値で戻さず、社務所で倍率を変更できる。
    const updated = { ...saved!.value as object, casino: { ...effective.casino, keibaBetPurseMult: 3 } };
    await db.update(settings).set({ value: updated }).where(eq(settings.key, 'overrides'));
    expect(applyOverrides(cfg, await loadOverrides(db)).casino.keibaBetPurseMult).toBe(3);
  });

  it('持分分配後の受取人ごとに日額1000。少額保証とは別枠で、日本時間0時に戻る', async () => {
    const made = await makeDb(); close = made.close;
    const db = made.db;
    await db.insert(members).values([A, B].map(m => ({ id: m.id, username: m.name, displayName: m.name })));
    const before = new Date('2026-10-30T14:59:59Z');
    const pay = (c: Credit, at = before) => payCredit(db, cfg, c, at, 'keiba', 1);
    const credit: Credit = { memberId: A.id, amount: 990, reason: 'keiba_prize', cap: 'keiba_purse_bet' };
    expect(await pay(credit)).toBe(990);
    const shared = settle(100, { shares: true });
    expect(shared.credits).toEqual([
      { ...credit, amount: 91 }, { ...credit, memberId: B.id, amount: 60 },
    ]);
    expect(await pay(shared.credits[0]!)).toBe(10);
    expect(await pay(shared.credits[1]!)).toBe(60);
    expect(await pay(shared.credits[0]!)).toBe(0);
    expect(await pay({ ...credit, cap: 'keiba_purse', amount: 50 })).toBe(50);
    expect((await walletOf(db, A.id)).balance).toBe(1050);
    expect(await pay({ ...credit, amount: 1000 }, new Date('2026-10-30T15:00:00Z'))).toBe(1000);
  });
});

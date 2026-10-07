import { randomInt } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { casinoStyles, casinoStyleDraws } from '../../db/schema.js';
import { audit } from '../audit.js';
import { spendWithin } from '../economy.js';
import { addTickets } from '../tickets.js';

export type StyleSlot = 'background' | 'table' | 'ornament' | 'chips' | 'cards' | 'effect' | 'sound' | 'title';
export const STYLE_SLOTS: Record<StyleSlot, string> = {
  background: '背景',
  table: '卓のふち',
  ornament: '席の飾り',
  chips: 'チップ',
  cards: 'カードの裏',
  effect: '勝ったときの動き',
  sound: '勝ったときの音',
  title: '称号',
};
export type StyleItem = { key: string; name: string; emoji: string; slot?: StyleSlot; note: string };
export const STYLE_ITEMS: StyleItem[] = [
  { key: 'yozakura', name: '夜桜の間', emoji: '🌸', slot: 'background', note: '夜桜と灯りに包まれる背景' },
  { key: 'stars', name: '星降る遊技場', emoji: '🌌', slot: 'background', note: '星がまたたく夜の背景' },
  { key: 'gold', name: '黄金の社', emoji: '🏯', slot: 'background', note: '金色の屏風を思わせる背景' },
  { key: 'foxroom', name: '白狐の隠れ家', emoji: '🦊', slot: 'background', note: '白狐と青い灯りの背景' },
  { key: 'festival', name: '縁日の夜', emoji: '🏮', slot: 'background', note: '提灯と花火の背景' },
  { key: 'sakura', name: '桜吹雪の卓', emoji: '🌸', slot: 'table', note: '自分の席を桜のふちで飾る' },
  { key: 'dragon', name: '龍の卓飾り', emoji: '🐉', slot: 'table', note: '自分の席を龍のふちで飾る' },
  { key: 'fox', name: '白狐の置物', emoji: '🦊', slot: 'ornament', note: '自分の席に小さな白狐' },
  { key: 'fan', name: '勝負扇', emoji: '🪭', slot: 'ornament', note: '自分の名前といっしょに飾る扇' },
  { key: 'gem', name: '宝石チップ', emoji: '💎', slot: 'chips', note: '自分の画面のチップを宝石色に' },
  { key: 'hanafuda', name: '花札の裏模様', emoji: '🎴', slot: 'cards', note: '自分の画面の伏せたカードを花模様に' },
  { key: 'petals', name: '祝いの桜吹雪', emoji: '🌸', slot: 'effect', note: '勝ったときに自分の画面に桜吹雪' },
  { key: 'bell', name: '勝利の鈴音', emoji: '🔔', slot: 'sound', note: '勝ったときに鈴の音（音を消すと鳴りません）' },
  { key: 'lifetime', name: '一世一代', emoji: '🎇', slot: 'title', note: '名前に添えるカジノの称号' },
  { key: 'gambler', name: '勝負師', emoji: '🎲', slot: 'title', note: '名前に添えるカジノの称号' },
  { key: 'lucky', name: '幸運の持ち主', emoji: '🍀', slot: 'title', note: '名前に添えるカジノの称号' },
  { key: 'trial', name: '見た目のお試し券', emoji: '🎟', note: '未所持の背景か卓のふちを1つ、24時間お試し' },
  { key: 'boost', name: '大勝負の札', emoji: '🎰', note: '持ち物から使うと、その日だけ賭けの上限が上がる' },
];
export const styleItem = (key: string) => STYLE_ITEMS.find((i) => i.key === key);
export type StyleState = typeof casinoStyles.$inferSelect;
const blank = (memberId: string): StyleState => ({ memberId, owned: [], equipped: {}, trialKey: null, trialUntil: null, tickets: 0, pity: 0 });
export async function stylesOf(db: Db, memberId: string): Promise<StyleState> {
  const [s] = await db.select().from(casinoStyles).where(eq(casinoStyles.memberId, memberId));
  return s ?? blank(memberId);
}
export function activeStyles(s: StyleState, now: Date): Partial<Record<StyleSlot, string>> {
  const result: Partial<Record<StyleSlot, string>> = {};
  for (const key of Object.values(s.equipped)) {
    const i = styleItem(key);
    if (i?.slot && s.owned.includes(key)) result[i.slot] = key;
  }
  const trial = styleItem(s.trialKey ?? '');
  if (trial?.slot && s.trialUntil && s.trialUntil > now) result[trial.slot] = trial.key;
  return result;
}
export async function tableStyles(db: Db, state: unknown, now: Date) {
  const seats = (state as { seats?: ({ id: string } | null)[] }).seats ?? [];
  const ids = seats.filter((s): s is { id: string } => !!s && typeof s.id === 'string').map((s) => s.id);
  if (!ids.length) return {};
  const rows = await db.select().from(casinoStyles).where(inArray(casinoStyles.memberId, ids));
  return Object.fromEntries(rows.map((s) => [s.memberId, activeStyles(s, now)]));
}
async function lock(tx: Db, memberId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`casino_style:${memberId}`}))`);
  await tx.insert(casinoStyles).values({ memberId }).onConflictDoNothing();
  return stylesOf(tx, memberId);
}
export async function equipStyle(db: Db, memberId: string, slot: string, key: string, trial: boolean, now = new Date()) {
  return db.transaction(async (tx) => {
    const s = await lock(tx, memberId);
    if (!Object.hasOwn(STYLE_SLOTS, slot)) return 'invalid' as const;
    const i = styleItem(key);
    if (key && i?.slot !== slot) return 'invalid' as const;
    if (trial) {
      if (!i || !['background', 'table'].includes(slot) || s.owned.includes(key)) return 'invalid' as const;
      if (s.trialUntil && s.trialUntil > now) return 'active' as const;
      if (s.tickets < 1) return 'no_ticket' as const;
      await tx
        .update(casinoStyles)
        .set({ tickets: s.tickets - 1, trialKey: key, trialUntil: new Date(now.getTime() + 86400000) })
        .where(eq(casinoStyles.memberId, memberId));
    } else {
      if (key && !s.owned.includes(key)) return 'not_owned' as const;
      const equipped = { ...s.equipped };
      if (key) equipped[slot] = key;
      else delete equipped[slot];
      const currentTrial = styleItem(s.trialKey ?? '');
      await tx
        .update(casinoStyles)
        .set({ equipped, ...(currentTrial?.slot === slot ? { trialKey: null, trialUntil: null } : {}) })
        .where(eq(casinoStyles.memberId, memberId));
    }
    await audit(tx, { actorId: memberId, action: trial ? 'casino_style_trial' : 'casino_style_equip', detail: { slot, key }, via: 'web' });
    return 'ok' as const;
  });
}
/** 未所持の見た目の品の中で均等。全部そろうと、その分はお試し券に */
export function styleChances(g: GuildConfig['casinoGacha'], owned: string[]) {
  const available = STYLE_ITEMS.filter((i) => i.slot && !owned.includes(i.key));
  return STYLE_ITEMS.map((i) => ({
    ...i,
    chance: i.slot
      ? available.some((x) => x.key === i.key)
        ? g.cosmeticPercent / available.length
        : 0
      : i.key === 'boost'
        ? g.boostPercent
        : 100 - g.boostPercent - (available.length ? g.cosmeticPercent : 0),
  }));
}
export type StyleDrawResult = { status: 'ok'; results: string[]; cost: number; replay: boolean } | { status: 'off' | 'invalid' | 'funds' };
export async function drawStyles(
  db: Db,
  g: GuildConfig['casinoGacha'],
  memberId: string,
  requestId: string,
  times: number,
  via: 'web' | 'discord',
  rng = () => randomInt(1000000) / 1000000,
): Promise<StyleDrawResult> {
  if (!requestId || requestId.length > 100 || ![1, 10].includes(times)) return { status: 'invalid' };
  return db.transaction(async (tx) => {
    const s = await lock(tx, memberId);
    const [receipt] = await tx
      .select()
      .from(casinoStyleDraws)
      .where(and(eq(casinoStyleDraws.memberId, memberId), eq(casinoStyleDraws.requestId, requestId)));
    if (receipt) return { status: 'ok', results: receipt.results, cost: receipt.cost, replay: true };
    if (!g.enabled) return { status: 'off' };
    const cost = times * g.price;
    if (!(await spendWithin(tx, memberId, cost, 'casino_gacha', { requestId, times }))) return { status: 'funds' };
    const results: string[] = [];
    const owned = [...s.owned];
    let pity = s.pity,
      tickets = s.tickets;
    for (let n = 0; n < times; n++) {
      const available = STYLE_ITEMS.filter((i) => i.slot && !owned.includes(i.key));
      const r = rng();
      if (!Number.isFinite(r) || r < 0 || r >= 1) throw new Error('bad random value');
      let key: string;
      if (available.length && pity + 1 >= g.pity) key = available[Math.floor(r * available.length)]!.key;
      else {
        const chances = styleChances(g, owned);
        let point = r * 100;
        key = 'trial';
        for (const i of chances) {
          point -= i.chance;
          if (point < 0) {
            key = i.key;
            break;
          }
        }
      }
      if (styleItem(key)?.slot) {
        owned.push(key);
        pity = 0;
      } else {
        pity = available.length ? pity + 1 : 0;
        if (key === 'trial') tickets++;
        else await addTickets(tx, memberId, 'casino_boost', 1);
      }
      results.push(key);
    }
    await tx.update(casinoStyles).set({ owned, pity, tickets }).where(eq(casinoStyles.memberId, memberId));
    await tx.insert(casinoStyleDraws).values({ memberId, requestId, results, cost });
    await audit(tx, { actorId: memberId, action: 'casino_gacha_draw', detail: { results, cost, requestId }, via });
    return { status: 'ok', results, cost, replay: false };
  });
}

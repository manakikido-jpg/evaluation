import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { aiMatches, casinoGames } from '../../db/schema.js';
import { OTHELLO_LEVELS, type OthelloLevel } from './othello.js';
import { DAIFUGO_RULES, type DaifugoRule } from './tables/daifugo.js';

/**
 * 🤖 AI（BOT・CPU）と人の勝負のまとめ（社務所Web のカジノのページ）。AI が強すぎ・弱すぎを見て、直すときに使う。
 * 順位は「0 = 1 位・1 = 最下位」にそろえて（人数がちがっても比べられるように）、人と AI の平均をくらべる
 */

export const AI_GAME_LABEL: Record<string, string> = { daifugo: '👑 大富豪', babanuki: '🃏 ババ抜き', poker: '♠ ポーカー（1 手ごと）', mahjong: '🀄 麻雀' };

/** 判定（人と AI の順位の差がこれより大きければ「強すぎ・弱すぎ」） */
export const AI_GAP = 0.12;
/** これより少ない人の席数では判定しない */
export const AI_MIN_SEATS = 20;

export type AiVerdict = 'strong' | 'weak' | 'fair' | 'few';

export type AiRow = {
  game: string;
  variant: string;
  aiVersion: string;
  matches: number;
  humanSeats: number;
  botSeats: number;
  /** 人が 1 位（ポーカーは勝った手）になった割合（%） */
  humanTop: number;
  /** AI が 1 位になった割合（%） */
  botTop: number;
  /** 順位（0 = 1 位・1 = 最下位）の平均。0.5 より小さいほど上 */
  humanPlace: number;
  botPlace: number;
  /** 人の増減（合計・1 席あたり） */
  humanNet: number;
  humanNetPer: number;
  /** 途中で抜けた人の席 */
  humanLeft: number;
  verdict: AiVerdict;
};

export type AiPlayer = { id: string; name: string; matches: number; place: number; top: number; net: number };

export type OthelloRow = { level: OthelloLevel; games: number; win: number; draw: number; lose: number; resign: number; humanNet: number; mult: number; verdict: AiVerdict };

export type AiStats = { rows: AiRow[]; totals: AiRow[]; players: AiPlayer[]; othello: OthelloRow[] };

/** 大富豪のルールの組み合わせを短く（「⚡ 革命・✂ 8 切り…」） */
export function variantLabel(game: string, variant: string): string {
  if (!variant) return 'すべて';
  if (game === 'daifugo') {
    return variant
      .split(',')
      .filter(Boolean)
      .map((k) => DAIFUGO_RULES[k as DaifugoRule]?.label ?? k)
      .join('・');
  }
  return variant;
}

const norm = (place: number, players: number) => (players > 1 ? (place - 1) / (players - 1) : 0);

export function verdictOf(humanPlace: number, botPlace: number, humanSeats: number): AiVerdict {
  if (humanSeats < AI_MIN_SEATS) return 'few';
  const gap = humanPlace - botPlace;
  return gap > AI_GAP ? 'strong' : gap < -AI_GAP ? 'weak' : 'fair';
}

type Acc = { matches: number; hs: number; bs: number; ht: number; bt: number; hp: number; bp: number; hn: number; hl: number };
const acc = (): Acc => ({ matches: 0, hs: 0, bs: 0, ht: 0, bt: 0, hp: 0, bp: 0, hn: 0, hl: 0 });
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

function rowOf(game: string, variant: string, aiVersion: string, a: Acc): AiRow {
  const humanPlace = a.hs ? a.hp / a.hs : 0;
  const botPlace = a.bs ? a.bp / a.bs : 0;
  return {
    game,
    variant,
    aiVersion,
    matches: a.matches,
    humanSeats: a.hs,
    botSeats: a.bs,
    humanTop: a.hs ? round((a.ht / a.hs) * 100) : 0,
    botTop: a.bs ? round((a.bt / a.bs) * 100) : 0,
    humanPlace: round(humanPlace, 3),
    botPlace: round(botPlace, 3),
    humanNet: a.hn,
    humanNetPer: a.hs ? Math.round(a.hn / a.hs) : 0,
    humanLeft: a.hl,
    verdict: verdictOf(humanPlace, botPlace, a.hs),
  };
}

export async function aiStats(db: Db, since: Date): Promise<AiStats> {
  const rows = await db.select().from(aiMatches).where(gte(aiMatches.at, since));
  const groups = new Map<string, { game: string; variant: string; aiVersion: string; a: Acc }>();
  const totals = new Map<string, Acc>();
  const players = new Map<string, { name: string; matches: number; place: number; top: number; net: number }>();
  for (const r of rows) {
    const key = `${r.game}\u0000${r.variant}\u0000${r.aiVersion}`;
    const g = groups.get(key) ?? { game: r.game, variant: r.variant, aiVersion: r.aiVersion, a: acc() };
    groups.set(key, g);
    const t = totals.get(r.game) ?? acc();
    totals.set(r.game, t);
    const n = r.seats.length;
    for (const a of [g.a, t]) {
      a.matches++;
      for (const x of r.seats) {
        const p = norm(x.place, r.game === 'poker' ? 2 : n);
        if (x.bot) {
          a.bs++;
          a.bp += p;
          if (x.place === 1) a.bt++;
        } else {
          a.hs++;
          a.hp += p;
          a.hn += x.net;
          if (x.place === 1) a.ht++;
          if (x.left) a.hl++;
        }
      }
    }
    for (const x of r.seats) {
      if (x.bot) continue;
      const pl = players.get(x.id) ?? { name: x.name, matches: 0, place: 0, top: 0, net: 0 };
      pl.name = x.name;
      pl.matches++;
      pl.place += norm(x.place, r.game === 'poker' ? 2 : n);
      if (x.place === 1) pl.top++;
      pl.net += x.net;
      players.set(x.id, pl);
    }
  }
  const order = Object.keys(AI_GAME_LABEL);
  const byGame = (a: { game: string }, b: { game: string }) => order.indexOf(a.game) - order.indexOf(b.game);
  return {
    rows: [...groups.values()].map((g) => rowOf(g.game, g.variant, g.aiVersion, g.a)).sort((a, b) => byGame(a, b) || b.matches - a.matches),
    totals: [...totals].map(([game, a]) => rowOf(game, '', '', a)).sort(byGame),
    players: [...players]
      .map(([id, p]) => ({ id, name: p.name, matches: p.matches, place: round(p.place / p.matches, 3), top: round((p.top / p.matches) * 100), net: p.net }))
      .sort((a, b) => b.matches - a.matches)
      .slice(0, 15),
    othello: await othelloStats(db, since),
  };
}

/** ⚫ オセロ（CPU）: 強さごとの勝ち負け。損得なしの勝率は 1 / 倍率 */
async function othelloStats(db: Db, since: Date): Promise<OthelloRow[]> {
  const rows = await db
    .select({ bet: casinoGames.bet, payout: casinoGames.payout, state: casinoGames.state })
    .from(casinoGames)
    .where(and(eq(casinoGames.game, 'othello'), eq(casinoGames.status, 'done'), gte(casinoGames.createdAt, since)));
  const by = new Map<OthelloLevel, OthelloRow>();
  for (const r of rows) {
    const st = r.state as { level?: OthelloLevel; result?: 'win' | 'lose' | 'draw' | 'resign' };
    const level = st.level && Object.hasOwn(OTHELLO_LEVELS, st.level) ? st.level : 'easy';
    const o = by.get(level) ?? { level, games: 0, win: 0, draw: 0, lose: 0, resign: 0, humanNet: 0, mult: OTHELLO_LEVELS[level].mult, verdict: 'few' as AiVerdict };
    o.games++;
    if (st.result) o[st.result]++;
    o.humanNet += r.payout - r.bet;
    by.set(level, o);
  }
  return (Object.keys(OTHELLO_LEVELS) as OthelloLevel[]).flatMap((level) => {
    const o = by.get(level);
    if (!o) return [];
    // 人の勝率が損得なしの勝率よりはっきり低ければ CPU が強め（引き分けは半分の勝ち）
    const rate = (o.win + o.draw / 2) / o.games;
    const even = 1 / o.mult;
    o.verdict = o.games < AI_MIN_SEATS ? 'few' : rate < even - 0.1 ? 'strong' : rate > even + 0.1 ? 'weak' : 'fair';
    return [o];
  });
}

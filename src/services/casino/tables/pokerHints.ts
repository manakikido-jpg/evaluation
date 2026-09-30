import { suitOf } from '../cards.js';
import { bestHand, categoryOf } from './pokerHands.js';

/**
 * ポーカーの「今の役」と、はじめての人向けのヒント（自分の手札と場のカードだけから。相手の手札は見ない）。
 * - 今の役: 場が 3 枚以上なら一番よい 5 枚の役。配られたばかりなら手札 2 枚の強さ
 * - 引き: フラッシュ・ストレートまであと 1 枚か（アウツの数と、当たるおおよその確率＝2 と 4 の法則）
 * - コールに見合うか: 当たる確率と、ポットに対してコールに必要な割合をくらべる
 */

export type Tone = 'go' | 'ok' | 'care' | 'fold';
export type PokerAdvice = {
  /** 役の名前（ワンペア など）と、くわしく（K のワンペア など） */
  name: string;
  detail: string;
  /** 役の強さの段（0 = ハイカード … 8 = ストレートフラッシュ）。配られたばかりなら null */
  category: number | null;
  /** 役になっているカード（光らせる。ペアならその 2 枚） */
  cards: number[];
  /** 場のカードだけでできている（みんな同じ） */
  boardOnly: boolean;
  draws: string[];
  outs: number;
  /** 次で当たるおおよその確率（%） */
  equity: number | null;
  /** コールに必要な確率（%）。コールがいらなければ null */
  potOdds: number | null;
  advice: string;
  tone: Tone;
};

const value = (c: number) => {
  const r = (c % 13) + 1;
  return r === 1 ? 14 : r;
};
export const valueText = (v: number) => ({ 14: 'A', 13: 'K', 12: 'Q', 11: 'J' })[v as 14] ?? String(v);
const SUIT_NAME = ['♠', '♥', '♦', '♣'];

/** 配られた 2 枚の強さ */
export function startingHand(hole: number[]): { label: string; tier: 'strong' | 'good' | 'play' | 'weak' } {
  const [a, b] = [value(hole[0]!), value(hole[1]!)].sort((x, y) => y - x) as [number, number];
  const suited = suitOf(hole[0]!) === suitOf(hole[1]!);
  const name = `${valueText(a)} と ${valueText(b)}${suited ? '・同じマーク' : ''}`;
  if (a === b) {
    const tier = a >= 11 ? 'strong' : a >= 7 ? 'good' : 'play';
    return { label: `${valueText(a)} のペア`, tier };
  }
  if (a === 14 && b >= 12) return { label: name, tier: 'strong' };
  if ((a === 14 && b >= 10) || (a === 13 && b >= 11 && suited)) return { label: name, tier: 'good' };
  if (a >= 10 && b >= 10) return { label: name, tier: 'play' };
  if (a === 14 && (suited || b >= 7)) return { label: name, tier: 'play' };
  if (suited && a - b <= 2 && b >= 4) return { label: name, tier: 'play' };
  return { label: name, tier: 'weak' };
}

/** ストレートまであと 1 枚で当たる数字（ない数字のうち、足すと 5 つ並ぶもの） */
function straightOuts(values: number[]): number[] {
  const have = new Set(values.flatMap((v) => (v === 14 ? [14, 1] : [v])));
  const done = (set: Set<number>) => {
    for (let top = 5; top <= 14; top++) if ([0, 1, 2, 3, 4].every((k) => set.has(top - k))) return true;
    return false;
  };
  if (done(have)) return [];
  const outs: number[] = [];
  for (let v = 2; v <= 14; v++) {
    if (have.has(v)) continue;
    const next = new Set(have);
    next.add(v);
    if (v === 14) next.add(1);
    if (done(next)) outs.push(v);
  }
  return outs;
}

function madeName(cards: number[], category: number): string {
  const vs = cards.map(value);
  const counts = new Map<number, number>();
  for (const v of vs) counts.set(v, (counts.get(v) ?? 0) + 1);
  const by = (n: number) => [...counts].filter(([, c]) => c === n).map(([v]) => v).sort((x, y) => y - x);
  const top = Math.max(...vs);
  const straightTop = vs.includes(14) && vs.includes(5) && vs.includes(2) && !vs.includes(13) ? 5 : top;
  switch (category) {
    case 8:
      return straightTop === 14 ? 'ロイヤルストレートフラッシュ！' : `${valueText(straightTop)} までのストレートフラッシュ`;
    case 7:
      return `${valueText(by(4)[0]!)} のフォーカード`;
    case 6:
      return `${valueText(by(3)[0]!)} と ${valueText(by(2)[0]!)} のフルハウス`;
    case 5:
      return `${SUIT_NAME[suitOf(cards[0]!)]} のフラッシュ（${valueText(top)} が一番上）`;
    case 4:
      return `${valueText(straightTop)} までのストレート`;
    case 3:
      return `${valueText(by(3)[0]!)} のスリーカード`;
    case 2:
      return `${valueText(by(2)[0]!)} と ${valueText(by(2)[1]!)} のツーペア`;
    case 1:
      return `${valueText(by(2)[0]!)} のワンペア`;
    default:
      return `${valueText(top)} が一番上（役なし）`;
  }
}

const TIER_WORD = { strong: 'とても強い', good: '強め', play: 'ふつう', weak: '弱め' } as const;

export const CATEGORY_NAME = ['ハイカード（役なし）', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート', 'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ'];

export function pokerAdvice(hole: number[], board: number[], o: { toCall: number; pot: number; bb: number }): PokerAdvice {
  const potOdds = o.toCall > 0 ? Math.round((o.toCall / (o.pot + o.toCall)) * 100) : null;
  if (board.length < 3) {
    const sh = startingHand(hole);
    const cheap = o.toCall <= o.bb;
    const adv: Record<typeof sh.tier, [string, Tone]> = {
      strong: ['とても強いスタートです。レイズしてポットを大きくしよう', 'go'],
      good: ['よいスタートです。コールでもレイズでも大丈夫', 'ok'],
      play: [cheap ? '安く見られるなら参加してみよう（コール・チェック）' : '悪くないけど、高く上げられたら降りてもよい', cheap ? 'ok' : 'care'],
      weak: [o.toCall === 0 ? 'チェックでタダで見よう' : cheap ? '弱めです。参加するなら安く' : '弱めです。フォールドがおすすめ', o.toCall === 0 || cheap ? 'care' : 'fold'],
    };
    return { name: '手札', detail: `${sh.label}（${TIER_WORD[sh.tier]}）`, category: null, cards: [], boardOnly: false, draws: [], outs: 0, equity: null, potOdds, advice: adv[sh.tier][0], tone: adv[sh.tier][1] };
  }

  const best = bestHand([...hole, ...board]);
  const category = categoryOf(best.score);
  const boardOnly = board.length >= 5 && !best.cards.some((c) => hole.includes(c));
  const detail = madeName(best.cards, category);
  const draws: string[] = [];
  let outs = 0;
  if (board.length < 5) {
    const all = [...hole, ...board];
    if (category < 5) {
      for (let s = 0; s < 4; s++) {
        const n = all.filter((c) => suitOf(c) === s).length;
        if (n === 4 && hole.some((c) => suitOf(c) === s)) {
          draws.push(`${SUIT_NAME[s]} のフラッシュまであと 1 枚（残り 9 枚）`);
          outs += 9;
        }
      }
    }
    if (category < 4) {
      const so = straightOuts(all.map(value));
      if (so.length >= 2) {
        draws.push(`ストレートまであと 1 枚（両側: ${so.map(valueText).join('・')}）`);
        outs += outs ? 6 : 8;
      } else if (so.length === 1) {
        draws.push(`ストレートまであと 1 枚（${valueText(so[0]!)} が来れば）`);
        outs += outs ? 3 : 4;
      }
    }
  }
  const equity = outs ? Math.min(100, outs * (board.length === 3 ? 4 : 2)) : null;

  // ペアの中身（一番上の場のカードとペアか・手札のペアが場より上か）
  const boardTop = Math.max(...board.map(value));
  const holeVals = hole.map(value);
  let pairNote = '';
  if (category === 1) {
    const pairVal = [...new Set(best.cards.map(value))].find((v) => best.cards.filter((c) => value(c) === v).length === 2)!;
    if (holeVals[0] === holeVals[1] && holeVals[0]! > boardTop) pairNote = 'over';
    else if (pairVal === boardTop && holeVals.includes(pairVal)) pairNote = 'top';
    else if (!holeVals.includes(pairVal) && holeVals[0] !== holeVals[1]) pairNote = 'board';
    else pairNote = 'low';
  }

  let advice: string;
  let tone: Tone;
  const drawOk = equity !== null && (potOdds === null || equity >= potOdds);
  if (boardOnly) {
    advice = '場のカードだけの役です（みんな同じ役を持っています）。強気にならないで';
    tone = 'care';
  } else if (category >= 3) {
    advice = 'とても強い手です！ベット・レイズしてポットを大きくしよう';
    tone = 'go';
  } else if (category === 2) {
    advice = '強い手です。ベットしてよい';
    tone = 'go';
  } else if (category === 1 && (pairNote === 'over' || pairNote === 'top')) {
    advice = pairNote === 'over' ? '場より強いペアです。ベット・コールでよい' : '場で一番上の数字とペアです（トップペア）。まずまず強い';
    tone = 'ok';
  } else if (drawOk && (o.toCall > 0 || category === 0)) {
    advice = o.toCall > 0 ? `コールする価値あり（当たる確率 約 ${equity}% ＞ 必要 ${potOdds}%）` : '次のカードで役ができるかも。チェックでタダで見よう';
    tone = 'ok';
  } else if (category === 1) {
    advice = pairNote === 'board' ? '場のペアで、みんなも持っています。強くはありません' : '弱めのペアです。安ければコール、高ければ降りても';
    tone = 'care';
  } else if (equity !== null) {
    advice = `当たる確率 約 ${equity}% に対して、コールに ${potOdds}% 必要。割に合わないのでフォールドも考えて`;
    tone = 'fold';
  } else {
    advice = o.toCall === 0 ? '役がありません。チェックで様子を見よう' : '役がありません。フォールドがおすすめ';
    tone = o.toCall === 0 ? 'care' : 'fold';
  }
  const counts = new Map<number, number>();
  for (const c of best.cards) counts.set(value(c), (counts.get(value(c)) ?? 0) + 1);
  const key =
    category === 4 || category === 5 || category === 6 || category === 8
      ? best.cards
      : category === 0
        ? [best.cards.reduce((a, b) => (value(b) > value(a) ? b : a))]
        : best.cards.filter((c) => (counts.get(value(c)) ?? 0) >= 2);
  return { name: CATEGORY_NAME[category]!, detail, category, cards: key, boardOnly, draws, outs, equity, potOdds, advice, tone };
}

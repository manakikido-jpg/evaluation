import type { Rng } from './cards.js';

/**
 * 🎲 ちんちろりん（サイコロ 3 つ）。親（胴元）と子が振り、役の強さで勝ち負けを決める。
 * - 1 回の番で 3 回まで振れる。役か目が出たらそこで止める。3 回とも出なければ「目なし」
 * - 役: ピンゾロ（1・1・1）> ゾロ目（2〜6 がそろう）> シゴロ（4・5・6）> 目（2 つそろった残りの数 6〜1）> 目なし > ヒフミ（1・2・3）
 * - 親がピンゾロ・ゾロ目・シゴロ・ヒフミ・目なしなら、子は振らずに決まる
 * 倍率は本物と同じ（子の払い戻し率はおよそ 99%）。負けは最大で賭けの 5 倍
 */

export type ChinKind = 'pin' | 'zoro' | 'shigoro' | 'me' | 'menashi' | 'hifumi';
export type ChinHand = { kind: ChinKind; value?: number };
/** 1 回振った目と、そのときの役（役がなければ null） */
export type ChinRoll = { dice: number[]; hand: ChinHand | null };

export const CHIN_MAX_ROLLS = 3;
/** 負けたときの最大の倍率（賭けのこの倍の銭が要る） */
export const CHIN_MAX_LOSS = 5;

export function rollDice(rng: Rng): number[] {
  return [1 + rng(6), 1 + rng(6), 1 + rng(6)];
}

/** 3 つの目の役（なければ null = もう一度振る） */
export function handOf(dice: number[]): ChinHand | null {
  const a = [...dice].sort((x, y) => x - y);
  if (a[0] === 1 && a[2] === 1) return { kind: 'pin' };
  if (a[0] === a[2]) return { kind: 'zoro', value: a[0] };
  if (a.join() === '4,5,6') return { kind: 'shigoro' };
  if (a.join() === '1,2,3') return { kind: 'hifumi' };
  if (a[0] === a[1]) return { kind: 'me', value: a[2] };
  if (a[1] === a[2]) return { kind: 'me', value: a[0] };
  return null;
}

/** 1 回振る（その番の続き）。役が出ていれば、もう振れない */
export function rollOnce(rolls: ChinRoll[], rng: Rng): ChinRoll[] {
  if (turnDone(rolls)) return rolls;
  const dice = rollDice(rng);
  return [...rolls, { dice, hand: handOf(dice) }];
}

export const turnDone = (rolls: ChinRoll[]) => rolls.length >= CHIN_MAX_ROLLS || rolls.some((r) => r.hand);

/** その番の役（3 回とも出なければ目なし） */
export function turnHand(rolls: ChinRoll[]): ChinHand {
  return rolls.find((r) => r.hand)?.hand ?? { kind: 'menashi' };
}

/** 1 番を最後まで振る */
export function rollTurn(rng: Rng): ChinRoll[] {
  let rolls: ChinRoll[] = [];
  while (!turnDone(rolls)) rolls = rollOnce(rolls, rng);
  return rolls;
}

export function handName(h: ChinHand): string {
  switch (h.kind) {
    case 'pin':
      return 'ピンゾロ';
    case 'zoro':
      return `${h.value} のゾロ目`;
    case 'shigoro':
      return 'シゴロ';
    case 'hifumi':
      return 'ヒフミ';
    case 'menashi':
      return '目なし';
    default:
      return `${h.value} の目`;
  }
}

/** 親の役で、子が振らずに決まるか */
export const parentDecides = (h: ChinHand) => h.kind !== 'me';

/**
 * 子から見た勝ち負けの倍率（+ は勝ち・- は負け・0 は引き分け）。child は親が決めたときは null
 * 親: ピンゾロ -5・ゾロ目 -3・シゴロ -2・ヒフミ +2・目なし +1
 * 子（親が目のとき）: ピンゾロ +5・ゾロ目 +3・シゴロ +2・目が大きい +1・同じ 0・小さい -1・目なし -1・ヒフミ -2
 */
export function chinSettle(parent: ChinHand, child: ChinHand | null): number {
  switch (parent.kind) {
    case 'pin':
      return -5;
    case 'zoro':
      return -3;
    case 'shigoro':
      return -2;
    case 'hifumi':
      return 2;
    case 'menashi':
      return 1;
  }
  if (!child) return 0;
  switch (child.kind) {
    case 'pin':
      return 5;
    case 'zoro':
      return 3;
    case 'shigoro':
      return 2;
    case 'hifumi':
      return -2;
    case 'menashi':
      return -1;
  }
  return Math.sign((child.value ?? 0) - (parent.value ?? 0));
}

/** 賭け base で倍率 mult のとき、引く銭（負けた分。勝ち・引き分けは賭けた分）と戻す銭 */
export function chinMoney(base: number, mult: number): { stake: number; payout: number } {
  if (mult < 0) return { stake: base * -mult, payout: 0 };
  return { stake: base, payout: base + base * mult };
}

/** 1 番の役の確率（3 回まで振る） */
function handDist(): { h: ChinHand; p: number }[] {
  const single = new Map<string, { h: ChinHand | null; p: number }>();
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++)
      for (let c = 1; c <= 6; c++) {
        const h = handOf([a, b, c]);
        const k = JSON.stringify(h);
        single.set(k, { h, p: (single.get(k)?.p ?? 0) + 1 / 216 });
      }
  const none = single.get('null')!.p;
  const dist = [...single.values()].filter((x) => x.h).map((x) => ({ h: x.h!, p: x.p * (1 + none + none * none) }));
  return [...dist, { h: { kind: 'menashi' }, p: none ** 3 }];
}

/** 子の期待値（賭け 1 あたりの勝ち負け。マイナスなら親が有利） */
export function chinEdge(): number {
  const dist = handDist();
  let ev = 0;
  for (const par of dist) {
    const children = parentDecides(par.h) ? [{ h: null as ChinHand | null, p: 1 }] : dist;
    for (const ch of children) ev += par.p * ch.p * chinSettle(par.h, ch.h);
  }
  return ev;
}

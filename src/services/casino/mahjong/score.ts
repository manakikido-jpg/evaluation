import { shantenKokushi } from './shanten.js';
import { countsOf, doraOf, HATSU, isDragon, isHonor, isRedTile, isTerminal, isWind, isYaochu, KINDS, kindOf, numOf, suitOf, WIND_NAME } from './tiles.js';

/**
 * 和了の点数（役・符・翻）。いちばん高くなる分け方を選ぶ。
 * 役は一般的なリーチ麻雀のもの（喰いタンあり・後付けあり・赤ドラあり）。役満は重ねて数える（ダブル役満はなし）。
 */

export type MeldType = 'chi' | 'pon' | 'minkan' | 'ankan' | 'kakan';
/** 鳴いた面子。from: 出した人の席・called: 鳴いた牌 */
export type Meld = { type: MeldType; tiles: number[]; from: number | null; called: number | null };

export type WinInput = {
  /** 手の中の牌（和了牌も入れる） */
  hand: number[];
  melds: Meld[];
  winTile: number;
  ron: boolean;
  /** 自風・場風（牌の種類 27〜30） */
  seatWind: number;
  roundWind: number;
  dealer: boolean;
  riichi?: boolean;
  doubleRiichi?: boolean;
  ippatsu?: boolean;
  haitei?: boolean;
  houtei?: boolean;
  rinshan?: boolean;
  chankan?: boolean;
  tenhou?: boolean;
  chiihou?: boolean;
  doraIndicators: number[];
  uraIndicators: number[];
};

export type Yaku = { name: string; han: number };
export type Score = {
  yaku: Yaku[];
  han: number;
  fu: number;
  /** 役満の数（0 ならふつうの役） */
  yakuman: number;
  base: number;
  /** 満貫・跳満…（なければ空） */
  limit: string;
  /** ロンのとき、出した人が払う（本場は別） */
  ron: number;
  /** ツモのとき: 親が払う（子のツモ）・子が払う（親のツモなら全員がこれ） */
  tsumoDealer: number;
  tsumoOther: number;
  /** 和了った人がもらう（本場・供託は別） */
  total: number;
};

type G = { type: 'run' | 'set' | 'kan' | 'pair'; k: number; open: boolean };
type Wait = 'ryanmen' | 'kanchan' | 'penchan' | 'tanki' | 'shanpon';

const ceil100 = (x: number) => Math.ceil(x / 100) * 100;

function decompositions(counts: readonly number[]): G[][] {
  const out: G[][] = [];
  const c = [...counts];
  const rec = (i: number, acc: G[]) => {
    while (i < KINDS && c[i] === 0) i++;
    if (i >= KINDS) {
      out.push([...acc]);
      return;
    }
    if (c[i]! >= 3) {
      c[i]! -= 3;
      acc.push({ type: 'set', k: i, open: false });
      rec(i, acc);
      acc.pop();
      c[i]! += 3;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1]! > 0 && c[i + 2]! > 0) {
      c[i]!--;
      c[i + 1]!--;
      c[i + 2]!--;
      acc.push({ type: 'run', k: i, open: false });
      rec(i, acc);
      acc.pop();
      c[i]!++;
      c[i + 1]!++;
      c[i + 2]!++;
    }
  };
  for (let k = 0; k < KINDS; k++) {
    if (c[k]! < 2) continue;
    c[k]! -= 2;
    rec(0, [{ type: 'pair', k, open: false }]);
    c[k]! += 2;
  }
  return out;
}

function meldGroup(m: Meld): G {
  const ks = m.tiles.map(kindOf);
  if (m.type === 'chi') return { type: 'run', k: Math.min(...ks), open: true };
  if (m.type === 'pon') return { type: 'set', k: ks[0]!, open: true };
  return { type: 'kan', k: ks[0]!, open: m.type !== 'ankan' };
}

const runHas = (g: G, k: number) => g.type === 'run' && k >= g.k && k <= g.k + 2;
const groupYaochu = (g: G) => (g.type === 'run' ? g.k % 9 === 0 || g.k % 9 === 6 : isYaochu(g.k));
const groupHonor = (g: G) => g.type !== 'run' && isHonor(g.k);

/** 状況の役（リーチ・一発・ツモ・海底など） */
function situational(w: WinInput, menzen: boolean): Yaku[] {
  const y: Yaku[] = [];
  if (w.doubleRiichi) y.push({ name: 'ダブル立直', han: 2 });
  else if (w.riichi) y.push({ name: '立直', han: 1 });
  if (w.ippatsu && (w.riichi || w.doubleRiichi)) y.push({ name: '一発', han: 1 });
  if (menzen && !w.ron) y.push({ name: '門前清自摸和', han: 1 });
  if (w.haitei && !w.ron) y.push({ name: '海底摸月', han: 1 });
  if (w.houtei && w.ron) y.push({ name: '河底撈魚', han: 1 });
  if (w.rinshan && !w.ron) y.push({ name: '嶺上開花', han: 1 });
  if (w.chankan && w.ron) y.push({ name: '槍槓', han: 1 });
  return y;
}

function situationalYakuman(w: WinInput): Yaku[] {
  const y: Yaku[] = [];
  if (w.tenhou) y.push({ name: '天和', han: 13 });
  if (w.chiihou) y.push({ name: '地和', han: 13 });
  return y;
}

/** 牌の色の役（タンヤオ・混一色・清一色・混老頭・字一色・清老頭・緑一色） */
function colorYaku(all: readonly number[], menzen: boolean): { yaku: Yaku[]; yakuman: Yaku[] } {
  const kinds = all.map(kindOf);
  const yaku: Yaku[] = [];
  const yakuman: Yaku[] = [];
  const suits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf));
  const honors = kinds.some(isHonor);
  if (kinds.every((k) => !isYaochu(k))) yaku.push({ name: '断么九', han: 1 });
  if (kinds.every(isHonor)) yakuman.push({ name: '字一色', han: 13 });
  else if (kinds.every(isTerminal)) yakuman.push({ name: '清老頭', han: 13 });
  else if (kinds.every(isYaochu)) yaku.push({ name: '混老頭', han: 2 });
  if (kinds.every((k) => k === 19 || k === 20 || k === 21 || k === 23 || k === 25 || k === HATSU)) yakuman.push({ name: '緑一色', han: 13 });
  if (suits.size === 1 && !honors) yaku.push({ name: '清一色', han: menzen ? 6 : 5 });
  else if (suits.size === 1 && honors) yaku.push({ name: '混一色', han: menzen ? 3 : 2 });
  return { yaku, yakuman };
}

type Eval = { yaku: Yaku[]; yakuman: Yaku[]; fu: number };

function evalRegular(w: WinInput, groups: G[], winIdx: number, wait: Wait, all: readonly number[]): Eval {
  const menzen = w.melds.every((m) => m.type === 'ankan');
  const pair = groups.find((g) => g.type === 'pair')!;
  const mentsu = groups.filter((g) => g.type !== 'pair');
  const runs = mentsu.filter((g) => g.type === 'run');
  const sets = mentsu.filter((g) => g.type !== 'run');
  const yakuhaiPair = isDragon(pair.k) || pair.k === w.seatWind || pair.k === w.roundWind;
  const yaku: Yaku[] = [...situational(w, menzen)];
  const yakuman: Yaku[] = [...situationalYakuman(w)];
  /** 暗刻（ロンで出来た刻子は明刻） */
  const concealedSet = (g: G, i: number) => g.type !== 'run' && !g.open && !(w.ron && i === winIdx && g.type === 'set');
  const anko = groups.filter((g, i) => g.type !== 'pair' && concealedSet(g, i)).length;
  const kans = sets.filter((g) => g.type === 'kan').length;

  const pinfu = menzen && runs.length === 4 && !yakuhaiPair && wait === 'ryanmen';
  if (pinfu) yaku.push({ name: '平和', han: 1 });
  if (menzen) {
    const byK = new Map<number, number>();
    for (const r of runs) byK.set(r.k, (byK.get(r.k) ?? 0) + 1);
    const peiko = [...byK.values()].reduce((a, n) => a + Math.floor(n / 2), 0);
    if (peiko >= 2) yaku.push({ name: '二盃口', han: 3 });
    else if (peiko === 1) yaku.push({ name: '一盃口', han: 1 });
  }
  for (const g of sets) {
    if (isDragon(g.k)) yaku.push({ name: `役牌 ${['白', '發', '中'][g.k - 31]}`, han: 1 });
    if (g.k === w.seatWind) yaku.push({ name: `自風 ${WIND_NAME[g.k - 27]}`, han: 1 });
    if (g.k === w.roundWind) yaku.push({ name: `場風 ${WIND_NAME[g.k - 27]}`, han: 1 });
  }
  for (let n = 0; n < 7; n++) if ([n, n + 9, n + 18].every((k) => runs.some((r) => r.k === k))) yaku.push({ name: '三色同順', han: menzen ? 2 : 1 });
  for (let s = 0; s < 3; s++) if ([0, 3, 6].every((d) => runs.some((r) => r.k === s * 9 + d))) yaku.push({ name: '一気通貫', han: menzen ? 2 : 1 });
  if (groups.every(groupYaochu) && runs.length > 0) {
    if (groups.some(groupHonor)) yaku.push({ name: '混全帯么九', han: menzen ? 2 : 1 });
    else yaku.push({ name: '純全帯么九', han: menzen ? 3 : 2 });
  }
  if (sets.length === 4) yaku.push({ name: '対々和', han: 2 });
  if (anko === 4) yakuman.push({ name: '四暗刻', han: 13 });
  else if (anko === 3) yaku.push({ name: '三暗刻', han: 2 });
  for (let n = 0; n < 9; n++) if ([n, n + 9, n + 18].every((k) => sets.some((g) => g.k === k))) yaku.push({ name: '三色同刻', han: 2 });
  if (kans === 4) yakuman.push({ name: '四槓子', han: 13 });
  else if (kans === 3) yaku.push({ name: '三槓子', han: 2 });
  const dragonSets = sets.filter((g) => isDragon(g.k)).length;
  const windSets = sets.filter((g) => isWind(g.k)).length;
  if (dragonSets === 3) yakuman.push({ name: '大三元', han: 13 });
  else if (dragonSets === 2 && isDragon(pair.k)) yaku.push({ name: '小三元', han: 2 });
  if (windSets === 4) yakuman.push({ name: '大四喜', han: 13 });
  else if (windSets === 3 && isWind(pair.k)) yakuman.push({ name: '小四喜', han: 13 });
  const color = colorYaku(all, menzen);
  yaku.push(...color.yaku);
  yakuman.push(...color.yakuman);
  // 九蓮宝燈
  if (menzen && w.melds.length === 0) {
    const c = countsOf(all);
    const s = suitOf(kindOf(all[0]!));
    if (s < 3 && all.every((t) => suitOf(kindOf(t)) === s)) {
      const b = s * 9;
      if (c[b]! >= 3 && c[b + 8]! >= 3 && [1, 2, 3, 4, 5, 6, 7].every((d) => c[b + d]! >= 1)) yakuman.push({ name: '九蓮宝燈', han: 13 });
    }
  }

  // 符
  let fu: number;
  if (pinfu) fu = w.ron ? 30 : 20;
  else {
    fu = 20;
    if (menzen && w.ron) fu += 10;
    if (!w.ron) fu += 2;
    groups.forEach((g, i) => {
      if (g.type === 'set') fu += (isYaochu(g.k) ? 4 : 2) * (concealedSet(g, i) ? 2 : 1);
      if (g.type === 'kan') fu += (isYaochu(g.k) ? 16 : 8) * (g.open ? 1 : 2);
    });
    if (isDragon(pair.k)) fu += 2;
    if (pair.k === w.seatWind) fu += 2;
    if (pair.k === w.roundWind) fu += 2;
    if (wait === 'kanchan' || wait === 'penchan' || wait === 'tanki') fu += 2;
    if (!menzen && fu === 20) fu = 30;
    fu = Math.ceil(fu / 10) * 10;
  }
  return { yaku, yakuman, fu };
}

function doraCount(w: WinInput, all: readonly number[]): Yaku[] {
  const count = (inds: number[]) => {
    const d = inds.map((t) => doraOf(kindOf(t)));
    return all.reduce((a, t) => a + d.filter((k) => k === kindOf(t)).length, 0);
  };
  const out: Yaku[] = [];
  const dora = count(w.doraIndicators);
  const red = all.filter(isRedTile).length;
  const ura = w.riichi || w.doubleRiichi ? count(w.uraIndicators) : 0;
  if (dora) out.push({ name: 'ドラ', han: dora });
  if (red) out.push({ name: '赤ドラ', han: red });
  if (ura) out.push({ name: '裏ドラ', han: ura });
  return out;
}

function finish(w: WinInput, e: Eval, all: readonly number[]): Score | null {
  let yakuman = e.yakuman.length;
  let yaku = e.yakuman.length ? e.yakuman : e.yaku;
  let han = yaku.reduce((a, y) => a + y.han, 0);
  if (!yakuman && han === 0) return null;
  let base: number;
  let limit = '';
  if (!yakuman) {
    yaku = [...yaku, ...doraCount(w, all)];
    han = yaku.reduce((a, y) => a + y.han, 0);
    if (han >= 13) {
      yakuman = 1;
      limit = '数え役満';
    }
  } else limit = yakuman > 1 ? `${yakuman}倍役満` : '役満';
  if (yakuman) base = 8000 * yakuman;
  else if (han >= 11) [base, limit] = [6000, '三倍満'];
  else if (han >= 8) [base, limit] = [4000, '倍満'];
  else if (han >= 6) [base, limit] = [3000, '跳満'];
  else {
    base = e.fu * 2 ** (han + 2);
    if (han >= 5 || base > 2000) [base, limit] = [2000, '満貫'];
  }
  const s: Score = { yaku, han, fu: e.fu, yakuman, base, limit, ron: 0, tsumoDealer: 0, tsumoOther: 0, total: 0 };
  if (w.dealer) {
    s.ron = ceil100(base * 6);
    s.tsumoOther = ceil100(base * 2);
    s.tsumoDealer = s.tsumoOther;
    s.total = w.ron ? s.ron : s.tsumoOther * 3;
  } else {
    s.ron = ceil100(base * 4);
    s.tsumoDealer = ceil100(base * 2);
    s.tsumoOther = ceil100(base);
    s.total = w.ron ? s.ron : s.tsumoDealer + s.tsumoOther * 2;
  }
  return s;
}

const better = (a: Score | null, b: Score | null) => (!a ? b : !b ? a : b.total > a.total || (b.total === a.total && b.han > a.han) ? b : a);

/** 和了の点数（形になっていない・役がないときは null） */
export function scoreWin(w: WinInput): Score | null {
  const c = countsOf(w.hand);
  const all = [...w.hand, ...w.melds.flatMap((m) => m.tiles)];
  const wk = kindOf(w.winTile);
  let best: Score | null = null;

  // 国士無双
  if (w.melds.length === 0 && w.hand.length === 14 && shantenKokushi(c) === -1) {
    return finish(w, { yaku: [], yakuman: [...situationalYakuman(w), { name: '国士無双', han: 13 }], fu: 0 }, all);
  }
  // 七対子
  if (w.melds.length === 0 && w.hand.length === 14 && c.filter((n) => n === 2).length === 7) {
    const color = colorYaku(all, true);
    best = better(best, finish(w, { yaku: [...situational(w, true), { name: '七対子', han: 2 }, ...color.yaku], yakuman: [...situationalYakuman(w), ...color.yakuman], fu: 25 }, all));
  }
  const melds = w.melds.map(meldGroup);
  for (const d of decompositions(c)) {
    const groups = [...d, ...melds];
    d.forEach((g, i) => {
      let wait: Wait | null = null;
      if (g.type === 'pair' && g.k === wk) wait = 'tanki';
      else if (g.type === 'set' && g.k === wk) wait = 'shanpon';
      else if (runHas(g, wk)) {
        const pos = wk - g.k;
        wait = pos === 1 ? 'kanchan' : (pos === 2 && numOf(g.k) === 1) || (pos === 0 && numOf(g.k) === 7) ? 'penchan' : 'ryanmen';
      }
      if (!wait) return;
      best = better(best, finish(w, evalRegular(w, groups, i, wait, all), all));
    });
  }
  return best;
}

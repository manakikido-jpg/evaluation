import type { Rng } from './cards.js';
import type { AtMachine, AtStep } from './slotAt.js';

/**
 * 🦊 AT 機の演出（見せ方だけ。当たり・払い戻しはもう決まっていて、ここでは変えない）。
 * レバーの予告・フリーズ・最後の STOP の色・溜め・確定音・液晶の舞台・継続バトルの攻め合いを決める。
 * 当たりのときほど強い演出が出やすいが、はずれでも出る（ガセ）。虹とフリーズは当たりのときだけ
 */

/** レバーを叩いたときの予告（none < kyuin < flash < shake < blackout < rainbow の順に強い） */
export type AtLever = 'none' | 'kyuin' | 'flash' | 'shake' | 'blackout' | 'rainbow';
/** 最後の STOP ボタンの色（青 < 赤 < 金 < 虹） */
export type AtStopColor = 'none' | 'blue' | 'red' | 'gold' | 'rainbow';
/** 液晶の舞台: 白狐の社（通常）・鬼の森（前兆）・白狐ラッシュ（AT）・白狐乱舞（特化） */
export type AtStage = 'shrine' | 'forest' | 'rush' | 'ranbu';
/** 継続バトルの 1 手（who が攻めて、hit なら当たる） */
export type AtBlow = { who: 'byakko' | 'oni'; hit: boolean };

export type AtShow = {
  stage: AtStage;
  lever: AtLever;
  /** フリーズ（リールが回らず暗くなる → 確定）。白狐目と、AT が決まったときの一部 */
  freeze: boolean;
  stop3: AtStopColor;
  /** 最後のリールの前で溜める（少しのあいだ止められない） */
  hold: boolean;
  /** 止め終わりの確定音（AT が決まった） */
  kakutei: boolean;
  /** 前兆の鬼の近さ（0 いない・1 遠く・2 近い・3 目の前） */
  oni: number;
  battle?: AtBlow[];
};

const pick = <T>(rng: Rng, table: [T, number][]): T => {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let x = rng(total);
  for (const [v, w] of table) {
    if (x < w) return v;
    x -= w;
  }
  return table[0]![0];
};

const LEVER_BY_HINT: [AtLever, number][][] = [
  [
    ['none', 97],
    ['kyuin', 3],
  ],
  [
    ['none', 35],
    ['kyuin', 35],
    ['flash', 25],
    ['shake', 5],
  ],
  [
    ['kyuin', 20],
    ['flash', 35],
    ['shake', 35],
    ['blackout', 10],
  ],
  [
    ['flash', 15],
    ['shake', 40],
    ['blackout', 45],
  ],
];
const STOP_BY_HINT: [AtStopColor, number][][] = [
  [
    ['none', 95],
    ['blue', 5],
  ],
  [
    ['none', 10],
    ['blue', 60],
    ['red', 30],
  ],
  [
    ['blue', 25],
    ['red', 55],
    ['gold', 20],
  ],
  [
    ['red', 25],
    ['gold', 75],
  ],
];
const LEVERS: AtLever[] = ['none', 'kyuin', 'flash', 'shake', 'blackout', 'rainbow'];
const STOPS: AtStopColor[] = ['none', 'blue', 'red', 'gold', 'rainbow'];
/** 1 段強く（虹は当たりのときだけなので、ここでは金まで） */
const upLever = (l: AtLever): AtLever => LEVERS[Math.min(LEVERS.indexOf(l) + 1, 4)]!;
const upStop = (s: AtStopColor): AtStopColor => STOPS[Math.min(STOPS.indexOf(s) + 1, 3)]!;

/** 継続バトル: 3〜5 手。勝つなら白狐の一撃で、負けるなら鬼の一撃で終わる。途中はどちらにも転ぶ */
export function atBattle(win: boolean, rng: Rng): AtBlow[] {
  const n = 2 + rng(3);
  const blows: AtBlow[] = [];
  for (let i = 0; i < n; i++) {
    const who = i % 2 === 0 ? 'oni' : 'byakko';
    blows.push({ who, hit: rng(100) < 35 });
  }
  // 逆転を見せたいので、勝つときは途中で白狐が押されることが多い
  if (win && rng(100) < 50) blows[0] = { who: 'oni', hit: true };
  blows.push(win ? { who: 'byakko', hit: true } : { who: 'oni', hit: true });
  return blows;
}

/** このゲームの演出（prev: 回す前の台・step: このゲーム・next: 回したあとの台） */
export function atShow(prev: AtMachine, step: AtStep, next: AtMachine, rng: Rng): AtShow {
  const hint = Math.max(0, Math.min(3, step.hint));
  const won = prev.phase === 'normal' && next.phase === 'zenchou';
  const atStart = step.events.some((e) => e.k === 'at_start');
  const battle = step.events.find((e) => e.k === 'battle');
  const rare = step.role === 'scherry' || step.role === 'chance' || step.role === 'byakko';
  const show: AtShow = { stage: 'shrine', lever: 'none', freeze: false, stop3: 'none', hold: false, kakutei: false, oni: 0 };

  if (step.during === 'at' || step.during === 'tokka') {
    show.stage = step.during === 'tokka' ? 'ranbu' : 'rush';
    const add = step.events.some((e) => e.k === 'add');
    show.lever = step.role === 'byakko' ? 'rainbow' : rare ? pick(rng, [['flash', 50], ['shake', 50]]) : add ? 'kyuin' : rng(100) < 3 ? 'kyuin' : 'none';
    show.stop3 = rare ? 'gold' : add ? 'red' : 'none';
    show.hold = step.role === 'chance' || step.role === 'byakko';
    show.freeze = step.role === 'byakko';
    if (battle && battle.k === 'battle') show.battle = atBattle(battle.win, rng);
    return show;
  }

  // 通常時・前兆
  if (step.during === 'zenchou') {
    show.stage = atStart || rng(100) < 85 ? 'forest' : 'shrine';
    show.oni = atStart ? 3 : Math.min(2, hint + (rng(100) < 40 ? 1 : 0));
  } else {
    // はずれでも、たまに鬼の森へ（ガセの前兆）
    show.stage = rng(100) < (hint >= 1 ? 25 : 3) ? 'forest' : 'shrine';
    show.oni = show.stage === 'forest' ? 1 : 0;
  }
  show.lever = pick(rng, LEVER_BY_HINT[hint]!);
  show.stop3 = pick(rng, STOP_BY_HINT[hint]!);
  show.hold = hint >= 2 || rare ? rng(100) < 60 : false;
  if (atStart) show.hold = true;

  if (won) {
    // AT が決まった: フリーズ・虹・確定音のどれか（なければ 1 段強く）
    if (step.role === 'byakko' || rng(100) < 20) show.freeze = true;
    else if (rng(100) < 30) show.lever = 'rainbow';
    else {
      show.lever = upLever(show.lever);
      show.stop3 = rng(100) < 25 ? 'rainbow' : upStop(show.stop3);
      show.kakutei = rng(100) < 50;
    }
  }
  return show;
}

import type { Rng } from './cards.js';

/**
 * 🏇 競馬（みんなでダービー）の中身: 馬を作る・レースを走らせる・オッズ（みんなの賭けで変わるパリミュチュエル）。
 *
 * - 1 レース 8 頭。馬は名簿にいて何度も走り、成績（○戦○勝・前走）がたまる
 * - 距離（1200〜2400m）でスタートの位置が変わる（1 周 2000m の左回り）。芝／ダート・馬場（良〜重）で、馬ごとの得意・不得意が変わる
 * - レースは 0.2 秒ずつ動かす。脚質（逃げ・先行・差し・追込）で前半・後半の速さが変わり、スタミナが切れると落ちる。
 *   内・外の位置取り、前が詰まる、カーブで外を回ると損をする、出遅れもある
 * - 結果は発走のときに決まる（それまではだれにも分からない）。画面では同じ動きを、みんなが同じ時刻に見る
 * - オッズ: 賭けた銭をまとめて、胴元の取り分を引いた残りを、当たった人で分ける（単勝・複勝・馬連・ワイド）。
 *   人が少なくても極端にならないよう、BOT のお客さん（見せ金）が馬の強さに合わせて少し賭けておく
 */

export const KB_HORSES = 8;
/** 胴元の取り分（払い戻し率 90%） */
export const KB_TAKE = 0.1;
/** BOT のお客さんが賭けておく量（賭け方ごと） */
export const KB_SEED = 2000;
/** 1 人が 1 レースに賭けられる数（3 連単の 4 頭ボックス 24 点が入る） */
export const KB_MAX_TICKETS = 30;

export const KB_STYLES = ['逃げ', '先行', '差し', '追込'] as const;
export const KB_DISTANCES = [1200, 1600, 2000, 2400] as const;
export const KB_SURFACES = ['芝', 'ダート'] as const;
export const KB_GOINGS = ['良', '稍重', '重'] as const;
export const KB_WEATHERS = ['☀ 晴', '☁ 曇', '☔ 雨'] as const;
/** 得意な距離 */
export const KB_APT = ['短距離', 'マイル', '中距離', '長距離'] as const;
/** 枠の色（1〜8 枠） */
export const KB_GATE_COLORS = ['#ffffff', '#222222', '#e53935', '#1e63d6', '#f4c430', '#2e9e4f', '#f08a24', '#f48fb1'] as const;

export const KB_BET_TYPES = ['win', 'place', 'quinella', 'wide', 'exacta', 'trio', 'trifecta'] as const;
export type KbBetType = (typeof KB_BET_TYPES)[number];
export const KB_BET_LABEL: Record<KbBetType, { name: string; note: string }> = {
  win: { name: '単勝', note: '1 着を当てる' },
  place: { name: '複勝', note: '3 着までに入る馬を当てる' },
  quinella: { name: '馬連', note: '1 着と 2 着の 2 頭を当てる（順番はどちらでも）' },
  wide: { name: 'ワイド', note: '3 着までに入る 2 頭を当てる（順番はどちらでも）' },
  exacta: { name: '馬単', note: '1 着と 2 着を順番どおりに当てる' },
  trio: { name: '3連複', note: '1〜3 着の 3 頭を当てる（順番はどちらでも）' },
  trifecta: { name: '3連単', note: '1〜3 着を順番どおりに当てる（いちばん大きい）' },
};
export const isKbBetType = (v: unknown): v is KbBetType => typeof v === 'string' && (KB_BET_TYPES as readonly string[]).includes(v);
/** 1 枚に選ぶ馬の数（単勝・複勝 1・馬連・ワイド・馬単 2・3 連複・3 連単 3） */
export const picksOf = (t: KbBetType) => (t === 'win' || t === 'place' ? 1 : t === 'trio' || t === 'trifecta' ? 3 : 2);
/** 順番どおりに当てる賭け方（馬単・3 連単） */
export const isOrderedType = (t: KbBetType) => t === 'exacta' || t === 'trifecta';
export const isPairType = (t: KbBetType) => picksOf(t) > 1;
/** 組の書き方: 順番どおりは "3>1>5"、どちらでもよいのは小さい順に "1-3-5" */
export const comboKey = (t: KbBetType, nos: readonly number[]) => (isOrderedType(t) ? nos.join('>') : [...nos].sort((a, b) => a - b).join('-'));
export const keyNos = (key: string) => key.split(/[->]/).map(Number);

const NAME_HEAD = ['サクラ', 'ハナ', 'ツキ', 'ヨイ', 'キツネ', 'オミクジ', 'コマ', 'カグラ', 'シュイン', 'ホウノウ', 'エマ', 'ミコ', 'スズ', 'ヤタ', 'ワタアメ', 'ユカタ', 'カザ', 'モミジ', 'ユキ', 'ウメ', 'フジ', 'ナデシコ', 'ホタル', 'カミナリ', 'ギン', 'ヨザクラ', 'ハル', 'アキ', 'シロ', 'クロ', 'ミヤ', 'トリイ'] as const;
const NAME_TAIL = ['ノミヤビ', 'ダンサー', 'スター', 'ノヨメイリ', 'ダイキチ', 'パワー', 'ノマイ', 'ハンター', 'ボーイ', 'ノネガイ', 'ライト', 'ノカンザシ', 'ノネイロ', 'クイーン', 'ビジン', 'グルマ', 'ガリ', 'ロード', 'ジェット', 'ノユメ', 'マル', 'ノカミ', 'スマイル', 'ボルト', 'シルク', 'ロマン', 'イチバン', 'ノヨナガ', 'ダッシュ', 'フブキ', 'キング', 'エース'] as const;

const RACE_NAMES = ['咲楽ノ宮ダービー', '桜吹雪ステークス', '月見記念', '宵宮カップ', '鳥居賞', '神楽ステークス', '花灯籠賞', '白狐特別', '御神籤杯', '紅葉ステークス'] as const;

/** 毛色 */
export const KB_COATS = ['鹿毛', '栗毛', '黒鹿毛', '芦毛', '青毛', '栃栗毛'] as const;
/** 勝負服の柄 */
export const KB_SILK_PATTERNS = ['無地', '縦縞', '襷', '輪', '山形', '星'] as const;
const SILK_COLORS = ['#e53935', '#1e63d6', '#f4c430', '#2e9e4f', '#ffffff', '#222222', '#8e44ad', '#f08a24', '#f48fb1', '#00a6a6', '#8b1a1a', '#0b3d91'] as const;

/** 勝負服（服の色・柄の色・柄） */
export type KbSilk = { base: string; accent: string; pattern: number };

/** 名簿の馬（何度も走る。成績がたまる） */
export type KbStable = {
  id: number;
  name: string;
  style: number;
  spd: number;
  sta: number;
  apt: number;
  surf: number;
  coat: number;
  silk: KbSilk;
  starts: number;
  wins: number;
  seconds: number;
  thirds: number;
  /** 最近のレース（新しい順・5 走まで） */
  recent: { pos: number; race: string; dist: number; surface: number }[];
  /** 馬主（メンバーの id と名前。BOT の馬は null） */
  ownerId: string | null;
  ownerName?: string | null;
  /** 獲得賞金（銭） */
  prize: number;
  /** 性 0 牡 / 1 牝 / 2 セン・年齢・ふだんの馬体重 */
  sex: number;
  age: number;
  weight: number;
  /** いまの疲れ（0〜100）・調教の上乗せ・親の名前（産駒のとき） */
  fatigue?: number;
  trainBoost?: number;
  sire?: string | null;
};

// ───────── 疲れと調教 ─────────

/** 1 走でたまる疲れ・1 時間で抜ける疲れ */
export const KB_FATIGUE_RUN = 25;
export const KB_FATIGUE_RECOVER = 10;
/** 疲れがこれ以上だと調子が 1 つ下がる・これ以上だと出走しない */
export const KB_FATIGUE_TIRED = 50;
export const KB_FATIGUE_REST = 80;
/** いまの疲れ（時間で抜ける） */
export const fatigueNow = (fatigue: number, at: Date | null, now: Date) =>
  Math.max(0, Math.round(fatigue - (at ? ((now.getTime() - at.getTime()) / 3_600_000) * KB_FATIGUE_RECOVER : fatigue)));
/** 調子（-2〜+2）: 運 + 調教の上乗せ - 疲れ */
export const condOf = (luck: number, h: { fatigue?: number; trainBoost?: number }) =>
  Math.max(-2, Math.min(2, luck + (h.trainBoost ?? 0) - ((h.fatigue ?? 0) >= KB_FATIGUE_TIRED ? 1 : 0)));

// ───────── クラスと重賞 ─────────

/** クラス（0 新馬 … 5 オープン）と重賞（6 G3・7 G2・8 G1） */
export const KB_CLASSES = ['新馬', '未勝利', '1勝クラス', '2勝クラス', '3勝クラス', 'オープン', 'G3', 'G2', 'G1'] as const;
export const KB_SEXES = ['牡', '牝', 'セ'] as const;
/** その馬が出られるクラス（まだ走っていなければ新馬、勝っていなければ未勝利、勝った数で 1〜3 勝、4 勝からオープン） */
export const classOf = (h: { starts: number; wins: number }) => (h.starts === 0 ? 0 : h.wins === 0 ? 1 : Math.min(5, h.wins + 1));
export const isGraded = (cls: number) => cls >= 6;
/** 馬主に払う賞金: そのレースでメンバーが賭けた合計の何 %（胴元の取り分 10% の中から。重賞ほど多い） */
export const KB_PRIZE_RATE = [3, 3, 4, 4, 4, 5, 6, 7, 8] as const;
/** 出走手当: 馬主のいる馬 1 頭につき、メンバーが賭けた合計の 0.25%（賞金と合わせて 10% を超えない） */
export const KB_APPEARANCE_BP = 25;
export const appearanceOf = (real: number) => Math.floor((real * KB_APPEARANCE_BP) / 10000);
/** 1〜5 着の分け方（%） */
export const KB_PRIZE_SPLIT = [50, 20, 13, 10, 7] as const;
/** 賞金（1〜5 着の銭）。real はメンバーが賭けた合計 */
export const prizesOf = (cls: number, real: number) => KB_PRIZE_SPLIT.map((p) => Math.floor((real * (KB_PRIZE_RATE[cls] ?? 5) * p) / 10000));

/** 馬主への還元の設定（社務所Web で変えられる） */
export type KbPayConf = { prizeMult: number; purse: readonly number[]; fanPct: number };
export const kbPayConf = (c: { keibaPrizeMult: number; keibaPurse: readonly number[]; keibaFanPct: number }): KbPayConf => ({ prizeMult: c.keibaPrizeMult, purse: c.keibaPurse, fanPct: c.keibaFanPct });
/**
 * そのレースの 1〜5 着の賞金: 賭けた合計の数 % に倍率をかけたものと、最低保証（1 着が purse、2〜5 着はその割合）の多いほう
 */
export function racePrizes(cls: number, real: number, conf: KbPayConf): number[] {
  const base = prizesOf(cls, real).map((p) => Math.floor((p * conf.prizeMult) / 100));
  const purse = conf.purse[cls] ?? 0;
  return base.map((p, i) => Math.max(p, Math.floor((purse * KB_PRIZE_SPLIT[i]!) / KB_PRIZE_SPLIT[0])));
}
/** 出走手当（倍率をかけたもの） */
export const raceAppearance = (real: number, conf: KbPayConf) => Math.floor((appearanceOf(real) * conf.prizeMult) / 100);
/** 応援金: 馬主でない人がその馬の単勝・複勝に賭けた額の fanPct % */
export function fanMoney(tickets: readonly { memberId: string; t: string; key: string; amount: number }[], no: number, ownerId: string, conf: KbPayConf): number {
  const cheer = tickets.filter((t) => (t.t === 'win' || t.t === 'place') && t.key === String(no) && t.memberId !== ownerId).reduce((a, t) => a + t.amount, 0);
  return Math.floor((cheer * conf.fanPct) / 100);
}

/** パドックの気配（調子から） */
export const KB_LOOK = ['少し元気がない', 'まずまず', '落ち着いて歩けている', '毛ヅヤがよく、気合十分', '踏み込みが力強く、絶好の仕上がり'] as const;

export type KbHorse = {
  /** 馬番（1〜8。枠も同じ） */
  no: number;
  /** 名簿の番号（名簿のないテストでは 0） */
  id: number;
  name: string;
  /** 脚質 0〜3 */
  style: number;
  /** 速さ（0.985〜1.015） */
  spd: number;
  /** スタミナ（0.9〜1.1） */
  sta: number;
  /** 調子 -2〜+2（レースごと） */
  cond: number;
  /** 得意な距離 0〜3 */
  apt: number;
  /** 得意な馬場 0 = 芝 / 1 = ダート / 2 = どちらも */
  surf: number;
  coat: number;
  silk: KbSilk;
  /** 走る前の成績 */
  starts: number;
  wins: number;
  seconds: number;
  thirds: number;
  recent: KbStable['recent'];
  /** 前走の着順（はじめてなら 0） */
  last: number;
  /** 馬主・獲得賞金・クラス・性・年齢・親・疲れ */
  ownerId: string | null;
  ownerName: string | null;
  sire?: string | null;
  fatigue?: number;
  prize: number;
  cls: number;
  sex: number;
  age: number;
  /** 今日の馬体重と、前走からの増減 */
  weight: number;
  wdiff: number;
  /** 勝つ見込み・3 着以内の見込み（BOT のお客さんの賭けと予想の印に使う） */
  p: number;
  p3: number;
};

/** cls: クラス（KB_CLASSES の番号） */
export type KbRaceInfo = { n: number; name: string; dist: number; surface: number; going: number; weather: number; cls: number };

/** 0〜1 の乱数（同じ種なら同じ並び） */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const distClass = (d: number) => Math.max(0, KB_DISTANCES.indexOf(d as (typeof KB_DISTANCES)[number]));
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

/** 新しい馬（名簿に入れる前。id は名簿が決める） */
export function newStable(r: () => number, taken: ReadonlySet<string> = new Set()): Omit<KbStable, 'id'> {
  let name = '';
  for (let i = 0; i < 50 && (!name || taken.has(name)); i++) name = pick(r, NAME_HEAD) + pick(r, NAME_TAIL);
  if (taken.has(name)) name = `${name}${Math.floor(r() * 90) + 10}`;
  const base = pick(r, SILK_COLORS);
  let accent = pick(r, SILK_COLORS);
  while (accent === base) accent = pick(r, SILK_COLORS);
  return {
    name,
    style: Math.floor(r() * 4),
    spd: round3(0.985 + r() * 0.03),
    sta: round3(0.9 + r() * 0.2),
    apt: Math.floor(r() * 4),
    surf: r() < 0.45 ? 0 : r() < 0.6 ? 1 : 2,
    coat: r() < 0.35 ? 0 : Math.floor(r() * KB_COATS.length),
    silk: { base, accent, pattern: Math.floor(r() * KB_SILK_PATTERNS.length) },
    starts: 0,
    wins: 0,
    seconds: 0,
    thirds: 0,
    recent: [],
    ownerId: null,
    prize: 0,
    sex: r() < 0.5 ? 0 : r() < 0.8 ? 1 : 2,
    age: 2 + Math.floor(r() * 3),
    weight: 430 + Math.floor(r() * 90),
  };
}

/**
 * どのクラスのレースにするか: 決めていなければ、出られる馬の多いクラスから（オープンの馬が多ければ、ときどき重賞）
 */
function chooseClass(r: () => number, roster: readonly KbStable[], want?: number): number {
  if (want !== undefined && want >= 0 && want < KB_CLASSES.length) return want;
  if (roster.length < KB_HORSES) return 0;
  const count = [0, 0, 0, 0, 0, 0];
  for (const h of roster) {
    const c = classOf(h);
    count[c]!++;
    // 新馬は未勝利にも出られる
    if (c === 0) count[1]!++;
  }
  if (count[5]! >= 5 && r() < 0.3) return 6 + Math.floor(r() * 3);
  const options = count.map((n, c) => ({ c, w: n >= 4 ? n : 0 })).filter((x) => x.w > 0);
  if (!options.length) return 1;
  let x = r() * options.reduce((a, b) => a + b.w, 0);
  for (const o of options) if ((x -= o.w) <= 0) return o.c;
  return options[0]!.c;
}

/** そのクラスに出られる馬か（未勝利は新馬も、重賞はオープンの馬） */
const fits = (h: KbStable, cls: number) => (isGraded(cls) ? classOf(h) === 5 : cls === 1 ? classOf(h) <= 1 : classOf(h) === cls);
/** 出られる馬が足りないとき、どのくらい離れたクラスから足すか */
const gap = (h: KbStable, cls: number) => Math.abs(classOf(h) - Math.min(5, cls));

/** レース名（下のクラスは「1勝クラス」など。オープンと重賞は名前つき） */
function raceName(r: () => number, cls: number, title?: string): string {
  const name = title || (cls >= 5 ? pick(r, RACE_NAMES) : KB_CLASSES[cls]!);
  return isGraded(cls) ? `${name}（${KB_CLASSES[cls]}）` : name;
}

/**
 * レースの条件と 8 頭を決める。名簿（roster）があれば、そこから 8 頭を選ぶ（なければその場で作る）。
 * 見込み（p・p3）は estimate で入れる
 */
export function makeRace(
  rng: Rng,
  n: number,
  opts: { name?: string; dist?: number; cls?: number; priority?: ReadonlySet<string> } = {},
  roster: readonly KbStable[] = [],
): { race: KbRaceInfo; horses: KbHorse[] } {
  const r = seeded(rng(2 ** 31));
  const dist = opts.dist && (KB_DISTANCES as readonly number[]).includes(opts.dist) ? opts.dist : pick(r, KB_DISTANCES);
  const weather = r() < 0.6 ? 0 : r() < 0.6 ? 1 : 2;
  const going = weather === 2 ? (r() < 0.5 ? 1 : 2) : weather === 1 ? (r() < 0.3 ? 1 : 0) : 0;
  const cls = chooseClass(r, roster, opts.cls);
  const race: KbRaceInfo = { n, name: raceName(r, cls, opts.name), dist, surface: r() < 0.65 ? 0 : 1, going, weather, cls };
  let pool: KbStable[] = [...roster];
  if (pool.length < KB_HORSES) {
    const taken = new Set(pool.map((h) => h.name));
    while (pool.length < KB_HORSES) {
      const h = newStable(r, taken);
      taken.add(h.name);
      pool.push({ ...h, id: 0 });
    }
  }
  // 出られる馬から。卓に座っている馬主の馬を先に。足りなければ近いクラスから
  const order = pool
    .map((h) => ({ h, k: (fits(h, cls) ? 0 : 10 + gap(h, cls)) - (h.ownerId && opts.priority?.has(h.ownerId) && (fits(h, cls) || gap(h, cls) <= 1) ? 5 : 0) + r() }))
    .sort((a, b) => a.k - b.k);
  pool = order.slice(0, KB_HORSES).map((x) => x.h);
  // 馬番はくじ
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const horses: KbHorse[] = pool.map((h, i) => ({
    no: i + 1,
    id: h.id,
    name: h.name,
    style: h.style,
    spd: h.spd,
    sta: h.sta,
    cond: condOf(Math.floor(r() * 5) - 2, h),
    apt: h.apt,
    surf: h.surf,
    coat: h.coat,
    silk: h.silk,
    starts: h.starts,
    wins: h.wins,
    seconds: h.seconds,
    thirds: h.thirds,
    recent: h.recent.slice(0, 5),
    last: h.recent[0]?.pos ?? 0,
    ownerId: h.ownerId,
    ownerName: h.ownerName ?? null,
    sire: h.sire ?? null,
    fatigue: h.fatigue ?? 0,
    prize: h.prize,
    cls: classOf(h),
    sex: h.sex,
    age: h.age,
    ...((d) => ({ weight: h.weight + d, wdiff: h.starts ? d : 0 }))(Math.round((r() - 0.5) * 16)),
    p: 0,
    p3: 0,
  }));
  return { race, horses };
}

// ───────── コース ─────────

/**
 * 1 周 2000m の左回り。ゴールから: 100m 直線 → 1・2 コーナー（400m）→ 向こう正面 600m → 3・4 コーナー（400m）→ 最後の直線 500m でゴール
 */
export const KB_LAP = 2000;
const TURNS: [number, number][] = [
  [100, 500],
  [1100, 1500],
];
/** カーブの半径（m） */
const TURN_R = 400 / Math.PI;
/** コーナーの真ん中あたり（通過順を数えるところ） */
const CORNERS: { at: number; name: string }[] = [
  { at: 200, name: '1 コーナー' },
  { at: 400, name: '2 コーナー' },
  { at: 1200, name: '3 コーナー' },
  { at: 1400, name: '4 コーナー' },
];
/** スタートの位置（ゴールから何 m 先か。2400m はスタンド前、1200m は向こう正面） */
export const startOf = (dist: number) => (((-dist) % KB_LAP) + KB_LAP) % KB_LAP;
const lapPos = (dist: number, x: number) => (startOf(dist) + x) % KB_LAP;
const onTurn = (p: number) => TURNS.some(([a, b]) => p >= a && p < b);

// ───────── レースを走らせる ─────────

/** 脚質ごとの速さの倍率（前半・中盤・終盤） */
const STYLE_CURVE: [number, number, number][] = [
  [1.035, 1.0, 0.975],
  [1.015, 1.0, 0.996],
  [0.99, 1.0, 1.02],
  [0.975, 0.995, 1.04],
];

function styleMult(style: number, phase: number): number {
  const [a, b, c] = STYLE_CURVE[style] ?? [1, 1, 1];
  if (phase < 0.3) return a;
  if (phase < 0.45) return a + ((b - a) * (phase - 0.3)) / 0.15;
  if (phase < 0.7) return b;
  if (phase < 0.8) return b + ((c - b) * (phase - 0.7)) / 0.1;
  return c;
}

/** その馬のこのレースでの速さ（m/秒） */
function baseSpeed(h: KbHorse, race: KbRaceInfo): number {
  const distOff = Math.abs(h.apt - distClass(race.dist));
  const surfOk = h.surf === 2 || h.surf === race.surface;
  // 重い馬場は、スタミナのある馬とダートの得意な馬が少し強い
  const heavy = race.going * (h.sta - 1) * 0.01 + (race.going > 0 && h.surf !== 0 ? 0.002 * race.going : 0);
  return 16.6 * h.spd * (1 + h.cond * 0.002) * (1 - distOff * 0.004) * (surfOk ? 1 : 0.994) * (1 + heavy) * (race.surface === 1 ? 0.97 : 1) * (1 - race.going * 0.008);
}

export type KbSim = {
  /** 着順（馬番） */
  order: number[];
  /** 走破タイム（秒）。馬番 - 1 の順 */
  times: number[];
  /** 動き（記録の間隔ごとの位置。1000 = ゴール）と、内ラチからの距離（10 倍した m）。馬番 - 1 の順 */
  frames?: number[][];
  lanes?: number[][];
  /** 記録の間隔（レースの中の秒） */
  frameSec?: number;
  /** 先頭の 200m ごとのラップ（秒） */
  laps?: number[];
  /** 上がり 3 ハロン（最後の 600m の秒）。馬番 - 1 の順 */
  last3f?: number[];
  /** 通過順（コーナーごとの順位）。馬番 - 1 の順 */
  corners?: number[][];
  /** 出遅れた馬（馬番） */
  late?: number[];
  /** 実況に使う: 先頭が x m に来たレースの中の秒 */
  leadAt?: (m: number) => number;
};

/**
 * 1 回走らせる。record なら、画面に出す動き（frames・lanes）と、ラップ・通過順なども返す。
 * - 位置は内ラチを走ったときの距離。カーブで外を回ると、そのぶん進みが少ない
 * - 前に馬がいて詰まったら、外が空いていれば外へ出す。空いていなければ前の馬に合わせて待つ
 * - 先行馬は内ラチ沿いへ、差し・追込は最後の直線で外へ持ち出す
 */
export function simulate(race: KbRaceInfo, horses: readonly KbHorse[], rand: () => number, record = false, dt = 0.2): KbSim {
  const D = race.dist;
  const n = horses.length;
  const v0 = horses.map((h) => baseSpeed(h, race));
  // スタミナが切れはじめるところ（長い距離ほど早い）
  const tired = horses.map((h) => Math.min(1.2, Math.max(0.5, (h.sta * 1800) / D)));
  // その日のでき（レースごとに変わる）
  const day = horses.map(() => 1 + (rand() + rand() + rand() - 1.5) * 0.012);
  const noise = horses.map(() => (rand() - 0.5) * 0.01);
  // 出遅れ（たまに）。ほかはゲートの出方に少し差
  const late = horses.map(() => rand() < 0.07);
  const gate = horses.map((_, i) => (late[i] ? 0.78 + rand() * 0.1 : 0.97 + rand() * 0.06));
  const x = horses.map(() => 0);
  const lane = horses.map((_, i) => i * 1.1);
  const fin: (number | undefined)[] = horses.map(() => undefined);
  const hist: number[][] = horses.map(() => []);
  const laneHist: number[][] = horses.map(() => []);
  // 200m ごと・コーナーを通った時刻（馬ごと）
  const marks200 = Math.floor(D / 200);
  const cross: number[][] = horses.map(() => Array(marks200 + 1).fill(Infinity));
  const cornerAt: number[] = [];
  for (let k = 0; k < 3; k++) for (const c of CORNERS) {
    const xc = ((c.at - startOf(D) + KB_LAP) % KB_LAP) + k * KB_LAP;
    if (xc > 50 && xc < D - 50) cornerAt.push(xc);
  }
  cornerAt.sort((a, b) => a - b);
  const cornerCross: number[][] = horses.map(() => cornerAt.map(() => Infinity));
  const vNow = horses.map(() => 0);
  let t = 0;
  while (fin.some((f) => f === undefined) && t < 400) {
    if (record) for (let i = 0; i < n; i++) {
      hist[i]!.push(x[i]!);
      laneHist[i]!.push(lane[i]!);
    }
    // 1. 走りたい速さ
    const want = horses.map((h, i) => {
      const phase = Math.min(1.1, x[i]! / D);
      noise[i] = Math.max(-0.025, Math.min(0.025, noise[i]! * 0.97 + (rand() - 0.5) * 0.006));
      const fade = 1 - Math.max(0, phase - tired[i]!) * 0.04;
      const accel = Math.min(1, ((t + dt) / 2.2) * gate[i]!);
      const kick = phase > 0.82 && phase < 1 ? (rand() - 0.5) * (h.style >= 2 ? 0.03 : 0.018) : 0;
      return v0[i]! * day[i]! * styleMult(h.style, phase) * fade * (1 + noise[i]! + kick) * accel * (fin[i] !== undefined ? 0.55 : 1);
    });
    // 2. 前の馬から順に、詰まり・外へ出す・内へ寄せる
    const byPos = [...Array(n).keys()].sort((a, b) => x[b]! - x[a]!);
    for (const i of byPos) {
      const p = lapPos(D, x[i]!);
      const remain = D - x[i]!;
      const ahead = byPos.filter((j) => j !== i && x[j]! > x[i]! && x[j]! - x[i]! < 2.8 && Math.abs(lane[j]! - lane[i]!) < 1.3);
      const free = (l: number) => l >= 0 && l <= 14 && !byPos.some((j) => j !== i && Math.abs(x[j]! - x[i]!) < 2.6 && Math.abs(lane[j]! - l) < 1.2);
      let v = want[i]!;
      if (ahead.length && fin[i] === undefined) {
        const front = ahead.reduce((a, b) => (x[a]! < x[b]! ? a : b));
        if (v > vNow[front]! * 1.003 && free(lane[i]! + 1.3)) {
          // 外へ持ち出す（少し損をする）
          lane[i] = Math.min(14, lane[i]! + 1.1 * dt);
          v *= 0.995;
        } else if (v > vNow[front]!) v = Math.max(vNow[front]! * 0.995, v * 0.96);
      } else if (fin[i] === undefined) {
        // 最後の直線: 差し・追込は外へ。ほかは内へ寄せる
        const straight = !onTurn(p) && remain < 500;
        const target = straight && horses[i]!.style >= 2 ? 3 + horses[i]!.style * 1.5 : horses[i]!.style <= 1 ? 0 : 1.2;
        if (lane[i]! > target + 0.3 && free(lane[i]! - 1)) lane[i] = Math.max(target, lane[i]! - 0.5 * dt);
        else if (lane[i]! < target - 0.3 && free(lane[i]! + 1.3)) lane[i] = Math.min(target, lane[i]! + 0.8 * dt);
      }
      vNow[i] = v;
      // カーブは外を回るぶん進みが少ない
      const dx = v * dt * (onTurn(p) ? TURN_R / (TURN_R + lane[i]!) : 1);
      const nx = x[i]! + dx;
      if (fin[i] === undefined && nx >= D) fin[i] = t + ((D - x[i]!) / dx) * dt;
      if (record) {
        for (let m = Math.floor(x[i]! / 200) + 1; m * 200 <= Math.min(nx, D); m++) cross[i]![m] = t + ((m * 200 - x[i]!) / dx) * dt;
        cornerAt.forEach((xc, k) => {
          if (x[i]! < xc && nx >= xc) cornerCross[i]![k] = t;
        });
      }
      x[i] = nx;
    }
    t += dt;
  }
  if (record) for (let i = 0; i < n; i++) {
    hist[i]!.push(x[i]!);
    laneHist[i]!.push(lane[i]!);
  }
  const times = fin.map((f) => Math.round((f ?? 400) * 10) / 10);
  const order = horses
    .map((h, i) => ({ no: h.no, f: fin[i] ?? 400 }))
    .sort((a, b) => a.f - b.f || a.no - b.no)
    .map((r) => r.no);
  if (!record) return { order, times };
  // 先頭がゴールしてから 6 秒あと（レースの中の時間）まで。90 コマぐらいに間引く
  const leader = Math.min(...fin.map((f) => f ?? 400));
  const steps = Math.min(hist[0]!.length, Math.ceil((leader + 6) / dt) + 1);
  const every = Math.max(1, Math.round(leader / dt / 90));
  const thin = (rows: number[][], f: (v: number) => number) =>
    rows.map((row) => {
      const out: number[] = [];
      for (let k = 0; k < steps; k += every) out.push(f(row[k]!));
      return out;
    });
  const frames = thin(hist, (v) => Math.min(1080, Math.round((v / D) * 1000)));
  const lanes = thin(laneHist, (v) => Math.round(v * 10));
  const leadCross = Array.from({ length: marks200 + 1 }, (_, m) => (m === 0 ? 0 : Math.min(...cross.map((c) => c[m]!))));
  const laps = leadCross.slice(1).map((c, m) => Math.round((c - leadCross[m]!) * 10) / 10);
  const last3f = cross.map((c) => Math.round((c[marks200]! - c[marks200 - 3]!) * 10) / 10);
  const corners = horses.map((_, i) =>
    cornerAt.map((_, k) => {
      const mine = cornerCross[i]![k]!;
      return 1 + cornerCross.filter((cc, j) => j !== i && (cc[k]! < mine || (cc[k] === mine && x[j]! > x[i]!))).length;
    }),
  );
  const leadAt = (m: number) => {
    const k = Math.min(marks200, Math.max(0, Math.round(m / 200)));
    return leadCross[k]!;
  };
  return {
    order,
    times: fin.map((f) => f ?? 400),
    frames,
    lanes,
    frameSec: every * dt,
    laps,
    last3f,
    corners,
    late: horses.filter((_, i) => late[i]).map((h) => h.no),
    leadAt,
  };
}

/** 見込みを数える（何回も走らせる）。p = 1 着・p3 = 3 着以内、pairs2 = 1・2 着の 2 頭、pairs3 = 3 着以内の 2 頭 */
export function estimate(race: KbRaceInfo, horses: readonly KbHorse[], seed: number, runs = 400): { p: number[]; p3: number[]; pairs2: Map<string, number>; pairs3: Map<string, number> } {
  const rand = seeded(seed);
  const win = horses.map(() => 0);
  const top3 = horses.map(() => 0);
  const pairs2 = new Map<string, number>();
  const pairs3 = new Map<string, number>();
  for (let k = 0; k < runs; k++) {
    const { order } = simulate(race, horses, rand, false, 0.5);
    win[order[0]! - 1]!++;
    for (const no of order.slice(0, 3)) top3[no - 1]!++;
    const k2 = pairKey(order[0]!, order[1]!);
    pairs2.set(k2, (pairs2.get(k2) ?? 0) + 1);
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]] as const) {
      const k3 = pairKey(order[a]!, order[b]!);
      pairs3.set(k3, (pairs3.get(k3) ?? 0) + 1);
    }
  }
  const norm = (m: Map<string, number>) => new Map([...m].map(([key, v]) => [key, v / runs]));
  return { p: win.map((n) => n / runs), p3: top3.map((n) => n / runs), pairs2: norm(pairs2), pairs3: norm(pairs3) };
}

export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export const allPairs = (n = KB_HORSES) => {
  const out: string[] = [];
  for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) out.push(pairKey(a, b));
  return out;
};

// ───────── 実況 ─────────

const fmtSec = (s: number) => {
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(1);
  return m > 0 ? `${m} 分 ${r} 秒` : `${r} 秒`;
};

/**
 * 実況（レースの中の何秒目に何を言うか）。toMs でレースの中の秒を画面の ms にする
 */
export function commentary(race: KbRaceInfo, horses: readonly KbHorse[], sim: KbSim, toMs: (sec: number) => number): { t: number; text: string }[] {
  const D = race.dist;
  const label = (no: number) => `${'①②③④⑤⑥⑦⑧'[no - 1]}${horses[no - 1]!.name}`;
  const frames = sim.frames!;
  const fsec = sim.frameSec!;
  const rankAtSec = (sec: number) => {
    const k = Math.min(frames[0]!.length - 1, Math.round(sec / fsec));
    return horses
      .map((h, i) => ({ no: h.no, x: frames[i]![k]! }))
      .sort((a, b) => b.x - a.x)
      .map((r) => r.no);
  };
  const out: { t: number; text: string }[] = [];
  const say = (sec: number, text: string) => out.push({ t: Math.round(toMs(sec)), text });
  const where = D === 2400 ? 'スタンド前' : D === 1200 ? '向こう正面' : D === 1600 ? '2 コーナーの奥' : 'ゴール板の前';
  say(0, `${where}からスタート！ ${KB_SURFACES[race.surface]} ${D}m、各馬いっせいに飛び出しました！`);
  if (sim.late?.length) say(1.5, `${sim.late.map(label).join('、')} は出遅れた！ 後ろからの競馬になります`);
  const s1 = sim.leadAt!(Math.min(400, D * 0.2));
  const r1 = rankAtSec(s1);
  say(s1, `ハナを切ったのは ${label(r1[0]!)}。2 番手に ${label(r1[1]!)}、その外 ${label(r1[2]!)}`);
  if (D >= 1600) {
    const s2 = sim.leadAt!(1000);
    const r2 = rankAtSec(s2);
    const pace = s2 / (1000 / 16.4) < 0.985 ? 'ハイペース！' : s2 / (1000 / 16.4) > 1.015 ? 'ゆったりしたペース' : '平均的なペース';
    say(s2, `1000m の通過は ${fmtSec(s2)}、${pace}。先頭から ${r2.slice(0, 4).map((no) => '①②③④⑤⑥⑦⑧'[no - 1]).join('、')}、最後方に ${label(r2.at(-1)!)}`);
  }
  const s3 = sim.leadAt!(D - 600);
  const r3 = rankAtSec(s3);
  say(s3, `3 コーナーから 4 コーナーへ！ 先頭は ${label(r3[0]!)}、${label(r3[1]!)} が並びかける。後ろの馬も動いた！`);
  const s4 = sim.leadAt!(D - 400);
  const r4 = rankAtSec(s4);
  say(s4, `最後の直線に向いた！ 残り 400、先頭は ${label(r4[0]!)}！ ${label(r4[1]!)}、${label(r4[2]!)} も来ている！`);
  const s5 = sim.leadAt!(D - 200);
  const r5 = rankAtSec(s5);
  const riser = r5.slice(0, 3).find((no) => r3.indexOf(no) - r5.indexOf(no) >= 3);
  say(s5, riser ? `残り 200！ 外から ${label(riser)}、すごい脚で上がってくる！` : `残り 200！ ${label(r5[0]!)} 粘る！ ${label(r5[1]!)} が迫る！ 叩き合い！`);
  const order = sim.order;
  const gap = sim.times[order[1]! - 1]! - sim.times[order[0]! - 1]!;
  const end = Math.min(...sim.times);
  say(
    end,
    gap < 0.05
      ? `ほとんど並んでゴールイン！ 写真判定です！ …1 着は ${label(order[0]!)}！ 2 着 ${label(order[1]!)}、3 着 ${label(order[2]!)}`
      : `${label(order[0]!)}、1 着でゴールイン！ 2 着は ${label(order[1]!)}、3 着 ${label(order[2]!)}！`,
  );
  return out.sort((a, b) => a.t - b.t);
}

// ───────── 賭けとオッズ ─────────

/**
 * 賭け方ごとの、賭けられた銭（BOT のお客さんの分を含む）。単勝・複勝は馬番 - 1、ほかは組の書き方（comboKey）。
 * 馬単・3 連複・3 連単は、前からある受付中のレースにはない（なければ空）
 */
export type KbPools = {
  win: number[];
  place: number[];
  quinella: Record<string, number>;
  wide: Record<string, number>;
  exacta?: Record<string, number>;
  trio?: Record<string, number>;
  trifecta?: Record<string, number>;
};
type ComboType = Exclude<KbBetType, 'win' | 'place'>;
const comboPool = (p: KbPools, t: ComboType): Record<string, number> => p[t] ?? {};

/** 順番どおりの組を全部（n 頭から k 頭） */
export function allOrdered(k: number, n = KB_HORSES): number[][] {
  const out: number[][] = [];
  const walk = (cur: number[]) => {
    if (cur.length === k) return void out.push(cur);
    for (let no = 1; no <= n; no++) if (!cur.includes(no)) walk([...cur, no]);
  };
  walk([]);
  return out;
}

/** 1 着になる見込みから、着順どおりになる見込み（ハービル: 残った馬の中で 1 着になる見込みで順に決まる） */
export function harville(p: readonly number[], order: readonly number[]): number {
  let rest = 1;
  let out = 1;
  for (const no of order) {
    const q = p[no - 1] ?? 0;
    if (rest <= 0) return 0;
    out *= q / rest;
    rest -= q;
  }
  return out;
}

/** BOT のお客さんの賭け（見込みの割合で KB_SEED を分ける。どの馬・組にも 1 は置く） */
export function seedPools(est: ReturnType<typeof estimate>, seed = KB_SEED): KbPools {
  const split = (w: number[]) => {
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((x) => Math.max(1, Math.round((seed * x) / sum)));
  };
  const keys = allPairs();
  const q = split(keys.map((k) => est.pairs2.get(k) ?? 0.0005));
  const w = split(keys.map((k) => est.pairs3.get(k) ?? 0.0005));
  // 馬単・3 連複・3 連単は、1 着の見込みからハービルで（組が多いので、走らせた回数では足りない）
  const pw = est.p.map((x) => Math.max(x, 0.002));
  const sum = pw.reduce((a, b) => a + b, 0);
  const pn = pw.map((x) => x / sum);
  const ordered = (k: number) => {
    const combos = allOrdered(k, pn.length);
    const v = split(combos.map((o) => harville(pn, o)));
    return combos.map((o, i) => [o, v[i]!] as const);
  };
  const ex = ordered(2);
  const tf = ordered(3);
  const trioW = new Map<string, number>();
  for (const [o] of tf) trioW.set(comboKey('trio', o), (trioW.get(comboKey('trio', o)) ?? 0) + harville(pn, o));
  const trioKeys = [...trioW.keys()];
  const tr = split(trioKeys.map((k) => trioW.get(k)!));
  return {
    win: split(pw),
    place: split(est.p3.map((x) => Math.max(x, 0.004))),
    quinella: Object.fromEntries(keys.map((k, i) => [k, q[i]!])),
    wide: Object.fromEntries(keys.map((k, i) => [k, w[i]!])),
    exacta: Object.fromEntries(ex.map(([o, v]) => [comboKey('exacta', o), v])),
    trio: Object.fromEntries(trioKeys.map((k, i) => [k, tr[i]!])),
    trifecta: Object.fromEntries(tf.map(([o, v]) => [comboKey('trifecta', o), v])),
  };
}

export function poolTotal(p: KbPools, t: KbBetType): number {
  const v = t === 'win' ? p.win : t === 'place' ? p.place : Object.values(comboPool(p, t));
  return v.reduce((a, b) => a + b, 0);
}

export function stakeOn(p: KbPools, t: KbBetType, key: string): number {
  if (t === 'win' || t === 'place') return (t === 'win' ? p.win : p.place)[Number(key) - 1] ?? 0;
  return comboPool(p, t)[key] ?? 0;
}

export function addToPool(p: KbPools, t: KbBetType, key: string, amount: number): void {
  if (t === 'win' || t === 'place') (t === 'win' ? p.win : p.place)[Number(key) - 1]! += amount;
  else {
    const m = (p[t] ??= {});
    m[key] = (m[key] ?? 0) + amount;
  }
}

/** 10 倍した倍率（0.1 倍きざみで切り捨て。1.0 倍より下にはしない） */
const odds10 = (x: number) => Math.max(10, Math.floor(x * 10 + 1e-9));

/** 1 頭（1 組）だけが当たる賭け（単勝・馬連）の倍率 */
function singleOdds(total: number, stake: number): number {
  return stake > 0 ? odds10((total * (1 - KB_TAKE)) / stake) : 10;
}

/** 3 頭（3 組）が当たる賭け（複勝・ワイド）の倍率: 当たった分を返した残りを 3 つに分ける */
function shareOdds(total: number, stake: number, winners: number[]): number {
  const profit = total * (1 - KB_TAKE) - winners.reduce((a, b) => a + b, 0);
  if (stake <= 0 || profit <= 0) return 10;
  return odds10(1 + profit / 3 / stake);
}

/** いまのオッズ（発走前）。1 つだけ当たる賭け方は 1 つ、複勝・ワイドは「いちばん低い〜高い」の幅 */
export function liveOdds(p: KbPools, t: KbBetType, key: string): { lo: number; hi: number } {
  const total = poolTotal(p, t);
  const s = stakeOn(p, t, key);
  if (t !== 'place' && t !== 'wide') {
    const o = singleOdds(total, s);
    return { lo: o, hi: o };
  }
  // ほかに当たる 2 つ: 多く賭けられた 2 つなら低く、少ない 2 つなら高い
  const others = (t === 'place' ? p.place.map((v, i) => [String(i + 1), v] as const) : Object.entries(p.wide)).filter(([k]) => k !== key && (t === 'place' || !sharesNone(k, key))).map(([, v]) => v);
  others.sort((a, b) => b - a);
  const lo = shareOdds(total, s, [s, ...others.slice(0, 2)]);
  const hi = shareOdds(total, s, [s, ...others.slice(-2)]);
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

/** ワイドで同時に当たりうる組か（2 つの組が 3 着以内の 3 頭に収まる = 1 頭は同じ） */
const sharesNone = (a: string, b: string) => {
  const [a1, a2] = a.split('-');
  const [b1, b2] = b.split('-');
  return a1 !== b1 && a1 !== b2 && a2 !== b1 && a2 !== b2;
};

/** 確定した払い戻し（10 倍した倍率）。order は着順の馬番 */
export function finalOdds(
  p: KbPools,
  order: readonly number[],
): { win: [number, number]; place: [number, number][]; quinella: [string, number]; wide: [string, number][]; exacta?: [string, number]; trio?: [string, number]; trifecta?: [string, number] } {
  const [a, b, c] = order as [number, number, number];
  const top3 = [a, b, c];
  const placeStakes = top3.map((no) => p.place[no - 1]!);
  const placeTotal = poolTotal(p, 'place');
  const q = pairKey(a, b);
  const wides = [pairKey(a, b), pairKey(a, c), pairKey(b, c)];
  const wideStakes = wides.map((k) => p.wide[k] ?? 0);
  const wideTotal = poolTotal(p, 'wide');
  const one = (t: 'exacta' | 'trio' | 'trifecta', nos: number[]): [string, number] => {
    const k = comboKey(t, nos);
    return [k, singleOdds(poolTotal(p, t), stakeOn(p, t, k))];
  };
  return {
    win: [a, singleOdds(poolTotal(p, 'win'), p.win[a - 1]!)],
    place: top3.map((no, i) => [no, shareOdds(placeTotal, placeStakes[i]!, placeStakes)]),
    quinella: [q, singleOdds(poolTotal(p, 'quinella'), p.quinella[q] ?? 0)],
    wide: wides.map((k, i) => [k, shareOdds(wideTotal, wideStakes[i]!, wideStakes)]),
    exacta: one('exacta', [a, b]),
    trio: one('trio', top3),
    trifecta: one('trifecta', top3),
  };
}

export type KbFinal = ReturnType<typeof finalOdds>;

/** 1 枚の当たり（10 倍した倍率。はずれは 0） */
export function ticketOdds(f: KbFinal, t: KbBetType, key: string): number {
  if (t === 'win') return f.win[0] === Number(key) ? f.win[1] : 0;
  if (t === 'place') return f.place.find(([no]) => no === Number(key))?.[1] ?? 0;
  if (t === 'quinella') return f.quinella[0] === key ? f.quinella[1] : 0;
  if (t === 'wide') return f.wide.find(([k]) => k === key)?.[1] ?? 0;
  const hit = f[t];
  return hit && hit[0] === key ? hit[1] : 0;
}

export const fmtOdds = (o10: number) => (o10 / 10).toFixed(1);

/** 走破タイム（1:34.5） */
export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** 着差（前の馬とのタイム差から。1 馬身 ≒ 0.17 秒） */
export function margin(diff: number): string {
  const lengths = diff / 0.17;
  if (lengths < 0.05) return 'ハナ';
  if (lengths < 0.15) return 'アタマ';
  if (lengths < 0.3) return 'クビ';
  if (lengths < 0.6) return '1/2';
  if (lengths < 0.85) return '3/4';
  if (lengths < 1.25) return '1';
  if (lengths < 1.75) return '1 1/2';
  if (lengths < 2.5) return '2';
  if (lengths < 3.5) return '3';
  if (lengths < 4.5) return '4';
  if (lengths < 7.5) return '5';
  return '大差';
}

/** 予想の印（見込みの高い順に ◎○▲△△） */
export function marks(horses: readonly KbHorse[]): Map<number, string> {
  const sorted = [...horses].sort((a, b) => b.p - a.p);
  const m = new Map<number, string>();
  ['◎', '○', '▲', '△', '△'].forEach((mk, i) => sorted[i] && m.set(sorted[i]!.no, mk));
  return m;
}

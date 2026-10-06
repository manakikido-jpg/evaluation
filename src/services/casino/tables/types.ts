import type { CasinoGame, GuildConfig, TableKind } from '../../../config.js';
import type { Rng } from '../cards.js';
import type { KbStable } from '../keiba.js';

/**
 * みんなで座る卓の決まりごと。ゲームごとに「状態 → 次の状態」を返す関数だけを書き、
 * 銭の出し入れ（fx）は卓のサービスが同じトランザクションでまとめて行う。
 */

export type Who = { id: string; name: string };

/** 引く銭（足りなければ動かさない）。limited: 1 日の上限に数える */
export type Debit = { memberId: string; amount: number; reason: 'casino_bet' | 'casino_buyin' | 'casino_hold'; limited: boolean };
export type Credit = {
  memberId: string;
  amount: number;
  reason: 'casino_win' | 'casino_refund' | 'casino_cashout' | 'keiba_prize';
  /** 胴元が出す最低保証の賞金（1 人 1 日の上限まで） */
  cap?: 'keiba_purse';
};
/** カジノの収支（運営の画面）に入れる 1 回分 */
export type PlayRecord = { memberId: string; game: CasinoGame; bet: number; payout: number };
/** 🀄 麻雀の戦績（終局のとき 1 人 1 行） */
export type MahjongResult = { memberId: string; name: string; rank: number; points: number; length: string; players: number; entry: number; payout: number; hands: number; wins: number; tsumo: number; dealins: number; riichi: number; bestPoints: number; bestName: string | null };
/** 🏇 名簿の馬の 1 走（レースが終わったとき 1 頭 1 行） */
export type KeibaResult = {
  horseId: number;
  pos: number;
  race: string;
  dist: number;
  surface: number;
  prize?: number;
  ownerId?: string | null;
  name?: string;
  cls?: number;
  /** 成績ページ用: 馬場・頭数・馬番・人気・単勝（10 倍）・タイム・着差・上がり 3F（10 倍）・通過順 */
  going?: number;
  field?: number;
  no?: number;
  pop?: number;
  odds?: number;
  time?: string;
  margin?: string;
  last3f?: number;
  corners?: string;
};
/** メンバーの馬券 1 枚（結果が出たとき） */
export type KeibaBet = { memberId: string; race: string; cls: number; type: string; key: string; names: string; amount: number; odds: number; payout: number };
/**
 * 🤖 AI（BOT）と人の勝負の記録（人と AI が両方いた勝負だけ。1 勝負 1 行）。AI の強さを直すときに使う。
 * place: 順位（1 から。ポーカーは 1 手ごとで、勝った人が 1・ほかは 2）。net: その勝負での増減（銭・ポーカーはチップ）
 */
export type AiMatch = { game: string; variant: string; aiVersion: string; seats: { id: string; name: string; bot: boolean; place: number; net: number; left?: boolean }[] };

export type Effects = { debits?: Debit[]; credits?: Credit[]; records?: PlayRecord[]; mahjong?: MahjongResult[]; keiba?: KeibaResult[]; keibaBets?: KeibaBet[]; aiMatch?: AiMatch[] };

export type Step<S> = { ok: true; state: S; fx?: Effects } | { ok: false; error: string };
export const ok = <S>(state: S, fx?: Effects): Step<S> => ({ ok: true, state, fx });
export const fail = <S = never>(error: string): Step<S> => ({ ok: false, error });

/** フォームから来た値 */
export type Form = Record<string, string | string[] | undefined>;
export const str = (f: Form, k: string) => {
  const v = f[k];
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
};
export const list = (f: Form, k: string) => {
  const v = f[k];
  return Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
};
export const intOf = (f: Form, k: string) => {
  const v = str(f, k);
  return v && /^\d{1,9}$/.test(v) ? Number(v) : NaN;
};

/** roster: 🏇 競馬の名簿の馬（競馬の卓のときだけ、卓のサービスが読み込んで渡す） */
export type Ctx = { now: number; rng: Rng; cfg: GuildConfig; roster?: KbStable[] };

/** 持ち時間の長さ（卓を立てる人が選ぶ）。ふつうの何倍か */
export const PACES = { normal: { label: 'ふつう', mult: 1 }, slow: { label: 'ゆっくり', mult: 2 }, relaxed: { label: 'のんびり', mult: 4 } } as const;
export type Pace = keyof typeof PACES;
export const paceOf = (f: Form): Pace => {
  const v = str(f, 'pace');
  return v && Object.hasOwn(PACES, v) ? (v as Pace) : 'normal';
};
/** 状態に入っている持ち時間の倍率（前に作った卓は「ふつう」） */
export const paceMult = (s: { pace?: Pace }) => PACES[s.pace ?? 'normal']?.mult ?? 1;

export interface TableEngine<S> {
  kind: TableKind;
  maxSeats: number;
  /** 卓を作る（作った人も座る） */
  create(host: Who, form: Form, ctx: Ctx): Step<S>;
  join(s: S, who: Who, form: Form, ctx: Ctx): Step<S>;
  leave(s: S, memberId: string, ctx: Ctx): Step<S>;
  act(s: S, memberId: string, form: Form, ctx: Ctx): Step<S>;
  /** 時間で進める（持ち時間切れ・次の回）。何もなければ null */
  tick(s: S, ctx: Ctx): Step<S> | null;
  /** 次に時間で動く時刻（ms） */
  due(s: S): number | null;
  /** 座っている人 */
  seats(s: S): string[];
  /** 閉じてよいか（だれもいない・終わった） */
  closed(s: S, now: number): boolean;
}

/** 卓の説明（ロビー） */
export const TABLE_LABEL: Record<TableKind, { emoji: string; name: string; note: string; players: string }> = {
  bj_table: { emoji: '🃏', name: 'ブラックジャック卓', note: 'みんなで同じディーラーと勝負', players: '1〜5 人' },
  baccarat_table: { emoji: '🎴', name: 'バカラ卓', note: 'みんなで同じ勝負に賭ける', players: '1〜8 人' },
  roulette_table: { emoji: '🎡', name: 'ルーレット卓', note: 'みんなで同じ回転に賭ける', players: '1〜8 人' },
  chinchiro_table: { emoji: '🎲', name: 'ちんちろ卓', note: 'みんなで同じ親にサイコロで挑む', players: '1〜6 人' },
  poker: { emoji: '♠\uFE0F', name: 'ポーカー', note: 'テキサスホールデム。持ち込んだ銭で賭け合う', players: '2〜6 人' },
  daifugo: { emoji: '👑', name: '大富豪', note: '早く上がった順に賞金', players: '3〜5 人' },
  babanuki: { emoji: '🤡', name: 'ババ抜き', note: '最後にババを持っていた人の負け', players: '2〜5 人' },
  mahjong: { emoji: '🀄', name: '麻雀', note: '4 人打ち・3 人打ち（サンマ）のリーチ麻雀。足りない席は BOT', players: '1〜4 人（残りは BOT）' },
  keiba: { emoji: '🏇', name: 'みんなでダービー', note: '8 頭のレースにみんなで賭けて、同じレースを見る', players: '1〜30 人（見るだけもできる）' },
};

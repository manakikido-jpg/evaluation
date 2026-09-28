/** ⏳ 一時的な権限の期間と種類（コマンドの選択肢にも使うので、ほかを読み込まない） */

export const DURATIONS = [
  ['10m', '10 分', 10],
  ['30m', '30 分', 30],
  ['1h', '1 時間', 60],
  ['3h', '3 時間', 180],
  ['6h', '6 時間', 360],
  ['12h', '12 時間', 720],
  ['1d', '1 日', 1440],
  ['3d', '3 日', 4320],
  ['7d', '7 日', 10080],
  ['30d', '30 日', 43200],
] as const;
export type DurationKey = (typeof DURATIONS)[number][0];
export const durationMinutes = (key: unknown): number | undefined => DURATIONS.find((d) => d[0] === key)?.[2];

const bit = (n: number) => 1n << BigInt(n);
const VIEW = bit(10) | bit(16);
const WRITE = bit(11) | bit(38) | bit(35) | bit(6) | bit(14) | bit(15);

export const PERM_PRESETS = {
  write: { label: '✍ 書き込める', note: '読むだけのチャンネルでも、メッセージ・スレッド・リアクション・添付ができる', allow: VIEW | WRITE, deny: 0n },
  view: { label: '👀 見られる', note: '見えないチャンネルを見られる（書き込みはチャンネルのまま）', allow: VIEW, deny: 0n },
  speak: { label: '🎙 通話で話せる', note: '通話に入って話せる・画面共有できる', allow: bit(10) | bit(20) | bit(21) | bit(9) | bit(25), deny: 0n },
  manage: { label: '🧹 メッセージの管理', note: 'メッセージの削除・ピン留めができる', allow: VIEW | bit(13), deny: 0n },
  mute: { label: '🔇 書き込み禁止', note: 'そのチャンネルでだけ、書き込み・リアクション・通話で話すのを止める', allow: 0n, deny: WRITE | bit(36) | bit(21) },
} as const;
export type PermPreset = keyof typeof PERM_PRESETS;
export const isPermPreset = (v: unknown): v is PermPreset => typeof v === 'string' && Object.hasOwn(PERM_PRESETS, v);


import type { GuildConfig } from '../config.js';

/**
 * 👹 厄（厄年ロールがある人）の制限（本人の決定 2026-11-26）。
 * - 通話は縁側だけ（ほかの通話に入ると切る）。銭の決まりは変えない。
 * - 使えるのは、お問い合わせ（チケット）・おみくじ・物御籤（ガチャ）だけ。授与所は「厄祓い」だけ買える。
 * - カジノ・市場・キャスト・宿・送金・贈り物・お年玉（受け取りも）・募集・朱印/結び・絵馬は使えない。
 * - 厄祓い（10000銭）を買うと面接待ちになり、運営が面接して祓う。
 */
export function isYakudoshi(cfg: Pick<GuildConfig, 'roles'>, roleIds: Iterable<string>): boolean {
  const id = cfg.roles.yakudoshi;
  if (!id) return false;
  for (const r of roleIds) if (r === id) return true;
  return false;
}

/** 止めたときの案内（やさしい日本語） */
export const YAKU_BLOCKED = '👹 厄のあいだは使えません。使えるのは、お問い合わせ・おみくじ・物御籤だけです（厄祓いは授与所から）。';

/** 厄のあいだ止めるコマンド（運営はのぞく）。送金・市場・キャスト・カジノ・神符合戦・じゃんけん・贈る */
export const YAKU_BLOCKED_COMMANDS: ReadonlySet<string> = new Set(['sokin', 'ichiba', 'cast', 'casino', 'shinpu', 'janken', 'present']);

/** 厄のあいだ止めるボタン・メニュー（customId の頭）。お年玉は置くのも受け取るのも止める */
export const YAKU_BLOCKED_PREFIXES: readonly string[] = [
  'sokin:',
  'koban:',
  'market:',
  'cast:',
  'present:',
  'items:give:',
  'items:to:',
  'items:count:',
  'otoshi:',
  'janken:',
  'lottery:',
  'ema:give:',
  'ema:modal:',
  'ema:pick:',
  'ema:edit:',
  'ema:vote:',
];

/** そのコマンド・ボタンが厄のあいだ止めるものか（授与所は shop.ts で厄祓いだけ通す） */
export function yakuBlocks(action: { command?: string; customId?: string }): boolean {
  if (action.command && YAKU_BLOCKED_COMMANDS.has(action.command)) return true;
  const id = action.customId;
  return Boolean(id && YAKU_BLOCKED_PREFIXES.some((p) => id.startsWith(p)));
}

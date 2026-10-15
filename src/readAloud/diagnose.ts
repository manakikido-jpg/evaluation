/**
 * 起動に失敗したわけを、秘密（トークン）を出さずに短い言葉にする。
 * discord.js のエラーは code（TokenInvalid など）か、Gateway の閉じたコード（4014 など）だけを見る。本文は出さない。
 */
export type StartupStage = 'env' | 'login' | 'duplicate' | 'guild' | 'command';

const CLOSE: Record<number, string> = {
  4004: 'token_invalid',
  4013: 'intents_invalid',
  4014: 'intents_disallowed',
};

export function startupReason(err: unknown): string {
  if (!err || typeof err !== 'object') return 'unknown';
  const e = err as { code?: unknown; name?: unknown };
  if (typeof e.code === 'number' && CLOSE[e.code]) return CLOSE[e.code]!;
  if (e.code === 'TokenInvalid') return 'token_invalid';
  if (typeof e.code === 'number') return `discord_${e.code}`;
  if (typeof e.code === 'string' && /^[A-Za-z_]{1,40}$/.test(e.code)) return e.code;
  return 'unknown';
}

/** ログに出す日本語の案内（値は入れない） */
export const STAGE_HINT: Record<StartupStage, string> = {
  env: '環境設定（/etc/sakura/read-aloud.env）の形がちがう',
  login: 'BOT がログインできない（トークンの間違い・MESSAGE CONTENT INTENT がオフ）',
  duplicate: '同じ BOT のトークンが 2 回入っている',
  guild: 'BOT が対象サーバーにいない（招待していない・サーバーIDの間違い）',
  command: '壱の BOT が /読み上げ を登録できない（applications.commands のスコープがない）',
};

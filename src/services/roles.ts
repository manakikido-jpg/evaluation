import type { GuildConfig } from '../config.js';
import type { GuildRole } from '../lib/discordRest.js';

/**
 * ロールの一覧・権限（管理画面の「ロール」ページ）。
 * 権限は Discord のビット。名前は Discord の日本語表示に合わせる。
 */

export type PermDef = { bit: number; label: string; danger?: boolean };
export type PermGroup = { title: string; perms: PermDef[] };

export const PERMISSION_GROUPS: PermGroup[] = [
  {
    title: 'サーバー全般',
    perms: [
      { bit: 10, label: 'チャンネルを見る' },
      { bit: 4, label: 'チャンネルの管理', danger: true },
      { bit: 28, label: 'ロールの管理', danger: true },
      { bit: 30, label: '絵文字・スタンプの管理' },
      { bit: 7, label: '監査ログを表示' },
      { bit: 29, label: 'ウェブフックの管理', danger: true },
      { bit: 5, label: 'サーバーの管理', danger: true },
    ],
  },
  {
    title: 'メンバー',
    perms: [
      { bit: 0, label: '招待を作成' },
      { bit: 26, label: 'ニックネームの変更' },
      { bit: 27, label: 'ニックネームの管理' },
      { bit: 1, label: 'メンバーをキック', danger: true },
      { bit: 2, label: 'メンバーを BAN', danger: true },
      { bit: 40, label: 'メンバーをタイムアウト' },
    ],
  },
  {
    title: 'テキスト',
    perms: [
      { bit: 11, label: 'メッセージを送信' },
      { bit: 38, label: 'スレッドでメッセージを送信' },
      { bit: 35, label: '公開スレッドの作成' },
      { bit: 36, label: 'プライベートスレッドの作成' },
      { bit: 14, label: '埋め込みリンク' },
      { bit: 15, label: 'ファイルを添付' },
      { bit: 6, label: 'リアクションの追加' },
      { bit: 18, label: '外部の絵文字を使用' },
      { bit: 17, label: '@everyone・@here・全ロールにメンション', danger: true },
      { bit: 13, label: 'メッセージの管理' },
      { bit: 34, label: 'スレッドの管理' },
      { bit: 16, label: 'メッセージ履歴を読む' },
      { bit: 31, label: 'アプリコマンドを使う' },
      { bit: 46, label: 'ボイスメッセージを送信' },
      { bit: 49, label: '投票の作成' },
    ],
  },
  {
    title: 'ボイス',
    perms: [
      { bit: 20, label: '接続' },
      { bit: 21, label: '発言' },
      { bit: 9, label: 'WEB カメラ・画面共有' },
      { bit: 25, label: '音声検出を使用' },
      { bit: 8, label: '優先スピーカー' },
      { bit: 22, label: 'メンバーをミュート' },
      { bit: 23, label: 'メンバーのスピーカーをミュート' },
      { bit: 24, label: 'メンバーを移動' },
      { bit: 42, label: 'サウンドボードを使用' },
      { bit: 39, label: 'アクティビティを使用' },
    ],
  },
  {
    title: 'イベント',
    perms: [
      { bit: 33, label: 'イベントの管理' },
      { bit: 44, label: 'イベントの作成' },
    ],
  },
  {
    title: '高度な権限',
    perms: [{ bit: 3, label: '管理者（すべての権限・どのチャンネルにも入れる）', danger: true }],
  },
];

export const ALL_PERMS: PermDef[] = PERMISSION_GROUPS.flatMap((g) => g.perms);
const KNOWN_MASK = ALL_PERMS.reduce((m, p) => m | (1n << BigInt(p.bit)), 0n);
export const ADMINISTRATOR = 1n << 3n;

export const permsOf = (role: Pick<GuildRole, 'permissions'>) => BigInt(role.permissions ?? '0');
export const hasPerm = (bits: bigint, bit: number) => (bits & (1n << BigInt(bit))) !== 0n;

/** 一覧に出す「目立つ権限」（危ないもの） */
export function dangerLabels(bits: bigint): string[] {
  if (bits & ADMINISTRATOR) return ['管理者'];
  return ALL_PERMS.filter((p) => p.danger && hasPerm(bits, p.bit)).map((p) => p.label);
}

/** フォームで選んだビットから新しい権限。フォームにない（知らない）ビットは今のまま残す */
export function mergePermissions(current: bigint, selectedBits: number[]): bigint {
  const selected = selectedBits.filter((b) => ALL_PERMS.some((p) => p.bit === b)).reduce((m, b) => m | (1n << BigInt(b)), 0n);
  return (current & ~KNOWN_MASK) | selected;
}

/** 変わった権限の名前（記録用） */
export function permDiff(before: bigint, after: bigint): { added: string[]; removed: string[] } {
  return {
    added: ALL_PERMS.filter((p) => !hasPerm(before, p.bit) && hasPerm(after, p.bit)).map((p) => p.label),
    removed: ALL_PERMS.filter((p) => hasPerm(before, p.bit) && !hasPerm(after, p.bit)).map((p) => p.label),
  };
}

/** このサーバーでの役目（設定ファイルから） */
export function roleKind(cfg: GuildConfig, role: GuildRole): string | undefined {
  if (role.id === cfg.guildId) return 'みんな（@everyone）';
  if (role.tags?.bot_id) return 'BOT';
  if (role.managed) return 'Discord が管理（ブーストなど）';
  const rank = cfg.ranks.find((r) => r.roleId === role.id);
  if (rank) return rank.auto ? '役職（自動で昇格）' : '役職（運営）';
  const r = cfg.roles;
  if (role.id === r.yakudoshi) return '厄年';
  if (role.id === r.yoimairi) return '宵参り';
  if (role.id === r.male || role.id === r.female) return '性別';
  if (role.id === r.emaPending) return '絵馬待ち';
  if (role.id === r.guidePending) return '案内待ち';
  if (role.id === r.merchant) return '開業（市場）';
  if (r.contact && [...Object.values(r.contact.dm), ...Object.values(r.contact.friend)].includes(role.id)) return 'DM・フレンド';
  if ([...(cfg.admin?.shinshokuRoleIds ?? []), ...(cfg.admin?.gujiRoleIds ?? [])].includes(role.id)) return '運営（管理画面に入れる）';
  if (r.omamori.some((o) => o.roleId === role.id)) return 'お守り（募集の通知）';
  if (cfg.shop.colors.some((c) => c.roleId === role.id)) return '色守り（ショップ）';
  if (cfg.shop.titles.some((t) => t.roleId === role.id)) return '称号（ショップ）';
  return undefined;
}

/** この BOT のロールの位置（これ以上のロールは BOT が変えられない）。BOT の ID が分からなければ BOT のロールのいちばん上 */
export function botTopPosition(roles: GuildRole[], botId?: string): number {
  const mine = roles.filter((r) => r.tags?.bot_id && (!botId || r.tags.bot_id === botId));
  return Math.max(0, ...mine.map((r) => r.position));
}

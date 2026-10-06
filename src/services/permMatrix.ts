import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import type { ChannelOverwrite, GuildChannel } from '../lib/discordRest.js';

/**
 * 🧮 チャンネル権限のマトリクス（ロール 1 つ × チャンネル × 権限）と、権限テンプレートの一括適用。
 * 1 つのマスは、そのロールの「権限の上書き」の 1 ビット: 許可（allow）・拒否（deny）・中立（どちらもなし = カテゴリ・ほかのロールに従う）。
 * ほかのビット・ほかのロールの上書きはそのまま残す。
 */

export type PermScope = 'base' | 'text' | 'voice';
/** 番号（画面に出す）・Discord のビット・名前 */
export type MatrixPerm = { no: number; bit: number; key: string; /** 表の見出しに出す短い名前 */ short: string; label: string; scope: PermScope; note?: string };

export const MATRIX_PERMS: MatrixPerm[] = [
  { no: 1, bit: 10, key: 'ViewChannel', short: '閲覧', label: 'チャンネル閲覧', scope: 'base', note: 'チャンネルやメッセージ履歴を見る' },
  { no: 2, bit: 4, key: 'ManageChannels', short: 'チャンネル管理', label: 'チャンネル管理', scope: 'base' },
  { no: 3, bit: 28, key: 'ManageRoles', short: '権限管理', label: '権限の管理', scope: 'base' },
  { no: 4, bit: 29, key: 'ManageWebhooks', short: 'Webhook', label: 'ウェブフック管理', scope: 'base' },
  { no: 5, bit: 0, key: 'CreateInstantInvite', short: '招待', label: '招待の作成', scope: 'base' },
  { no: 6, bit: 11, key: 'SendMessages', short: '送信', label: 'メッセージ送信', scope: 'text' },
  { no: 7, bit: 38, key: 'SendMessagesInThreads', short: 'スレッド発言', label: 'スレッド発言', scope: 'text' },
  { no: 8, bit: 35, key: 'CreatePublicThreads', short: '公開スレッド', label: '公開スレッド作成', scope: 'text' },
  { no: 9, bit: 36, key: 'CreatePrivateThreads', short: '非公開スレッド', label: '非公開スレッド作成', scope: 'text' },
  { no: 10, bit: 14, key: 'EmbedLinks', short: '埋め込み', label: '埋め込みリンク', scope: 'text' },
  { no: 11, bit: 15, key: 'AttachFiles', short: '添付', label: 'ファイル添付', scope: 'text', note: '画像やファイルを送る' },
  { no: 12, bit: 6, key: 'AddReactions', short: 'リアクション', label: 'リアクション追加', scope: 'text' },
  { no: 13, bit: 18, key: 'UseExternalEmojis', short: '外部絵文字', label: '外部絵文字', scope: 'text' },
  { no: 14, bit: 37, key: 'UseExternalStickers', short: '外部スタンプ', label: '外部スタンプ', scope: 'text' },
  { no: 15, bit: 17, key: 'MentionEveryone', short: '全体メンション', label: '全体メンション', scope: 'text', note: '@everyone・@here・全ロール' },
  { no: 16, bit: 13, key: 'ManageMessages', short: 'メッセージ管理', label: 'メッセージ管理', scope: 'text' },
  { no: 17, bit: 34, key: 'ManageThreads', short: 'スレッド管理', label: 'スレッド管理', scope: 'text' },
  { no: 18, bit: 16, key: 'ReadMessageHistory', short: '過去ログ', label: '過去ログ閲覧', scope: 'text' },
  { no: 19, bit: 12, key: 'SendTTSMessages', short: 'TTS', label: 'TTS 送信', scope: 'text' },
  { no: 20, bit: 31, key: 'UseApplicationCommands', short: 'アプリ', label: 'アプリコマンド利用', scope: 'text' },
  { no: 21, bit: 46, key: 'SendVoiceMessages', short: 'ボイスメッセ', label: 'ボイスメッセージ送信', scope: 'text' },
  { no: 22, bit: 20, key: 'Connect', short: '接続', label: 'ボイス接続', scope: 'voice' },
  { no: 23, bit: 21, key: 'Speak', short: '発言', label: 'ボイス発言', scope: 'voice' },
  { no: 24, bit: 9, key: 'Stream', short: '画面共有', label: '画面共有・動画', scope: 'voice' },
  { no: 25, bit: 39, key: 'UseEmbeddedActivities', short: 'アクティビティ', label: 'アクティビティ利用', scope: 'voice' },
  { no: 26, bit: 25, key: 'UseVAD', short: '音声検出', label: '音声検出の使用', scope: 'voice' },
  { no: 27, bit: 8, key: 'PrioritySpeaker', short: '優先スピーカー', label: '優先スピーカー', scope: 'voice' },
  { no: 28, bit: 22, key: 'MuteMembers', short: 'ミュート', label: 'メンバーミュート', scope: 'voice' },
  { no: 29, bit: 23, key: 'DeafenMembers', short: 'スピーカーミュート', label: 'スピーカーミュート', scope: 'voice' },
  { no: 30, bit: 24, key: 'MoveMembers', short: '移動', label: 'メンバー移動', scope: 'voice' },
  { no: 31, bit: 48, key: 'SetVoiceChannelStatus', short: 'VCステータス', label: 'VC ステータス設定', scope: 'voice' },
];

export const SCOPE_LABEL: Record<PermScope, string> = { base: '📁 基本・共通権限', text: '💬 テキストチャンネル権限', voice: '🔊 ボイスチャンネル権限' };
/** はじめに出す列（主要 14 項目） */
export const MAIN_PERMS = [1, 6, 7, 11, 12, 15, 18, 20, 21, 22, 23, 24, 25, 26];

const mask = (bit: number) => 1n << BigInt(bit);
export const perm = (no: number) => MATRIX_PERMS.find((p) => p.no === no);

/** チャンネルの種類（テキスト・ボイス・カテゴリ） */
export const kindOf = (c: Pick<GuildChannel, 'type'>): 'text' | 'voice' | 'category' => (c.type === 4 ? 'category' : c.type === 2 || c.type === 13 ? 'voice' : 'text');

/** その権限がそのチャンネルにあるか（ボイスの権限はテキストにない。テキストの権限は通話のチャットにもある） */
export const applies = (p: Pick<MatrixPerm, 'scope'>, c: Pick<GuildChannel, 'type'>) => p.scope !== 'voice' || kindOf(c) !== 'text';

export type Cell = 'allow' | 'deny' | 'neutral';
export const isCell = (v: unknown): v is Cell => v === 'allow' || v === 'deny' || v === 'neutral';

export function cellOf(o: Pick<ChannelOverwrite, 'allow' | 'deny'> | undefined, bit: number): Cell {
  if (!o) return 'neutral';
  if (BigInt(o.allow) & mask(bit)) return 'allow';
  if (BigInt(o.deny) & mask(bit)) return 'deny';
  return 'neutral';
}

/** いくつかのビットを変えた allow・deny（ほかのビットはそのまま） */
export function withCells(o: Pick<ChannelOverwrite, 'allow' | 'deny'> | undefined, changes: { bit: number; cell: Cell }[]): { allow: string; deny: string } {
  let allow = BigInt(o?.allow ?? '0');
  let deny = BigInt(o?.deny ?? '0');
  for (const { bit, cell } of changes) {
    allow &= ~mask(bit);
    deny &= ~mask(bit);
    if (cell === 'allow') allow |= mask(bit);
    if (cell === 'deny') deny |= mask(bit);
  }
  return { allow: allow.toString(), deny: deny.toString() };
}

/** 中立 → 許可 → 拒否 → 中立 */
export const nextCell = (c: Cell): Cell => (c === 'neutral' ? 'allow' : c === 'allow' ? 'deny' : 'neutral');

/** 上書きの変え方（set: 付け直す / del: 消す（全部中立になった）/ null: 変わらない） */
export function planCells(
  ch: Pick<GuildChannel, 'type' | 'permission_overwrites'>,
  roleId: string,
  changes: { bit: number; cell: Cell }[],
): { set: ChannelOverwrite } | { del: string } | null {
  const before = (ch.permission_overwrites ?? []).find((o) => o.id === roleId);
  const usable = changes.filter((x) => {
    const p = MATRIX_PERMS.find((m) => m.bit === x.bit);
    return p && applies(p, ch);
  });
  if (!usable.length) return null;
  const next = withCells(before, usable);
  if (before && next.allow === before.allow && next.deny === before.deny) return null;
  if (!before && next.allow === '0' && next.deny === '0') return null;
  if (next.allow === '0' && next.deny === '0') return { del: roleId };
  return { set: { id: roleId, type: 0, allow: next.allow, deny: next.deny } };
}

// ───────── テンプレート ─────────

/** keep: 変えない（テンプレートに入れない） */
export const templateSchema = z.object({
  id: z.string().regex(/^t[a-z0-9]{1,20}$/),
  name: z.string().trim().min(1).max(40),
  /** 当てるチャンネルの種類 */
  target: z.enum(['all', 'text', 'voice']),
  note: z.string().max(200).default(''),
  /** 番号 → 許可・拒否・中立に戻す（入っていない番号は変えない） */
  perms: z.record(z.string().regex(/^\d{1,2}$/), z.enum(['allow', 'deny', 'neutral'])),
});
export type PermTemplate = z.infer<typeof templateSchema>;

const KEY = 'channel.permTemplates';

export async function listTemplates(db: Db): Promise<PermTemplate[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const parsed = z.array(templateSchema).safeParse(row?.value ?? []);
  return parsed.success ? parsed.data : [];
}

export async function saveTemplates(db: Db, list: PermTemplate[], by: string): Promise<void> {
  const value = z.array(templateSchema).max(50).parse(list);
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
}

/** テンプレートのマスの変え方（そのチャンネルにある権限だけ） */
export const templateChanges = (t: PermTemplate): { bit: number; cell: Cell }[] =>
  Object.entries(t.perms).flatMap(([no, cell]) => {
    const p = perm(Number(no));
    return p ? [{ bit: p.bit, cell }] : [];
  });

/** テンプレートを当てられるチャンネルか（種類） */
export const templateFits = (t: Pick<PermTemplate, 'target'>, c: Pick<GuildChannel, 'type'>) => {
  const k = kindOf(c);
  return t.target === 'all' || k === 'category' || k === t.target;
};

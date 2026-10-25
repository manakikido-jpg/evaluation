import { desc, eq } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { reactionRolePanels, type ReactionRolePanel } from '../db/schema.js';
import type { DiscordActions, GuildRole, MessageBody } from '../lib/discordRest.js';
import { audit } from './audit.js';
import { staffRoleIds } from './meetings.js';
import { botTopPosition, dangerLabels, permsOf } from './roles.js';

/**
 * 🎭 スタンプでロールを付けるパネル（carl-bot のリアクションロールと同じ動き）。
 * スタンプを押すとロールが付き、外すとロールが外れる。社務所Web で作って、BOT が投稿する。
 */
export const PANEL_ENTRIES_MAX = 20;
export const PANEL_TITLE_MAX = 100;
export const PANEL_BODY_MAX = 1500;
const COLOR = 0xf4a7b9;

export type PanelEntry = ReactionRolePanel['entries'][number];

/**
 * スタンプの書き方を 1 つにそろえる。
 * - Discord の絵文字（サーバーのスタンプ）: `<:name:id>` / `<a:name:id>` → そのまま（見分けは id）
 * - ふつうの絵文字: 異体字セレクタ（FE0F）を除いた文字
 */
export function normalizeEmoji(raw: string): string | undefined {
  const s = raw.trim();
  const custom = /^<(a?):([\w~]{1,32}):(\d{17,20})>$/.exec(s);
  if (custom) return `<${custom[1]}:${custom[2]}:${custom[3]}>`;
  const plain = s.replace(/️/g, '');
  if (!plain || plain.length > 16 || /[\s<>:@#]/.test(plain) || !/\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]⃣/u.test(s)) return undefined;
  return plain;
}

/** 見分けに使う鍵（Discord の絵文字は id、ふつうの絵文字は文字） */
export function emojiKey(e: { id?: string | null; name?: string | null } | string): string {
  if (typeof e === 'string') return /^<a?:[\w~]+:(\d+)>$/.exec(e)?.[1] ?? e.replace(/️/g, '');
  return e.id ?? (e.name ?? '').replace(/️/g, '');
}

/** REST でスタンプを付けるときの書き方（ふつうの絵文字はそのまま、Discord の絵文字は name:id） */
export function emojiPath(emoji: string): string {
  const m = /^<a?:([\w~]+):(\d+)>$/.exec(emoji);
  return encodeURIComponent(m ? `${m[1]}:${m[2]}` : emoji);
}

/** 付けてよいロールか（@everyone・BOT のロール・BOT より上・強い権限・運営のロールはだめ） */
export function roleProblem(cfg: GuildConfig, roles: GuildRole[], roleId: string, botId?: string): string | undefined {
  const role = roles.find((r) => r.id === roleId);
  if (!role) return 'ロールが見つかりません';
  if (role.id === cfg.guildId || role.managed) return `「${role.name}」は付けられないロールです`;
  if (role.position >= botTopPosition(roles, botId)) return `「${role.name}」は BOT のロールより上なので付けられません（Discord でロールの順番を下げてください）`;
  if (dangerLabels(permsOf(role)).length) return `「${role.name}」は強い権限（${dangerLabels(permsOf(role)).join('・')}）があるので付けられません`;
  if (staffRoleIds(cfg).has(role.id)) return `「${role.name}」は運営・役職のロールなので付けられません`;
  return undefined;
}

export type PanelInput = { channelId: string; title: string; body: string; entries: PanelEntry[] };

/** フォームの入力を確かめる（スタンプの重なり・ロールの安全） */
export function parsePanel(cfg: GuildConfig, roles: GuildRole[], b: Record<string, unknown>, botId?: string): { ok: PanelInput } | { error: string } {
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
  const list = (k: string) => {
    const v = b[k];
    return (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => (typeof x === 'string' ? x : ''));
  };
  const channelId = str('channelId');
  if (!/^\d{17,20}$/.test(channelId)) return { error: 'チャンネルを選んでください。' };
  const emojis = list('emoji'), roleIds = list('roleId'), labels = list('label');
  const entries: PanelEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < emojis.length; i++) {
    const rawEmoji = emojis[i]!.trim(), roleId = (roleIds[i] ?? '').trim();
    if (!rawEmoji && !roleId) continue;
    const emoji = normalizeEmoji(rawEmoji);
    if (!emoji) return { error: `${i + 1} 行目のスタンプが読めません（絵文字 1 つか、<:名前:ID> の形で入れてください）。` };
    if (seen.has(emojiKey(emoji))) return { error: `${i + 1} 行目のスタンプが、ほかの行と同じです。` };
    seen.add(emojiKey(emoji));
    const problem = roleProblem(cfg, roles, roleId, botId);
    if (problem) return { error: `${i + 1} 行目: ${problem}。` };
    entries.push({ emoji, roleId, label: (labels[i] ?? '').trim().slice(0, 80) });
  }
  if (!entries.length) return { error: 'スタンプとロールを 1 つ以上入れてください。' };
  if (entries.length > PANEL_ENTRIES_MAX) return { error: `スタンプは ${PANEL_ENTRIES_MAX} 個までです。` };
  return { ok: { channelId, title: str('title').trim().slice(0, PANEL_TITLE_MAX), body: str('body').trim().slice(0, PANEL_BODY_MAX), entries } };
}

/** Discord に出すパネルの見た目 */
export function panelMessage(p: Pick<PanelInput, 'title' | 'body' | 'entries'>, roleName: (id: string) => string | undefined): MessageBody {
  const lines = p.entries.map((e) => `${e.emoji} → **${roleName(e.roleId) ?? 'ロール'}**${e.label ? `　${e.label}` : ''}`);
  return {
    embeds: [{ title: p.title || '🎭 スタンプでロールを選ぶ', description: [...(p.body ? [p.body, ''] : []), ...lines, '', '-# スタンプを押すとロールが付き、外すとロールが外れます。'].join('\n').slice(0, 4000), color: COLOR }],
    allowed_mentions: { parse: [] },
  };
}

export const listPanels = (db: Db) => db.select().from(reactionRolePanels).orderBy(desc(reactionRolePanels.id));
export async function getPanel(db: Db, id: number) {
  const [row] = await db.select().from(reactionRolePanels).where(eq(reactionRolePanels.id, id));
  return row;
}
export async function panelByMessage(db: Db, messageId: string) {
  const [row] = await db.select().from(reactionRolePanels).where(eq(reactionRolePanels.messageId, messageId));
  return row;
}

type Discord = Pick<DiscordActions, 'sendMessage' | 'editMessage' | 'deleteMessage' | 'addReaction' | 'removeReactionEmoji'>;

/**
 * 作る・直す。Discord に投稿（直すときは書きかえ）して、スタンプを BOT が先に付けておく。
 * チャンネルを変えたら、前の投稿を消して新しく出す。外したスタンプは、パネルから消す。
 */
export async function savePanel(db: Db, discord: Discord, input: PanelInput, roleName: (id: string) => string | undefined, by: string, id?: number, now = new Date()): Promise<ReactionRolePanel> {
  const prev = id ? await getPanel(db, id) : undefined;
  if (id && !prev) throw new Error('panel not found');
  const body = panelMessage(input, roleName);
  let messageId = prev?.messageId ?? null;
  if (prev && messageId && prev.channelId !== input.channelId) {
    await discord.deleteMessage(prev.channelId, messageId).catch(() => undefined);
    messageId = null;
  }
  if (messageId) {
    try { await discord.editMessage(input.channelId, messageId, body); }
    catch { messageId = null; }
  }
  const fresh = !messageId;
  if (!messageId) messageId = (await discord.sendMessage(input.channelId, body)).id;
  // 外したスタンプは消す（同じチャンネルで書きかえたときだけ）
  if (prev && !fresh && discord.removeReactionEmoji) {
    const keep = new Set(input.entries.map((e) => emojiKey(e.emoji)));
    for (const e of prev.entries) if (!keep.has(emojiKey(e.emoji))) await discord.removeReactionEmoji(input.channelId, messageId, emojiPath(e.emoji)).catch(() => undefined);
  }
  for (const e of input.entries) await discord.addReaction?.(input.channelId, messageId, emojiPath(e.emoji)).catch(() => undefined);
  const values = { channelId: input.channelId, messageId, title: input.title, body: input.body, entries: input.entries, updatedBy: by, updatedAt: now };
  const [row] = prev
    ? await db.update(reactionRolePanels).set(values).where(eq(reactionRolePanels.id, prev.id)).returning()
    : await db.insert(reactionRolePanels).values({ ...values, createdAt: now }).returning();
  await audit(db, { actorId: by, action: prev ? 'reaction_role.update' : 'reaction_role.create', detail: { id: row!.id, channelId: input.channelId, roles: input.entries.map((e) => e.roleId) }, via: 'web' });
  return row!;
}

/** 消す（Discord の投稿も消す。ロールはそのまま残す） */
export async function deletePanel(db: Db, discord: Pick<DiscordActions, 'deleteMessage'>, id: number, by: string): Promise<boolean> {
  const [row] = await db.delete(reactionRolePanels).where(eq(reactionRolePanels.id, id)).returning();
  if (!row) return false;
  if (row.messageId) await discord.deleteMessage(row.channelId, row.messageId).catch(() => undefined);
  await audit(db, { actorId: by, action: 'reaction_role.delete', detail: { id }, via: 'web' });
  return true;
}

/** スタンプに合うロール（なければ undefined） */
export function roleFor(panel: Pick<ReactionRolePanel, 'entries'>, emoji: { id?: string | null; name?: string | null }): string | undefined {
  const key = emojiKey(emoji);
  return panel.entries.find((e) => emojiKey(e.emoji) === key)?.roleId;
}

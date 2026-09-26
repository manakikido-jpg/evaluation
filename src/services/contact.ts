import type { GuildConfig } from '../config.js';
import type { ModCtx } from './moderation.js';
import { logger } from '../lib/logger.js';

/**
 * DM・フレンド追加の「OK / 要相談 / NG」。ロールで持つので、名前を押すとプロフィールに出る。
 * 入鯖申請で選び、あとから #授与所 のボタンで変えられる。
 */

export type ContactKind = 'dm' | 'friend';
export type ContactLevel = 'ok' | 'ask' | 'ng';

export const CONTACT_KINDS: ContactKind[] = ['dm', 'friend'];
export const CONTACT_LEVELS: ContactLevel[] = ['ok', 'ask', 'ng'];
export const CONTACT_KIND_LABEL: Record<ContactKind, string> = { dm: 'DM', friend: 'フレンド追加' };
export const CONTACT_LEVEL_LABEL: Record<ContactLevel, string> = { ok: 'OK', ask: '要相談', ng: 'NG' };
export const CONTACT_LEVEL_EMOJI: Record<ContactLevel, string> = { ok: '⭕', ask: '💬', ng: '❌' };

export const isContactKind = (v: unknown): v is ContactKind => v === 'dm' || v === 'friend';
export const isContactLevel = (v: unknown): v is ContactLevel => v === 'ok' || v === 'ask' || v === 'ng';

/** そのレベルのロール */
export function contactRoleOf(cfg: GuildConfig, kind: ContactKind, level: ContactLevel): string | undefined {
  return cfg.roles.contact?.[kind][level];
}

/** 3 つのロールがそろっていれば選べる */
export function contactEnabled(cfg: GuildConfig, kind: ContactKind): boolean {
  return CONTACT_LEVELS.every((l) => contactRoleOf(cfg, kind, l));
}

/** 持っているロールから、今の選択 */
export function contactOfRoles(cfg: GuildConfig, kind: ContactKind, roleIds: readonly string[]): ContactLevel | undefined {
  return CONTACT_LEVELS.find((l) => {
    const r = contactRoleOf(cfg, kind, l);
    return r && roleIds.includes(r);
  });
}

/** 「DM: OK ・ フレンド追加: 要相談」のような 1 行（選んでいなければ空） */
export function contactSummary(answers: { dm?: unknown; friend?: unknown }): string {
  return CONTACT_KINDS.flatMap((k) => {
    const v = answers[k];
    return isContactLevel(v) ? [`${CONTACT_KIND_LABEL[k]}: ${CONTACT_LEVEL_LABEL[v]}`] : [];
  }).join(' ・ ');
}

/**
 * 選んだロールを付けて、同じ種類のほかのロールを外す。
 * roleIds が分からないとき（承認のとき）は、ほかの 2 つを外してみる。
 */
export async function setContact(
  ctx: Pick<ModCtx, 'cfg' | 'discord'>,
  memberId: string,
  kind: ContactKind,
  level: ContactLevel,
  roleIds?: readonly string[],
): Promise<'ok' | 'disabled'> {
  if (!contactEnabled(ctx.cfg, kind)) return 'disabled';
  const g = ctx.cfg.guildId;
  const reason = `${CONTACT_KIND_LABEL[kind]}: ${CONTACT_LEVEL_LABEL[level]}`;
  const want = contactRoleOf(ctx.cfg, kind, level)!;
  if (!roleIds?.includes(want)) await ctx.discord.addRole(g, memberId, want, reason);
  for (const l of CONTACT_LEVELS) {
    if (l === level) continue;
    const r = contactRoleOf(ctx.cfg, kind, l)!;
    if (roleIds && !roleIds.includes(r)) continue;
    await ctx.discord.removeRole(g, memberId, r, reason).catch((err: unknown) => logger.warn({ err }, 'remove contact role failed'));
  }
  return 'ok';
}

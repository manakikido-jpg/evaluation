import { and, isNull } from 'drizzle-orm';
import type { GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { members } from '../../db/schema.js';
import type { DiscordActions } from '../../lib/discordRest.js';
import { logger } from '../../lib/logger.js';
import { isGraded, KB_CLASSES } from './keiba.js';
import { markAnnounced, ownerRoleTargets, pendingWins } from './keibaStable.js';

/**
 * 🏇 1 分ごと: 馬主の馬が勝ったら Discord でお祝い。🐴 馬主ロール・🏆 G1 馬主ロールを付ける・外す
 */

type Ctx = { db: Db; cfg: GuildConfig; discord: Pick<DiscordActions, 'sendMessage' | 'addRole' | 'removeRole'> };

const fmt = (n: number) => n.toLocaleString('ja-JP');

export function winMessage(w: { race: string; horseName: string; ownerId: string; prize: number; cls: number }, coinName: string): string {
  const big = isGraded(w.cls);
  return [
    big ? `🏆 **${w.race}** を **${w.horseName}** が制しました！` : `🐴 ${KB_CLASSES[w.cls] ?? ''}「${w.race}」で **${w.horseName}** が勝ちました！`,
    `馬主の <@${w.ownerId}> さん、おめでとうございます！${w.prize > 0 ? `（賞金 ${fmt(w.prize)} ${coinName}）` : ''}`,
  ].join('\n');
}

export async function keibaTick(ctx: Ctx, now = new Date()): Promise<void> {
  const c = ctx.cfg.casino;
  // お祝い（チャンネルがなければ、流したことにして溜めない）
  for (const w of await pendingWins(ctx.db)) {
    if (c.keibaAnnounceChannelId) {
      try {
        await ctx.discord.sendMessage(c.keibaAnnounceChannelId, { content: winMessage(w, ctx.cfg.economy.currencyName), allowed_mentions: { parse: ['users'] } });
      } catch (err) {
        logger.warn({ err }, 'keiba win announce failed');
      }
    }
    await markAnnounced(ctx.db, w.id, now);
  }
  // ロール
  if (!c.keibaOwnerRoleId && !c.keibaG1RoleId) return;
  const { owners, g1 } = await ownerRoleTargets(ctx.db);
  const rows = await ctx.db.select({ id: members.id, roleIds: members.roleIds }).from(members).where(and(isNull(members.leftAt)));
  for (const m of rows) {
    const sync = async (roleId: string | undefined, want: boolean, keep: boolean) => {
      if (!roleId) return;
      const has = m.roleIds.includes(roleId);
      if (want && !has) await ctx.discord.addRole(ctx.cfg.guildId, m.id, roleId, '🏇 みんなでダービーの馬主').catch(() => undefined);
      else if (!want && has && !keep) await ctx.discord.removeRole(ctx.cfg.guildId, m.id, roleId, '🏇 走れる馬がいなくなった').catch(() => undefined);
    };
    await sync(c.keibaOwnerRoleId, owners.has(m.id), false);
    // G1 馬主は外さない（一度勝てばずっと）
    await sync(c.keibaG1RoleId, g1.has(m.id), true);
  }
}

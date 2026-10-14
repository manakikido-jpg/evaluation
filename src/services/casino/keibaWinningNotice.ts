import { and, eq, lte } from 'drizzle-orm';
import type { GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { keibaWinningNotices } from '../../db/schema.js';
import type { DiscordActions } from '../../lib/discordRest.js';
import { logger } from '../../lib/logger.js';
import { renderWinningTicket } from './keibaWinningTicket.js';

/** 清算と同時に保存した通知を送る。送信を試した通知は自動で再送しない。 */
export async function winningNoticeTick(ctx: { db: Db; cfg: GuildConfig; discord: Pick<DiscordActions, 'sendMessage'> }, now = new Date()): Promise<void> {
  if (!ctx.cfg.casino.keibaWinningChannelId) return;
  const pending = await ctx.db.select().from(keibaWinningNotices).where(and(eq(keibaWinningNotices.status, 'pending'), lte(keibaWinningNotices.availableAt, now))).orderBy(keibaWinningNotices.id).limit(10);
  for (const item of pending) {
    const [claimed] = await ctx.db.update(keibaWinningNotices).set({ status: 'sending', updatedAt: now }).where(and(eq(keibaWinningNotices.id, item.id), eq(keibaWinningNotices.status, 'pending'))).returning({ id: keibaWinningNotices.id });
    if (!claimed) continue;
    try {
      const slip = item.payload;
      const png = renderWinningTicket(slip, item.coinName, new Date(item.availableAt.getTime() - 6800));
      const fmt = (n: number) => n.toLocaleString('ja-JP');
      const result = await ctx.discord.sendMessage(item.channelId, {
        content: `🌸 <@${item.memberId}> さん、競馬的中！\n${slip.race} 第${slip.raceNo}レース\n購入 ${fmt(slip.bet)}${item.coinName}／払戻 ${fmt(slip.payout)}${item.coinName}／レース収支 +${fmt(slip.payout - slip.bet)}${item.coinName}`,
        allowed_mentions: { parse: [] },
        files: [{ name: `keiba-winning-${item.id}.png`, contentType: 'image/png', data: png }],
      });
      await ctx.db.update(keibaWinningNotices).set({ status: 'sent', messageId: result.id, updatedAt: now }).where(eq(keibaWinningNotices.id, item.id));
    } catch (err) {
      await ctx.db.update(keibaWinningNotices).set({ status: 'failed', updatedAt: now }).where(eq(keibaWinningNotices.id, item.id));
      logger.warn({ err, noticeId: item.id }, 'keiba winning notice failed; not automatically retried');
    }
  }
}

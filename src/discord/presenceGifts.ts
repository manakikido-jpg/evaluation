import type { Guild } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { deliverPresenceGift, failPresenceGift, pendingPresenceGifts } from '../services/presenceGifts.js';
import { ticketName } from '../services/tickets.js';
import type { TicketKind } from '../config.js';

/** いまオンライン（オフライン以外）で、役職のある人（BOT はのぞく） */
export async function onlineMemberIds(guild: Guild, rankRoleIds: readonly string[]): Promise<string[]> {
  // オンラインの人は presences に入っている（PRESENCE INTENT が要る）
  const online = [...guild.presences.cache.values()].filter((p) => p.status !== 'offline').map((p) => p.userId);
  if (!online.length) return [];
  // 1 回に読みこめるのは 100 人まで
  const members = [];
  for (let i = 0; i < online.length; i += 100) {
    const got = await guild.members.fetch({ user: online.slice(i, i + 100) }).catch(() => undefined);
    members.push(...(got?.values() ?? []));
  }
  return members.filter((m) => !m.user.bot && rankRoleIds.some((r) => m.roles.cache.has(r))).map((m) => m.id);
}

/** 🎁 社務所Web で受け付けたプレゼントを、1 分ごとに配る */
export class PresenceGiftApp {
  private busy = false;
  constructor(private db: Db, private cfg: () => GuildConfig, private discord: DiscordActions, private presence: boolean) {}

  async tick(guild: Guild): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const g of await pendingPresenceGifts(this.db)) {
        // オンラインかどうかを見られないと、だれが浮上しているか分からない
        if (!this.presence) {
          await failPresenceGift(this.db, g.id, 'presence_off');
          continue;
        }
        const cfg = this.cfg();
        const ids = await onlineMemberIds(guild, cfg.ranks.map((r) => r.roleId));
        const r = await deliverPresenceGift(this.db, g.id, ids);
        if (r.status !== 'ok') continue;
        const what = g.kind === 'coins' ? `${cfg.economy.currencyEmoji}${cfg.economy.currencyName} ${g.amount} 枚` : `${ticketName(g.ticketKind as TicketKind)} ${g.amount} 枚`;
        await audit(this.db, { actorId: g.createdBy, action: 'gift.presence', detail: { id: g.id, kind: g.kind, ticketKind: g.ticketKind, amount: g.amount, count: r.count, note: g.note }, via: 'discord' });
        if (cfg.channels.log) {
          await this.discord
            .sendMessage(cfg.channels.log, { content: `🎁 浮上している ${r.count} 人に、${what}ずつ配りました（${g.note}）。`, allowed_mentions: { parse: [] } })
            .catch(() => undefined);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'presence gift failed');
    } finally {
      this.busy = false;
    }
  }
}

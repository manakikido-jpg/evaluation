import { ChannelType, DiscordAPIError, OverwriteType, PermissionFlagsBits, type Guild, type VoiceState } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { cleanupRooms, onVoiceJoin, onVoiceLeave, type TempVoiceCtx, type VoiceOps } from '../services/tempVoice.js';

/** 作った人ができること: 名前・人数の上限の変更、入っている人を抜けさせる */
const OWNER_ALLOW = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.MoveMembers;

export function discordVoiceOps(guild: Guild): VoiceOps {
  return {
    async create({ hubId, name, ownerId }) {
      const hub = guild.channels.cache.get(hubId);
      const parent = hub && 'parent' in hub ? hub.parent : null;
      // カテゴリと同じ見える範囲（宵宮なら宵参りの人だけ）にして、作った人の権限を足す
      const overwrites = parent
        ? parent.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }))
        : [];
      const mine = overwrites.find((o) => o.id === ownerId);
      if (mine) mine.allow |= OWNER_ALLOW;
      else overwrites.push({ id: ownerId, type: OverwriteType.Member, allow: OWNER_ALLOW, deny: 0n });
      const ch = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: parent?.id ?? null,
        permissionOverwrites: overwrites,
        nsfw: Boolean(hub && 'nsfw' in hub && hub.nsfw),
        reason: '自分の通話部屋',
      });
      return ch.id;
    },
    async move(userId, channelId) {
      const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId));
      if (!member.voice.channelId) throw new Error('not in voice');
      await member.voice.setChannel(channelId, '自分の通話部屋へ');
    },
    async remove(channelId) {
      const ch = guild.channels.cache.get(channelId);
      if (!ch) return;
      try {
        await ch.delete('自分の通話部屋（全員抜けた）');
      } catch (err) {
        // すでに消されていた（Unknown Channel）
        if (!(err instanceof DiscordAPIError && err.code === 10003)) throw err;
      }
    },
    occupancy(channelId) {
      const ch = guild.channels.cache.get(channelId);
      return ch?.isVoiceBased() ? ch.members.size : undefined;
    },
  };
}

export class TempVoiceApp {
  private ctx?: TempVoiceCtx;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  /** 起動したとき。権限を確かめて、止まっていた間に空になった部屋を消す */
  async attach(guild: Guild): Promise<void> {
    const ops = discordVoiceOps(guild);
    this.ctx = { db: this.db, cfg: this.cfg(), ops };
    if (this.cfg().tempVoice.hubs.length) {
      const me = guild.members.me;
      if (me && !me.permissions.has(PermissionFlagsBits.ManageChannels | PermissionFlagsBits.MoveMembers)) {
        logger.warn('自分の通話部屋を作るには、BOT のロールに「チャンネルの管理」「メンバーを移動」の権限が必要です（サーバー設定 → ロール）');
      }
    }
    await this.cleanup();
  }

  async cleanup(): Promise<void> {
    if (!this.ctx) return;
    this.ctx.cfg = this.cfg();
    const n = await cleanupRooms(this.ctx).catch((err) => (logger.warn({ err }, 'temp voice cleanup failed'), 0));
    if (n) logger.info({ removed: n }, 'empty temp voice rooms removed');
  }

  async onVoiceStateUpdate(before: VoiceState, after: VoiceState): Promise<void> {
    if (!this.ctx || before.channelId === after.channelId) return;
    this.ctx.cfg = this.cfg();
    try {
      let movedInto: string | undefined;
      if (after.channelId && after.member && !after.member.user.bot) {
        const r = await onVoiceJoin(this.ctx, { userId: after.id, displayName: after.member.displayName, channelId: after.channelId });
        if (r.status === 'moved' || r.status === 'created') movedInto = r.channelId;
      }
      // 自分の部屋から入口に入って、また自分の部屋に戻された: その部屋は空ではない
      if (before.channelId && before.channelId !== movedInto) await onVoiceLeave(this.ctx, before.channelId);
    } catch (err) {
      logger.warn({ err }, 'temp voice failed');
    }
  }
}

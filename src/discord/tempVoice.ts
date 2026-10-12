import { ButtonStyle, ChannelType, DiscordAPIError, MessageFlags, OverwriteType, PermissionFlagsBits, type Guild, type Interaction, type VoiceState } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { claimSecretRoom, cleanupRooms, createSecretRoom, onVoiceJoin, onVoiceLeave, removeRoom, SECRET_PENDING_MS, type TempVoiceCtx, type VoiceOps } from '../services/tempVoice.js';
import { planOf, roomOverwrites } from '../services/rooms.js';
import { adminLevelOf } from '../config.js';
import type { MessageBody } from '../lib/discordRest.js';

/** 作った人ができること: 名前・人数の上限の変更、入っている人を抜けさせる */
export const OWNER_ALLOW = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.MoveMembers;

export function discordVoiceOps(guild: Guild): VoiceOps {
  return {
    async create({ hubId, name, ownerId, fromHub, secret }) {
      const hub = guild.channels.cache.get(hubId);
      const parent = hub && 'parent' in hub ? hub.parent : null;
      // カテゴリと同じ見える範囲（宵宮なら宵参りの人だけ）にして、作った人の権限を足す。💎 極は入口と同じ（VIP だけ）
      const source = fromHub && hub && 'permissionOverwrites' in hub ? hub : parent;
      const overwrites = source
        ? source.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }))
        : [];
      const mine = overwrites.find((o) => o.id === ownerId);
      if (mine) mine.allow |= OWNER_ALLOW;
      else overwrites.push({ id: ownerId, type: OverwriteType.Member, allow: OWNER_ALLOW, deny: 0n });
      // 🤫 シクレの入口: できた瞬間から、作った人（と BOT）にしか見えない
      // カテゴリに @everyone の上書きがなくても、見えなくする
      if (secret && !overwrites.some((o) => o.id === guild.id)) overwrites.push({ id: guild.id, type: OverwriteType.Role, allow: 0n, deny: 0n });
      const list = secret
        ? roomOverwrites(overwrites.map((o) => ({ ...o, type: o.type as 0 | 1 })), 'secret', { ownerId, botId: guild.client.user.id, invited: [], ownerAllow: OWNER_ALLOW })
        : overwrites;
      const ch = await guild.channels.create({
        name: secret ? `🤫 シクレ｜${name}`.slice(0, 100) : name,
        type: ChannelType.GuildVoice,
        parent: parent?.id ?? null,
        permissionOverwrites: list,
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
    /** 部屋ができたとき（宿坊・宵宮の部屋の設定を出す）。secret: パネルで作ったシクレ部屋（シークレットの部屋代を取る） */
    private readonly onCreated?: (channelId: string, ownerId: string, opts?: { secret?: boolean }) => Promise<void>,
  ) {}

  /** 🤫 パネルからシクレ部屋を作る */
  async openSecret(hubId: string, userId: string, displayName: string) {
    if (!this.ctx) return { status: 'failed' as const };
    this.ctx.cfg = this.cfg();
    return createSecretRoom(this.ctx, { hubId, userId, displayName });
  }

  /** 部屋を閉じる（中の人は通話から抜ける） */
  async close(channelId: string): Promise<void> {
    if (this.ctx) await removeRoom(this.ctx, channelId);
  }

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
        if (r.status === 'created') await this.onCreated?.(r.channelId, after.id).catch((err) => logger.warn({ err }, 'room created hook failed'));
        // 🤫 パネルで作ったシクレ部屋に、作った人がはじめて入った: ここで部屋代を取って、部屋の設定を出す
        if (r.status === 'ignored' && (await claimSecretRoom(this.db, after.channelId, after.id))) {
          await this.onCreated?.(after.channelId, after.id, { secret: true }).catch((err) => logger.warn({ err }, 'secret room created hook failed'));
        }
      }
      // 自分の部屋から入口に入って、また自分の部屋に戻された: その部屋は空ではない
      if (before.channelId && before.channelId !== movedInto) await onVoiceLeave(this.ctx, before.channelId);
    } catch (err) {
      logger.warn({ err }, 'temp voice failed');
    }
  }
}

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
/** シクレ部屋を作れる入口（宿坊・宵宮。💎 極・入口方式のシクレは除く） */
export const secretRoomHubs = (cfg: GuildConfig) =>
  cfg.tempVoice.hubs.filter((h) => h.kind !== 'secret' && h.channelId !== cfg.rooms.vip?.hubId && ['once', 'hourly'].includes(planOf(cfg, h.channelId)));

/** 🤫 シクレ部屋のパネル（みんなに見える。押した人にだけ確かめを返す） */
export function secretRoomPanel(cfg: GuildConfig, names: ReadonlyMap<string, string> = new Map()): MessageBody {
  const hubs = secretRoomHubs(cfg).slice(0, 5);
  const coin = cfg.economy.currencyName;
  return {
    embeds: [{
      title: '🤫 シクレ部屋をつくる',
      description: [
        '下のボタンを押すと、**あなたにしか見えない部屋**を BOT が作ります。どの通話も通らないので、だれにも見られません。',
        ...hubs.map((h) => { const plan = planOf(cfg, h.channelId) as 'once' | 'hourly'; return `- ${names.get(h.channelId) ?? h.name.replace('{name}', '○○')}: ${cfg.rooms[plan].secret.toLocaleString('ja-JP')} ${coin}${plan === 'hourly' ? '（1 時間ごと）' : '（ひらくときに 1 回）'}`; }),
        `-# 部屋代は、できた部屋に入ったときに払います。${SECRET_PENDING_MS / 60_000} 分たっても入らなければ部屋は消えます（銭は減りません）。`,
      ].join('\n'),
      color: 0x8e6bbf,
    }],
    components: hubs.length ? [{ type: 1, components: hubs.map((h) => ({ type: 2, style: ButtonStyle.Secondary, label: `🤫 ${(names.get(h.channelId) ?? h.name.replace('{name}', '')).replace(/^[➕\s]+/, '').slice(0, 70)}`, custom_id: `secretroom:${h.channelId}` })) }] : [],
    allowed_mentions: { parse: [] },
  };
}

/** パネルのボタン・/パネル シクレ部屋 */
export async function onSecretRoomInteraction(app: TempVoiceApp, cfg: () => GuildConfig, i: Interaction): Promise<void> {
  if (!i.inCachedGuild() || i.guildId !== cfg().guildId) return;
  if (i.isChatInputCommand() && i.commandName === 'panel' && i.options.getSubcommand(false) === 'secretroom') {
    if (!adminLevelOf(cfg(), [...i.member.roles.cache.keys()])) return void (await i.reply({ content: '神職・宮司のみ置けます。', ...EPHEMERAL }));
    if (!i.channel?.isSendable()) return void (await i.reply({ content: 'このチャンネルには置けません。', ...EPHEMERAL }));
    const names = new Map(secretRoomHubs(cfg()).map((h) => [h.channelId, i.guild.channels.cache.get(h.channelId)?.name ?? h.name]));
    await i.channel.send(secretRoomPanel(cfg(), names) as never);
    return void (await i.reply({ content: '🤫 シクレ部屋のパネルを置きました。', ...EPHEMERAL }));
  }
  if (!i.isButton() || !i.customId.startsWith('secretroom:')) return;
  const hubId = i.customId.slice('secretroom:'.length);
  if (!secretRoomHubs(cfg()).some((h) => h.channelId === hubId)) return void (await i.reply({ content: 'この入口は、いまは使えません。', ...EPHEMERAL }));
  // 入口が見えない人（宵宮は宵参りの人だけ など）には作らない
  const hub = i.guild.channels.cache.get(hubId);
  if (!hub || !hub.permissionsFor(i.member).has(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect)) return void (await i.reply({ content: 'この部屋は、あなたは作れません（入れる人が決まっている入口です）。', ...EPHEMERAL }));
  await i.deferReply(EPHEMERAL);
  const r = await app.openSecret(hubId, i.user.id, i.member.displayName);
  if (r.status !== 'created' && r.status !== 'exists') return void (await i.editReply(r.status === 'busy' ? 'いま作っています。少し待ってください。' : '部屋を作れませんでした。神職に知らせてください。'));
  const url = `https://discord.com/channels/${i.guildId}/${r.channelId}`;
  await i.editReply({
    content: r.status === 'exists'
      ? `🤫 あなたの部屋はもうあります。<#${r.channelId}>`
      : `🤫 あなたにしか見えない部屋を作りました。<#${r.channelId}>\n-# 入ったときに部屋代を払います。${SECRET_PENDING_MS / 60_000} 分たっても入らなければ消えます。`,
    components: [{ type: 1, components: [{ type: 2, style: ButtonStyle.Link, label: '部屋に入る', url }] }],
  });
}

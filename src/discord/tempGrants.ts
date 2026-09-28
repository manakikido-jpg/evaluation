import { MessageFlags, type ChatInputCommandInteraction, type Guild, type GuildMember, type Interaction } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions, GuildChannel, GuildRole } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import {
  activeGrants,
  changeRole,
  durationMinutes,
  endGrant,
  GRANT_MESSAGES,
  grantLabel,
  grantPerm,
  grantRole,
  isPermPreset,
  jstShort,
  remaining,
  ROLE_CHANGE_MESSAGES,
  type GrantResult,
} from '../services/tempGrants.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** discord.js のロール・チャンネルを、REST と同じ形に */
const rolesOf = (g: Guild): GuildRole[] =>
  [...g.roles.cache.values()].map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    managed: r.managed,
    color: r.color,
    permissions: r.permissions.bitfield.toString(),
    ...(r.tags?.botId ? { tags: { bot_id: r.tags.botId } } : {}),
  }));
const channelsOf = (g: Guild): GuildChannel[] =>
  [...g.channels.cache.values()].map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    parent_id: c.parentId,
    position: 'position' in c ? c.position : 0,
    permission_overwrites:
      'permissionOverwrites' in c
        ? [...c.permissionOverwrites.cache.values()].map((o) => ({ id: o.id, type: o.type as 0 | 1, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() }))
        : [],
  }));

/** ⏳ /一時ロール・/一時権限、🏷 /ロール（期限なし）（神職・宮司） */
export class TempGrantApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    if (!interaction.isChatInputCommand() || !['temprole', 'tempperm', 'role'].includes(interaction.commandName)) return;
    try {
      await this.handle(interaction);
    } catch (err) {
      logger.error({ err }, 'temp grant command failed');
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'うまくいきませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL }).catch(() => undefined);
    }
  }

  private async handle(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const cfg = this.cfg();
    const level = adminLevelOf(cfg, [...i.member.roles.cache.keys()]);
    if (!level) return void (await i.reply({ content: '神職・宮司だけが使えます。', ...EPHEMERAL }));
    const sub = i.options.getSubcommand();
    if (sub === 'list') return this.list(i);
    await i.deferReply(EPHEMERAL);
    const ctx = { db: this.db, cfg, discord: this.discord };
    const target = i.options.getMember('user') as GuildMember | null;
    const user = i.options.getUser('user', true);
    if (i.commandName === 'role') {
      const role = i.options.getRole('role', true);
      if (!target) return void (await i.editReply(`${user} はこのサーバーにいません。`));
      const r = await changeRole(ctx, {
        action: sub === 'remove' ? 'remove' : 'give',
        memberId: user.id,
        roleId: role.id,
        reason: i.options.getString('reason') ?? '',
        by: i.user.id,
        byLevel: level,
        roles: rolesOf(i.guild),
        memberRoleIds: [...target.roles.cache.keys()],
        botId: i.client.user.id,
        via: 'discord',
      });
      if (r.status === 'given') return void (await i.editReply(`🏷 ${user} に ${role} を付けました${r.madePermanent ? '（一時的だったのを、期限なしにしました）' : ''}。`));
      if (r.status === 'removed') return void (await i.editReply(`🏷 ${user} の ${role} を外しました。`));
      return void (await i.editReply(ROLE_CHANGE_MESSAGES[r.status]));
    }
    if (i.commandName === 'temprole') {
      const role = i.options.getRole('role', true);
      if (sub === 'remove') {
        const g = (await activeGrants(this.db, { memberId: user.id })).find((x) => x.kind === 'role' && x.roleId === role.id);
        if (!g) return void (await i.editReply(`${user} に一時的に付けた ${role} はありません。`));
        const r = await endGrant(ctx, g, i.user.id, 'revoked', new Date(), 'discord');
        return void (await i.editReply(r === 'ended' ? `⏹ ${user} の ${role} を外しました。` : GRANT_MESSAGES.failed));
      }
      const minutes = durationMinutes(i.options.getString('for', true));
      if (!minutes) return void (await i.editReply('期間を選んでください。'));
      const r = await grantRole(ctx, {
        memberId: user.id,
        roleId: role.id,
        minutes,
        reason: i.options.getString('reason') ?? '',
        by: i.user.id,
        byLevel: level,
        roles: rolesOf(i.guild),
        memberRoleIds: target ? [...target.roles.cache.keys()] : [],
        botId: i.client.user.id,
        via: 'discord',
      });
      return void (await i.editReply(this.resultText(r, `${user} に ${role}`)));
    }
    // /一時権限
    const channel = i.options.getChannel('channel') ?? i.channel;
    if (!channel) return void (await i.editReply('チャンネルが見つかりませんでした。'));
    if (sub === 'remove') {
      const g = (await activeGrants(this.db, { memberId: user.id })).find((x) => x.kind === 'perm' && x.channelId === channel.id);
      if (!g) return void (await i.editReply(`${user} に <#${channel.id}> で一時的に付けた権限はありません。`));
      const r = await endGrant(ctx, g, i.user.id, 'revoked', new Date(), 'discord');
      return void (await i.editReply(r === 'ended' ? `⏹ ${user} の ${grantLabel(g)} を元に戻しました。` : GRANT_MESSAGES.failed));
    }
    const preset = i.options.getString('perm', true);
    const minutes = durationMinutes(i.options.getString('for', true));
    if (!isPermPreset(preset) || !minutes) return void (await i.editReply('権限と期間を選んでください。'));
    const r = await grantPerm(ctx, {
      memberId: user.id,
      channelId: channel.id,
      preset,
      minutes,
      reason: i.options.getString('reason') ?? '',
      by: i.user.id,
      byLevel: level,
      channels: channelsOf(i.guild),
      via: 'discord',
    });
    await i.editReply(this.resultText(r, `${user} に`));
  }

  private resultText(r: GrantResult, who: string): string {
    if (r.status === 'granted') return `⏳ ${who} ${r.grant.kind === 'role' ? '' : grantLabel(r.grant)}を付けました（${jstShort(r.grant.expiresAt)} まで。期限が来たら BOT が外します）。`.replace('  ', ' ');
    if (r.status === 'extended') return `⏳ もう付いていたので、期限を ${jstShort(r.grant.expiresAt)} にしました。`;
    return GRANT_MESSAGES[r.status];
  }

  private async list(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const user = i.options.getUser('user');
    const list = await activeGrants(this.db, user ? { memberId: user.id } : {});
    if (!list.length) return void (await i.reply({ content: user ? `${user} に一時的に付いているものはありません。` : '一時的に付いているものはありません。', ...EPHEMERAL }));
    const now = new Date();
    const lines = list.slice(0, 30).map((g) => `- <@${g.memberId}> … ${grantLabel(g)}（${jstShort(g.expiresAt)} まで・${remaining(g.expiresAt, now)}）`);
    await i.reply({
      embeds: [{ title: '⏳ 一時的に付いているもの', description: [...lines, list.length > 30 ? `-# ほか ${list.length - 30} 件（社務所Web で見られます）` : ''].join('\n').slice(0, 4000), color: 0xd7003a }],
      ...EPHEMERAL,
    });
  }
}

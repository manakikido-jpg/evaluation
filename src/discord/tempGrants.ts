import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Guild, type GuildMember, type Interaction } from 'discord.js';
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

import { createRoleRequest, decideRoleRequest, finishRoleRequest, needsApproval, type RoleRequestKind } from '../services/roleRequests.js';

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
    // 🛡 ロールの承認待ちのボタン
    if (interaction.isButton() && interaction.customId.startsWith('rolereq:')) {
      try {
        await this.decide(interaction);
      } catch (err) {
        logger.error({ err }, 'role request decide failed');
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'うまくいきませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL }).catch(() => undefined);
      }
      return;
    }
    if (!interaction.isChatInputCommand() || !['temprole', 'tempperm', 'role'].includes(interaction.commandName)) return;
    try {
      await this.handle(interaction);
    } catch (err) {
      logger.error({ err }, 'temp grant command failed');
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'うまくいきませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL }).catch(() => undefined);
    }
  }

  /** 承認待ちにして、ログのチャンネルに承認・却下のボタンを出す */
  private async ask(i: ChatInputCommandInteraction<'cached'>, r: { kind: RoleRequestKind; memberId: string; roleId: string; minutes?: number; reason: string }): Promise<void> {
    const ch = this.cfg().channels.log;
    if (!ch) return void (await i.editReply('承認を頼むログのチャンネルが決まっていません。宮司に頼んでください。'));
    const req = await createRoleRequest(this.db, { ...r, requestedBy: i.user.id });
    const what = r.kind === 'remove' ? 'から外す' : r.kind === 'temp' ? `に一時的に付ける（${r.minutes} 分）` : 'に付ける';
    await this.discord.sendMessage(ch, {
      content: `🛡 **ロールの承認待ち #${req.id}**: <@${i.user.id}> が <@${r.memberId}> ${what}: <@&${r.roleId}>${r.reason ? `\n理由: ${r.reason}` : ''}\n頼んだ人とは別の神職・宮司が決めてください。`,
      allowed_mentions: { parse: [] },
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 3, label: '承認する', custom_id: `rolereq:approve:${req.id}` },
            { type: 2, style: 4, label: '却下する', custom_id: `rolereq:reject:${req.id}` },
          ],
        },
      ],
    });
    await i.editReply(`🛡 このロールは承認がいるので、承認待ち #${req.id} にしました。別の神職・宮司が承認すると付け外しされます。`);
  }

  /** 承認・却下（頼んだ本人以外の神職・宮司） */
  private async decide(i: ButtonInteraction<'cached'>): Promise<void> {
    const [, action, idText] = i.customId.split(':');
    const level = adminLevelOf(this.cfg(), [...i.member.roles.cache.keys()]);
    if (!level) return void (await i.reply({ content: '神職・宮司だけが決められます。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const d = await decideRoleRequest(this.db, Number(idText), i.user.id, action === 'approve');
    if (d.status === 'self') return void (await i.editReply('自分で頼んだものは決められません。ほかの神職・宮司に頼んでください。'));
    if (d.status !== 'ok') return void (await i.editReply('この頼みは、もう決まっています。'));
    const req = d.request;
    const done = async (text: string) => {
      await i.message.edit({ content: `${i.message.content}\n${text}`, components: [] }).catch(() => undefined);
      await i.editReply(text);
    };
    if (action !== 'approve') return done(`❌ <@${i.user.id}> が却下しました。`);
    const target = await i.guild.members.fetch(req.memberId).catch(() => null);
    const ctx = { db: this.db, cfg: this.cfg(), discord: this.discord };
    const common = { memberId: req.memberId, roleId: req.roleId, reason: `${req.reason}（#${req.id} 承認: ${i.user.id}）`, by: i.user.id, byLevel: level, roles: rolesOf(i.guild), memberRoleIds: target ? [...target.roles.cache.keys()] : [], botId: i.client.user.id, via: 'discord' as const };
    let text: string;
    let okDone = false;
    if (req.kind === 'temp') {
      const r = await grantRole(ctx, { ...common, minutes: req.minutes ?? 60 });
      okDone = r.status === 'granted' || r.status === 'extended';
      text = this.resultText(r, `<@${req.memberId}> に <@&${req.roleId}>`);
    } else if (!target) {
      text = 'その人はもうこのサーバーにいません。';
    } else {
      const r = await changeRole(ctx, { ...common, action: req.kind === 'remove' ? 'remove' : 'give' });
      okDone = r.status === 'given' || r.status === 'removed';
      text = r.status === 'given' ? `🏷 <@${req.memberId}> に <@&${req.roleId}> を付けました。` : r.status === 'removed' ? `🏷 <@${req.memberId}> の <@&${req.roleId}> を外しました。` : ROLE_CHANGE_MESSAGES[r.status];
    }
    await finishRoleRequest(this.db, req.id, okDone, text);
    return done(`✅ <@${i.user.id}> が承認しました。${text}`);
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
      // 🛡 許可リストにないロールは、別の神職・宮司の承認を待つ
      if (needsApproval(cfg, level, role.id)) return this.ask(i, { kind: sub === 'remove' ? 'remove' : 'give', memberId: user.id, roleId: role.id, reason: i.options.getString('reason') ?? '' });
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
      if (needsApproval(cfg, level, role.id)) return this.ask(i, { kind: 'temp', memberId: user.id, roleId: role.id, minutes, reason: i.options.getString('reason') ?? '' });
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

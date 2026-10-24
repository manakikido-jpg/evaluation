import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type Interaction,
  type VoiceBasedChannel,
} from 'discord.js';
import type { GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * 🛡 通話のチャットの「寝落ちを報告する」「運営を呼ぶ」。
 * 本殿・作業の通話だけに出す。押すと衛士（ロール名に「衛士」）に知らせる。
 * 知らせる先: 名前に「衛士」が入るテキストチャンネル（なければ運営のログ）。
 */
const PREFIX = 'vchelp:';
/** 同じ通話・同じ種類の知らせは、この間は 1 回だけ（いたずら・二重押し止め） */
export const VC_HELP_COOLDOWN_MS = 2 * 60_000;

export type VcHelpKind = 'sleep' | 'call';
export const vcHelpId = (kind: 'sleep' | 'call' | 'pick' | 'modal', channelId: string) => `${PREFIX}${kind}:${channelId}`;

/** 本殿・作業の通話か（通話の名前か、入っているカテゴリの名前で見る） */
export function isVcHelpChannel(channel: { name: string; parent?: { name: string } | null }): boolean {
  return [channel.name, channel.parent?.name ?? ''].some((n) => /本殿|作業/.test(n));
}

export function vcHelpRow(channelId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(vcHelpId('sleep', channelId)).setLabel('寝落ちを報告する').setEmoji('💤').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(vcHelpId('call', channelId)).setLabel('運営を呼ぶ').setEmoji('🛡').setStyle(ButtonStyle.Secondary),
  );
}

/** 衛士に送る文 */
export function vcHelpNotice(p: { kind: VcHelpKind; roleId?: string; channelId: string; reporterId: string; targetId?: string; reason?: string }): string {
  const head = p.roleId ? `<@&${p.roleId}> ` : '';
  if (p.kind === 'sleep') return `${head}💤 **寝落ちの報告**\n通話: <#${p.channelId}>\n寝落ちしている人: <@${p.targetId}>\n報告した人: <@${p.reporterId}>\n-# 奥の院への移動をお願いします。`;
  return `${head}🛡 **運営を呼んでいます**\n通話: <#${p.channelId}>\n呼んだ人: <@${p.reporterId}>${p.reason ? `\nようす: ${p.reason}` : ''}`;
}

export class VcHelpApp {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly cfg: () => GuildConfig,
    private readonly now: () => number = Date.now,
  ) {}

  async onInteraction(i: Interaction): Promise<void> {
    if (!i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    const id = 'customId' in i ? i.customId : '';
    if (!id.startsWith(PREFIX)) return;
    const [kind, channelId] = id.slice(PREFIX.length).split(':') as [string, string];
    try {
      const vc = i.guild.channels.cache.get(channelId);
      if (!vc?.isVoiceBased()) return void (i.isRepliable() && (await i.reply({ content: 'この通話が見つかりませんでした。', flags: MessageFlags.Ephemeral })));
      if (i.isButton() && kind === 'sleep') {
        const people = [...vc.members.values()].filter((m) => !m.user.bot && m.id !== i.user.id).slice(0, 25);
        if (!people.length) return void (await i.reply({ content: '今この通話には、ほかの方がいません。', flags: MessageFlags.Ephemeral }));
        const menu = new StringSelectMenuBuilder()
          .setCustomId(vcHelpId('pick', channelId))
          .setPlaceholder('寝落ちしている人をえらぶ')
          .addOptions(people.map((m) => ({ label: m.displayName.slice(0, 100) || '（名前なし）', value: m.id })));
        return void (await i.reply({ content: '💤 寝落ちしている人をえらんでください。衛士に知らせます。', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], flags: MessageFlags.Ephemeral }));
      }
      if (i.isStringSelectMenu() && kind === 'pick') {
        const target = i.values[0];
        if (!target || !vc.members.has(target)) return void (await i.update({ content: 'その方はもう通話にいません。', components: [] }));
        return void (await i.update({ content: await this.notify(i.guild, vc, 'sleep', i.user.id, { targetId: target }), components: [] }));
      }
      if (i.isButton() && kind === 'call') {
        const modal = new ModalBuilder().setCustomId(vcHelpId('modal', channelId)).setTitle('運営を呼ぶ').addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId('reason').setLabel('ようす（書かなくてもよいです）').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300),
          ),
        );
        return void (await i.showModal(modal));
      }
      if (i.isModalSubmit() && kind === 'modal') {
        const reason = i.fields.getTextInputValue('reason').trim().replace(/@/g, '＠');
        return void (await i.reply({ content: await this.notify(i.guild, vc, 'call', i.user.id, { reason }), flags: MessageFlags.Ephemeral }));
      }
    } catch (err) {
      logger.warn({ err }, 'vc help failed');
    }
  }

  /** 衛士に知らせて、押した人への返事を返す */
  private async notify(guild: Guild, vc: VoiceBasedChannel, kind: VcHelpKind, reporterId: string, extra: { targetId?: string; reason?: string }): Promise<string> {
    const key = `${vc.id}:${kind}:${extra.targetId ?? ''}`;
    const prev = this.last.get(key);
    if (prev && this.now() - prev < VC_HELP_COOLDOWN_MS) return '✅ 少し前に、ほかの方が知らせています。衛士が向かうまでお待ちください。';
    const role = guild.roles.cache.find((r) => r.name.includes('衛士'));
    const dest =
      guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name.includes('衛士')) ??
      (this.cfg().channels.log ? guild.channels.cache.get(this.cfg().channels.log!) : undefined);
    if (!dest?.isSendable()) return '知らせる先のチャンネルが見つかりませんでした。運営に直接お声がけください。';
    await dest.send({ content: vcHelpNotice({ kind, roleId: role?.id, channelId: vc.id, reporterId, ...extra }), allowedMentions: { roles: role ? [role.id] : [], users: [] } });
    this.last.set(key, this.now());
    return kind === 'sleep' ? '✅ 衛士に寝落ちを知らせました。ありがとうございます。' : '✅ 衛士に知らせました。少しお待ちください。';
  }
}

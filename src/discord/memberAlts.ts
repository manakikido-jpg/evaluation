import { MessageFlags, type Guild, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { requestMemberAlt, type AltRequestResult } from '../services/memberAlts.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const TEXT: Record<AltRequestResult, string> = {
  ok: '🔗 サブアカウントの申告を受け付けました。運営が確かめて承認します。\n-# 承認されると、このアカウントには銭が入らず、朱印・招待のお礼も受けません。今の銭は本アカウントへ移します。',
  invalid: '申告できませんでした。',
  self: '本アカウントには、別のアカウントを選んでください（サブのアカウントで打ちます）。',
  exists: 'このアカウントは、もう申告ずみです（運営の確認待ち、または承認ずみ）。',
  main_is_alt: '選んだ本アカウントが、だれかのサブとして申告されています。本アカウントを選び直してください。',
  alt_has_alts: 'このアカウントには、もうサブが申告されています。サブのアカウントで打ってください。',
  staff_alt: 'このアカウントでは申告できません。神職に知らせてください。',
};

/** 🔗 サブアカウントの申告パネル（/パネル サブ垢申告） */
export const altPanelBody = () => ({
  embeds: [{ title: '🔗 サブアカウントの申告', description: 'サブアカウントは、申告して運営が承認すれば使えます（申告していないサブはルール違反です）。\n**サブのアカウントで**下のボタンを押し、本アカウントを選んでください。\n-# 承認されると、サブには銭が入らず、朱印・招待のお礼も受けません。サブの銭は本アカウントへ移ります。', color: 0xd7003a }],
  components: [{ type: 1, components: [{ type: 2, style: 1, label: 'サブアカウントを申告する', emoji: { name: '🔗' }, custom_id: 'alt:declare' }] }],
});

async function declare(db: Db, cfg: () => GuildConfig, guild: Guild, altId: string, mainId: string): Promise<string> {
  const r = await requestMemberAlt(db, { altId, mainId, by: altId, via: 'discord' });
  if (r === 'ok') {
    // 運営に知らせる（記録のチャンネル）
    const log = cfg().channels.log ? guild.channels.cache.get(cfg().channels.log!) : undefined;
    if (log?.isSendable()) {
      await log.send({ content: `🔗 サブアカウントの申告: <@${altId}> は <@${mainId}> のサブです（本人の申告）。社務所Web の「🔗 サブアカウント」で承認・却下してください。`, allowedMentions: { parse: [] } })
        .catch((err: unknown) => logger.warn({ err }, 'member alt notify failed'));
    }
  }
  return TEXT[r];
}

/** 🔗 /サブ垢 申告・申告パネルのボタン（サブのアカウントで使う） */
export async function onMemberAltInteraction(db: Db, cfg: () => GuildConfig, i: Interaction): Promise<void> {
  if (!i.inCachedGuild() || i.guildId !== cfg().guildId) return;
  // /パネル サブ垢申告
  if (i.isChatInputCommand() && i.commandName === 'panel' && i.options.getSubcommand(false) === 'alt') {
    if (!i.channel?.isSendable()) return void (await i.reply({ content: 'このチャンネルには置けません。', ...EPHEMERAL }));
    await i.channel.send({ ...altPanelBody(), allowedMentions: { parse: [] } } as never);
    return void (await i.reply({ content: '🔗 サブアカウントの申告パネルを置きました。', ...EPHEMERAL }));
  }
  // パネルのボタン: 本アカウントを選んでもらう
  if (i.isButton() && i.customId === 'alt:declare') {
    return void (await i.reply({
      content: '🔗 あなたの**本アカウント**を選んでください（このボタンは、サブのアカウントで押します）。',
      components: [{ type: 1, components: [{ type: 5, custom_id: 'alt:main', placeholder: '本アカウントを選ぶ', min_values: 1, max_values: 1 }] }],
      ...EPHEMERAL,
    } as never));
  }
  if (i.isUserSelectMenu() && i.customId === 'alt:main') {
    const main = i.users.first();
    if (!main || main.bot) return void (await i.update({ content: 'BOT は本アカウントにできません。', components: [] }));
    return void (await i.update({ content: await declare(db, cfg, i.guild, i.user.id, main.id), components: [] }));
  }
  if (i.isChatInputCommand() && i.commandName === 'alt') {
    const main = i.options.getUser('main', true);
    if (main.bot) return void (await i.reply({ content: 'BOT は本アカウントにできません。', ...EPHEMERAL }));
    await i.reply({ content: await declare(db, cfg, i.guild, i.user.id, main.id), ...EPHEMERAL });
  }
}

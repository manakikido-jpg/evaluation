import { MessageFlags, type Guild, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { ALT_CODE_TTL_MS, issueAltCode, redeemAltCode, requestMemberAlt, type AltRequestResult } from '../services/memberAlts.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const TEXT: Record<AltRequestResult | 'okMain', string> = {
  ok: '🔗 サブアカウントの申告を受け付けました。運営が確かめて承認します。\n-# 承認されると、このアカウントには銭が入らず、朱印・招待のお礼も受けません。今の銭は本アカウントへ移します。',
  okMain: '🔗 サブアカウントの申告を受け付けました。運営が確かめて承認します。\n-# 承認されると、サブのアカウントには銭が入らず、朱印・招待のお礼も受けません。サブが今持っている銭は、そのままです（本アカウントへは移しません）。',
  invalid: '申告できませんでした。',
  self: '本アカウントには、別のアカウントを選んでください（サブのアカウントで打ちます）。',
  exists: 'このアカウントは、もう申告ずみです（運営の確認待ち、または承認ずみ）。',
  main_is_alt: '選んだ本アカウントが、だれかのサブとして申告されています。本アカウントを選び直してください。',
  alt_has_alts: 'このアカウントには、もうサブが申告されています。サブのアカウントで打ってください。',
  staff_alt: 'このアカウントでは申告できません。神職に知らせてください。',
};

const CODE_ERR: Record<string, string> = {
  invalid_code: '合言葉が違うか、期限（10 分）が切れています。本アカウントで、もう一度「合言葉をもらう」を押してください。',
  locked: '合言葉を続けて間違えたので、10 分ほど入れられません。',
  invalid: '合言葉を使えませんでした。',
  self: '本アカウントの合言葉は、サブのアカウントで入れます。',
  exists: TEXT.exists,
  main_is_alt: TEXT.main_is_alt,
  alt_has_alts: TEXT.alt_has_alts,
  staff_alt: TEXT.staff_alt,
};

/** 合言葉を出す（本アカウント） */
async function giveCode(db: Db, mainId: string): Promise<string> {
  const r = await issueAltCode(db, mainId);
  if (r.status === 'main_is_alt') return 'このアカウントは、サブとして申告されています。合言葉は、本アカウントでもらってください。';
  if (r.status !== 'ok') return '合言葉を出せませんでした。神職に知らせてください。';
  return `🔑 合言葉: **\`${r.code}\`**\n${ALT_CODE_TTL_MS / 60_000} 分以内に、**サブのアカウント**で「🔑 合言葉を入れる」を押して入れてください（1 回だけ使えます）。\n-# 合言葉は、自分のサブのアカウント以外には見せないでください。もらい直すと、前の合言葉は使えなくなります。`;
}

/** 合言葉を入れる（サブのアカウント） */
async function useCode(db: Db, cfg: () => GuildConfig, guild: Guild, altId: string, raw: string): Promise<string> {
  const r = await redeemAltCode(db, altId, raw);
  if (r.status !== 'linked' && r.status !== 'pending') return CODE_ERR[r.status] ?? CODE_ERR.invalid!;
  const log = cfg().channels.log ? guild.channels.cache.get(cfg().channels.log!) : undefined;
  if (log?.isSendable()) {
    const text = r.status === 'linked'
      ? `🔗 サブアカウントがつながりました（合言葉）: <@${altId}> は <@${r.mainId}> のサブです。`
      : `🔗 サブアカウントの申告（合言葉で確認ずみ）: <@${altId}> は <@${r.mainId}> のサブです。社務所Web の「🔗 サブアカウント」で承認してください。`;
    await log.send({ content: text, allowedMentions: { parse: [] } }).catch((err: unknown) => logger.warn({ err }, 'member alt notify failed'));
  }
  if (r.status === 'pending') return '🔑 合言葉が合いました。運営が承認すると、サブとしてつながります。';
  return `🔗 サブアカウントとしてつながりました（本アカウント: <@${r.mainId}>）。\n-# このアカウントには銭が入らず、朱印・招待のお礼も受けません。${r.moved > 0 ? `持っていた銭（${r.moved.toLocaleString('ja-JP')} 枚）は、本アカウントへ移しました。` : ''}`;
}

/** 🔗 サブアカウントの申告パネル（/パネル サブ垢申告） */
export const altPanelBody = () => ({
  embeds: [{ title: '🔗 サブアカウントの申告', description: [
    'サブアカウントは、申告すれば使えます（申告していないサブはルール違反です）。',
    '**① 本アカウント**で「🔑 合言葉をもらう」を押します（6 文字・10 分・1 回だけ）。',
    '**② サブのアカウント**で「🔑 合言葉を入れる」を押して、合言葉を入れます。',
    '両方の操作がそろうと、その場でサブとしてつながります。',
    '-# つながったサブには、銭が入らず、朱印・招待のお礼も受けません。サブの銭は本アカウントへ移ります。',
  ].join('\n'), color: 0xd7003a }],
  components: [
    { type: 1, components: [
      { type: 2, style: 1, label: '合言葉をもらう（本アカウント）', emoji: { name: '🔑' }, custom_id: 'alt:code_get' },
      { type: 2, style: 3, label: '合言葉を入れる（サブ）', emoji: { name: '🔑' }, custom_id: 'alt:code_enter' },
    ] },
    { type: 1, components: [
      { type: 2, style: 2, label: '運営に確かめてもらう（本アカウントから）', custom_id: 'alt:declare_main' },
      { type: 2, style: 2, label: '運営に確かめてもらう（サブから）', custom_id: 'alt:declare' },
    ] },
  ],
});

/** by: 申告した人（サブ本人か、本アカウントの人） */
async function declare(db: Db, cfg: () => GuildConfig, guild: Guild, altId: string, mainId: string, by: string): Promise<string> {
  const r = await requestMemberAlt(db, { altId, mainId, by, via: 'discord' });
  if (r === 'ok') {
    // 運営に知らせる（記録のチャンネル）
    const log = cfg().channels.log ? guild.channels.cache.get(cfg().channels.log!) : undefined;
    if (log?.isSendable()) {
      await log.send({ content: `🔗 サブアカウントの申告: <@${altId}> は <@${mainId}> のサブです（${by === altId ? 'サブ本人の申告' : '本アカウント側の申告'}）。社務所Web の「🔗 サブアカウント」で承認・却下してください。`, allowedMentions: { parse: [] } })
        .catch((err: unknown) => logger.warn({ err }, 'member alt notify failed'));
    }
  }
  return r === 'ok' && by !== altId ? TEXT.okMain : TEXT[r];
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
  // 🔑 合言葉（本アカウントでもらい、サブのアカウントで入れる）
  if (i.isButton() && i.customId === 'alt:code_get') return void (await i.reply({ content: await giveCode(db, i.user.id), ...EPHEMERAL }));
  if (i.isButton() && i.customId === 'alt:code_enter') {
    return void (await i.showModal({ custom_id: 'alt:code_modal', title: '合言葉を入れる', components: [{ type: 1, components: [{ type: 4, custom_id: 'code', label: '本アカウントで出した合言葉（6 文字）', style: 1, min_length: 6, max_length: 12, required: true }] }] } as never));
  }
  if (i.isModalSubmit() && i.customId === 'alt:code_modal') {
    await i.deferReply(EPHEMERAL);
    return void (await i.editReply({ content: await useCode(db, cfg, i.guild, i.user.id, i.fields.getTextInputValue('code')), allowedMentions: { parse: [] } }));
  }
  // パネルのボタン: 本アカウントを選んでもらう
  if (i.isButton() && i.customId === 'alt:declare') {
    return void (await i.reply({
      content: '🔗 あなたの**本アカウント**を選んでください（このボタンは、サブのアカウントで押します）。',
      components: [{ type: 1, components: [{ type: 5, custom_id: 'alt:main', placeholder: '本アカウントを選ぶ', min_values: 1, max_values: 1 }] }],
      ...EPHEMERAL,
    } as never));
  }
  // パネルのボタン（本アカウントから）: サブを選んでもらう
  if (i.isButton() && i.customId === 'alt:declare_main') {
    return void (await i.reply({
      content: '🔗 あなたの**サブアカウント**を選んでください（このボタンは、本アカウントで押します）。',
      components: [{ type: 1, components: [{ type: 5, custom_id: 'alt:sub', placeholder: 'サブアカウントを選ぶ', min_values: 1, max_values: 1 }] }],
      ...EPHEMERAL,
    } as never));
  }
  if (i.isUserSelectMenu() && i.customId === 'alt:main') {
    const main = i.users.first();
    if (!main || main.bot) return void (await i.update({ content: 'BOT は本アカウントにできません。', components: [] }));
    return void (await i.update({ content: await declare(db, cfg, i.guild, i.user.id, main.id, i.user.id), components: [] }));
  }
  if (i.isUserSelectMenu() && i.customId === 'alt:sub') {
    const sub = i.users.first();
    if (!sub || sub.bot) return void (await i.update({ content: 'BOT はサブアカウントにできません。', components: [] }));
    return void (await i.update({ content: await declare(db, cfg, i.guild, sub.id, i.user.id, i.user.id), components: [] }));
  }
  if (i.isChatInputCommand() && i.commandName === 'alt') {
    if (i.options.getSubcommand(false) === 'code') return void (await i.reply({ content: await giveCode(db, i.user.id), ...EPHEMERAL }));
    if (i.options.getSubcommand(false) === 'enter') {
      await i.deferReply(EPHEMERAL);
      return void (await i.editReply({ content: await useCode(db, cfg, i.guild, i.user.id, i.options.getString('code', true)), allowedMentions: { parse: [] } }));
    }
    if (i.options.getSubcommand(false) === 'declare-main') {
      const sub = i.options.getUser('sub', true);
      if (sub.bot) return void (await i.reply({ content: 'BOT はサブアカウントにできません。', ...EPHEMERAL }));
      return void (await i.reply({ content: await declare(db, cfg, i.guild, sub.id, i.user.id, i.user.id), ...EPHEMERAL }));
    }
    const main = i.options.getUser('main', true);
    if (main.bot) return void (await i.reply({ content: 'BOT は本アカウントにできません。', ...EPHEMERAL }));
    await i.reply({ content: await declare(db, cfg, i.guild, i.user.id, main.id, i.user.id), ...EPHEMERAL });
  }
}

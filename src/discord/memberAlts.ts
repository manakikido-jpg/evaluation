import { MessageFlags, type Interaction } from 'discord.js';
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

/** 🔗 /サブ垢 申告（サブのアカウントで打つ） */
export async function onMemberAltInteraction(db: Db, cfg: () => GuildConfig, i: Interaction): Promise<void> {
  if (!i.isChatInputCommand() || i.commandName !== 'alt' || !i.inCachedGuild() || i.guildId !== cfg().guildId) return;
  const main = i.options.getUser('main', true);
  if (main.bot) return void (await i.reply({ content: 'BOT は本アカウントにできません。', ...EPHEMERAL }));
  const r = await requestMemberAlt(db, { altId: i.user.id, mainId: main.id, by: i.user.id, via: 'discord' });
  await i.reply({ content: TEXT[r], ...EPHEMERAL });
  if (r !== 'ok') return;
  // 運営に知らせる（記録のチャンネル）
  const log = cfg().channels.log ? i.guild.channels.cache.get(cfg().channels.log!) : undefined;
  if (log?.isSendable()) {
    await log.send({ content: `🔗 サブアカウントの申告: <@${i.user.id}> は <@${main.id}> のサブです（本人の申告）。社務所Web の「🔗 サブアカウント」で承認・却下してください。`, allowedMentions: { parse: [] } })
      .catch((err: unknown) => logger.warn({ err }, 'member alt notify failed'));
  }
}

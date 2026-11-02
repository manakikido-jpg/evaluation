import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { intros, members } from '../db/schema.js';
import { introInviterText, matchIntroInviters, type IntroInviterCandidate } from '../domain/introInviter.js';
import { DiscordHttpError, type DiscordActions } from '../lib/discordRest.js';
import { audit } from './audit.js';
import { introOf, introUrl, recordIntro, removeIntroMessages } from './intros.js';

export type IntroInviterSuggestion = { text: string; url: string; candidates: IntroInviterCandidate[]; fromExcerpt: boolean };
const emaChannels = (cfg: GuildConfig) => [cfg.channels.ema, cfg.channels.emaFemale].filter((id): id is string => !!id);

/** 宮司の登録画面用。候補を読むだけでは、招待の確定も報酬の支払いもしない。 */
export async function introInviterSuggestions(db: Db, cfg: GuildConfig, memberIds: string[]): Promise<Map<string, IntroInviterSuggestion>> {
  const channels = emaChannels(cfg);
  if (!memberIds.length || !channels.length) return new Map();
  const [rows, people] = await Promise.all([
    db.select().from(intros).where(and(inArray(intros.memberId, memberIds), inArray(intros.channelId, channels))),
    db.select({ id: members.id, name: members.displayName, username: members.username }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false))),
  ]);
  return new Map(rows.map(row => {
    const text = row.inviterText ?? introInviterText(row.excerpt);
    return [row.memberId, { text, url: introUrl(cfg.guildId, row), candidates: matchIntroInviters(text, row.memberId, people), fromExcerpt: row.inviterText === null }];
  }));
}

/** 指定されたURLは受け取らず、本人の記録済み絵馬だけを読み直す。 */
export async function refreshIntroInviter(db: Db, cfg: GuildConfig, discord: Pick<DiscordActions, 'introMessage'>, memberId: string, actorId: string): Promise<'refreshed' | 'missing' | 'unavailable'> {
  const row = await introOf(db, memberId);
  const [member] = await db.select({ id: members.id }).from(members).where(and(eq(members.id, memberId), isNull(members.leftAt), eq(members.isBot, false)));
  if (!row || !member || !emaChannels(cfg).includes(row.channelId)) return 'missing';
  if (!discord.introMessage) return 'unavailable';
  let message: Awaited<ReturnType<NonNullable<DiscordActions['introMessage']>>>;
  try { message = await discord.introMessage(row.channelId, row.messageId); }
  catch (err) {
    if (err instanceof DiscordHttpError && err.status === 404) {
      await db.transaction(async tx => {
        await removeIntroMessages(tx as Db, [row.messageId]);
        await audit(tx as Db, { actorId, targetId: memberId, action: 'invite.intro_refresh', detail: { channelId: row.channelId, messageId: row.messageId, result: 'missing' }, via: 'web' });
      });
      return 'missing';
    }
    return 'unavailable';
  }
  const postedAt = new Date(message.timestamp);
  if (message.id !== row.messageId || message.channel_id !== row.channelId || message.author.id !== memberId || message.author.bot || typeof message.content !== 'string' || !Number.isFinite(postedAt.getTime())) return 'unavailable';
  // 空の本文は権限・Message Content Intent不足の可能性があり、読めたことにしない。
  if (!message.content.trim()) return 'unavailable';
  await db.transaction(async tx => {
    await recordIntro(tx as Db, { memberId, channelId: row.channelId, messageId: row.messageId, content: message.content, postedAt });
    await audit(tx as Db, { actorId, targetId: memberId, action: 'invite.intro_refresh', detail: { channelId: row.channelId, messageId: row.messageId }, via: 'web' });
  });
  return 'refreshed';
}

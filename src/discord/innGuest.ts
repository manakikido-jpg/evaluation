import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  type Guild,
  type Interaction,
  type VoiceState,
} from 'discord.js';
import { eq, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';

/**
 * 🏯 院（役職だけが入れる通話）に、人を指名して一時的に入れる。
 * 呼ばれた人は、その通話に入って話す・その通話のチャットに文と画像を送れる。通話を抜けたら元に戻す。
 * 呼べるのは、もともとその通話に入れる人（役職）だけ。
 */
const PREFIX = 'inn:';
const KEY = 'inn.guests';
/** 呼ばれてから入らないまま、この時間がたったら元に戻す */
export const INN_GUEST_IDLE_MS = 30 * 60_000;
export const INN_GUEST_MAX = 5;
export const INN_GUEST_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.UseVAD,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
];
export type InnGuest = { channelId: string; memberId: string; by: string; at: string; joined?: boolean };

/** 院の通話か（入っているカテゴリの名前に「院」が入る。奥の院はのぞく） */
export function isInnChannel(ch: { name: string; parent?: { name: string } | null }): boolean {
  const names = [ch.parent?.name ?? '', ch.name ?? ''];
  return names.some((n) => n.includes('院')) && !names.some((n) => n.includes('奥の院'));
}

export function innRow(channelId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}invite:${channelId}`).setLabel('人を呼ぶ（一時的に入れる）').setEmoji('👤').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}remove:${channelId}`).setLabel('呼んだ人を帰す').setEmoji('🚪').setStyle(ButtonStyle.Secondary),
  );
}

export async function innGuests(db: Db): Promise<InnGuest[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = row?.value as { list?: unknown } | undefined;
  return Array.isArray(v?.list) ? (v.list as InnGuest[]).filter((g) => typeof g?.memberId === 'string' && typeof g?.channelId === 'string') : [];
}

/** 記録を書きかえる（同時に押されても順に） */
async function updateGuests(db: Db, fn: (list: InnGuest[]) => InnGuest[]): Promise<InnGuest[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY}))`);
    const next = fn(await innGuests(tx));
    await tx.insert(settings).values({ key: KEY, value: { list: next }, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value: { list: next }, updatedBy: 'system', updatedAt: new Date() } });
    return next;
  });
}

export class InnGuestApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async onInteraction(i: Interaction): Promise<void> {
    if (!i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    const id = 'customId' in i ? i.customId : '';
    if (!id.startsWith(PREFIX)) return;
    const [action, channelId] = id.slice(PREFIX.length).split(':') as [string, string];
    if (!i.isRepliable()) return;
    try {
      const vc = i.guild.channels.cache.get(channelId);
      if (!vc?.isVoiceBased() || !isInnChannel(vc)) return void (await i.reply({ content: 'この通話が見つかりませんでした。', flags: MessageFlags.Ephemeral }));
      // 呼べるのは、もともとこの通話に入れる人だけ（呼ばれた人は呼べない）
      const guests = (await innGuests(this.db)).filter((g) => g.channelId === vc.id);
      if (guests.some((g) => g.memberId === i.user.id) || !vc.permissionsFor(i.member)?.has(PermissionFlagsBits.Connect)) {
        return void (await i.reply({ content: 'この通話に入れる役職の方だけが使えます。', flags: MessageFlags.Ephemeral }));
      }
      if (i.isButton() && action === 'invite') {
        const menu = new UserSelectMenuBuilder().setCustomId(`${PREFIX}pick:${vc.id}`).setPlaceholder('呼ぶ人をえらぶ').setMinValues(1).setMaxValues(INN_GUEST_MAX);
        return void (await i.reply({ content: `👤 この通話に一時的に入れる人をえらんでください（${INN_GUEST_MAX} 人まで）。通話を抜けると元に戻ります。`, components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu)], flags: MessageFlags.Ephemeral }));
      }
      if (i.isUserSelectMenu() && action === 'pick') {
        await i.deferUpdate();
        const added: string[] = [];
        for (const user of i.users.values()) {
          if (user.bot || vc.permissionsFor(user.id)?.has(PermissionFlagsBits.Connect)) continue;
          await vc.permissionOverwrites.edit(user.id, Object.fromEntries(INN_GUEST_ALLOW.map((p) => [permName(p), true])), { reason: `🏯 院に呼ばれた（${i.member.displayName}）` });
          await updateGuests(this.db, (list) => [...list.filter((g) => !(g.channelId === vc.id && g.memberId === user.id)), { channelId: vc.id, memberId: user.id, by: i.user.id, at: this.now().toISOString() }]);
          await audit(this.db, { actorId: i.user.id, targetId: user.id, action: 'inn.guest_add', detail: { channelId: vc.id }, via: 'discord' });
          added.push(user.id);
        }
        if (added.length && vc.isSendable()) await vc.send({ content: `👤 ${added.map((u) => `<@${u}>`).join('・')} さんを、<@${i.user.id}> さんがこの通話に呼びました。通話を抜けると元に戻ります。`, allowedMentions: { users: added } }).catch(() => undefined);
        return void (await i.editReply({ content: added.length ? `✅ ${added.length} 人を呼びました。` : 'えらんだ人は、もう入れる人か BOT でした。', components: [] }));
      }
      if (i.isButton() && action === 'remove') {
        if (!guests.length) return void (await i.reply({ content: 'いま呼ばれている人はいません。', flags: MessageFlags.Ephemeral }));
        const menu = new StringSelectMenuBuilder().setCustomId(`${PREFIX}unpick:${vc.id}`).setPlaceholder('帰す人をえらぶ').setMinValues(1).setMaxValues(guests.length)
          .addOptions(guests.map((g) => ({ label: (i.guild.members.cache.get(g.memberId)?.displayName ?? g.memberId).slice(0, 100), value: g.memberId })));
        return void (await i.reply({ content: '🚪 帰す人をえらんでください（通話にいれば外します）。', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], flags: MessageFlags.Ephemeral }));
      }
      if (i.isStringSelectMenu() && action === 'unpick') {
        await i.deferUpdate();
        let n = 0;
        for (const memberId of i.values) if (await this.release(i.guild, vc.id, memberId, i.user.id)) n++;
        return void (await i.editReply({ content: `✅ ${n} 人を帰しました。`, components: [] }));
      }
    } catch (err) {
      logger.warn({ err }, 'inn guest failed');
      const content = 'うまくできませんでした。BOT に「チャンネルの管理」「権限の管理」「メンバーを移動」があるか確かめてください。';
      await (i.deferred || i.replied ? i.editReply({ content, components: [] }) : i.reply({ content, flags: MessageFlags.Ephemeral })).catch(() => undefined);
    }
  }

  /** 元に戻す（権限を消して、通話にいれば外す）。記録になければ false */
  async release(guild: Guild, channelId: string, memberId: string, by = 'system'): Promise<boolean> {
    const before = await innGuests(this.db);
    if (!before.some((g) => g.channelId === channelId && g.memberId === memberId)) return false;
    const vc = guild.channels.cache.get(channelId);
    if (vc?.isVoiceBased()) {
      await vc.permissionOverwrites.delete(memberId, '🏯 院に呼ばれた時間が終わった').catch((err: unknown) => logger.warn({ err }, 'inn guest overwrite delete failed'));
      const state = guild.voiceStates.cache.get(memberId);
      if (state?.channelId === channelId) await state.disconnect('🏯 院から帰す').catch(() => undefined);
    }
    await updateGuests(this.db, (list) => list.filter((g) => !(g.channelId === channelId && g.memberId === memberId)));
    await audit(this.db, { actorId: by, targetId: memberId, action: 'inn.guest_remove', detail: { channelId }, via: 'discord' });
    return true;
  }

  /** 呼ばれた人が入ったら覚える・抜けたら元に戻す */
  async onVoiceStateUpdate(before: VoiceState, after: VoiceState): Promise<void> {
    if (after.guild.id !== this.cfg().guildId || before.channelId === after.channelId) return;
    const guests = await innGuests(this.db);
    if (!guests.length) return;
    if (after.channelId && guests.some((g) => g.channelId === after.channelId && g.memberId === after.id && !g.joined)) {
      await updateGuests(this.db, (list) => list.map((g) => (g.channelId === after.channelId && g.memberId === after.id ? { ...g, joined: true } : g)));
    }
    if (before.channelId && guests.some((g) => g.channelId === before.channelId && g.memberId === after.id)) await this.release(after.guild, before.channelId, after.id);
  }

  /** 毎分: 呼ばれたのに入らないまま 30 分たった人・止まっていた間に抜けた人を元に戻す */
  async tick(guild: Guild): Promise<void> {
    if (guild.id !== this.cfg().guildId) return;
    const now = this.now().getTime();
    for (const g of await innGuests(this.db)) {
      const inVc = guild.voiceStates.cache.get(g.memberId)?.channelId === g.channelId;
      if (inVc) continue;
      if (g.joined || now - Date.parse(g.at) >= INN_GUEST_IDLE_MS) await this.release(guild, g.channelId, g.memberId);
    }
  }
}

/** 権限のビットから、discord.js の名前（ViewChannel など） */
const permName = (bit: bigint) => Object.entries(PermissionFlagsBits).find(([, v]) => v === bit)![0];

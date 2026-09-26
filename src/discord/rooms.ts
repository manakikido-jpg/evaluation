import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  MessageFlags,
  type Guild,
  type Interaction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type VoiceChannel,
} from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import {
  addInvites,
  changeRoomKind,
  hourlyRooms,
  isRoomKind,
  planOf,
  priceLabel,
  roomOf,
  roomOverwrites,
  ROOM_KINDS,
  startRoom,
  type Overwrite,
  type RoomKind,
  type RoomRow,
} from '../services/rooms.js';
import { OWNER_ALLOW } from './tempVoice.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const LIMITS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 0];

/** 部屋のチャットに出す「部屋の設定」（作った人だけ使える） */
export function roomPanel(cfg: GuildConfig, row: Pick<RoomRow, 'ownerId' | 'hubId' | 'kind'>, userLimit: number) {
  const plan = planOf(cfg, row.hubId);
  const how = plan === 'hourly' ? '1 時間ごとに払います（払えなくなると、招待限定などは公開に戻り、公開も払えなければ 5 分後に閉じます）' : 'ひらくたびに 1 回。種類を変えたら差額だけ払います';
  const k = ROOM_KINDS[row.kind];
  const lines = [
    `<@${row.ownerId}> さんの部屋です。下のメニューは作った人だけ使えます。`,
    `いま: **${k.emoji} ${k.label}**・人数 ${userLimit ? `${userLimit} 人まで` : '上限なし'}`,
    '',
    ...(Object.keys(ROOM_KINDS) as RoomKind[]).map((key) => `${ROOM_KINDS[key].emoji} ${ROOM_KINDS[key].label} … ${priceLabel(cfg, plan, key)}（${ROOM_KINDS[key].description}）`),
    `-# 🌸 花びら: ${how}`,
    '-# 招待限定・シークレット・ツーショットの部屋には、運営も入れません',
  ];
  return {
    embeds: [{ title: '⚙ 部屋の設定', description: lines.join('\n'), color: 0x6b5b95 }],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('room:kind')
          .setPlaceholder('部屋の種類を変える')
          .addOptions(
            (Object.keys(ROOM_KINDS) as RoomKind[]).map((key) => ({
              label: `${ROOM_KINDS[key].label}（${priceLabel(cfg, plan, key)}）`,
              value: key,
              description: ROOM_KINDS[key].description,
              emoji: ROOM_KINDS[key].emoji,
              default: key === row.kind,
            })),
          ),
      ),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('room:limit')
          .setPlaceholder('人数の上限を変える')
          .addOptions(LIMITS.map((n) => ({ label: n ? `${n} 人まで` : '上限なし', value: String(n), default: n === userLimit }))),
      ),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder().setCustomId('room:invite').setPlaceholder('招待する人を選ぶ').setMinValues(1).setMaxValues(10),
      ),
    ],
    allowedMentions: { parse: [] as const },
  };
}

export class RoomApp {
  private guild?: Guild;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    /** 部屋を閉じる（TempVoiceApp） */
    private readonly close: (channelId: string) => Promise<void>,
  ) {}

  attach(guild: Guild): void {
    this.guild = guild;
  }

  private voice(channelId: string): VoiceChannel | undefined {
    const ch = this.guild?.channels.cache.get(channelId);
    return ch?.isVoiceBased() && ch.isTextBased() && 'userLimit' in ch ? (ch as VoiceChannel) : undefined;
  }

  /** 部屋ができたとき: 公開の値段を払い、部屋の設定を出す */
  async onCreated(channelId: string, ownerId: string): Promise<void> {
    const cfg = this.cfg();
    const row = await roomOf(this.db, channelId);
    if (!row || planOf(cfg, row.hubId) === 'none') return;
    const ch = this.voice(channelId);
    const r = await startRoom(this.db, cfg, channelId);
    if (r.status === 'insufficient') {
      await ch?.send({ content: `<@${ownerId}> さん、花びらが足りないため部屋をひらけませんでした（${r.price} 枚必要）。`, allowedMentions: { users: [ownerId] } }).catch(() => undefined);
      await this.close(channelId);
      return;
    }
    await ch?.send(roomPanel(cfg, row, ch.userLimit));
  }

  /** 種類に合わせて、見える・入れる範囲を付け直す */
  private async apply(ch: VoiceChannel, row: RoomRow, kind: RoomKind): Promise<void> {
    const parent = ch.parent;
    const base: Overwrite[] = parent
      ? parent.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type as 0 | 1, allow: o.allow.bitfield, deny: o.deny.bitfield }))
      : [];
    const list = roomOverwrites(base, kind, { ownerId: row.ownerId, botId: ch.client.user.id, invited: row.invited, ownerAllow: OWNER_ALLOW });
    await ch.permissionOverwrites.set(
      list.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })),
      `部屋の種類: ${ROOM_KINDS[kind].label}`,
    );
    if (kind === 'twoshot') await ch.setUserLimit(2);
    else if (row.kind === 'twoshot') await ch.setUserLimit(0);
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    if (!(interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) || !interaction.customId.startsWith('room:')) return;
    try {
      const row = await roomOf(this.db, interaction.channelId);
      const ch = this.voice(interaction.channelId);
      if (!row || !ch) return void (await interaction.reply({ content: 'この部屋はもうありません。', ...EPHEMERAL }));
      if (interaction.user.id !== row.ownerId) return void (await interaction.reply({ content: '部屋の設定は、部屋を作った人だけが変えられます。', ...EPHEMERAL }));
      if (interaction.isStringSelectMenu() && interaction.customId === 'room:kind') return await this.kind(interaction, row, ch);
      if (interaction.isStringSelectMenu() && interaction.customId === 'room:limit') return await this.limit(interaction, row, ch);
      if (interaction.isUserSelectMenu() && interaction.customId === 'room:invite') return await this.invite(interaction, row, ch);
    } catch (err) {
      logger.warn({ err }, 'room settings failed');
      const content = 'うまくいきませんでした。BOT に「チャンネルの管理」「ロールの管理」の権限があるか、神職に確かめてもらってください。';
      await (interaction.deferred || interaction.replied ? interaction.followUp({ content, ...EPHEMERAL }) : interaction.reply({ content, ...EPHEMERAL })).catch(() => undefined);
    }
  }

  private async kind(i: StringSelectMenuInteraction<'cached'>, row: RoomRow, ch: VoiceChannel): Promise<void> {
    const kind = i.values[0];
    if (!isRoomKind(kind)) return;
    if (kind === row.kind) return void (await i.reply({ content: 'もうその種類です。', ...EPHEMERAL }));
    if (kind === 'twoshot' && ch.members.filter((m) => !m.user.bot).size > 2) {
      return void (await i.reply({ content: '今 3 人以上いるので、ツーショットにはできません。', ...EPHEMERAL }));
    }
    const r = await changeRoomKind(this.db, this.cfg(), ch.id, kind);
    if (r.status === 'not_found') return void (await i.reply({ content: 'この部屋はもうありません。', ...EPHEMERAL }));
    if (r.status === 'insufficient') return void (await i.reply({ content: `花びらが足りません（${r.price} 枚必要）。`, ...EPHEMERAL }));
    await this.apply(ch, row, kind);
    await i.update(roomPanel(this.cfg(), { ...row, kind }, kind === 'twoshot' ? 2 : row.kind === 'twoshot' ? 0 : ch.userLimit));
    const k = ROOM_KINDS[kind];
    const paid = r.charged ? `（花びら ${r.charged} 枚を払いました）` : '';
    await i.followUp({ content: `${k.emoji} ${k.label}にしました${paid}。${kind === 'public' ? '' : '入ってほしい人は「招待する人を選ぶ」から招待してください。'}`, ...EPHEMERAL });
  }

  private async limit(i: StringSelectMenuInteraction<'cached'>, row: RoomRow, ch: VoiceChannel): Promise<void> {
    if (row.kind === 'twoshot') return void (await i.reply({ content: 'ツーショットの部屋は 2 人までです。', ...EPHEMERAL }));
    const n = Number(i.values[0]);
    if (!LIMITS.includes(n)) return;
    await ch.setUserLimit(n, '部屋の人数');
    await i.update(roomPanel(this.cfg(), row, n));
  }

  private async invite(i: UserSelectMenuInteraction<'cached'>, row: RoomRow, ch: VoiceChannel): Promise<void> {
    const ids = i.values.filter((id) => id !== row.ownerId && !i.users.get(id)?.bot);
    if (!ids.length) return void (await i.reply({ content: '招待できる人がいません（自分・BOT は選べません）。', ...EPHEMERAL }));
    if (row.kind === 'twoshot' && new Set([...row.invited, ...ids]).size > 1) {
      return void (await i.reply({ content: 'ツーショットの部屋に招待できるのは 1 人だけです。', ...EPHEMERAL }));
    }
    const updated = await addInvites(this.db, ch.id, ids);
    if (!updated) return;
    await this.apply(ch, updated, updated.kind);
    await i.reply({ content: `${ids.map((id) => `<@${id}>`).join(' ')} さんを招待しました。`, ...EPHEMERAL, allowedMentions: { parse: [] } });
    // 招待された人に通知（この部屋のチャットで呼ぶ）
    await ch.send({ content: `${ids.map((id) => `<@${id}>`).join(' ')} さん、<@${row.ownerId}> さんから <#${ch.id}> への招待です。`, allowedMentions: { users: ids } });
  }

  /** 1 分ごと: 1 時間ごとの部屋の支払い */
  async tick(): Promise<void> {
    const cfg = this.cfg();
    for (const a of await hourlyRooms(this.db, cfg)) {
      const ch = this.voice(a.channelId);
      const row = await roomOf(this.db, a.channelId);
      try {
        if (a.action === 'downgraded' && ch && row) {
          await this.apply(ch, { ...row, kind: a.from }, 'public');
          await ch.send({ content: `<@${row.ownerId}> さん、花びらが足りないため、部屋を公開に戻しました。`, allowedMentions: { users: [row.ownerId] } });
          await ch.send(roomPanel(cfg, { ...row, kind: 'public' }, ch.userLimit));
        } else if (a.action === 'warned' && ch && row) {
          await ch.send({ content: `<@${row.ownerId}> さん、花びらが足りません。5 分以内に払えないと、この部屋は閉じます。`, allowedMentions: { users: [row.ownerId] } });
        } else if (a.action === 'close') {
          await this.close(a.channelId);
        }
      } catch (err) {
        logger.warn({ err, channelId: a.channelId }, 'room hourly action failed');
      }
    }
  }
}

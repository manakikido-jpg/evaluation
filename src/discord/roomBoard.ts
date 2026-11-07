import { createHash } from 'node:crypto';
import { ChannelType, escapeMarkdown, type Guild, type VoiceChannel } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { roomKnockConfig, roomKnockState, ROOM_MODES, type RoomMode } from '../services/roomKnock.js';
import { listRooms } from '../services/rooms.js';

/**
 * 🏨 いまの部屋の掲示板。宿の VC（こんこんを使える VC）で人がいるものを、1 部屋 1 メッセージで出す。
 * 人数・入室のしかた（出入り自由／こんこん歓迎／取り込み中／🔑 招待のみ）・今の話題。シクレの宿は出さない。
 * 出す先は社務所Web の「宿のこんこん」で選ぶ（room_knock.config の boardChannelId。空なら出さない）
 */
const STATE_KEY = 'room_board.messages';
type BoardState = { channelId: string; items: Record<string, { messageId: string; hash: string }> };

export type BoardInfo = {
  vcId: string; guildId: string; name: string; count: number; mode: RoomMode;
  invite: boolean; topic?: string; ownerId?: string; knockEnabled: boolean;
};
const COLOR: Record<RoomMode, number> = { open: 0x57a773, knock: 0xe0a33a, busy: 0x5b5b8f };

/** 1 部屋ぶんのメッセージ */
export function roomBoardCard(i: BoardInfo) {
  const lines = [
    `👥 **${i.count}人**`,
    i.invite ? '🔑 招待のみ（身内の集まり）' : `入室：**${ROOM_MODES[i.mode]}**`,
    `💬 今の話題：${i.topic ? escapeMarkdown(i.topic) : '—'}`,
    ...(i.ownerId ? [`部屋主：<@${i.ownerId}>`] : []),
  ];
  const buttons: Record<string, unknown>[] = [{ type: 2, style: 5, label: '部屋を開く', url: `https://discord.com/channels/${i.guildId}/${i.vcId}` }];
  if (!i.invite && i.mode === 'knock' && i.knockEnabled) buttons.unshift({ type: 2, style: 1, label: '🚪 こんこんする', custom_id: `rkn:knock:${i.vcId}` });
  return {
    embeds: [{ title: i.name.slice(0, 256), description: lines.join('\n'), color: i.invite ? 0x888888 : COLOR[i.mode] }],
    components: [{ type: 1, components: buttons }],
    allowedMentions: { parse: [] as never[] },
  };
}
const hashOf = (card: unknown) => createHash('sha1').update(JSON.stringify(card)).digest('hex');

export class RoomBoardApp {
  private guild?: Guild;
  private timer?: NodeJS.Timeout;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    /** 宿の VC か（RoomKnockApp.isEligible） */
    private readonly eligible: (ch: VoiceChannel) => Promise<boolean>,
    private readonly delayMs = 3_000,
  ) {}

  async attach(guild: Guild): Promise<void> {
    this.guild = guild;
    await this.refreshNow();
  }

  /** 通話の出入り・受付や話題が変わったとき（少しまとめてから書きかえる） */
  schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refreshNow(), this.delayMs);
  }

  /** 毎分の確認・起動したとき。同時に 2 つは動かさない */
  refreshNow(): Promise<void> {
    const run = this.queue.then(() => this.refresh()).catch((err: unknown) => logger.warn({ err }, 'room board refresh failed'));
    this.queue = run;
    return run as Promise<void>;
  }

  private async loadState(): Promise<BoardState> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, STATE_KEY));
    const v = (row?.value ?? {}) as Partial<BoardState>;
    return { channelId: typeof v.channelId === 'string' ? v.channelId : '', items: v.items && typeof v.items === 'object' ? v.items : {} };
  }
  private async saveState(value: BoardState): Promise<void> {
    await this.db.insert(settings).values({ key: STATE_KEY, value, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: 'system', updatedAt: new Date() } });
  }

  private async refresh(): Promise<void> {
    const guild = this.guild;
    if (!guild || guild.id !== this.cfg().guildId) return;
    const conf = await roomKnockConfig(this.db);
    const state = await this.loadState();
    const channelOf = (id: string) => {
      const ch = id ? guild.channels.cache.get(id) : undefined;
      return ch?.isTextBased() && ch.isSendable() ? ch : undefined;
    };
    // 出す先を変えた・止めた: 前のチャンネルのメッセージを消す
    if (state.channelId && state.channelId !== conf.boardChannelId) {
      const old = channelOf(state.channelId);
      for (const item of Object.values(state.items)) await old?.messages.delete(item.messageId).catch(() => undefined);
      state.items = {};
    }
    state.channelId = conf.boardChannelId;
    const target = channelOf(conf.boardChannelId);
    if (!target) return void (await this.saveState({ channelId: conf.boardChannelId, items: {} }));

    const rows = new Map((await listRooms(this.db)).map((r) => [r.channelId, r]));
    const active: VoiceChannel[] = [];
    for (const ch of guild.channels.cache.values()) {
      if (ch.type !== ChannelType.GuildVoice) continue;
      if (!ch.members.some((m) => !m.user.bot)) continue;
      if (rows.get(ch.id)?.kind === 'secret') continue;
      if (await this.eligible(ch)) active.push(ch);
    }
    active.sort((a, b) => a.rawPosition - b.rawPosition);

    const next: BoardState['items'] = {};
    for (const ch of active) {
      const row = rows.get(ch.id), s = await roomKnockState(this.db, ch.id);
      const card = roomBoardCard({
        vcId: ch.id, guildId: guild.id, name: ch.name, count: ch.members.filter((m) => !m.user.bot).size, mode: s.mode,
        invite: row?.kind === 'invite', topic: s.topic?.text, ownerId: row?.ownerId, knockEnabled: conf.enabled,
      });
      const hash = hashOf(card), had = state.items[ch.id];
      try {
        if (had && had.hash === hash) { next[ch.id] = had; continue; }
        if (had) {
          const ok = await target.messages.edit(had.messageId, card as never).then(() => true).catch(() => false);
          if (ok) { next[ch.id] = { messageId: had.messageId, hash }; continue; }
        }
        // まだない・消されていた: 新しく出す
        const sent = await target.send(card as never);
        next[ch.id] = { messageId: sent.id, hash };
      } catch (err) {
        logger.warn({ err, channelId: ch.id }, 'room board card failed');
        if (had) next[ch.id] = had;
      }
    }
    // 空いた・消えた・シクレになった部屋のメッセージは消す
    for (const [vc, item] of Object.entries(state.items)) if (!next[vc]) await target.messages.delete(item.messageId).catch(() => undefined);
    await this.saveState({ channelId: conf.boardChannelId, items: next });
  }
}

import { ChannelType, type Guild, type VoiceChannel, type VoiceState } from 'discord.js';
import type { GuildConfig, VoiceGroup } from '../config.js';
import { logger } from '../lib/logger.js';
import { groupMembers, planGroup, type GroupChannel } from '../services/voiceGroups.js';

/** 出入りが続いても、落ち着いてから 1 回だけ確かめる */
const SETTLE_MS = 1500;

/** 自動で増える通話（大きな縁側 1〜3 など）。全部埋まったら次の番号を作り、空きが増えたら減らす */
export class VoiceGroupApp {
  private guild?: Guild;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly cfg: () => GuildConfig) {}

  async attach(guild: Guild): Promise<void> {
    this.guild = guild;
    await this.checkAll();
  }

  /** 1 分ごと（念のため） */
  async checkAll(): Promise<void> {
    for (const g of this.cfg().voiceGroups) await this.check(g);
  }

  private channels(): GroupChannel[] {
    const g = this.guild;
    if (!g) return [];
    return [...g.channels.cache.values()]
      .filter((c): c is VoiceChannel => c.type === ChannelType.GuildVoice)
      .map((c) => ({ id: c.id, name: c.name, position: c.rawPosition, members: c.members.filter((m) => !m.user.bot).size }));
  }

  onVoiceStateUpdate(before: VoiceState, after: VoiceState): void {
    if (before.channelId === after.channelId || after.guild.id !== this.cfg().guildId) return;
    const channels = this.channels();
    for (const group of this.cfg().voiceGroups) {
      const ids = new Set(groupMembers(channels, group).map((c) => c.id));
      if (!ids.has(before.channelId ?? '') && !ids.has(after.channelId ?? '')) continue;
      clearTimeout(this.timers.get(group.name));
      this.timers.set(
        group.name,
        setTimeout(() => void this.check(group), SETTLE_MS),
      );
    }
  }

  /** 同じ仲間は 1 つずつ（作っている間に、もう 1 つ作らないように） */
  private check(group: VoiceGroup): Promise<void> {
    const prev = this.running.get(group.name) ?? Promise.resolve();
    const next = prev.then(() => this.apply(group)).catch((err: unknown) => logger.warn({ err, group: group.name }, 'voice group update failed'));
    this.running.set(group.name, next);
    return next;
  }

  private async apply(group: VoiceGroup): Promise<void> {
    const g = this.guild;
    if (!g) return;
    const plan = planGroup(this.channels(), group);
    if (plan.create) {
      const last = g.channels.cache.get(plan.create.afterId);
      if (last?.type === ChannelType.GuildVoice) {
        const ch = await last.clone({ name: plan.create.name, reason: `自動で増える通話（${group.name}）` });
        // いちばん大きい番号のすぐ下へ
        await ch.setPosition(last.position + 1, { reason: `自動で増える通話（${group.name}）` }).catch((err: unknown) => logger.warn({ err }, 'voice group position failed'));
        logger.info({ group: group.name, name: plan.create.name }, 'voice group channel created');
      }
    }
    for (const id of plan.remove) {
      const ch = g.channels.cache.get(id);
      // 消す直前にも、だれもいないか確かめる
      if (ch?.type !== ChannelType.GuildVoice || ch.members.filter((m) => !m.user.bot).size > 0) continue;
      await ch.delete(`自動で増える通話（${group.name}）: 空きが多いので減らす`);
      logger.info({ group: group.name, name: ch.name }, 'voice group channel removed');
    }
  }
}

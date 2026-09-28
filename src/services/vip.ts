import type { GuildConfig } from '../config.js';
import type { ChannelOverwrite, GuildChannel } from '../lib/discordRest.js';
import { staffRoleIds } from './meetings.js';
import { planOf } from './rooms.js';

/**
 * 💎 極（遊郭の VIP）: 「極の VIP」のロールを持っている人だけが見える入口「➕ 💎 極の部屋をひらく」を置き、
 * そこから VIP だけの部屋（部屋代なし）をひらける。VIP は授与所で買う（宵参りの方だけ・期間つき）。
 */

export const VIP_ROLE_NAME = '💎 極 VIP';
export const VIP_HUB_NAME = '➕ 💎 極の部屋をひらく';
export const VIP_COLOR = 0xe6b422;

const bit = (n: number) => 1n << BigInt(n);
const VIEW = bit(10);
const CONNECT = bit(20);
const SPEAK = bit(21);
/** BOT: 見る・入る・チャンネルの管理・メンバーを移動 */
const BOT_ALLOW = VIEW | CONNECT | bit(4) | bit(24);

/** 極の入口を置くカテゴリ: 宵宮（1 時間ごとの部屋）の入口と同じカテゴリ。なければ名前に「遊郭」「宵宮」が入ったカテゴリ */
export function vipCategoryOf(cfg: GuildConfig, channels: GuildChannel[]): GuildChannel | undefined {
  const cats = channels.filter((c) => c.type === 4);
  const hourly = cfg.tempVoice.hubs.find((h) => planOf(cfg, h.channelId) === 'hourly');
  const hub = hourly ? channels.find((c) => c.id === hourly.channelId) : undefined;
  return (hub?.parent_id ? cats.find((c) => c.id === hub.parent_id) : undefined) ?? cats.find((c) => /遊郭|宵宮/.test(c.name));
}

/** 宵宮の入口（年齢制限を同じにするため） */
export function hourlyHubOf(cfg: GuildConfig, channels: GuildChannel[]): GuildChannel | undefined {
  const hourly = cfg.tempVoice.hubs.find((h) => planOf(cfg, h.channelId) === 'hourly');
  return hourly ? channels.find((c) => c.id === hourly.channelId) : undefined;
}

/**
 * 極の入口の権限: カテゴリの権限をもとに、ロール（@everyone も）からは見る・入るを外し、VIP のロールだけ許す。
 * 運営（神職・宮司）のロールはそのまま（カテゴリで見えていれば見える）。人ごとの上書きは持ってこない（BOT はのぞく）
 */
export function vipHubOverwrites(category: ChannelOverwrite[], cfg: GuildConfig, vipRoleId: string, botId?: string): ChannelOverwrite[] {
  const staff = staffRoleIds(cfg);
  const lock = VIEW | CONNECT;
  const out: ChannelOverwrite[] = category
    .filter((o) => o.type === 0 && o.id !== vipRoleId)
    .map((o) => (staff.has(o.id) ? { ...o } : { ...o, allow: String(BigInt(o.allow) & ~lock), deny: String(BigInt(o.deny) | lock) }));
  if (!out.some((o) => o.id === cfg.guildId)) out.push({ id: cfg.guildId, type: 0, allow: '0', deny: String(lock) });
  out.push({ id: vipRoleId, type: 0, allow: String(VIEW | CONNECT | SPEAK), deny: '0' });
  if (botId) out.push({ id: botId, type: 1, allow: String(BOT_ALLOW), deny: '0' });
  return out;
}

/** VIP を買える人: 宵参り（18 歳以上）の人。宵参りのロールを決めていなければ、だれでも */
export function canBuyVip(cfg: GuildConfig, roleIds: readonly string[]): boolean {
  const adult = cfg.roles.yoimairi;
  return !adult || roleIds.includes(adult);
}

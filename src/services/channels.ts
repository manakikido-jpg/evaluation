import type { GuildConfig } from '../config.js';
import type { ChannelOverwrite, GuildChannel } from '../lib/discordRest.js';

/**
 * チャンネルの「書き込める／読むだけ」。管理画面（宮司）から切り替える。
 * 読むだけ = メッセージ・スレッドは送れない（リアクションは付けられる）。神職・宮司と BOT は書ける。
 */

export type ChannelMode = 'writable' | 'readonly';

const bit = (n: number) => 1n << BigInt(n);
/** メッセージを送る・スレッドを作る・スレッドに書く */
export const WRITE = bit(11) | bit(35) | bit(36) | bit(38);
const ADD_REACTIONS = bit(6);

const has = (bits: string | undefined, p: bigint) => (BigInt(bits ?? '0') & p) !== 0n;

/** 神職・宮司のロール（読むだけのチャンネルにも書ける） */
function staffRoleIds(cfg: GuildConfig): Set<string> {
  return new Set([...cfg.ranks.filter((r) => !r.auto).map((r) => r.roleId), ...(cfg.admin?.shinshokuRoleIds ?? []), ...(cfg.admin?.gujiRoleIds ?? [])]);
}

/** 今の設定から読み取る: みんな（@everyone）に書き込みが止められていて、一般のロールで許されていなければ「読むだけ」 */
export function modeOf(channel: GuildChannel, cfg: GuildConfig): ChannelMode {
  const ow = channel.permission_overwrites ?? [];
  const staff = staffRoleIds(cfg);
  const everyone = ow.find((o) => o.id === cfg.guildId);
  const blocked = has(everyone?.deny, bit(11));
  const allowedByRole = ow.some((o) => o.type === 0 && o.id !== cfg.guildId && !staff.has(o.id) && has(o.allow, bit(11)));
  return blocked && !allowedByRole ? 'readonly' : 'writable';
}

/** 切り替えるために書き換える上書き（変わるものだけ） */
export function planMode(channel: GuildChannel, cfg: GuildConfig, mode: ChannelMode): ChannelOverwrite[] {
  const staff = staffRoleIds(cfg);
  const ow = channel.permission_overwrites ?? [];
  const out: ChannelOverwrite[] = [];
  const push = (o: ChannelOverwrite, allow: bigint, deny: bigint) => {
    if (allow.toString() !== o.allow || deny.toString() !== o.deny) out.push({ id: o.id, type: o.type, allow: allow.toString(), deny: deny.toString() });
  };
  const everyone = ow.find((o) => o.id === cfg.guildId) ?? { id: cfg.guildId, type: 0 as const, allow: '0', deny: '0' };
  for (const o of [everyone, ...ow.filter((x) => x.id !== cfg.guildId)]) {
    if (o.type !== 0) continue; // メンバー（BOT など）の上書きはそのまま
    const allow = BigInt(o.allow);
    const deny = BigInt(o.deny);
    if (staff.has(o.id)) {
      // 神職・宮司は、読むだけのチャンネルにも書ける
      if (mode === 'readonly') push(o, allow | WRITE, deny & ~WRITE);
      continue;
    }
    if (mode === 'readonly') {
      if (o.id === cfg.guildId) push(o, allow & ~WRITE, (deny | WRITE) & ~ADD_REACTIONS);
      else push(o, allow & ~WRITE, deny & ~ADD_REACTIONS);
    } else {
      push(o, allow, deny & ~WRITE);
    }
  }
  return out;
}

/** 管理画面に並べるチャンネル（テキストとお知らせ。カテゴリの順） */
export function listTextChannels(channels: GuildChannel[]): { category: GuildChannel | null; items: GuildChannel[] }[] {
  const cats = channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
  const text = channels.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position);
  const groups: { category: GuildChannel | null; items: GuildChannel[] }[] = [];
  const top = text.filter((c) => !c.parent_id);
  if (top.length) groups.push({ category: null, items: top });
  for (const cat of cats) {
    const items = text.filter((c) => c.parent_id === cat.id);
    if (items.length) groups.push({ category: cat, items });
  }
  return groups;
}

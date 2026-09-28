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

/** テキスト・お知らせ */
export const isText = (c: GuildChannel) => c.type === 0 || c.type === 5;
/** 通話・ステージ */
export const isVoice = (c: GuildChannel) => c.type === 2 || c.type === 13;

/** みんな（@everyone）から見えないチャンネル（チャンネルに上書きがなければカテゴリで見る） */
export function isRestricted(channel: GuildChannel, cfg: GuildConfig, parent?: GuildChannel | null): boolean {
  const own = (channel.permission_overwrites ?? []).find((o) => o.id === cfg.guildId);
  if (own) return has(own.deny, bit(10));
  const cat = (parent?.permission_overwrites ?? []).find((o) => o.id === cfg.guildId);
  return has(cat?.deny, bit(10));
}

/** 管理画面に並べるチャンネル（カテゴリの順。テキストと通話を分けて） */
export function listTextChannels(
  channels: GuildChannel[],
): { category: GuildChannel | null; items: GuildChannel[]; voice: GuildChannel[] }[] {
  const cats = channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
  const byPos = (a: GuildChannel, b: GuildChannel) => a.position - b.position;
  const text = channels.filter(isText).sort(byPos);
  const voice = channels.filter(isVoice).sort(byPos);
  const groups: { category: GuildChannel | null; items: GuildChannel[]; voice: GuildChannel[] }[] = [];
  const top = { category: null, items: text.filter((c) => !c.parent_id), voice: voice.filter((c) => !c.parent_id) };
  if (top.items.length || top.voice.length) groups.push(top);
  for (const cat of cats) groups.push({ category: cat, items: text.filter((c) => c.parent_id === cat.id), voice: voice.filter((c) => c.parent_id === cat.id) });
  return groups;
}

/** 名前として使えるか（前後の空白を除いて 1〜100 文字） */
export function cleanChannelName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const name = v.replace(/[\r\n]+/g, ' ').trim();
  return name.length >= 1 && name.length <= 100 ? name : undefined;
}

// ───────── 作る・消す ─────────

/**
 * 新しいチャンネルの見える範囲。
 * category: 入れるカテゴリと同じ ／ public: 申請前の人も ／ members: 参拝者以上 ／ private: 選んだロールだけ ／ staff: 神職・宮司だけ ／ adult: 宵参りの人だけ
 * どれでも（public・category 以外）神職・宮司と BOT は見られる。
 */
export type ChannelVisibility = 'category' | 'public' | 'members' | 'private' | 'staff' | 'adult';
export const CHANNEL_VISIBILITY: Record<ChannelVisibility, string> = {
  category: 'カテゴリと同じ',
  public: 'みんな（申請前の人も）',
  members: '参拝者以上',
  private: 'プライベート（選んだロールだけ）',
  staff: '運営だけ（神職・宮司）',
  adult: '🔞 宵参りの人だけ',
};
export const isChannelVisibility = (v: unknown): v is ChannelVisibility => typeof v === 'string' && Object.hasOwn(CHANNEL_VISIBILITY, v);

const VIEW = bit(10) | bit(16) | bit(20); // 見る・履歴・通話に入る
const BOT_ALLOW = VIEW | bit(11) | bit(14) | bit(13); // 見る・送る・埋め込み・メッセージの管理

export function overwritesFor(
  cfg: GuildConfig,
  opts: { visibility: ChannelVisibility; roleIds?: readonly string[]; readOnly?: boolean; botId?: string; parent?: GuildChannel },
): ChannelOverwrite[] {
  const ow = (id: string, type: 0 | 1, allow: bigint, deny: bigint): ChannelOverwrite => ({ id, type, allow: allow.toString(), deny: deny.toString() });
  const staff = [...staffRoleIds(cfg)];
  let list: ChannelOverwrite[];
  if (opts.visibility === 'category') {
    list = (opts.parent?.permission_overwrites ?? []).map((o) => ({ ...o }));
  } else if (opts.visibility === 'public') {
    list = [ow(cfg.guildId, 0, VIEW, 0n)];
  } else {
    const see =
      opts.visibility === 'members'
        ? cfg.ranks.filter((r) => r.auto).map((r) => r.roleId)
        : opts.visibility === 'private'
          ? [...(opts.roleIds ?? [])]
          : opts.visibility === 'adult'
            ? [cfg.roles.yoimairi ?? '']
            : [];
    list = [ow(cfg.guildId, 0, 0n, bit(10)), ...[...new Set(see)].filter((id) => id && id !== cfg.guildId && !staff.includes(id)).map((id) => ow(id, 0, VIEW, 0n))];
    for (const id of staff) list.push(ow(id, 0, VIEW, 0n));
  }
  if (opts.botId && !list.some((o) => o.id === opts.botId)) list.push(ow(opts.botId, 1, BOT_ALLOW, 0n));
  if (opts.readOnly) {
    // 読むだけ: いつもの切り替えと同じ書き換えを重ねる
    const changes = planMode({ id: 'new', name: '', type: 0, parent_id: null, position: 0, permission_overwrites: list }, cfg, 'readonly');
    list = list.map((o) => changes.find((c) => c.id === o.id) ?? o);
    for (const c of changes) if (!list.some((o) => o.id === c.id)) list.push(c);
  }
  return list;
}

/** BOT が使っているチャンネル（設定ファイルの ID・部屋の入口・募集ボタン）。消させない */
export function channelsInUse(cfg: GuildConfig): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, id] of Object.entries(cfg.channels)) if (typeof id === 'string') out.set(id, `設定の channels.${key}`);
  for (const h of cfg.tempVoice.hubs) out.set(h.channelId, '通話部屋の入口');
  for (const p of cfg.recruit.panels) out.set(p.channelId, '募集ボタン');
  return out;
}

/** Discord のチャンネル名にできるか（1〜100 文字） */
export const cleanNewChannelName = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return s && s.length <= 100 ? s : undefined;
};

// ───────── 並べ替え・カテゴリを移す ─────────

/** 並び順で同じ仲間（カテゴリどうし・同じカテゴリのテキスト・同じカテゴリの通話） */
function siblingsOf(channels: GuildChannel[], ch: GuildChannel, parentId: string | null): GuildChannel[] {
  const group = (c: GuildChannel) => (c.type === 4 ? 'cat' : isVoice(c) ? 'voice' : 'text');
  return channels
    .filter((c) => c.id !== ch.id && group(c) === group(ch) && (ch.type === 4 || (c.parent_id ?? null) === parentId))
    .sort((a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

/**
 * 1 つ上・下へ（同じ仲間の中で入れ替える）。動かなければ空。
 * 仲間の並びを 0, 1, 2… に振り直して送る（Discord の位置は重なっていることがあるため）。
 */
export function planMove(channels: GuildChannel[], id: string, dir: 'up' | 'down'): ChannelPositionPlan {
  const ch = channels.find((c) => c.id === id);
  if (!ch) return [];
  const list = [...siblingsOf(channels, ch, ch.parent_id ?? null), ch].sort((a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const i = list.findIndex((c) => c.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return [];
  [list[i], list[j]] = [list[j]!, list[i]!];
  return list.map((c, position) => ({ id: c.id, position }));
}

export type ChannelPositionPlan = { id: string; position: number; parent_id?: string | null; lock_permissions?: boolean }[];

/** ほかのカテゴリへ移す（いちばん下へ）。sync: 移した先の権限に合わせる */
export function planParent(channels: GuildChannel[], id: string, parentId: string | null, sync: boolean): ChannelPositionPlan {
  const ch = channels.find((c) => c.id === id);
  if (!ch || ch.type === 4 || (ch.parent_id ?? null) === parentId) return [];
  if (parentId && !channels.some((c) => c.id === parentId && c.type === 4)) return [];
  const list = siblingsOf(channels, ch, parentId);
  return [...list.map((c, position) => ({ id: c.id, position })), { id: ch.id, position: list.length, parent_id: parentId, lock_permissions: sync }];
}

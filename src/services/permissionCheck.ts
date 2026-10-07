import { adminLevelOf, type GuildConfig } from '../config.js';
import type { ChannelOverwrite, GuildChannel, GuildRole } from '../lib/discordRest.js';
import { sameOverwrites } from './channelPerms.js';
import { channelsInUse } from './channels.js';
import { ALL_PERMS, dangerLabels } from './roles.js';

const bit = (n: number) => 1n << BigInt(n);
const ALL = ALL_PERMS.reduce((n, p) => n | bit(p.bit), 0n);
const has = (p: bigint, n: number) => Boolean(p & bit(n));

/** 不完全な取得を「問題なし」として扱わない。 */
export function validatePermissionSnapshot(channels: GuildChannel[], roles: GuildRole[], guildId: string): void {
  if (!roles.some(r => r.id === guildId) || !channels.length) throw new Error('permission snapshot incomplete');
  if (roles.some(r => !/^\d+$/.test(r.permissions ?? ''))) throw new Error('role permissions missing');
  if (channels.some(c => !Array.isArray(c.permission_overwrites) || c.permission_overwrites.some(o => !/^\d+$/.test(o.allow) || !/^\d+$/.test(o.deny)))) throw new Error('channel permissions missing');
}

export type PermissionResult = { bits: bigint; admin: boolean; view: boolean; send: boolean; history: boolean; connect: boolean; speak: boolean };

/** @everyone → 選んだロールの上書きの合算 → 本人の上書き。ロールの順番では決めない。 */
export function effectivePermissions(channel: GuildChannel, roles: GuildRole[], guildId: string, selected: readonly string[], memberId?: string): PermissionResult {
  const ids = new Set([guildId, ...selected]);
  let bits = roles.filter(r => ids.has(r.id)).reduce((n, r) => n | BigInt(r.permissions ?? '0'), 0n);
  const admin = has(bits, 3);
  const apply = (o?: ChannelOverwrite) => { if (o) bits = (bits & ~BigInt(o.deny)) | BigInt(o.allow); };
  if (admin) bits |= ALL;
  else {
    // 子チャンネル自身の上書きを使う。未同期ならカテゴリの上書きを足さない。
    const ows = channel.permission_overwrites ?? [];
    apply(ows.find(o => o.type === 0 && o.id === guildId));
    let allow = 0n, deny = 0n;
    for (const o of ows) if (o.type === 0 && o.id !== guildId && ids.has(o.id)) { allow |= BigInt(o.allow); deny |= BigInt(o.deny); }
    bits = (bits & ~deny) | allow;
    if (memberId) apply(ows.find(o => o.type === 1 && o.id === memberId));
  }
  const view = has(bits, 10);
  return { bits, admin, view, send: view && has(bits, 11), history: view && has(bits, 16), connect: view && has(bits, 20), speak: view && has(bits, 20) && has(bits, 21) };
}

/** 表示するチャンネルの権限。閲覧・送信・接続に伴う制限も反映する。 */
export function canUsePermission(p: PermissionResult, n: number): boolean {
  if (p.admin) return true;
  if (!p.view) return false;
  if ([12, 14, 15, 35, 36, 46, 49].includes(n) && !p.send) return false;
  if ([9, 21, 39, 42].includes(n) && !p.connect) return false;
  return has(p.bits, n);
}

export type SyncChange = { id: string; type: 0 | 1; name: string; labels: string[] };
/** 順番や数字の表記ではなく、すべての権限ビットを比べる。未知のビットも隠さない。 */
export function syncChanges(channel: GuildChannel, parent: GuildChannel, roles: GuildRole[]): SyncChange[] {
  const own = channel.permission_overwrites ?? [], category = parent.permission_overwrites ?? [];
  const keys = new Set([...own, ...category].map(o => `${o.type}:${o.id}`));
  const known = ALL_PERMS.reduce((n, p) => n | bit(p.bit), 0n);
  const out: SyncChange[] = [];
  for (const key of keys) {
    const a = own.find(o => `${o.type}:${o.id}` === key), b = category.find(o => `${o.type}:${o.id}` === key);
    const changed = (BigInt(a?.allow ?? '0') ^ BigInt(b?.allow ?? '0')) | (BigInt(a?.deny ?? '0') ^ BigInt(b?.deny ?? '0'));
    // 0ビットの行の追加・削除も「同期」の差として残す。
    if (!changed && Boolean(a) === Boolean(b)) continue;
    const o = a ?? b!;
    const labels = ALL_PERMS.filter(p => changed & bit(p.bit)).map(p => p.label);
    if (changed & ~known) labels.push('そのほかの権限');
    if (!labels.length) labels.push('上書きの行の有無');
    out.push({ id: o.id, type: o.type, name: o.type === 0 ? (roles.find(r => r.id === o.id)?.name ?? `消えたロール ${o.id}`) : `個人指定 ${o.id}`, labels });
  }
  return out;
}

export type PermissionIssue = { key: string; level: 'warn' | 'check'; title: string; question: string; channelId?: string; roleId?: string };
export function permissionIssues(channels: GuildChannel[], roles: GuildRole[], cfg: GuildConfig): PermissionIssue[] {
  const out: PermissionIssue[] = [];
  const byId = new Map(channels.map(c => [c.id, c]));
  const roleIds = new Set(roles.map(r => r.id));
  const normal = roles.filter(r => !r.managed && r.id !== cfg.guildId && !adminLevelOf(cfg, [r.id]));
  for (const r of roles.filter(r => !r.managed && !adminLevelOf(cfg, [r.id]))) {
    const danger = dangerLabels(BigInt(r.permissions ?? '0')).filter(x => !x.includes('メンション'));
    if (danger.length) out.push({ key: `role:${r.id}`, level: 'warn', title: `${r.name} に強い権限`, question: `${danger.join('・')}があります。このロールは運営用ですか？`, roleId: r.id });
  }
  for (const c of channels) {
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    if (c.parent_id && (!parent || parent.type !== 4)) out.push({ key: `parent:${c.id}`, level: 'warn', title: `${c.name} のカテゴリが見つかりません`, question: 'カテゴリが削除されたか、取得できていない可能性があります。', channelId: c.id });
    if (parent && parent.type === 4 && !sameOverwrites(c.permission_overwrites, parent.permission_overwrites)) {
      out.push({ key: `sync:${c.id}`, level: 'check', title: `${c.name} はカテゴリと未同期`, question: '個別の部屋・運営専用など、意図した例外ですか？差分を確認してください。', channelId: c.id });
      const broader = [cfg.guildId, ...normal.map(r => r.id)].filter(id => effectivePermissions(c, roles, cfg.guildId, [id]).view && !effectivePermissions(parent, roles, cfg.guildId, [id]).view);
      if (broader.length) out.push({ key: `broader:${c.id}`, level: 'warn', title: `${c.name} はカテゴリより公開範囲が広い`, question: `${broader.map(id => roles.find(r => r.id === id)?.name ?? id).join('・')}が子チャンネルを見られます。公開してよい場所ですか？`, channelId: c.id });
    }
    for (const o of c.permission_overwrites ?? []) {
      if (o.type === 0 && !roleIds.has(o.id)) out.push({ key: `missing-role:${c.id}:${o.id}`, level: 'check', title: `${c.name} に消えたロールの指定`, question: `ロール ${o.id} の上書きが残っています。必要な指定ですか？`, channelId: c.id });
      if (BigInt(o.allow) & BigInt(o.deny)) out.push({ key: `conflict:${c.id}:${o.id}`, level: 'warn', title: `${c.name} に許可と拒否の重なり`, question: '同じ権限が両方に入っています。Discord側の設定を確認してください。', channelId: c.id });
    }
  }
  for (const rank of cfg.ranks) if (!roleIds.has(rank.roleId)) out.push({ key: `rank:${rank.key}`, level: 'warn', title: `役職「${rank.name}」のロールが見つかりません`, question: '役職の設定とDiscordのロールIDが一致していますか？' });
  for (const [id, label] of channelsInUse(cfg)) if (!byId.has(id)) out.push({ key: `missing-channel:${id}`, level: 'warn', title: `BOTが使う「${label}」が見つかりません`, question: '設定のチャンネルIDと、Discordにチャンネルがあるか確認してください。' });
  return out;
}

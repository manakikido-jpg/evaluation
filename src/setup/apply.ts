import { panelMessage, type PanelKind } from '../discord/panels.js';
import { P, type ChannelSpec, type Layout, type RoleKey, type Visibility } from './layout.js';

/** セットアップで使う Discord API（テストでは偽物に差し替える） */
export interface SetupApi {
  me(): Promise<{ id: string }>;
  guild(guildId: string): Promise<{ id: string; name: string; afk_channel_id: string | null }>;
  roles(guildId: string): Promise<ApiRole[]>;
  member(guildId: string, userId: string): Promise<{ roles: string[] }>;
  createRole(guildId: string, body: { name: string; color: number; hoist: boolean; permissions: string; mentionable: boolean }): Promise<ApiRole>;
  channels(guildId: string): Promise<ApiChannel[]>;
  createChannel(guildId: string, body: CreateChannelBody): Promise<ApiChannel>;
  modifyGuild(guildId: string, body: { afk_channel_id: string; afk_timeout: number }): Promise<void>;
  sendMessage(channelId: string, body: unknown): Promise<void>;
}

export type ApiRole = { id: string; name: string; position: number; permissions: string; managed: boolean };
export type ApiChannel = { id: string; name: string; type: number; parent_id: string | null };
export type Overwrite = { id: string; type: 0 | 1; allow: string; deny: string };
export type CreateChannelBody = {
  name: string;
  type: number;
  parent_id?: string;
  topic?: string;
  nsfw?: boolean;
  permission_overwrites: Overwrite[];
};

export class SetupError extends Error {}

const TYPE = { text: 0, voice: 2, category: 4 } as const;
const EmbedLinks = 1n << 14n;

export type SetupResult = {
  guildName: string;
  roleIds: Record<RoleKey, string>;
  channelIds: Partial<Record<NonNullable<ChannelSpec['configKey']>, string>>;
  created: { roles: string[]; channels: string[] };
  reused: { roles: number; channels: number };
  panelsPosted: string[];
  warnings: string[];
};

/** Discord はテキストチャンネル名を小文字・空白→ハイフンにするので、比べるときはそろえる */
const norm = (name: string, kind: 'text' | 'voice' | 'category') => (kind === 'text' ? name.toLowerCase().replace(/\s+/g, '-') : name);

export async function applyLayout(api: SetupApi, guildId: string, layout: Layout, opts: { postPanels?: boolean; dryRun?: boolean } = {}): Promise<SetupResult> {
  const me = await api.me();
  const guild = await api.guild(guildId);
  let roles = await api.roles(guildId);
  const member = await api.member(guildId, me.id);

  // ── BOT に管理者権限があるか ──
  const everyone = roles.find((r) => r.id === guildId);
  const myRoles = roles.filter((r) => member.roles.includes(r.id));
  const perms = [everyone, ...myRoles].reduce((acc, r) => acc | BigInt(r?.permissions ?? '0'), 0n);
  if (!(perms & P.Administrator)) {
    throw new SetupError(
      'BOT に「管理者」権限がありません。セットアップの間だけ、サーバー設定 → ロール → BOT のロール → 「管理者」を ON にしてから、もう一度実行してください（終わったら OFF に戻してかまいません）。',
    );
  }

  const result: SetupResult = {
    guildName: guild.name,
    roleIds: {} as Record<RoleKey, string>,
    channelIds: {},
    created: { roles: [], channels: [] },
    reused: { roles: 0, channels: 0 },
    panelsPosted: [],
    warnings: [],
  };

  // ── ロール（上から順に作る。新しいロールはいちばん下にできるので、この順で作ると並びが正しくなる） ──
  for (const spec of layout.roles) {
    const found = roles.find((r) => r.name === spec.name && !r.managed);
    if (found) {
      result.roleIds[spec.key] = found.id;
      result.reused.roles++;
      continue;
    }
    if (opts.dryRun) {
      result.roleIds[spec.key] = `dry:${spec.key}`;
      result.created.roles.push(spec.name);
      continue;
    }
    const r = await api.createRole(guildId, { name: spec.name, color: spec.color, hoist: spec.hoist, permissions: spec.permissions.toString(), mentionable: false });
    result.roleIds[spec.key] = r.id;
    result.created.roles.push(spec.name);
  }

  // ── BOT のロールが、BOT が付け外しするロールより上にあるか ──
  if (!opts.dryRun) {
    roles = await api.roles(guildId);
    const myTop = Math.max(...roles.filter((r) => member.roles.includes(r.id)).map((r) => r.position), 0);
    const managedByBot: RoleKey[] = ['yakudoshi', 'yoimairi', 'sodai', 'sewayaku', 'ujiko', 'sanpaisha'];
    const above = managedByBot
      .map((k) => roles.find((r) => r.id === result.roleIds[k]))
      .filter((r): r is ApiRole => Boolean(r && r.position >= myTop))
      .map((r) => r.name);
    if (above.length) {
      result.warnings.push(
        `BOT のロールより上に ${above.join('・')} があります。サーバー設定 → ロール で、BOT のロールをこれらより上にドラッグしてください（下にあると付け外しできません）。`,
      );
    }
  }

  // ── チャンネル ──
  let channels = await api.channels(guildId);
  const ids = result.roleIds;
  const memberRoles = [ids.sanpaisha, ids.ujiko, ids.sewayaku, ids.sodai, ids.shinshoku, ids.guji];
  const staffRoles = [ids.shinshoku, ids.guji];
  const VIEW = P.ViewChannel | P.ReadMessageHistory;
  const WRITE = P.SendMessages | P.AddReactions | P.CreatePublicThreads | P.SendMessagesInThreads;
  const BOT = P.ViewChannel | P.SendMessages | EmbedLinks | P.ReadMessageHistory | P.Connect;

  const overwrites = (visibility: Visibility, readOnly: boolean): Overwrite[] => {
    const ow = (id: string, type: 0 | 1, allow: bigint, deny: bigint): Overwrite => ({ id, type, allow: allow.toString(), deny: deny.toString() });
    const list: Overwrite[] = [];
    const seeRoles = visibility === 'member' ? memberRoles : visibility === 'staff' ? staffRoles : visibility === 'adult' ? [ids.yoimairi, ...staffRoles] : [];
    if (visibility === 'public') list.push(ow(guildId, 0, VIEW, readOnly ? WRITE : 0n));
    else list.push(ow(guildId, 0, 0n, P.ViewChannel | (readOnly ? WRITE : 0n)));
    for (const r of seeRoles) if (!staffRoles.includes(r)) list.push(ow(r, 0, VIEW, 0n));
    // 神職・宮司はどこでも見られて、読み取り専用のチャンネルにも書ける
    for (const r of staffRoles) list.push(ow(r, 0, VIEW | (readOnly ? WRITE : 0n), 0n));
    // BOT 自身（管理者権限を外したあとも、見る・書く・通話の人数を数えることができるように）
    list.push(ow(me.id, 1, BOT, 0n));
    return list;
  };

  let afkChannelId: string | undefined;
  for (const cat of layout.categories) {
    let parent = channels.find((c) => c.type === TYPE.category && c.name === cat.name);
    if (parent) {
      result.reused.channels++;
    } else if (opts.dryRun) {
      parent = { id: `dry:${cat.name}`, name: cat.name, type: TYPE.category, parent_id: null };
      result.created.channels.push(cat.name);
    } else {
      parent = await api.createChannel(guildId, { name: cat.name, type: TYPE.category, permission_overwrites: overwrites(cat.visibility, false) });
      result.created.channels.push(cat.name);
      channels = [...channels, parent];
    }

    for (const ch of cat.channels) {
      const type = TYPE[ch.kind];
      let found = channels.find((c) => c.type === type && c.parent_id === parent!.id && c.name === norm(ch.name, ch.kind));
      let isNew = false;
      if (found) {
        result.reused.channels++;
      } else if (opts.dryRun) {
        found = { id: `dry:${ch.name}`, name: ch.name, type, parent_id: parent.id };
        isNew = true;
        result.created.channels.push(`${cat.name} / ${ch.name}`);
      } else {
        found = await api.createChannel(guildId, {
          name: ch.name,
          type,
          parent_id: parent.id,
          ...(ch.topic && ch.kind === 'text' ? { topic: ch.topic } : {}),
          ...(cat.visibility === 'adult' ? { nsfw: true } : {}),
          permission_overwrites: overwrites(cat.visibility, Boolean(ch.readOnly)),
        });
        isNew = true;
        channels = [...channels, found];
        result.created.channels.push(`${cat.name} / ${ch.name}`);
      }
      if (ch.configKey) result.channelIds[ch.configKey] = found.id;
      if (ch.afk) afkChannelId = found.id;
      if (ch.panels && (isNew || opts.postPanels) && !opts.dryRun) {
        for (const kind of ch.panels as PanelKind[]) {
          await api.sendMessage(found.id, panelMessage(kind));
          result.panelsPosted.push(`#${ch.name}（${kind === 'apply' ? '入鯖申請' : '宵参り申請'}）`);
        }
      }
    }
  }

  if (afkChannelId && !guild.afk_channel_id && !opts.dryRun) {
    await api.modifyGuild(guildId, { afk_channel_id: afkChannelId, afk_timeout: 1800 });
  }
  return result;
}

/** 既存の設定（なければ見本）に、作ったロール・チャンネルの ID を書き込む */
export function mergeIntoConfig(base: Record<string, unknown>, guildId: string, r: SetupResult): Record<string, unknown> {
  const ranks = Array.isArray(base.ranks) ? (base.ranks as { key: string; roleId: string }[]) : [];
  return {
    ...base,
    guildId,
    channels: { ...(base.channels as object), ...r.channelIds },
    roles: { ...(base.roles as object), yakudoshi: r.roleIds.yakudoshi, yoimairi: r.roleIds.yoimairi },
    ranks: ranks.map((rank) => (rank.key in r.roleIds ? { ...rank, roleId: r.roleIds[rank.key as RoleKey] } : rank)),
  };
}

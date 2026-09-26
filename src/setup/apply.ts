import { panelMessage, type PanelKind } from '../discord/panels.js';
import { FULL, MINIMAL, P, RETIRED, type ChannelSpec, type Layout, type RoleKey, type Visibility } from './layout.js';

export type ApiGuild = {
  id: string;
  name: string;
  afk_channel_id: string | null;
  features?: string[];
  rules_channel_id?: string | null;
  public_updates_channel_id?: string | null;
  safety_alerts_channel_id?: string | null;
};

export type GuildPatch = {
  afk_channel_id?: string;
  afk_timeout?: number;
  rules_channel_id?: string;
  public_updates_channel_id?: string;
  safety_alerts_channel_id?: string;
};

/** セットアップで使う Discord API（テストでは偽物に差し替える） */
export interface SetupApi {
  me(): Promise<{ id: string }>;
  guild(guildId: string): Promise<ApiGuild>;
  roles(guildId: string): Promise<ApiRole[]>;
  member(guildId: string, userId: string): Promise<{ roles: string[] }>;
  createRole(guildId: string, body: { name: string; color: number; hoist: boolean; permissions: string; mentionable: boolean }): Promise<ApiRole>;
  channels(guildId: string): Promise<ApiChannel[]>;
  createChannel(guildId: string, body: CreateChannelBody): Promise<ApiChannel>;
  modifyGuild(guildId: string, body: GuildPatch): Promise<void>;
  sendMessage(channelId: string, body: unknown): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;
  reorderChannels(guildId: string, body: { id: string; position: number }[]): Promise<void>;
}

export type ApiRole = { id: string; name: string; position: number; permissions: string; managed: boolean };
export type ApiChannel = { id: string; name: string; type: number; parent_id: string | null; position?: number };
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
  /** 自分の通話部屋の入口（config の tempVoice.hubs に書く） */
  hubs: { channelId: string; name: string }[];
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

  // 自分の通話部屋を作るには、管理者を外したあとも「チャンネルの管理」「メンバーを移動」が要る
  const needsHub = layout.categories.some((c) => c.channels.some((ch) => ch.hub));
  const HUB_PERMS = P.ManageChannels | P.MoveMembers;
  const hubWarning =
    needsHub && (perms & HUB_PERMS) !== HUB_PERMS
      ? 'BOT のロールに「チャンネルの管理」「メンバーを移動」の権限がありません。自分の通話部屋（➕ ○○をひらく）を使うには、サーバー設定 → ロール → BOT のロールでこの 2 つを ON にしてください（「管理者」を OFF にしても動くように）。'
      : undefined;

  const result: SetupResult = {
    guildName: guild.name,
    roleIds: {} as Record<RoleKey, string>,
    channelIds: {},
    created: { roles: [], channels: [] },
    reused: { roles: 0, channels: 0 },
    panelsPosted: [],
    warnings: hubWarning ? [hubWarning] : [],
    hubs: [],
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
      if (ch.hub) result.hubs.push({ channelId: found.id, name: ch.hub });
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

/** Discord がサーバーを作ったときに最初からあるもの */
const DEFAULT_CATEGORIES = ['テキストチャンネル', 'ボイスチャンネル', 'text channels', 'voice channels'];
const DEFAULT_CHANNELS = ['一般', 'general'];
/** コミュニティにしたときに Discord が作るもの */
const COMMUNITY_CHANNELS = ['rules', 'moderator-only'];

/**
 * 片付け（--tidy）: applyLayout のあとに実行する。
 * - 全部の構成にしたとき、最小構成にしかないチャンネル（境内の 絵馬・慶事・通話テスト）を消す
 * - コミュニティ設定のルール・お知らせを #しきたり・#寄合 にしてから、#rules・#moderator-only を消す
 * - Discord が最初から作る「一般」と、空になったそのカテゴリを消す
 * - カテゴリとチャンネルを配置どおりに並べる
 * 配置にあるチャンネルと、上の名前のもの以外は消さない。
 */
export async function tidyGuild(api: SetupApi, guildId: string, layout: Layout, opts: { dryRun?: boolean } = {}): Promise<string[]> {
  const done: string[] = [];
  const guild = await api.guild(guildId);
  let channels = await api.channels(guildId);
  const isCategory = (c: ApiChannel) => c.type === TYPE.category;
  const catOf = (c: ApiChannel) => channels.find((p) => p.id === c.parent_id);
  const label = (c: ApiChannel) => `${catOf(c) ? `${catOf(c)!.name} / ` : ''}${c.name}`;
  const specsIn = (l: Layout, catName: string) => l.categories.find((c) => c.name === catName)?.channels ?? [];
  const matches = (c: ApiChannel, s: ChannelSpec) => c.type === TYPE[s.kind] && c.name === norm(s.name, s.kind);
  const findIn = (catName: string, s: ChannelSpec) => {
    const cat = channels.find((c) => isCategory(c) && c.name === catName);
    return cat && channels.find((c) => c.parent_id === cat.id && matches(c, s));
  };

  // ── コミュニティ設定の付け替え（#rules などは、設定で使われている間は消せないので先に） ──
  let communityMoved = false;
  if (guild.features?.includes('COMMUNITY')) {
    const rules = findIn('⛩ 鳥居', { name: 'しきたり', kind: 'text' });
    const yoriai = findIn('🔒 社務所裏', { name: '寄合', kind: 'text' });
    if (rules && yoriai) {
      const patch: GuildPatch = {};
      if (guild.rules_channel_id !== rules.id) patch.rules_channel_id = rules.id;
      if (guild.public_updates_channel_id !== yoriai.id) patch.public_updates_channel_id = yoriai.id;
      if (guild.safety_alerts_channel_id !== yoriai.id) patch.safety_alerts_channel_id = yoriai.id;
      if (Object.keys(patch).length) {
        if (!opts.dryRun) await api.modifyGuild(guildId, patch);
        done.push('コミュニティ設定: ルール → #しきたり、お知らせ・セーフティ通知 → #寄合');
      }
      communityMoved = true;
    }
  }

  // ── 消すものを決める ──
  const remove = new Map<string, ApiChannel>();
  // 前の版の配置にあって、今はなくしたもの（固定の通話など）
  if (layout === FULL) {
    for (const r of RETIRED) {
      const c = findIn(r.category, { name: r.name, kind: r.kind });
      if (c) remove.set(c.id, c);
    }
  }
  // 全部の構成にしたとき、最小構成にしかなかったもの
  if (layout === FULL) {
    for (const cat of MINIMAL.categories) {
      for (const s of cat.channels) {
        if (specsIn(FULL, cat.name).some((f) => f.name === s.name && f.kind === s.kind)) continue;
        const c = findIn(cat.name, s);
        if (c) remove.set(c.id, c);
      }
    }
  }
  if (communityMoved) {
    for (const c of channels.filter((c) => c.type === TYPE.text && COMMUNITY_CHANNELS.includes(c.name))) remove.set(c.id, c);
  }
  // Discord が最初から作るもの（中が空になるカテゴリも）
  for (const cat of channels.filter((c) => isCategory(c) && DEFAULT_CATEGORIES.includes(c.name.toLowerCase()))) {
    const children = channels.filter((c) => c.parent_id === cat.id);
    const defaults = children.filter((c) => DEFAULT_CHANNELS.includes(c.name.toLowerCase()));
    for (const c of defaults) remove.set(c.id, c);
    if (children.every((c) => remove.has(c.id))) remove.set(cat.id, cat);
  }
  // 念のため: 配置にあるチャンネルは消さない
  for (const cat of layout.categories) {
    const c = channels.find((x) => isCategory(x) && x.name === cat.name);
    if (c) remove.delete(c.id);
    for (const s of cat.channels) {
      const ch = findIn(cat.name, s);
      if (ch) remove.delete(ch.id);
    }
  }

  // 中のチャンネルを先に、カテゴリをあとに消す
  for (const c of [...remove.values()].sort((a, b) => Number(isCategory(a)) - Number(isCategory(b)))) {
    if (!opts.dryRun) await api.deleteChannel(c.id);
    done.push(`削除: ${isCategory(c) ? 'カテゴリ ' : ''}${label(c)}`);
  }
  channels = channels.filter((c) => !remove.has(c.id));

  // ── 並べ替え: 配置のカテゴリを上から順に、配置にないものはそのあと ──
  const byPos = (a: ApiChannel, b: ApiChannel) => (a.position ?? 0) - (b.position ?? 0);
  const order: { id: string; position: number }[] = [];
  const layoutCats = layout.categories.map((cat) => channels.find((c) => isCategory(c) && c.name === cat.name)).filter((c): c is ApiChannel => Boolean(c));
  const otherCats = channels.filter((c) => isCategory(c) && !layoutCats.includes(c)).sort(byPos);
  [...layoutCats, ...otherCats].forEach((c, i) => order.push({ id: c.id, position: i }));
  for (const cat of layout.categories) {
    const parent = layoutCats.find((c) => c.name === cat.name);
    if (!parent) continue;
    const inLayout = cat.channels.map((s) => findIn(cat.name, s)).filter((c): c is ApiChannel => Boolean(c));
    const others = channels.filter((c) => c.parent_id === parent.id && !inLayout.includes(c)).sort(byPos);
    [...inLayout, ...others].forEach((c, i) => order.push({ id: c.id, position: i }));
  }
  const current = new Map(channels.map((c) => [c.id, c.position]));
  const changed = order.filter((o) => current.get(o.id) !== o.position);
  if (changed.length) {
    if (!opts.dryRun) await api.reorderChannels(guildId, changed);
    done.push(`並べ替え: カテゴリ・チャンネルを配置どおりの順に（${changed.length} 件）`);
  }
  return done;
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
    tempVoice: { ...(base.tempVoice as object), hubs: r.hubs },
  };
}

import { panelMessage, type PanelKind } from '../discord/panels.js';
import { FULL, MINIMAL, OMAMORI_SPECS, P, RETIRED, ROLES, SHOP_COLORS, SHOP_TITLES, type ChannelSpec, type Layout, type RoleKey, type Visibility } from './layout.js';
import { coreName } from '../lib/names.js';

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
  reorderChannels(guildId: string, body: { id: string; position: number; parent_id?: string; lock_permissions?: boolean }[]): Promise<void>;
  /** 最近のメッセージ（重複の片付けで、人の書き込みがないか確かめる） */
  recentMessages(channelId: string): Promise<{ author: { id: string; bot?: boolean } }[]>;
  reorderRoles(guildId: string, body: { id: string; position: number }[]): Promise<void>;
  /** チャンネルの名前を変える（前の版の名前から、今の名前へ） */
  renameChannel(channelId: string, name: string): Promise<void>;
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
  /** 前の版の場所・名前から移したもの */
  moved: string[];
  warnings: string[];
  /** 自分の通話部屋の入口（config の tempVoice.hubs に書く） */
  hubs: { channelId: string; name: string; plan?: 'once' | 'hourly' }[];
  /** 「募集する」ボタンを置くチャンネル（config の recruit.panels に書く） */
  recruit: { channelId: string; omamori: RoleKey; hubId?: string }[];
};

/** Discord はテキストチャンネル名を小文字・空白→ハイフンにするので、比べるときはそろえる */
const norm = (name: string, kind: 'text' | 'voice' | 'category') => (kind === 'text' ? name.toLowerCase().replace(/\s+/g, '-') : name);

export { coreName };

/** 同じ名前（または飾りを除いて同じ名前）のものが複数あれば、いちばん古いもの（前からあるほう） */
const oldest = <T extends { id: string }>(list: T[]): T | undefined => [...list].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))[0];

const sameName = (actual: string, want: string, kind: 'text' | 'voice' | 'category') => actual === norm(want, kind) || coreName(actual) === coreName(want);

export function findCategory(channels: ApiChannel[], name: string): ApiChannel | undefined {
  return oldest(channels.filter((c) => c.type === TYPE.category && sameName(c.name, name, 'category')));
}

export function findChild(channels: ApiChannel[], parentId: string, spec: { name: string; kind: 'text' | 'voice' }): ApiChannel | undefined {
  return oldest(channels.filter((c) => c.type === TYPE[spec.kind] && c.parent_id === parentId && sameName(c.name, spec.name, spec.kind)));
}

/** 前の版の名前のチャンネル（どのカテゴリにあっても。いちばん古いもの） */
function findFormer(channels: ApiChannel[], spec: ChannelSpec): ApiChannel | undefined {
  if (!spec.formerly?.length) return undefined;
  return oldest(channels.filter((c) => c.type === TYPE[spec.kind] && spec.formerly!.some((f) => sameName(c.name, f, spec.kind))));
}

/**
 * 前の版の名前なら、今の名前にしたもの（飾りは残す: 「🪧｜絵馬」→「🪧｜絵馬-男性」）。変えなくてよければ undefined
 */
export function renamedFrom(current: string, spec: ChannelSpec): string | undefined {
  const former = spec.formerly?.find((f) => sameName(current, f, spec.kind));
  if (!former || sameName(current, spec.name, spec.kind)) return undefined;
  const i = current.indexOf(former);
  return i >= 0 ? current.slice(0, i) + spec.name + current.slice(i + former.length) : spec.name;
}

/** 前に作ったロール・チャンネルの ID（config/guild.json）。名前が変えられていても、同じものを使い続ける */
export type KnownIds = { roles?: Partial<Record<RoleKey, string>>; channels?: Partial<Record<NonNullable<ChannelSpec['configKey']>, string>> };

export async function applyLayout(
  api: SetupApi,
  guildId: string,
  layout: Layout,
  opts: { postPanels?: boolean; dryRun?: boolean; known?: KnownIds } = {},
): Promise<SetupResult> {
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
    moved: [],
    warnings: hubWarning ? [hubWarning] : [],
    hubs: [],
    recruit: [],
  };

  // ── ロール（上から順に作る。新しいロールはいちばん下にできるので、この順で作ると並びが正しくなる） ──
  for (const spec of layout.roles) {
    // 前に作ったロール（ID で探す）→ なければ同じ名前のロール
    const knownId = opts.known?.roles?.[spec.key];
    const found = roles.find((r) => r.id === knownId && !r.managed) ?? roles.find((r) => r.name === spec.name && !r.managed);
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
    const r = await api.createRole(guildId, {
      name: spec.name,
      color: spec.color,
      hoist: spec.hoist,
      permissions: spec.permissions.toString(),
      mentionable: Boolean(spec.mentionable),
    });
    result.roleIds[spec.key] = r.id;
    result.created.roles.push(spec.name);
  }

  // ── BOT のロールが、BOT が付け外しするロールより上にあるか ──
  if (!opts.dryRun) {
    roles = await api.roles(guildId);
    const myTop = Math.max(...roles.filter((r) => member.roles.includes(r.id)).map((r) => r.position), 0);
    const managedByBot: RoleKey[] = ['yakudoshi', 'yoimairi', 'sodai', 'sewayaku', 'ujiko', 'sanpaisha', ...OMAMORI_SPECS().map((o) => o.key), ...SHOP_COLORS().map((c) => c.key), ...SHOP_TITLES().map((t) => t.key)];
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
  // 募集ボタンのチャンネルと、同じカテゴリの「➕ ○○をひらく」（通話にいない人への案内）
  const hubOfCategory = new Map<string, string>();
  const recruitIn: { channelId: string; omamori: RoleKey; parentId: string }[] = [];
  for (const cat of layout.categories) {
    let parent = findCategory(channels, cat.name);
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
      // 設定に ID があるチャンネル（#慶事 など）は ID で探す → なければ同じカテゴリの同じ名前
      const knownId = ch.configKey ? opts.known?.channels?.[ch.configKey] : undefined;
      let found =
        channels.find((c) => c.id === knownId && c.type === type) ?? findChild(channels, parent.id, ch) ?? findFormer(channels, ch);
      let isNew = false;
      if (found) {
        result.reused.channels++;
        // 前の版の場所・名前にあるもの（#絵馬 など）: 書き込みはそのままで、このカテゴリへ移して名前を変える
        // 前の版の名前のままのときだけ（移したあとに、自分で別の場所へ動かしたものは動かさない）
        const newName = renamedFrom(found.name, ch);
        if (newName && found.parent_id !== parent.id && !String(parent.id).startsWith('dry:')) {
          if (!opts.dryRun) await api.reorderChannels(guildId, [{ id: found.id, position: 999, parent_id: parent.id, lock_permissions: false }]);
          result.moved.push(`#${found.name} → ${cat.name}`);
          found = { ...found, parent_id: parent.id };
        }
        if (newName) {
          if (!opts.dryRun) await api.renameChannel(found.id, newName);
          result.moved.push(`名前: #${found.name} → #${newName}`);
          found = { ...found, name: newName };
        }
        channels = channels.map((c) => (c.id === found!.id ? found! : c));
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
          permission_overwrites: overwrites(cat.visibility, Boolean(ch.readOnly)),
        });
        isNew = true;
        channels = [...channels, found];
        result.created.channels.push(`${cat.name} / ${ch.name}`);
      }
      if (ch.configKey) result.channelIds[ch.configKey] = found.id;
      if (ch.afk) afkChannelId = found.id;
      if (ch.hub) {
        result.hubs.push({ channelId: found.id, name: ch.hub, ...(ch.plan ? { plan: ch.plan } : {}) });
        hubOfCategory.set(parent.id, found.id);
      }
      if (ch.recruit) recruitIn.push({ channelId: found.id, omamori: ch.recruit, parentId: parent.id });
      if (ch.panels && (isNew || opts.postPanels) && !opts.dryRun) {
        for (const kind of ch.panels as PanelKind[]) {
          await api.sendMessage(found.id, panelMessage(kind, { omamori: omamoriConfig(result.roleIds) }));
          result.panelsPosted.push(`#${ch.name}（${PANEL_LABEL[kind]}）`);
        }
      }
    }
  }

  for (const r of recruitIn) {
    const hubId = hubOfCategory.get(r.parentId);
    result.recruit.push({ channelId: r.channelId, omamori: r.omamori, ...(hubId ? { hubId } : {}) });
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
  const me = await api.me();
  /** 人（BOT 以外）の書き込みがなければ true。確かめられなければ false（消さない） */
  const noPeople = async (c: ApiChannel) => {
    try {
      return (await api.recentMessages(c.id)).every((m) => m.author.id === me.id || m.author.bot);
    } catch {
      return false;
    }
  };
  const findIn = (catName: string, s: ChannelSpec) => {
    const cat = findCategory(channels, catName);
    return cat && findChild(channels, cat.id, s);
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
        // 人の書き込みがあるもの（#絵馬 の自己紹介など）は消さない
        if (c && (c.type !== TYPE.text || (await noPeople(c)))) remove.set(c.id, c);
      }
    }
  }
  if (communityMoved) {
    // コミュニティ設定で使われていた #rules・#moderator-only だけ（同じ名前の、自分で作ったチャンネルは消さない）
    const wasCommunity = new Set([guild.rules_channel_id, guild.public_updates_channel_id, guild.safety_alerts_channel_id].filter(Boolean));
    for (const c of channels.filter((c) => c.type === TYPE.text && COMMUNITY_CHANNELS.includes(c.name) && wasCommunity.has(c.id))) remove.set(c.id, c);
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

  // ── 色守り（ショップ）のロールを、役職・宵参りより上へ（上にないと、買った色が名前に出ない） ──
  {
    const me = await api.me();
    const mine = (await api.member(guildId, me.id)).roles;
    const roles = await api.roles(guildId);
    const myTop = Math.max(0, ...roles.filter((r) => mine.includes(r.id)).map((r) => r.position));
    const below = roles.filter((r) => r.id !== guildId && r.position < myTop).sort((a, b) => b.position - a.position || a.id.localeCompare(b.id));
    const colorNames = new Set(SHOP_COLORS().map((c) => c.name));
    const colors = below.filter((r) => colorNames.has(r.name) && !r.managed);
    const colored = ['🔞 宵参り', ...ROLES.filter((x) => ['sodai', 'sewayaku', 'ujiko', 'sanpaisha'].includes(x.key)).map((x) => x.name)];
    const anchor = below.find((r) => colored.includes(r.name) && !r.managed);
    if (colors.length && anchor && colors.some((c) => c.position <= anchor.position)) {
      const rest = below.filter((r) => !colors.includes(r));
      const i = rest.indexOf(anchor);
      const order = [...rest.slice(0, i), ...colors, ...rest.slice(i)];
      const body = order.map((r, k) => ({ id: r.id, position: myTop - 1 - k })).filter((o) => roles.find((r) => r.id === o.id)!.position !== o.position);
      if (body.length) {
        if (!opts.dryRun) await api.reorderRoles(guildId, body);
        done.push('並べ替え: 色守りのロールを、役職と宵参りより上に');
      }
    }
  }

  // ── 並べ替え: 配置のカテゴリを上から順に、配置にないものはそのあと ──
  const byPos = (a: ApiChannel, b: ApiChannel) => (a.position ?? 0) - (b.position ?? 0);
  const order: { id: string; position: number }[] = [];
  const layoutCats = layout.categories.map((cat) => findCategory(channels, cat.name)).filter((c): c is ApiChannel => Boolean(c));
  const otherCats = channels.filter((c) => isCategory(c) && !layoutCats.includes(c)).sort(byPos);
  [...layoutCats, ...otherCats].forEach((c, i) => order.push({ id: c.id, position: i }));
  for (const cat of layout.categories) {
    const parent = findCategory(layoutCats, cat.name);
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

const PANEL_LABEL: Record<PanelKind, string> = { apply: '入鯖申請', yoimairi: '宵参り申請', omamori: 'お守り', shop: '授与品' };

/** 作った（見つけた）お守りロール → config の roles.omamori */
export function omamoriConfig(roleIds: Partial<Record<RoleKey, string>>) {
  return OMAMORI_SPECS()
    .filter((o) => roleIds[o.key])
    .map((o) => ({ roleId: roleIds[o.key]!, label: o.label, emoji: o.emoji, description: o.description, adultOnly: o.adultOnly }));
}

/** 募集ボタンの設定（お守りのロールと、同じカテゴリの ➕ を結びつける） */
export function recruitConfig(r: Pick<SetupResult, 'recruit' | 'roleIds'>) {
  return r.recruit.map((p) => {
    const o = OMAMORI_SPECS().find((x) => x.key === p.omamori)!;
    const roleId = r.roleIds[p.omamori];
    return { channelId: p.channelId, label: o.label, emoji: o.emoji, adultOnly: o.adultOnly, ...(roleId ? { roleId } : {}), ...(p.hubId ? { hubId: p.hubId } : {}) };
  });
}

/**
 * 重複の片付け（--tidy のとき、セットアップの前に実行する）。
 * 名前の見た目を変えたあとに、前の版のセットアップが同じカテゴリ・チャンネルを作り直してしまったもの。
 * - 同じもの（飾りを除いて同じ名前・同じ種類）が複数あれば、いちばん古いもの（前からあるほう）を残す
 * - 新しいほうは、中に人の書き込みがなければ消す（BOT の書き込みだけなら消してよい）。書き込みがあれば消さずに知らせる
 * - 重複したカテゴリにしかないチャンネル（誰かが作った通話部屋など）は、残すほうのカテゴリへ移す
 * - コミュニティ設定で使われていたら、先に残すほうへ付け替える
 */
export async function dedupeGuild(api: SetupApi, guildId: string, layout: Layout, opts: { dryRun?: boolean } = {}): Promise<string[]> {
  const done: string[] = [];
  const me = await api.me();
  const guild = await api.guild(guildId);
  const channels = await api.channels(guildId);
  const byOld = (a: ApiChannel, b: ApiChannel) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
  const childrenOf = (id: string) => channels.filter((c) => c.parent_id === id);
  const sameKind = (a: ApiChannel, b: ApiChannel) => a.type === b.type && coreName(a.name) === coreName(b.name);

  /** 人（BOT 以外）の書き込みがなければ true。確かめられなければ false（消さない） */
  const emptyOfPeople = async (c: ApiChannel) => {
    try {
      return (await api.recentMessages(c.id)).every((m) => m.author.id === me.id || m.author.bot);
    } catch {
      return false;
    }
  };

  const community: [keyof GuildPatch, string | null | undefined][] = [
    ['rules_channel_id', guild.rules_channel_id],
    ['public_updates_channel_id', guild.public_updates_channel_id],
    ['safety_alerts_channel_id', guild.safety_alerts_channel_id],
  ];

  const removeDuplicate = async (dup: ApiChannel, keep: ApiChannel, where: string) => {
    if (!(await emptyOfPeople(dup))) {
      done.push(`⚠️ 消さなかった（人の書き込みあり）: ${where}${dup.name}。中身を確かめて、要らなければ手で消してください`);
      return false;
    }
    const patch: GuildPatch = {};
    for (const [k, v] of community) if (v === dup.id) (patch as Record<string, string>)[k] = keep.id;
    if (Object.keys(patch).length && !opts.dryRun) await api.modifyGuild(guildId, patch);
    if (!opts.dryRun) await api.deleteChannel(dup.id);
    done.push(`重複を削除: ${where}${dup.name}`);
    return true;
  };

  /** 残すカテゴリの中の、同じチャンネルの重複 */
  const dedupeChildren = async (keep: ApiChannel) => {
    const kids = childrenOf(keep.id).sort(byOld);
    const seen: ApiChannel[] = [];
    for (const k of kids) {
      const first = seen.find((x) => sameKind(x, k));
      if (!first) seen.push(k);
      else await removeDuplicate(k, first, `${keep.name} / `);
    }
  };

  for (const cat of layout.categories) {
    const cats = channels.filter((c) => c.type === TYPE.category && sameName(c.name, cat.name, 'category')).sort(byOld);
    const keep = cats[0];
    if (!keep) continue;
    for (const dup of cats.slice(1)) {
      let left = 0;
      for (const child of childrenOf(dup.id)) {
        const counterpart = childrenOf(keep.id).find((k) => sameKind(k, child));
        if (counterpart) {
          if (!(await removeDuplicate(child, counterpart, `${dup.name} / `))) left++;
        } else {
          // 残すカテゴリにないもの（通話部屋など）は移す
          if (!opts.dryRun) await api.reorderChannels(guildId, [{ id: child.id, position: 999, parent_id: keep.id, lock_permissions: false }]);
          child.parent_id = keep.id;
          done.push(`移動: ${dup.name} / ${child.name} → ${keep.name}`);
        }
      }
      if (left === 0) {
        if (!opts.dryRun) await api.deleteChannel(dup.id);
        done.push(`重複を削除: カテゴリ ${dup.name}`);
      }
    }
    await dedupeChildren(keep);
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
    roles: { ...(base.roles as object), yakudoshi: r.roleIds.yakudoshi, yoimairi: r.roleIds.yoimairi, omamori: omamoriConfig(r.roleIds) },
    ranks: ranks.map((rank) => (rank.key in r.roleIds ? { ...rank, roleId: r.roleIds[rank.key as RoleKey] } : rank)),
    tempVoice: { ...(base.tempVoice as object), hubs: r.hubs },
    recruit: { ...(base.recruit as object), panels: recruitConfig(r) },
    shop: {
      colors: SHOP_COLORS().filter((c) => r.roleIds[c.key]).map((c) => ({ roleId: r.roleIds[c.key], name: c.label, emoji: c.emoji })),
      titles: SHOP_TITLES().filter((t) => r.roleIds[t.key]).map((t) => ({ roleId: r.roleIds[t.key], name: t.label, emoji: t.emoji })),
    },
  };
}

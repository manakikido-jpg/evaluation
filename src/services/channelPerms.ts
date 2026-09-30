import type { ChannelOverwrite, GuildChannel, GuildRole } from '../lib/discordRest.js';

/**
 * チャンネル・カテゴリの「見られる・書ける・入れる」を、社務所Web で見て変える。
 * Discord の権限の上書き（ロール・人ごと）のうち、ここで扱う権限だけを変え、ほかのビットはそのまま残す。
 */

const bit = (n: number) => 1n << BigInt(n);
export const PERM = { view: bit(10), send: bit(11), connect: bit(20), speak: bit(21) } as const;
const ADMIN = bit(3);

export type PermKey = keyof typeof PERM;
/** allow: 許可 / deny: 拒否 / inherit: 決めない（カテゴリ・ほかのロールに従う） */
export type Tri = 'allow' | 'deny' | 'inherit';

export const PERM_LABEL: Record<PermKey, string> = { view: '👀 見る', send: '✍ 書く', connect: '🔊 入る', speak: '🎙 話す' };

/** その種類のチャンネルで扱う権限 */
export function permKeysFor(c: Pick<GuildChannel, 'type'>): PermKey[] {
  if (c.type === 4) return ['view', 'send', 'connect'];
  if (c.type === 2 || c.type === 13) return ['view', 'connect', 'speak'];
  return ['view', 'send'];
}

export const isTri = (v: unknown): v is Tri => v === 'allow' || v === 'deny' || v === 'inherit';

export function triOf(o: Pick<ChannelOverwrite, 'allow' | 'deny'> | undefined, key: PermKey): Tri {
  if (!o) return 'inherit';
  if (BigInt(o.allow) & PERM[key]) return 'allow';
  if (BigInt(o.deny) & PERM[key]) return 'deny';
  return 'inherit';
}

/** 1 つの権限を変えた allow・deny（ほかのビットはそのまま） */
export function withTri(o: Pick<ChannelOverwrite, 'allow' | 'deny'>, key: PermKey, tri: Tri): { allow: string; deny: string } {
  let allow = BigInt(o.allow) & ~PERM[key];
  let deny = BigInt(o.deny) & ~PERM[key];
  if (tri === 'allow') allow |= PERM[key];
  if (tri === 'deny') deny |= PERM[key];
  return { allow: allow.toString(), deny: deny.toString() };
}

export type OverwriteRow = {
  id: string;
  type: 0 | 1;
  name: string;
  tris: Record<PermKey, Tri>;
  /** @everyone（みんな） */
  everyone: boolean;
  /** BOT 自身・連携のロール（ここでは変えない） */
  locked: boolean;
};

/** 今の上書きを、表に出す形に（@everyone を先に、ロールは上から、人はあと） */
export function overwriteRows(
  ch: Pick<GuildChannel, 'type' | 'permission_overwrites'>,
  roles: GuildRole[],
  memberNames: Map<string, string>,
  guildId: string,
  botId?: string,
): OverwriteRow[] {
  const keys = permKeysFor(ch);
  const roleOf = (id: string) => roles.find((r) => r.id === id);
  const rows = (ch.permission_overwrites ?? []).map((o) => {
    const role = o.type === 0 ? roleOf(o.id) : undefined;
    const everyone = o.type === 0 && o.id === guildId;
    return {
      id: o.id,
      type: o.type,
      name: everyone ? '@everyone（みんな）' : o.type === 0 ? `@${role?.name ?? `消えたロール ${o.id}`}` : `👤 ${memberNames.get(o.id) ?? `ID ${o.id}`}`,
      tris: Object.fromEntries(keys.map((k) => [k, triOf(o, k)])) as Record<PermKey, Tri>,
      everyone,
      locked: (o.type === 1 && o.id === botId) || Boolean(role?.managed),
      position: everyone ? Infinity : (role?.position ?? -1),
    };
  });
  rows.sort((a, b) => (a.type !== b.type ? a.type - b.type : b.position - a.position));
  return rows.map(({ position: _p, ...r }) => r);
}

/**
 * そのロール（と @everyone）だけを持っている人が、このチャンネルを見られるか。
 * 見られるロールの名前を、上のロールから返す（@everyone が見られるなら「みんな」）
 */
export function whoCanView(ch: Pick<GuildChannel, 'permission_overwrites'>, roles: GuildRole[], guildId: string): { everyone: boolean; roles: string[] } {
  const ows = ch.permission_overwrites ?? [];
  const everyoneRole = roles.find((r) => r.id === guildId);
  const everyoneBase = BigInt(everyoneRole?.permissions ?? '0');
  const eo = ows.find((o) => o.type === 0 && o.id === guildId);
  const apply = (p: bigint, o?: ChannelOverwrite) => (o ? (p & ~BigInt(o.deny)) | BigInt(o.allow) : p);
  const canView = (base: bigint, own?: ChannelOverwrite) => {
    if (base & ADMIN) return true;
    return Boolean(apply(apply(base, eo), own) & PERM.view);
  };
  const everyone = canView(everyoneBase);
  const list = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .filter((r) => canView(everyoneBase | BigInt(r.permissions ?? '0'), ows.find((o) => o.type === 0 && o.id === r.id)))
    .map((r) => r.name);
  return { everyone, roles: list };
}

/** カテゴリと同じ上書きか（Discord の「カテゴリと同期」） */
export function sameOverwrites(a: ChannelOverwrite[] = [], b: ChannelOverwrite[] = []): boolean {
  const key = (list: ChannelOverwrite[]) =>
    list
      .map((o) => `${o.type}:${o.id}:${o.allow}:${o.deny}`)
      .sort()
      .join('|');
  return key(a) === key(b);
}

export type WantedOverwrite = { id: string; type: 0 | 1; tris: Partial<Record<PermKey, Tri>>; remove?: boolean };

/**
 * 変える分を決める。set: 置く上書き / del: 消す上書き（扱う権限が全部「決めない」になって、ほかのビットもないもの・外すもの）
 */
export function planOverwrites(current: ChannelOverwrite[] = [], wanted: WantedOverwrite[], keys: PermKey[]): { set: ChannelOverwrite[]; del: string[] } {
  const set: ChannelOverwrite[] = [];
  const del: string[] = [];
  for (const w of wanted) {
    const now = current.find((o) => o.id === w.id);
    if (w.remove) {
      if (now) del.push(w.id);
      continue;
    }
    let next = { allow: now?.allow ?? '0', deny: now?.deny ?? '0' };
    for (const k of keys) {
      const t = w.tris[k];
      if (t) next = withTri(next, k, t);
    }
    if (next.allow === '0' && next.deny === '0') {
      if (now) del.push(w.id);
      continue;
    }
    if (!now || now.allow !== next.allow || now.deny !== next.deny) set.push({ id: w.id, type: w.type, ...next });
  }
  return { set, del };
}

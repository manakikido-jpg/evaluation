import { and, arrayOverlaps, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { WEB_PAGE_KEYS, type GuildConfig, type WebPage } from '../config.js';
import type { Db } from '../db/client.js';
import { members, settings } from '../db/schema.js';
import { audit } from './audit.js';

/**
 * 🏯 運営の組織図（社務所Web だけ。Discord のロールは変えない）。
 * - 部署: 自由に置ける四角（場所・大きさ・色）。部署ごとに、社務所Web で見られるページを選べる
 * - 線: 部署と部署をつなぐ。曲がり角（折れ点）を自由に動かせる。実線・点線
 * - 段階: 統括・副統括など（名前・数・順番は自由）。部署に置いた人に 1 つ付ける
 * - 左の一覧に出すロールを選べる（はじめは役職のロール）
 * - 置いた人は、その部署のページを社務所Web で使える（宮司・神職はもとから全部）
 */
const KEY = 'org.chart';
const id = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const snowflake = z.string().regex(/^\d{17,20}$/);
const coord = z.number().finite().min(-20000).max(20000);
export const ORG_COLORS = ['plain', 'sakura', 'sky', 'leaf', 'gold', 'violet', 'ink'] as const;
export const orgChartSchema = z.object({
  ranks: z.array(z.object({ id, name: z.string().trim().min(1).max(20) })).min(1).max(12),
  roles: z.array(snowflake).max(30).default([]),
  nodes: z.array(z.object({
    id, name: z.string().trim().min(1).max(30),
    /** 前の形（木）の親。場所がないときの並べ方と線を作るのにだけ使う */
    parentId: id.nullable().optional(),
    pages: z.array(z.enum(WEB_PAGE_KEYS)).max(WEB_PAGE_KEYS.length).default([]),
    x: coord.optional(), y: coord.optional(),
    w: z.number().finite().min(120).max(1200).optional(), h: z.number().finite().min(60).max(1200).optional(),
    color: z.enum(ORG_COLORS).default('plain'),
  })).max(80),
  edges: z.array(z.object({ id, from: id, to: id, bends: z.array(z.object({ x: coord, y: coord })).max(12).default([]), dashed: z.boolean().default(false) })).max(200).default([]),
  placements: z.array(z.object({ memberId: snowflake, nodeId: id, rankId: id })).max(500),
});
export type OrgChart = z.infer<typeof orgChartSchema>;
export type OrgNode = OrgChart['nodes'][number];
export const DEFAULT_ORG: OrgChart = {
  ranks: [{ id: 'lead', name: '統括' }, { id: 'sub', name: '副統括' }, { id: 'member', name: '一般' }],
  roles: [],
  nodes: [{ id: 'top', name: '宮司', pages: [], x: 400, y: 40, w: 220, h: 120, color: 'sakura' }],
  edges: [],
  placements: [],
};
const W = 220, H = 120, GAP_X = 40, GAP_Y = 80;

/** 前の形（木）から、場所と線を作る（場所がない部署だけ） */
function layoutLegacy(c: OrgChart): OrgChart {
  if (c.nodes.every(n => n.x !== undefined && n.y !== undefined)) return c;
  const nodeIds = new Set(c.nodes.map(n => n.id));
  const parentOf = (n: OrgNode) => (n.parentId && nodeIds.has(n.parentId) && n.parentId !== n.id ? n.parentId : null);
  const kids = (pid: string | null) => c.nodes.filter(n => parentOf(n) === pid);
  // 葉の数で幅を決めて、上から順に置く（輪になっていても止まる）
  const seen = new Set<string>();
  const width = (n: OrgNode): number => { if (seen.has(n.id)) return 1; seen.add(n.id); const k = kids(n.id); return k.length ? k.reduce((a, x) => a + width(x), 0) : 1; };
  const placed = new Map<string, { x: number; y: number }>();
  const put = (n: OrgNode, left: number, depth: number) => {
    if (placed.has(n.id)) return;
    seen.clear(); const span = width(n);
    placed.set(n.id, { x: left + (span * (W + GAP_X) - W - GAP_X) / 2, y: 40 + depth * (H + GAP_Y) });
    let l = left;
    for (const k of kids(n.id)) { seen.clear(); const s = width(k); put(k, l, depth + 1); l += s * (W + GAP_X); }
  };
  let left = 40;
  for (const r of [...kids(null), ...c.nodes]) { if (placed.has(r.id)) continue; seen.clear(); const s = width(r); put(r, left, 0); left += s * (W + GAP_X); }
  const nodes = c.nodes.map(n => (n.x !== undefined && n.y !== undefined ? n : { ...n, ...placed.get(n.id)!, w: n.w ?? W, h: n.h ?? H }));
  const edges = c.edges.length ? c.edges : c.nodes.flatMap(n => { const p = parentOf(n); return p ? [{ id: `e-${p}-${n.id}`.slice(0, 40), from: p, to: n.id, bends: [], dashed: false }] : []; });
  return { ...c, nodes, edges };
}

/** 消えた部署・段階を指すもの（置き方・線）を外す。同じ人を同じ部署に 2 回は置かない */
export function tidyOrg(input: OrgChart): OrgChart {
  const c = layoutLegacy(input);
  const nodeIds = new Set(c.nodes.map(n => n.id)), rankIds = new Set(c.ranks.map(r => r.id));
  const nodes = c.nodes.map(({ parentId: _old, ...n }) => ({ ...n, w: n.w ?? W, h: n.h ?? H, pages: [...new Set(n.pages)] }));
  const seenEdge = new Set<string>();
  const edges = c.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to) && e.from !== e.to && !seenEdge.has(e.id) && seenEdge.add(e.id));
  const seenPlace = new Set<string>();
  const placements = c.placements.filter(p => nodeIds.has(p.nodeId) && rankIds.has(p.rankId) && !seenPlace.has(p.memberId + ':' + p.nodeId) && seenPlace.add(p.memberId + ':' + p.nodeId));
  return { ranks: c.ranks, roles: [...new Set(c.roles)], nodes, edges, placements };
}

export async function loadOrg(db: Db): Promise<OrgChart> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const r = orgChartSchema.safeParse(row?.value);
  return r.success ? tidyOrg(r.data) : structuredClone(DEFAULT_ORG);
}
export async function saveOrg(db: Db, input: unknown, by: string): Promise<OrgChart> {
  const value = tidyOrg(orgChartSchema.parse(input));
  if (new Set(value.ranks.map(r => r.id)).size !== value.ranks.length || new Set(value.nodes.map(n => n.id)).size !== value.nodes.length) throw new Error('duplicate id');
  await db.transaction(async tx => {
    await tx.insert(settings).values({ key: KEY, value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
    await audit(tx, { actorId: by, action: 'org.save', detail: { nodes: value.nodes.length, edges: value.edges.length, placements: value.placements.length, ranks: value.ranks.map(r => r.name), roles: value.roles }, via: 'web' });
  });
  return value;
}

/** その人が組織図で使えるページ（置かれた部署のページを合わせたもの） */
export function orgPagesOf(c: OrgChart, memberId: string): WebPage[] {
  const nodes = new Set(c.placements.filter(p => p.memberId === memberId).map(p => p.nodeId));
  const pages = new Set(c.nodes.filter(n => nodes.has(n.id)).flatMap(n => n.pages));
  return WEB_PAGE_KEYS.filter(k => pages.has(k));
}

export type OrgPerson = { id: string; name: string; avatar: string | null };
/**
 * 左の一覧: ロールごとのメンバー（抜けた人・BOT はのぞく。1 つのロール 300 人まで）。
 * 組織図で選んだロール（なければ役職のロールを上から）。roleName: ロールの名前（分からなければ undefined）
 */
export async function orgSidebar(db: Db, cfg: GuildConfig, chart: OrgChart, roleName: (id: string) => string | undefined): Promise<{ id: string; name: string; members: OrgPerson[] }[]> {
  const list = chart.roles.length
    ? chart.roles.map(id => ({ id, name: roleName(id) ?? '（消えたロール）' }))
    : [...cfg.ranks].reverse().map(r => ({ id: r.roleId, name: `${r.emoji}${r.name}` }));
  const roleIds = list.map(r => r.id);
  const rows = roleIds.length ? await db.select({ id: members.id, name: members.displayName, avatar: members.avatarUrl, roleIds: members.roleIds }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false), arrayOverlaps(members.roleIds, roleIds))) : [];
  return list.map(r => ({
    ...r,
    members: rows.filter(m => m.roleIds.includes(r.id)).map(m => ({ id: m.id, name: m.name, avatar: m.avatar })).sort((a, b) => a.name.localeCompare(b.name, 'ja')).slice(0, 300),
  }));
}
/** 置いた人の名前とアイコン（左の一覧にいない人の分も） */
export async function orgPeople(db: Db, ids: string[]): Promise<Record<string, OrgPerson>> {
  if (!ids.length) return {};
  const rows = await db.select({ id: members.id, name: members.displayName, avatar: members.avatarUrl }).from(members).where(inArray(members.id, [...new Set(ids)]));
  return Object.fromEntries(rows.map(r => [r.id, r]));
}

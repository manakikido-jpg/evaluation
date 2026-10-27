import { and, arrayOverlaps, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { WEB_PAGE_KEYS, type GuildConfig, type WebPage } from '../config.js';
import type { Db } from '../db/client.js';
import { members, settings } from '../db/schema.js';
import { audit } from './audit.js';

/**
 * 🏯 運営の組織図（社務所Web だけ。Discord のロールは変えない）。
 * - 部署: 木の形（親の部署の下に子の部署）。部署ごとに、社務所Web で見られるページを選べる
 * - 段階: 統括・副統括など（名前・数・順番は自由）。部署に置いた人に 1 つ付ける
 * - 置いた人は、その部署のページを社務所Web で使える（宮司・神職はもとから全部）
 */
const KEY = 'org.chart';
const id = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const snowflake = z.string().regex(/^\d{17,20}$/);
export const orgChartSchema = z.object({
  ranks: z.array(z.object({ id, name: z.string().trim().min(1).max(20) })).min(1).max(12),
  nodes: z.array(z.object({ id, name: z.string().trim().min(1).max(30), parentId: id.nullable(), pages: z.array(z.enum(WEB_PAGE_KEYS)).max(WEB_PAGE_KEYS.length).default([]) })).max(80),
  placements: z.array(z.object({ memberId: snowflake, nodeId: id, rankId: id })).max(500),
});
export type OrgChart = z.infer<typeof orgChartSchema>;
export const DEFAULT_ORG: OrgChart = {
  ranks: [{ id: 'lead', name: '統括' }, { id: 'sub', name: '副統括' }, { id: 'member', name: '一般' }],
  nodes: [{ id: 'top', name: '宮司', parentId: null, pages: [] }],
  placements: [],
};

/** 消えた部署・段階を指す置き方を外し、親のない部署は一番上にする（同じ人が同じ部署に 2 回は置かない） */
export function tidyOrg(c: OrgChart): OrgChart {
  const nodeIds = new Set(c.nodes.map(n => n.id)), rankIds = new Set(c.ranks.map(r => r.id));
  const nodes = c.nodes.map(n => ({ ...n, parentId: n.parentId && nodeIds.has(n.parentId) && n.parentId !== n.id ? n.parentId : null, pages: [...new Set(n.pages)] }));
  // 親をたどって輪になっていたら、その部署は一番上にする
  const parent = new Map(nodes.map(n => [n.id, n.parentId]));
  for (const n of nodes) {
    const seen = new Set<string>([n.id]);
    for (let p = n.parentId; p; p = parent.get(p) ?? null) {
      if (seen.has(p)) { n.parentId = null; parent.set(n.id, null); break; }
      seen.add(p);
    }
  }
  const seenPlace = new Set<string>();
  const placements = c.placements.filter(p => nodeIds.has(p.nodeId) && rankIds.has(p.rankId) && !seenPlace.has(p.memberId + ':' + p.nodeId) && seenPlace.add(p.memberId + ':' + p.nodeId));
  return { ranks: c.ranks, nodes, placements };
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
    await audit(tx, { actorId: by, action: 'org.save', detail: { nodes: value.nodes.length, placements: value.placements.length, ranks: value.ranks.map(r => r.name) }, via: 'web' });
  });
  return value;
}

/** その人が組織図で使えるページ（置かれた部署のページを合わせたもの） */
export function orgPagesOf(c: OrgChart, memberId: string): WebPage[] {
  const nodes = new Set(c.placements.filter(p => p.memberId === memberId).map(p => p.nodeId));
  const pages = new Set(c.nodes.filter(n => nodes.has(n.id)).flatMap(n => n.pages));
  return WEB_PAGE_KEYS.filter(k => pages.has(k));
}

/** 左の一覧: 役職ごとのメンバー（上の役職から。抜けた人・BOT はのぞく。1 つの役職 300 人まで） */
export async function orgSidebar(db: Db, cfg: GuildConfig): Promise<{ name: string; members: { id: string; name: string }[] }[]> {
  const roleIds = cfg.ranks.map(r => r.roleId);
  const rows = roleIds.length ? await db.select({ id: members.id, name: members.displayName, roleIds: members.roleIds }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false), arrayOverlaps(members.roleIds, roleIds))) : [];
  return [...cfg.ranks].reverse().map(r => ({
    name: `${r.emoji}${r.name}`,
    members: rows.filter(m => m.roleIds.includes(r.roleId)).map(m => ({ id: m.id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name, 'ja')).slice(0, 300),
  }));
}

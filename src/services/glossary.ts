import { asc, eq, max } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { glossaryTerms, type GlossaryTerm } from '../db/schema.js';
import { audit } from './audit.js';
import { DEFAULT_TERMS, GLOSSARY_CATEGORIES, GLOSSARY_CATEGORY_KEYS, type GlossaryCategory } from './glossaryDefaults.js';
import { createNotice, deleteNotice, findChannel, guildChannelsCached, listNotices, renderNotice, updateNotice, type NoticeCtx } from './notices.js';

/**
 * 用語集: 言葉は社務所Web で編集し、#しきたり の「用語集」・#用語集 のカテゴリごとの掲示・/用語 に出す。
 * 説明には掲示と同じ差し込み（{通貨} {#チャンネル} など）が使える。
 */

export type TermInput = { category: GlossaryCategory; term: string; reading: string; emoji: string; description: string; aliases: string };

export async function listTerms(db: Db, opts: { enabledOnly?: boolean } = {}): Promise<GlossaryTerm[]> {
  const rows = await db
    .select()
    .from(glossaryTerms)
    .where(opts.enabledOnly ? eq(glossaryTerms.enabled, true) : undefined)
    .orderBy(asc(glossaryTerms.position), asc(glossaryTerms.id));
  const order = (c: string) => {
    const i = GLOSSARY_CATEGORY_KEYS.indexOf(c as GlossaryCategory);
    return i < 0 ? 99 : i;
  };
  return rows.sort((a, b) => order(a.category) - order(b.category));
}

export async function getTerm(db: Db, id: number): Promise<GlossaryTerm | undefined> {
  const [row] = await db.select().from(glossaryTerms).where(eq(glossaryTerms.id, id));
  return row;
}

async function nextPosition(db: Db, category: string): Promise<number> {
  const [row] = await db
    .select({ p: max(glossaryTerms.position) })
    .from(glossaryTerms)
    .where(eq(glossaryTerms.category, category));
  return (row?.p ?? -1) + 1;
}

export async function createTerm(db: Db, input: TermInput, by: string): Promise<GlossaryTerm> {
  const [row] = await db
    .insert(glossaryTerms)
    .values({ ...input, position: await nextPosition(db, input.category) })
    .returning();
  await audit(db, { actorId: by, action: 'glossary.create', detail: { id: row!.id, term: input.term }, via: 'web' });
  return row!;
}

export async function updateTerm(db: Db, id: number, input: TermInput, by: string): Promise<void> {
  const before = await getTerm(db, id);
  if (!before) return;
  const moved = before.category !== input.category;
  await db
    .update(glossaryTerms)
    .set({ ...input, ...(moved ? { position: await nextPosition(db, input.category) } : {}), updatedAt: new Date() })
    .where(eq(glossaryTerms.id, id));
  await audit(db, { actorId: by, action: 'glossary.update', detail: { id, term: input.term }, via: 'web' });
}

export async function setTermEnabled(db: Db, id: number, enabled: boolean): Promise<void> {
  await db.update(glossaryTerms).set({ enabled, updatedAt: new Date() }).where(eq(glossaryTerms.id, id));
}

export async function deleteTerm(db: Db, id: number, by: string): Promise<void> {
  const t = await getTerm(db, id);
  if (!t) return;
  await db.delete(glossaryTerms).where(eq(glossaryTerms.id, id));
  await audit(db, { actorId: by, action: 'glossary.delete', detail: { id, term: t.term }, via: 'web' });
}

/** 同じカテゴリの中で 1 つ上・下と入れ替える */
export async function moveTerm(db: Db, id: number, dir: 'up' | 'down'): Promise<void> {
  const t = await getTerm(db, id);
  if (!t) return;
  const list = await db
    .select()
    .from(glossaryTerms)
    .where(eq(glossaryTerms.category, t.category))
    .orderBy(asc(glossaryTerms.position), asc(glossaryTerms.id));
  const i = list.findIndex((x) => x.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
  await db.transaction(async (tx) => {
    for (const [pos, x] of list.entries()) await tx.update(glossaryTerms).set({ position: pos }).where(eq(glossaryTerms.id, x.id));
  });
}

/** 標準の言葉を入れる（同じカテゴリに同じ言葉があれば入れない）。入れた数 */
export async function seedDefaultTerms(db: Db, by: string): Promise<number> {
  const have = new Set((await listTerms(db)).map((t) => `${t.category}\n${t.term}`));
  let n = 0;
  for (const d of DEFAULT_TERMS) {
    if (have.has(`${d.category}\n${d.term}`)) continue;
    await db.insert(glossaryTerms).values({
      category: d.category,
      term: d.term,
      reading: d.reading ?? '',
      emoji: d.emoji ?? '',
      description: d.description,
      aliases: d.aliases ?? '',
      position: await nextPosition(db, d.category),
    });
    n++;
  }
  if (n) await audit(db, { actorId: by, action: 'glossary.seed', detail: { count: n }, via: 'web' });
  return n;
}

// ───────── 文面 ─────────

/** 1 行: 絵文字 **言葉**（読み）… 説明 */
export function termLine(t: Pick<GlossaryTerm, 'emoji' | 'term' | 'reading' | 'description'>): string {
  return `- ${t.emoji ? `${t.emoji} ` : ''}**${t.term}**${t.reading ? `（${t.reading}）` : ''} … ${t.description}`;
}

export const categoryHeading = (c: GlossaryCategory) => `${GLOSSARY_CATEGORIES[c].emoji} ${GLOSSARY_CATEGORIES[c].label}`;

/** カテゴリごとにまとめる（言葉のないカテゴリは除く） */
export function byCategory(terms: GlossaryTerm[]): { category: GlossaryCategory; terms: GlossaryTerm[] }[] {
  return GLOSSARY_CATEGORY_KEYS.map((category) => ({ category, terms: terms.filter((t) => t.category === category && t.enabled) })).filter((g) => g.terms.length);
}

const DISCLAIMER = '-# ここでの呼び名は神社の雰囲気を楽しむためのもので、実際の神社や信仰とは関係ありません';

/** #用語集 のカテゴリごとのカード */
export function categoryCard(category: GlossaryCategory, terms: GlossaryTerm[]): string {
  return [`# ${categoryHeading(category)}`, ...terms.map(termLine)].join('\n');
}

/** #しきたり の「用語集」（全部。長すぎるときは short で、役職・仕組みだけと #用語集 への案内） */
export function glossaryAll(terms: GlossaryTerm[], opts: { short?: boolean; channelLink?: boolean } = {}): string {
  const groups = byCategory(terms).filter((g) => !opts.short || g.category === 'roles' || g.category === 'system');
  const more = opts.channelLink ? '{#用語集}' : '';
  return [
    '# 📖 用語集',
    DISCLAIMER,
    ...groups.flatMap((g) => ['', `## ${categoryHeading(g.category)}`, ...g.terms.map(termLine)]),
    '',
    opts.short ? `ほかの言葉は ${more ? `${more} か ` : ''}\`/用語\` で調べられます` : `-# 言葉は \`/用語 天井\` のように調べることもできます${more ? `（カテゴリごとの一覧は ${more}）` : ''}`,
  ].join('\n');
}

// ───────── 探す ─────────

/** 比べやすくする（全角半角・大文字小文字・カタカナ → ひらがな・空白） */
export function normalizeWord(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・]/g, '');
}

/** 言葉・読み・別名で探す（ぴったり → 始まりが同じ → 含む → 説明に含む の順）。{通貨} は今の名前でも探せる */
export function searchTerms(terms: GlossaryTerm[], query: string, currencyName: string, limit = 5): GlossaryTerm[] {
  const q = normalizeWord(query);
  if (!q) return [];
  const names = (t: GlossaryTerm) =>
    [t.term.replaceAll('{通貨}', currencyName), t.reading, ...t.aliases.split(',')].map(normalizeWord).filter(Boolean);
  const score = (t: GlossaryTerm) => {
    const ns = names(t);
    if (ns.some((n) => n === q)) return 0;
    if (ns.some((n) => n.startsWith(q))) return 1;
    if (ns.some((n) => n.includes(q))) return 2;
    if (normalizeWord(t.description.replaceAll('{通貨}', currencyName)).includes(q)) return 3;
    return 9;
  };
  return terms
    .filter((t) => t.enabled)
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map((x) => x.t);
}

// ───────── 掲示に反映 ─────────

export const GLOSSARY_CHANNEL = '用語集';
const SHIKITARI = 'しきたり';
const TITLE = '用語集';
const cardTitle = (c: GlossaryCategory) => `用語集: ${GLOSSARY_CATEGORIES[c].label}`;

export type SyncResult = { created: number; updated: number; removed: number; noShikitari: boolean; noChannel: boolean };

/**
 * 用語集を掲示にする: #しきたり の「用語集」（長すぎれば短く）と、#用語集 にカテゴリごとのカード。
 * 掲示を作る・書き換えるだけ（Discord への反映は掲示のページの「すべて反映」で）。
 */
export async function syncGlossaryNotices(ctx: NoticeCtx, by: string): Promise<SyncResult> {
  const channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId, true);
  const terms = await listTerms(ctx.db, { enabledOnly: true });
  const all = await listNotices(ctx.db);
  const r: SyncResult = { created: 0, updated: 0, removed: 0, noShikitari: false, noChannel: false };
  const glossaryChannel = findChannel(channels, GLOSSARY_CHANNEL);

  const upsert = async (channelId: string, title: string, body: string) => {
    const n = all.find((x) => x.channelId === channelId && x.title === title);
    if (!n) {
      await createNotice(ctx.db, { channelId, title, body, by });
      r.created++;
    } else if (n.body !== body) {
      await updateNotice(ctx.db, n.id, { title, body, by });
      r.updated++;
    }
  };

  const shikitari = findChannel(channels, SHIKITARI);
  if (!shikitari) r.noShikitari = true;
  else {
    const full = glossaryAll(terms, { channelLink: Boolean(glossaryChannel) });
    // カードは 4096 文字まで（差し込んだあとで数える）
    const fits = renderNotice(full, ctx.cfg, channels).text.length <= 4000;
    await upsert(shikitari.id, TITLE, fits ? full : glossaryAll(terms, { short: true, channelLink: Boolean(glossaryChannel) }));
  }

  if (!glossaryChannel) r.noChannel = true;
  else {
    const groups = byCategory(terms);
    for (const g of groups) await upsert(glossaryChannel.id, cardTitle(g.category), categoryCard(g.category, g.terms));
    // 言葉がなくなったカテゴリのカードは消す
    const keep = new Set(groups.map((g) => cardTitle(g.category)));
    for (const n of all.filter((x) => x.channelId === glossaryChannel.id && x.title.startsWith('用語集: ') && !keep.has(x.title))) {
      await deleteNotice(ctx, n.id, by);
      r.removed++;
    }
  }
  await audit(ctx.db, { actorId: by, action: 'glossary.sync', detail: { ...r }, via: 'web' });
  return r;
}

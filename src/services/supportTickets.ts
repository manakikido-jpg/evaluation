import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings, supportTickets, type SupportTicket } from '../db/schema.js';
import { addCoins, spendWithin, walletOf } from './economy.js';

/**
 * 🎫 チケット: パネルから種類を選んで開くと、開いた人と、その種類のロールの人だけが見えるチャンネルができる。
 * - 種類（お問い合わせ・相談・役職の希望・個人スタンプ依頼など）は社務所Web で決める（見えるロール・カテゴリ・あいさつ・質問）
 * - 同じ種類は 1 人 1 つまで。運営は「担当する」で受け持つ。「人を足す」であとから人を入れられる
 * - 閉じると、やりとりを文字にして #記録 と社務所Web に残し、チャンネルを消す。開いた人に評価（⭐1〜5）を聞く
 * - 放置: 運営の返事がないまま staleHours たつと運営に知らせる。開いた人の返事がないまま idleHours たつと案内を出し、さらに 24 時間で閉じる
 * - 役職の希望（kind: role）: 希望するロールを選んで開き、運営が面接して「採用する」でロールを付ける
 * - 依頼（kind: request）: 運営が見積もり（値段・期限）を出し、開いた人が払うと銭を預かる。「納品」で担当に渡す。渡す前に閉じたら戻す
 */

export type TicketKind = 'normal' | 'role' | 'request';
export type TicketQuestion = { label: string; long: boolean; required: boolean };
export type TicketType = {
  key: string;
  label: string;
  emoji: string;
  description: string;
  kind: TicketKind;
  /** 見えるロール（運営側） */
  roleIds: string[];
  /** チャンネルを作るカテゴリ（なければ全体の設定） */
  categoryId?: string;
  /** チャンネルの最初に出すあいさつ */
  greeting: string;
  /** 開くときの質問（5 つまで。Discord の入力欄の数） */
  questions: TicketQuestion[];
  /** 役職の希望で選べるロール */
  roleChoices: string[];
  enabled: boolean;
};

export type TicketConfig = {
  panelChannelId?: string;
  panelMessageId?: string;
  /** チャンネルを作るカテゴリ（種類で決めていなければ） */
  categoryId?: string;
  /** 閉じたときのやりとりを残すチャンネル（なければ #記録） */
  logChannelId?: string;
  /** 運営の返事がないまま、この時間たったら運営に知らせる */
  staleHours: number;
  /** 開いた人の返事がないまま、この時間たったら案内（さらに 24 時間で閉じる）。0 なら自動で閉じない */
  idleHours: number;
  types: TicketType[];
};

export const TICKET_QUESTIONS_MAX = 5;
export const TICKET_TYPES_MAX = 20;
const KEY = 'tickets';

const q = (label: string, long = false, required = true): TicketQuestion => ({ label, long, required });
const type = (key: string, label: string, emoji: string, description: string, kind: TicketKind, greeting: string, questions: TicketQuestion[]): TicketType => ({
  key, label, emoji, description, kind, roleIds: [], greeting, questions, roleChoices: [], enabled: true,
});

/** はじめの種類（社務所Web で変えられる） */
export const DEFAULT_TICKET_TYPES: TicketType[] = [
  type('inquiry', 'お問い合わせ', '📮', '運営への質問・お知らせ', 'normal', 'お問い合わせありがとうございます。運営が確認してお返事します。', [q('お問い合わせの内容', true)]),
  type('soudan', '相談', '🍵', '困りごと・人間関係などの相談', 'normal', 'ご相談ありがとうございます。ここは、あなたと運営だけが見られます。ゆっくりお話しください。', [q('相談したいこと', true)]),
  type('role', '役職の希望（面接）', '🎐', '運営の役職を希望する', 'role', '役職のご希望ありがとうございます。面接の日時をこのチャンネルで決めましょう。', [q('希望する理由', true), q('面接できる日時', false, false)]),
  type('stamp', '個人スタンプ依頼', '🎨', 'あなただけのスタンプを依頼する', 'request', 'スタンプのご依頼ありがとうございます。内容を確認して、値段と期限をお出しします。', [q('スタンプの内容（文字・絵の雰囲気）', true), q('希望の期限', false, false)]),
];
export const TICKET_DEFAULTS: TicketConfig = { staleHours: 24, idleHours: 72, types: DEFAULT_TICKET_TYPES };

const sf = (x: unknown) => (typeof x === 'string' && /^\d{17,20}$/.test(x) ? x : undefined);
const int = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi ? x : d);
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
const ids = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => !!sf(v)) : []);

function parseType(x: unknown): TicketType | undefined {
  const v = x as Record<string, unknown>;
  if (!v || typeof v.key !== 'string' || !/^[a-z0-9_-]{1,20}$/.test(v.key) || typeof v.label !== 'string' || !v.label) return undefined;
  const kind: TicketKind = v.kind === 'role' || v.kind === 'request' ? v.kind : 'normal';
  const qs = Array.isArray(v.questions) ? v.questions : [];
  return {
    key: v.key,
    label: str(v.label, 40),
    emoji: str(v.emoji, 16),
    description: str(v.description, 100),
    kind,
    roleIds: ids(v.roleIds),
    ...(sf(v.categoryId) ? { categoryId: sf(v.categoryId) } : {}),
    greeting: str(v.greeting, 1000),
    questions: qs
      .map((y) => y as Record<string, unknown>)
      .filter((y) => typeof y?.label === 'string' && y.label)
      .slice(0, TICKET_QUESTIONS_MAX)
      .map((y) => ({ label: str(y.label, 45), long: y.long === true, required: y.required !== false })),
    roleChoices: ids(v.roleChoices),
    enabled: v.enabled !== false,
  };
}

export async function loadTicketConfig(db: Db): Promise<TicketConfig> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = (row?.value ?? {}) as Record<string, unknown>;
  const d = TICKET_DEFAULTS;
  const types = Array.isArray(v.types) ? v.types.map(parseType).filter((t): t is TicketType => !!t).slice(0, TICKET_TYPES_MAX) : d.types;
  return {
    panelChannelId: sf(v.panelChannelId),
    panelMessageId: sf(v.panelMessageId),
    categoryId: sf(v.categoryId),
    logChannelId: sf(v.logChannelId),
    staleHours: int(v.staleHours, d.staleHours, 1, 24 * 14),
    idleHours: int(v.idleHours, d.idleHours, 0, 24 * 30),
    types,
  };
}

export async function saveTicketConfig(db: Db, c: TicketConfig, by: string): Promise<void> {
  const value = { ...c };
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
}

export const ticketTypeOf = (c: TicketConfig, key: string) => c.types.find((t) => t.key === key);

/** その人が、その種類のチケットの運営側か（種類のロールか、運営のロール） */
export const isTicketStaff = (t: TicketType | undefined, roleIds: readonly string[], staffRoleIds: readonly string[]) =>
  roleIds.some((r) => staffRoleIds.includes(r) || (t?.roleIds.includes(r) ?? false));

/** チャンネルの名前（例: 🍵相談-0012） */
export const ticketChannelName = (t: TicketType, id: number) => `${t.emoji}${t.label}-${String(id).padStart(4, '0')}`.replace(/\s+/g, '-').slice(0, 90);

// ───────── 開く ─────────

export type OpenResult = { status: 'ok'; ticket: SupportTicket } | { status: 'already'; ticket: SupportTicket } | { status: 'no_type' | 'bad_role' | 'missing' };

/** チケットを作る（チャンネルはあとで付ける）。同じ種類は 1 人 1 つまで（同時に押しても 1 つ） */
export async function openTicket(
  db: Db,
  c: TicketConfig,
  input: { typeKey: string; openerId: string; answers: { q: string; a: string }[]; roleId?: string },
  now = new Date(),
): Promise<OpenResult> {
  const t = ticketTypeOf(c, input.typeKey);
  if (!t || !t.enabled) return { status: 'no_type' };
  if (t.kind === 'role' && (!input.roleId || !t.roleChoices.includes(input.roleId))) return { status: 'bad_role' };
  for (const [i, question] of t.questions.entries()) if (question.required && !input.answers[i]?.a.trim()) return { status: 'missing' };
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ticket:${input.openerId}:${input.typeKey}`}))`);
    const [cur] = await tx.select().from(supportTickets).where(and(eq(supportTickets.openerId, input.openerId), eq(supportTickets.typeKey, input.typeKey), eq(supportTickets.status, 'open')));
    if (cur) return { status: 'already' as const, ticket: cur };
    const [row] = await tx
      .insert(supportTickets)
      .values({ typeKey: input.typeKey, openerId: input.openerId, answers: input.answers.map((x) => ({ q: x.q.slice(0, 45), a: x.a.slice(0, 1000) })), ...(t.kind === 'role' ? { roleId: input.roleId } : {}), lastUserAt: now, createdAt: now })
      .returning();
    return { status: 'ok' as const, ticket: row! };
  });
}

export async function setTicketChannel(db: Db, id: number, channelId: string): Promise<void> {
  await db.update(supportTickets).set({ channelId }).where(eq(supportTickets.id, id));
}

/** チャンネルを作れなかったとき: なかったことにする */
export async function dropTicket(db: Db, id: number): Promise<void> {
  await db.delete(supportTickets).where(and(eq(supportTickets.id, id), eq(supportTickets.escrow, 0)));
}

export async function getTicket(db: Db, id: number): Promise<SupportTicket | undefined> {
  const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, id));
  return row;
}

export async function ticketByChannel(db: Db, channelId: string): Promise<SupportTicket | undefined> {
  const [row] = await db.select().from(supportTickets).where(and(eq(supportTickets.channelId, channelId), eq(supportTickets.status, 'open')));
  return row;
}

export async function openTickets(db: Db): Promise<SupportTicket[]> {
  return db.select().from(supportTickets).where(eq(supportTickets.status, 'open')).orderBy(supportTickets.createdAt);
}

export async function closedTickets(db: Db, limit = 50): Promise<SupportTicket[]> {
  return db.select().from(supportTickets).where(eq(supportTickets.status, 'closed')).orderBy(desc(supportTickets.closedAt)).limit(limit);
}

// ───────── 担当・人を足す・話した時刻 ─────────

/** 担当する（ほかの人が担当していても引きつげる） */
export async function claimTicket(db: Db, id: number, staffId: string): Promise<SupportTicket | undefined> {
  const [row] = await db.update(supportTickets).set({ assigneeId: staffId }).where(and(eq(supportTickets.id, id), eq(supportTickets.status, 'open'))).returning();
  return row;
}

export async function addTicketMember(db: Db, id: number, memberId: string): Promise<SupportTicket | undefined> {
  const [row] = await db
    .update(supportTickets)
    .set({ members: sql`array_append(array_remove(${supportTickets.members}, ${memberId}), ${memberId})` })
    .where(and(eq(supportTickets.id, id), eq(supportTickets.status, 'open')))
    .returning();
  return row;
}

/** チャンネルで話した: 運営か、開いた人（足した人も開いた人の側） */
export async function touchTicket(db: Db, id: number, side: 'staff' | 'user', now = new Date()): Promise<void> {
  await db
    .update(supportTickets)
    .set(side === 'staff' ? { lastStaffAt: now, staleNotifiedAt: null } : { lastUserAt: now, idleWarnedAt: null })
    .where(and(eq(supportTickets.id, id), eq(supportTickets.status, 'open')));
}

// ───────── 依頼: 見積もり・払う・納品 ─────────

export async function setQuote(db: Db, id: number, by: string, price: number, deadline: string): Promise<SupportTicket | undefined> {
  if (!Number.isInteger(price) || price < 1 || price > 1_000_000) return undefined;
  // 払ったあとは見積もりを変えない
  const [row] = await db
    .update(supportTickets)
    .set({ quotePrice: price, quoteDeadline: deadline.slice(0, 40), quoteBy: by })
    .where(and(eq(supportTickets.id, id), eq(supportTickets.status, 'open'), eq(supportTickets.escrow, 0), isNull(supportTickets.paidTo)))
    .returning();
  return row;
}

export type PayResult = { status: 'ok'; ticket: SupportTicket; balance: number } | { status: 'insufficient'; price: number; balance: number } | { status: 'no_quote' | 'paid' | 'not_opener' };

/** 開いた人が見積もりの値段を払う（銭を預かる）。同時に押しても 1 回だけ */
export async function payQuote(db: Db, id: number, payerId: string, expectedPrice: number): Promise<PayResult> {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for('update');
    if (!t || t.status !== 'open' || !t.quotePrice) return { status: 'no_quote' as const };
    if (t.openerId !== payerId) return { status: 'not_opener' as const };
    if (t.escrow > 0 || t.paidTo) return { status: 'paid' as const };
    // 見積もりが変わったあとの古いボタンでは払わない
    if (t.quotePrice !== expectedPrice) return { status: 'no_quote' as const };
    if (!(await spendWithin(tx, payerId, t.quotePrice, 'ticket_pay', { ticketId: id }))) return { status: 'insufficient' as const, price: t.quotePrice, balance: (await walletOf(tx, payerId)).balance };
    const [row] = await tx.update(supportTickets).set({ escrow: t.quotePrice }).where(eq(supportTickets.id, id)).returning();
    return { status: 'ok' as const, ticket: row!, balance: (await walletOf(tx, payerId)).balance };
  });
}

/** 納品: 預かった銭を担当（なければ見積もりを出した人）に渡す */
export async function deliverTicket(db: Db, id: number): Promise<{ ticket: SupportTicket; to: string; amount: number } | undefined> {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for('update');
    const to = t?.assigneeId ?? t?.quoteBy;
    if (!t || t.escrow <= 0 || !to) return undefined;
    const amount = t.escrow;
    const [row] = await tx.update(supportTickets).set({ escrow: 0, paidTo: to }).where(eq(supportTickets.id, id)).returning();
    await addCoins(tx, to, amount, 'ticket_reward', { ticketId: id, from: t.openerId });
    return { ticket: row!, to, amount };
  });
}

// ───────── 役職の希望: 採用 ─────────

/** 採用した印（ロールは Discord で付ける）。閉じていても記録として残す */
export async function markHired(db: Db, id: number, by: string): Promise<SupportTicket | undefined> {
  const [row] = await db.update(supportTickets).set({ closeReason: `hired:${by}` }).where(and(eq(supportTickets.id, id), eq(supportTickets.status, 'open'))).returning();
  return row;
}

// ───────── 閉じる・評価 ─────────

/** 閉じる。預かっている銭（まだ渡していない）は開いた人に戻す。1 回だけ */
export async function closeTicket(db: Db, id: number, by: string, reason: string, transcript: string, now = new Date()): Promise<{ ticket: SupportTicket; refunded: number } | undefined> {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for('update');
    if (!t || t.status !== 'open') return undefined;
    const refunded = t.escrow;
    const [row] = await tx
      .update(supportTickets)
      .set({ status: 'closed', closedAt: now, closedBy: by, closeReason: t.closeReason ?? reason, transcript: transcript.slice(0, 500_000), escrow: 0 })
      .where(eq(supportTickets.id, id))
      .returning();
    if (refunded > 0) await addCoins(tx, t.openerId, refunded, 'ticket_refund', { ticketId: id });
    return { ticket: row!, refunded };
  });
}

/** 評価（開いた人だけ・1 回だけ） */
export async function rateTicket(db: Db, id: number, userId: string, stars: number): Promise<boolean> {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return false;
  const [row] = await db
    .update(supportTickets)
    .set({ rating: stars })
    .where(and(eq(supportTickets.id, id), eq(supportTickets.openerId, userId), eq(supportTickets.status, 'closed'), isNull(supportTickets.rating)))
    .returning();
  return Boolean(row);
}

// ───────── 放置の確認（1 分ごと） ─────────

export type TicketTick = { stale: SupportTicket[]; idleWarn: SupportTicket[]; idleClose: SupportTicket[] };

/**
 * - stale: 開いた人が最後に話してから、運営の返事がないまま staleHours（1 回だけ知らせる）
 * - idleWarn: 運営が最後に話してから、開いた人の返事がないまま idleHours（案内を 1 回）
 * - idleClose: 案内から 24 時間たっても返事がない（閉じる）
 */
export async function ticketTick(db: Db, c: TicketConfig, now = new Date()): Promise<TicketTick> {
  const H = 3_600_000;
  const open = await openTickets(db);
  const out: TicketTick = { stale: [], idleWarn: [], idleClose: [] };
  for (const t of open) {
    const userAt = t.lastUserAt?.getTime() ?? t.createdAt.getTime();
    const staffAt = t.lastStaffAt?.getTime() ?? 0;
    if (userAt > staffAt && !t.staleNotifiedAt && now.getTime() - userAt >= c.staleHours * H) {
      const [row] = await db.update(supportTickets).set({ staleNotifiedAt: now }).where(and(eq(supportTickets.id, t.id), isNull(supportTickets.staleNotifiedAt))).returning();
      if (row) out.stale.push(row);
    }
    // 依頼で銭を預かっている間は、自動で閉じない（運営が決める）
    if (c.idleHours > 0 && staffAt > userAt && t.escrow === 0) {
      if (!t.idleWarnedAt && now.getTime() - staffAt >= c.idleHours * H) {
        const [row] = await db.update(supportTickets).set({ idleWarnedAt: now }).where(and(eq(supportTickets.id, t.id), isNull(supportTickets.idleWarnedAt))).returning();
        if (row) out.idleWarn.push(row);
      } else if (t.idleWarnedAt && now.getTime() - t.idleWarnedAt.getTime() >= 24 * H) out.idleClose.push(t);
    }
  }
  return out;
}

/** 社務所Web の一覧の数（開いている・担当なし・放置） */
export async function ticketCounts(db: Db): Promise<{ open: number; unassigned: number }> {
  const [r] = await db
    .select({ open: sql<number>`count(*)::int`, unassigned: sql<number>`count(*) filter (where ${supportTickets.assigneeId} is null)::int` })
    .from(supportTickets)
    .where(eq(supportTickets.status, 'open'));
  return { open: Number(r?.open ?? 0), unassigned: Number(r?.unassigned ?? 0) };
}

/** やりとりを文字にする（古い順） */
export function transcriptText(t: Pick<SupportTicket, 'id' | 'typeKey' | 'openerId' | 'answers' | 'createdAt'>, label: string, lines: { at: Date; author: string; content: string; attachments: string[] }[]): string {
  const jst = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
  return [
    `🎫 チケット #${t.id}（${label}） 開いた人: ${t.openerId} ・ ${jst(t.createdAt)}`,
    ...t.answers.map((x) => `【${x.q}】 ${x.a}`),
    '────────',
    ...lines.map((l) => `[${jst(l.at)}] ${l.author}: ${l.content}${l.attachments.length ? ` （添付: ${l.attachments.join(' ')}）` : ''}`),
  ].join('\n');
}


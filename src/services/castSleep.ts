import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { castSessions, castSleepReports, type CastSession, type CastSleepReport, type CastSleepCalculation } from '../db/schema.js';
import { castFee, isDeliverySession, isFreeSession, type CastConfig } from './cast.js';
import { addCoins } from './economy.js';
import { audit } from './audit.js';

export class CastSleepError extends Error {}
export async function getCastSleepReport(db: Db, id: string): Promise<CastSleepReport | undefined> {
  return (await db.select().from(castSleepReports).where(eq(castSleepReports.id, id)))[0];
}
export type CastSleepActor = { id: string; channelId: string; staff: boolean; present: boolean; castPresent: boolean; customerPresent: boolean };

function allowed(s: CastSession | undefined, actor: CastSleepActor): asserts s is CastSession {
  if (!s || s.status !== 'active') throw new CastSleepError('この接客はもう終了しています。');
  if (!s.channelId || actor.channelId !== s.channelId) throw new CastSleepError('この予約の接客用VCから報告してください。');
  if (!actor.staff && actor.id !== s.customerId && actor.id !== s.castId) throw new CastSleepError('報告できるのは、この予約の当事者と運営だけです。');
  if (!actor.staff && !actor.present) throw new CastSleepError('接客用VCに入ってから報告してください。');
  if (!actor.castPresent) throw new CastSleepError('キャストがVCにいません。欠席は「相手が来ない」、ほかの問題は「通報」を使ってください。');
  if (!actor.customerPresent && !s.attendance?.customerJoinedAt) throw new CastSleepError('お客様の入室を確認できません。欠席は「相手が来ない」、確認が必要な場合は「通報」を使ってください。');
  if (isDeliverySession(s) || isFreeSession(s) || !s.startedAt || !s.endsAt || s.endsAt <= s.startedAt) throw new CastSleepError('時間で割れない契約です。「通報」から運営に精算を依頼してください。');
}

/** 延長を含む契約総額を契約時間で按分する。途中の秒も使い、銭の端数だけ切り捨てる。 */
export function sleepCalculation(s: Pick<CastSession, 'price' | 'startedAt' | 'endsAt'>, c: Pick<CastConfig, 'feePercent'>, at: Date): CastSleepCalculation {
  const durationMs = s.endsAt!.getTime() - s.startedAt!.getTime();
  if (!Number.isFinite(at.getTime()) || durationMs <= 0) throw new CastSleepError('開始・終了時刻を確認できません。');
  const elapsedMs = Math.min(durationMs, Math.max(0, at.getTime() - s.startedAt!.getTime()));
  // 最大20億銭でもミリ秒との掛け算が安全整数を超えないよう整数演算する。
  const charge = Number(BigInt(s.price) * BigInt(elapsedMs) / BigInt(durationMs));
  const fee = castFee(c, charge);
  return { elapsedMs, durationMs, charge, fee, pay: charge - fee, refund: s.price - charge };
}

export async function prepareCastSleep(db: Db, c: CastConfig, sessionId: number, actor: CastSleepActor, now = new Date()): Promise<CastSleepReport> {
  return db.transaction(async tx => {
    const [s] = await tx.select().from(castSessions).where(eq(castSessions.id, sessionId)).for('update');
    allowed(s, actor);
    if (now < s.startedAt! || now >= s.endsAt!) throw new CastSleepError('接客時間外です。最新の予約状態を確認してください。');
    const [report] = await tx.insert(castSleepReports).values({
      id: randomUUID(), sessionId, reporterId: actor.id, channelId: actor.channelId, reportedAt: now,
      expiresAt: new Date(now.getTime() + 90_000),
      snapshot: { price: s.price, startedAt: s.startedAt!.toISOString(), endsAt: s.endsAt!.toISOString(), extensions: s.extensions, feePercent: c.feePercent },
      calculation: sleepCalculation(s, c, now),
    }).returning();
    return report!;
  });
}

export async function confirmCastSleep(db: Db, c: CastConfig, reportId: string, actor: CastSleepActor, now = new Date()): Promise<{ report: CastSleepReport; session: CastSession }> {
  return db.transaction(async tx => {
    const [report] = await tx.select().from(castSleepReports).where(eq(castSleepReports.id, reportId)).for('update');
    if (!report || report.reporterId !== actor.id || report.channelId !== actor.channelId) throw new CastSleepError('この確認は利用できません。寝落ち報告を開き直してください。');
    if (report.settledAt) throw new CastSleepError('この報告は精算済みです。二重には支払いません。');
    if (now >= report.expiresAt || now < report.reportedAt) throw new CastSleepError('確認の期限が切れました。寝落ち報告を開き直してください。');
    const [s] = await tx.select().from(castSessions).where(eq(castSessions.id, report.sessionId)).for('update');
    allowed(s, actor);
    const snap = report.snapshot;
    if (s.price !== snap.price || s.startedAt?.toISOString() !== snap.startedAt || s.endsAt?.toISOString() !== snap.endsAt || s.extensions !== snap.extensions || c.feePercent !== snap.feePercent || now >= s.endsAt!) throw new CastSleepError('時間・料金・状態が変わりました。最新の内容で寝落ち報告を開き直してください。');
    const p = sleepCalculation(s, c, report.reportedAt);
    const [session] = await tx.update(castSessions).set({ status: 'done', closedAt: report.reportedAt, endsAt: report.reportedAt, deleteAt: now, paid: p.pay, decidedBy: actor.id }).where(and(eq(castSessions.id, s.id), eq(castSessions.status, 'active'))).returning();
    if (!session) throw new CastSleepError('この接客はもう終了しています。');
    const detail = { sessionId: s.id, sleepReport: report.id, reportedAt: report.reportedAt.toISOString(), charge: p.charge, fee: p.fee };
    if (p.pay > 0) await addCoins(tx, s.castId, p.pay, 'cast_reward', { ...detail, from: s.customerId });
    if (p.refund > 0) await addCoins(tx, s.customerId, p.refund, 'cast_refund', detail);
    const [settled] = await tx.update(castSleepReports).set({ settledAt: now, calculation: p }).where(eq(castSleepReports.id, report.id)).returning();
    await audit(tx, { actorId: actor.id, targetId: s.castId, action: 'cast.sleep_settle', detail: { ...detail, pay: p.pay, refund: p.refund, elapsedMs: p.elapsedMs }, via: 'discord' });
    return { report: settled!, session };
  });
}

export function castSleepReceipt(r: CastSleepReport, coin: string): string {
  const at = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(r.reportedAt);
  const p = r.calculation, minutes = Math.floor(p.elapsedMs / 60000), seconds = Math.floor(p.elapsedMs % 60000 / 1000);
  return `💤 キャストの寝落ち報告・予約 #${r.sessionId}\n受付・終了時刻：${at}（日本時間）\n利用時間：${minutes}分${seconds}秒\n利用料金：${p.charge.toLocaleString('ja-JP')}${coin}\nキャストへ振込：${p.pay.toLocaleString('ja-JP')}${coin}（手数料${p.fee.toLocaleString('ja-JP')}${coin}を差し引き）\nお客様へ返金：${p.refund.toLocaleString('ja-JP')}${coin}`;
}

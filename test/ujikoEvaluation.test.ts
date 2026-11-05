import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { members, settings, shuin, specialGoen, voiceChannels, voiceUsage } from '../src/db/schema.js';
import { evaluationCsv, EvaluationSelectionError, ujikoEvaluation } from '../src/services/ujikoEvaluation.js';
import { recordPresence } from '../src/services/voiceUsage.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const A = '810000000000000001', B = '810000000000000002', C = '810000000000000003', D = '810000000000000004';
const ENG = '910000000000000001', OTHER = '910000000000000002', OLD = '910000000000000003';
const now = new Date('2026-11-07T03:00:00Z'), filter = { q: '', status: 'all' as const };
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([A, B, C, D].map((id, i) => ({ id, username: `person${i}`, displayName: `参拝者${i}`, roleIds: [ROLE.sanpaisha] })));
  await db.insert(voiceChannels).values([{ channelId: ENG, name: '🌸 2人｜大きな縁側１' }, { channelId: OTHER, name: '宿坊' }, { channelId: OLD, name: '旧広場' }]);
});
afterEach(async () => close());
async function stamps(id: string, n: number, weight = 1) {
  await db.insert(shuin).values(Array.from({ length: n }, (_, i) => ({ giverId: String(820000000000000000n + BigInt(i)), receiverId: id, weight, giverRank: 'ujiko' })));
}
const voice = (id: string, minutes: number, confirmed: number, recorded = confirmed, channelId = ENG, date = '2026-11-06') =>
  db.insert(voiceUsage).values({ memberId: id, date, channelId, minutes, sanpaishaMinutes: confirmed, rankRecordedMinutes: recorded });

it('40個と1200分を別々に判定し、過去取込は加算し、重み・特別ご縁・取消し・対象外時間は足さない', async () => {
  await stamps(A, 40, 10); await stamps(B, 39, 100); await stamps(C, 40); await stamps(D, 40);
  await db.update(shuin).set({ revokedAt: now }).where(eq(shuin.receiverId, D));
  await db.insert(specialGoen).values({ memberId: B, amount: 1000, reason: 'test', grantedBy: A, nonce: 'evaluation-test' });
  await voice(A, 1440, 1200); await voice(B, 1200, 1200); await voice(C, 10000, 1199, 2000); await voice(D, 1200, 1200);
  await voice(C, 8000, 0, 0, OTHER); await voice(C, 3000, 3000, 3000, ENG, '2026-11-08');
  const data = await ujikoEvaluation(db, cfg, filter, now), by = new Map(data.rows.map(r => [r.memberId, r]));
  expect(data.achieved).toBe(2);
  expect(by.get(A)).toMatchObject({ shuinCount: 40, minutes: 1440, confirmedMinutes: 1200, pastMinutes: 240, achieved: true, remainingMinutes: 0 });
  expect(by.get(B)).toMatchObject({ shuinCount: 39, achieved: false, remainingShuin: 1 });
  expect(by.get(C)).toMatchObject({ shuinCount: 40, minutes: 9199, confirmedMinutes: 1199, pastMinutes: 8000, remainingMinutes: 0, achieved: true });
  expect(by.get(D)).toMatchObject({ shuinCount: 0, achieved: false });
});

it('達成者が先、次に個数と時間、同点は同順位。検索しても元の順位を保つ', async () => {
  await stamps(A, 40); await stamps(B, 80); await stamps(C, 40); await stamps(D, 40);
  await voice(A, 1200, 1200); await voice(B, 1199, 1199); await voice(C, 1200, 1200); await voice(D, 1250, 1250);
  const data = await ujikoEvaluation(db, cfg, filter, now);
  expect(data.rows.map(r => [r.memberId, r.rank])).toEqual([[D, 1], [A, 2], [C, 2], [B, 4]]);
  expect(data.rows.find(r => r.memberId === B)).toMatchObject({ minutes: 1199, pastMinutes: 0, remainingMinutes: 1, achieved: false });
  const found = await ujikoEvaluation(db, cfg, { q: 'ＰＥＲＳＯＮ１', status: 'unmet' }, now);
  expect(found.rows.map(r => [r.memberId, r.rank])).toEqual([[B, 4]]);
  expect(found.total).toBe(4); expect(found.achieved).toBe(3);
});

it('在籍中の参拝者だけを対象にし、上位職・BOT・退出者・運営サブを除く', async () => {
  await db.update(members).set({ roleIds: [ROLE.sanpaisha, ROLE.ujiko] }).where(eq(members.id, A));
  await db.update(members).set({ isBot: true }).where(eq(members.id, B));
  await db.update(members).set({ leftAt: now }).where(eq(members.id, C));
  await db.insert(settings).values({ key: 'staff.alts', value: { list: [{ id: D }] }, updatedBy: A });
  expect((await ujikoEvaluation(db, cfg, filter, now)).rows).toEqual([]);
  await db.update(members).set({ isBot: false, roleIds: [ROLE.sanpaisha, ROLE.guji] }).where(eq(members.id, B));
  expect((await ujikoEvaluation(db, cfg, filter, now)).rows).toEqual([]);
});

it('確定した縁側時間は改名後も残し、未選択や不明チャンネルを全通話へ広げない', async () => {
  await voice(A, 1200, 1200, 1200, OLD); await voice(A, 300, 300); await voice(A, 9000, 0, 9000, OTHER);
  const data = await ujikoEvaluation(db, cfg, filter, now);
  expect(data.channels.map(c => c.id).sort()).toEqual([ENG, OLD]);
  expect(data.channels.find(c => c.id === OLD)?.renamed).toBe(true);
  expect(data.rows.find(r => r.memberId === A)?.minutes).toBe(1500);
  expect((await ujikoEvaluation(db, cfg, { ...filter, channelIds: [ENG] }, now)).rows.find(r => r.memberId === A)?.minutes).toBe(300);
  expect((await ujikoEvaluation(db, cfg, { ...filter, channelIds: [] }, now)).rows.every(r => r.minutes === 0)).toBe(true);
  await expect(ujikoEvaluation(db, cfg, { ...filter, channelIds: [OTHER] }, now)).rejects.toBeInstanceOf(EvaluationSelectionError);
});

it('同じ縁側の過去IDを1つにまとめ、重複選択や旧URLでも各記録を1回だけ加算する', async () => {
  const old1 = '910000000000000004', old2 = '910000000000000005', second = '910000000000000006', otherCat = '910000000000000007';
  await db.insert(voiceChannels).values([
    { channelId: old1, name: '大きな縁側1' }, { channelId: old2, name: '🌸 大きな縁側１' },
    { channelId: second, name: '大きな縁側2' },
    { channelId: otherCat, name: '大きな縁側1', categoryId: '920000000000000001', categoryName: '別の境内' },
  ]);
  await stamps(A, 40);
  await voice(A, 600, 0, 0, ENG, '2026-11-05');
  await voice(A, 300, 0, 0, old1, '2026-11-05'); await voice(A, 300, 0, 0, old2, '2026-11-05');
  await voice(A, 600, 0, 0, second, '2026-11-05'); await voice(A, 900, 0, 0, otherCat, '2026-11-05');
  const beforeRooms = await db.select().from(voiceChannels), beforeUsage = await db.select().from(voiceUsage);
  const data = await ujikoEvaluation(db, cfg, { ...filter, channelIds: [old1] }, now);
  expect(data.channels).toHaveLength(3);
  expect(data.channels.find(c => c.id === ENG)).toMatchObject({ name: '大きな縁側1', ids: [ENG, old1, old2], categoryName: 'カテゴリなし' });
  expect(data.channels.find(c => c.id === otherCat)?.categoryName).toBe('別の境内');
  expect(data.selectedIds).toEqual([ENG]);
  expect(data.rows.find(r => r.memberId === A)).toMatchObject({ minutes: 1200, pastMinutes: 1200, confirmedMinutes: 0, achieved: true, remainingMinutes: 0 });
  const repeated = await ujikoEvaluation(db, cfg, { ...filter, channelIds: [ENG, old1, old2, old1] }, now);
  expect(repeated.rows).toEqual(data.rows);
  expect(await db.select().from(voiceChannels)).toEqual(beforeRooms);
  expect(await db.select().from(voiceUsage)).toEqual(beforeUsage);
  expect(evaluationCsv(data)).toContain('カテゴリなし / 大きな縁側1');
});

it('毎分の記録で過去・確認済みの参拝者・上位職・縁側以外を区別する', async () => {
  const ch = { id: ENG, name: '縁側１', categoryId: null, categoryName: null, memberIds: [A, A, B] };
  await recordPresence(db, [ch], now);
  await recordPresence(db, [{ ...ch, sanpaishaMemberIds: [A] }], now);
  await recordPresence(db, [{ ...ch, sanpaishaMemberIds: [] }], now);
  await recordPresence(db, [{ ...ch, name: '宿坊', sanpaishaMemberIds: [A, B] }], now);
  const usage = await db.select().from(voiceUsage).where(eq(voiceUsage.channelId, ENG));
  expect(usage.find(r => r.memberId === A)).toMatchObject({ minutes: 4, rankRecordedMinutes: 3, sanpaishaMinutes: 1 });
  expect(usage.find(r => r.memberId === B)).toMatchObject({ minutes: 4, rankRecordedMinutes: 3, sanpaishaMinutes: 0 });
  await expect(voice(C, 1, 2, 2)).rejects.toThrow();
});

it('確認済み計測は11月6日0時から。直前の分は過去取込として重複せず合計へ足す', async () => {
  const before = new Date('2026-11-05T14:59:00Z'), start = new Date('2026-11-05T15:00:00Z');
  const ch = { id: ENG, name: '縁側１', categoryId: null, categoryName: null, memberIds: [A], sanpaishaMemberIds: [A] };
  await recordPresence(db, [ch], before);
  expect((await ujikoEvaluation(db, cfg, filter, before)).rows.find(r => r.memberId === A)).toMatchObject({ minutes: 1, confirmedMinutes: 0, pastMinutes: 1 });
  await recordPresence(db, [ch], start);
  expect((await ujikoEvaluation(db, cfg, filter, start)).rows.find(r => r.memberId === A)).toMatchObject({ minutes: 2, confirmedMinutes: 1, pastMinutes: 1 });
  // 記録側だけでなく、集計側も開始前の分を確認済みとして重ねて足さない。
  await db.update(voiceUsage).set({ sanpaishaMinutes: 1 }).where(eq(voiceUsage.date, '2026-11-05'));
  expect((await ujikoEvaluation(db, cfg, filter, start)).rows.find(r => r.memberId === A)).toMatchObject({ minutes: 2, confirmedMinutes: 1, pastMinutes: 1 });
});

it('CSVでは名前の数式と改行を引用し、Discord IDの桁を守る', async () => {
  await db.update(members).set({ displayName: '=1+1,"危険"\n名前' }).where(eq(members.id, A));
  const csv = evaluationCsv(await ujikoEvaluation(db, cfg, { q: A, status: 'all' }, now));
  expect(csv.startsWith('\ufeff')).toBe(true);
  expect(csv).toContain('"\'=1+1,""危険""\n名前"');
  expect(csv).toContain('"\'' + A + '"');
  expect(csv).toContain('うち過去取込（分・当時役職未確認）');
});

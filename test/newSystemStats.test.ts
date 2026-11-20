import { afterEach, beforeEach, expect, it } from 'vitest';
import { activityHourly, members, omairi, voiceChannels, voicePairs, voiceUsage } from '../src/db/schema.js';
import type { Db } from '../src/db/client.js';
import { EMA_DAY_THRESHOLDS, EMA_MIN_THRESHOLDS, newSystemStats } from '../src/services/newSystemStats.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const S = '870000000000000001'; // 参拝者
const U = '870000000000000002'; // 氏子
const W = '870000000000000003'; // 世話役（氏子以上）
const ENG = '970000000000000001';
const now = new Date('2026-11-18T03:00:00Z');
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: S, username: 's', displayName: '参拝者エス', roleIds: [ROLE.sanpaisha] },
    { id: U, username: 'u', displayName: '氏子ユー', roleIds: [ROLE.ujiko] },
    { id: W, username: 'w', displayName: '世話役ダブュ', roleIds: [ROLE.sewayaku] },
  ]);
  await db.insert(voiceChannels).values({ channelId: ENG, name: '🌸 縁側１' });
});
afterEach(async () => close());

const vu = (id: string, date: string, minutes: number, elig = 0) =>
  db.insert(voiceUsage).values({ memberId: id, date, channelId: ENG, minutes, evaluationEligibleMinutes: elig, evaluationRecordedMinutes: elig, sanpaishaMinutes: elig, rankRecordedMinutes: minutes });
const pair = (x: string, y: string, date: string, minutes: number) => {
  const [a, b] = x < y ? [x, y] : [y, x];
  return db.insert(voicePairs).values({ memberA: a, memberB: b, date, minutes });
};
const gi = (mins: number, days: number) => ({ i: EMA_MIN_THRESHOLDS.indexOf(mins), j: EMA_DAY_THRESHOLDS.indexOf(days) });

it('縁側アクティブ人数: 参拝者=非ミュート・氏子以上=全時間、しきい値で分ける', async () => {
  await vu(S, '2026-11-12', 100, 40);
  await vu(U, '2026-11-12', 200, 0);
  const d = await newSystemStats(db, cfg, { now, days: 30, activeMin: 30 });
  expect(d.baseCount).toEqual({ sanpaisha: 1, ujikoPlus: 2 });
  expect(d.engawaWeekly.find((w) => w.bucket === '2026-11-09')?.active).toEqual({ sanpaisha: 1, ujikoPlus: 1 });
  const d50 = await newSystemStats(db, cfg, { now, days: 30, activeMin: 50 });
  expect(d50.engawaWeekly.find((w) => w.bucket === '2026-11-09')?.active).toEqual({ sanpaisha: 0, ujikoPlus: 1 });
});

it('絵馬の条件: 氏子以上×参拝者の組だけ、1日◯分以上いた日が◯日以上の組を数える（全VC）', async () => {
  // U(氏子)×S(参拝者): 60分の日が3日 → 60分以上×3日以上に入る
  await pair(U, S, '2026-11-10', 60);
  await pair(U, S, '2026-11-11', 60);
  await pair(U, S, '2026-11-12', 60);
  // U×W は 氏子×世話役（どちらも氏子以上）なので対象外
  await pair(U, W, '2026-11-10', 200);
  const d = await newSystemStats(db, cfg, { now, days: 30 }); // 既定は全VC
  const c60x3 = gi(60, 3);
  expect(d.emaGrid[c60x3.i]![c60x3.j]).toBe(1); // U×S の1組
  const c120x3 = gi(120, 3);
  expect(d.emaGrid[c120x3.i]![c120x3.j]).toBe(0); // 1日120分以上の日はない
  const c60x4 = gi(60, 4);
  expect(d.emaGrid[c60x4.i]![c60x4.j]).toBe(0); // 4日はない
  // 縁側・ミュート除外に切り替えると、engawa_pairs は空なので0
  const de = await newSystemStats(db, cfg, { now, days: 30, src: 'engawa' });
  expect(de.src).toBe('engawa');
  expect(de.emaGrid[c60x3.i]![c60x3.j]).toBe(0);
});

it('昇格の現実性: 14日たった参拝者の、14日以内に会った氏子以上', async () => {
  await db.insert(omairi).values({ memberId: S, startedAt: new Date('2026-11-01T00:00:00Z'), endsAt: new Date('2026-11-15T00:00:00Z'), status: 'ongoing' });
  await pair(S, U, '2026-11-03', 120);
  await pair(S, W, '2026-11-05', 60);
  await pair(S, U, '2026-11-20', 300); // 14日より後 → 数えない
  const d = await newSystemStats(db, cfg, { now, days: 30 });
  expect(d.promoteReality.sample).toBe(1);
  expect(d.promoteReality.metPartners.find((b) => b.label === '2人')!.count).toBe(1);
  // 14日たっていない参拝者（11/10開始・now=11/18）は除く
  await db.update(omairi).set({ startedAt: new Date('2026-11-10T00:00:00Z') });
  expect((await newSystemStats(db, cfg, { now, days: 30 })).promoteReality.sample).toBe(0);
});

it('維持（月ごと）と評価期間（期間内に氏子化）', async () => {
  await pair(U, S, '2026-11-12', 90);
  await db.insert(omairi).values({ memberId: U, startedAt: new Date('2026-11-01T00:00:00Z'), endsAt: new Date('2026-11-15T00:00:00Z'), status: 'promoted', decidedAt: new Date('2026-11-11T00:00:00Z') });
  const d = await newSystemStats(db, cfg, { now, days: 30 });
  const nov = d.keepMonthly.find((m) => m.month === '2026-11')!;
  expect(nov.sample).toBe(1); // 氏子ちょうどは U
  expect(nov.metSanpaisha.find((b) => b.label === '1人')!.count).toBe(1);
  expect(d.promoteDays.sample).toBe(1);
  expect(d.promoteDays.median).toBe(10);
  expect(d.promoteDays.buckets.find((b) => b.label === '8〜14日')!.count).toBe(1);
});

it('お守り: 週に何日来たか・◯時間以上・ランキング', async () => {
  await vu(U, '2026-11-10', 200); // 月
  await vu(U, '2026-11-11', 100); // 火 → 週に2日
  await vu(S, '2026-11-10', 100, 40); // 参拝者は非ミュート40分
  const d = await newSystemStats(db, cfg, { now, days: 30 });
  const wk = d.surfaceWeekly.find((w) => w.bucket === '2026-11-09')!;
  expect(wk.came).toBe(2); // U と S
  expect(wk.avgDays).toBe(1.5); // U=2日, S=1日 → 平均1.5
  expect(wk.top.map((t) => t.memberId)).toEqual([U, S]); // その週のランキング（U=300分, S=40分）
  expect(d.surfaceDaysCame.find((b) => b.label === '2日')!.count).toBe(1); // U
  expect(d.surfaceHours.find((r) => r.hours === 5)!.people).toBe(1); // U=300分=5時間
});

it('縁側の記録がなくても落ちない', async () => {
  const d = await newSystemStats(db, cfg, { now, days: 7 });
  expect(d.engawaWeekly).toEqual([]);
  expect(d.emaGrid.flat().every((x) => x === 0)).toBe(true);
});

import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { activityHourly, members, voiceChannels, voicePairs, voiceUsage } from '../src/db/schema.js';
import { newSystemStats } from '../src/services/newSystemStats.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const S = '870000000000000001'; // 参拝者
const U = '870000000000000002'; // 氏子
const W = '870000000000000003'; // 世話役（氏子以上）
const ENG = '970000000000000001'; // 縁側
const OTHER = '970000000000000002'; // 縁側でない通話
const now = new Date('2026-11-18T03:00:00Z');
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: S, username: 's', displayName: '参拝者エス', roleIds: [ROLE.sanpaisha] },
    { id: U, username: 'u', displayName: '氏子ユー', roleIds: [ROLE.ujiko] },
    { id: W, username: 'w', displayName: '世話役ダブュ', roleIds: [ROLE.sewayaku] },
  ]);
  await db.insert(voiceChannels).values([{ channelId: ENG, name: '🌸 縁側１' }, { channelId: OTHER, name: '宿坊' }]);
});
afterEach(async () => close());

const vu = (id: string, date: string, channelId: string, minutes: number, elig = 0) =>
  db.insert(voiceUsage).values({ memberId: id, date, channelId, minutes, evaluationEligibleMinutes: elig, evaluationRecordedMinutes: elig, sanpaishaMinutes: elig, rankRecordedMinutes: minutes });

it('縁側アクティブ人数は、参拝者＝非ミュート・氏子以上＝全時間で数え、しきい値と役職で分ける', async () => {
  await vu(S, '2026-11-12', ENG, 100, 40); // 参拝者 → 非ミュート40分
  await vu(U, '2026-11-12', ENG, 200, 0); //  氏子 → 全時間200分
  await vu(S, '2026-11-12', OTHER, 500, 0); // 縁側でないので数えない
  const d = await newSystemStats(db, cfg, { now, days: 30, activeMin: 30 });
  expect(d.baseCount).toEqual({ sanpaisha: 1, ujikoPlus: 2 }); // U と W が氏子以上
  const wk = d.engawaWeekly.find((w) => w.bucket === '2026-11-09'); // 週（月曜）
  expect(wk?.active).toEqual({ sanpaisha: 1, ujikoPlus: 1 });
  // しきい値を50分に上げると、参拝者(40分)は外れる
  const d50 = await newSystemStats(db, cfg, { now, days: 30, activeMin: 50 });
  expect(d50.engawaWeekly.find((w) => w.bucket === '2026-11-09')?.active).toEqual({ sanpaisha: 0, ujikoPlus: 1 });
});

it('時間帯（全VC）に◯分以上いた人を、時間帯の絞りで数える', async () => {
  await db.insert(activityHourly).values([
    { memberId: S, date: '2026-11-12', hour: 22, vcMinutes: 40 },
    { memberId: U, date: '2026-11-12', hour: 23, vcMinutes: 60 },
  ]);
  const core = await newSystemStats(db, cfg, { now, days: 30, activeMin: 30, hourFrom: 22, hourTo: 24 });
  expect(core.hourActive).toEqual({ sanpaisha: 1, ujikoPlus: 1 });
  const only22 = await newSystemStats(db, cfg, { now, days: 30, activeMin: 30, hourFrom: 22, hourTo: 23 });
  expect(only22.hourActive).toEqual({ sanpaisha: 1, ujikoPlus: 0 }); // 22時台だけ → U(23時)は入らない
});

it('絵馬の条件: 合計分・違う日数ごとの組数（全VC）', async () => {
  const [a, b] = S < U ? [S, U] : [U, S];
  await db.insert(voicePairs).values([
    { memberA: a, memberB: b, date: '2026-11-12', minutes: 60 },
    { memberA: a, memberB: b, date: '2026-11-13', minutes: 60 },
    { memberA: a, memberB: b, date: '2026-11-14', minutes: 60 },
  ]);
  const d = await newSystemStats(db, cfg, { now, days: 30 });
  const m180 = d.pairByMins.find((r) => r.mins === 180)!;
  expect(m180).toMatchObject({ pairs: 1, pairsWith3days: 1, people: 2 });
  expect(d.pairByMins.find((r) => r.mins === 240)!.pairs).toBe(0); // 合計180分なので240以上はなし
  expect(d.pairByDays.find((r) => r.days === 3)!.pairs).toBe(1); // 3日以上＋180分以上
  expect(d.pairByDays.find((r) => r.days === 5)!.pairs).toBe(0);
});

it('お守りの目安: 縁側の浮上率・◯時間以上の人数・ランキング', async () => {
  await vu(S, '2026-11-12', ENG, 100, 40);
  await vu(U, '2026-11-12', ENG, 200, 0);
  const d = await newSystemStats(db, cfg, { now, days: 30 });
  const wk = d.surfaceWeekly.find((w) => w.bucket === '2026-11-09')!;
  expect(wk.active).toBe(2); // S と U が縁側に出た
  expect(wk.rate).toBe(66.7); // 2 / 在籍3
  expect(d.surfaceHours.find((r) => r.hours === 1)!.people).toBe(1); // U(200分=3.3h)のみ60分以上… S は40分
  expect(d.surfaceHours.find((r) => r.hours === 3)!.people).toBe(1); // U(200分>=180)
  expect(d.surfaceTop.map((t) => t.memberId)).toEqual([U, S]); // 多い順
  expect(d.surfaceTop[0]).toMatchObject({ name: '氏子ユー', minutes: 200 });
});

it('縁側の記録がなければ空で返す（落ちない）', async () => {
  const d = await newSystemStats(db, cfg, { now, days: 7 });
  expect(d.engawaWeekly).toEqual([]);
  expect(d.pairByMins.every((r) => r.pairs === 0)).toBe(true);
});

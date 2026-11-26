import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { memberEvents, members, sewayakuElections, voiceChannels, voiceUsage } from '../src/db/schema.js';
import { addMonths, sewayakuElectionWindow, sewayakuVotePasses, EMA_DEFAULT_THRESHOLDS } from '../src/domain/ema.js';
import { resetAllShuin } from '../src/services/shuin.js';
import {
  candidateStatus,
  closeDueSewayakuElections,
  currentElectionOf,
  eligibleVoters,
  finishSewayakuElection,
  hasSewayakuVote,
  openSewayakuElections,
  scheduleSewayakuElections,
  toggleSewayakuVote,
  voterStatus,
} from '../src/services/sewayakuElection.js';
import type { GuildConfig } from '../src/config.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const withTh = (patch: Partial<GuildConfig['emaThresholds']>): GuildConfig => ({ ...cfg, emaThresholds: { ...cfg.emaThresholds, ...patch } });

const ENG = '890000000000000001';
const OTHER = '890000000000000002';
const C1 = '890000000000000011'; // 候補：新制度より前からの氏子
const C2 = '890000000000000012'; // 氏子になって間もない
const C3 = '890000000000000013'; // 新制度より前に昇格の記録がある氏子
const V = ['890000000000000021', '890000000000000022', '890000000000000023', '890000000000000024', '890000000000000025', '890000000000000026'];
const SA = '890000000000000031';
const SW = '890000000000000032';
const SD = '890000000000000033';
const SK = '890000000000000034'; // 神職
const START = new Date('2026-08-01T03:00:00Z'); // 新制度（④）が始まった日
const now = new Date('2026-11-25T03:00:00Z'); // 水曜 日本時間12時
const FRI = new Date('2026-11-27T00:00:00+09:00');
const MON = new Date('2026-11-30T00:00:00+09:00');
let db: Db, close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: C1, username: 'c1', displayName: '候補1', roleIds: [ROLE.ujiko] },
    { id: C2, username: 'c2', displayName: '候補2', roleIds: [ROLE.ujiko] },
    { id: C3, username: 'c3', displayName: '候補3', roleIds: [ROLE.ujiko] },
    ...V.map((id, i) => ({ id, username: `v${i}`, displayName: `投票${i}`, roleIds: [ROLE.ujiko] })),
    { id: SA, username: 'sa', displayName: '参拝者', roleIds: [ROLE.sanpaisha] },
    { id: SW, username: 'sw', displayName: '世話役', roleIds: [ROLE.sewayaku] },
    { id: SD, username: 'sd', displayName: '総代', roleIds: [ROLE.sodai] },
    { id: SK, username: 'sk', displayName: '神職', roleIds: [ROLE.shinshoku] },
  ]);
  await db.insert(voiceChannels).values([{ channelId: ENG, name: '縁側１' }, { channelId: OTHER, name: '宿坊' }]);
});
afterEach(async () => close());

async function voice(memberId: string, date: string, minutes: number, channelId = ENG) {
  await db.insert(voiceUsage).values({ memberId, date, channelId, minutes });
}
async function promotedToUjiko(memberId: string, at: Date) {
  await db.insert(memberEvents).values({ memberId, kind: 'promote', detail: { from: 'sanpaisha', to: 'ujiko', goen: 0 }, at });
}

describe('🗳 世話役の選挙：決まり', () => {
  it('票が投票できる人の6割を「超えたら」昇格・投票できる人が5人未満なら不成立', () => {
    expect(sewayakuVotePasses(4, 5, EMA_DEFAULT_THRESHOLDS)).toBe(true); // 80%
    expect(sewayakuVotePasses(3, 5, EMA_DEFAULT_THRESHOLDS)).toBe(false); // ちょうど60%は超えていない
    expect(sewayakuVotePasses(4, 4, EMA_DEFAULT_THRESHOLDS)).toBe(false); // 4人しかいない
    expect(addMonths(new Date('2026-11-30T00:00:00Z'), 3).toISOString().slice(0, 10)).toBe('2027-02-28');
  });

  it('選挙期間は、条件を満たした週の金・土・日（金曜0時より後なら次の週）', () => {
    const at = (iso: string) => sewayakuElectionWindow(new Date(iso));
    expect(at('2026-11-23T00:00:00+09:00')).toEqual({ startsAt: FRI, endsAt: MON }); // 月曜
    expect(at('2026-11-26T23:59:00+09:00')).toEqual({ startsAt: FRI, endsAt: MON }); // 木曜の夜
    const next = { startsAt: new Date('2026-12-04T00:00:00+09:00'), endsAt: new Date('2026-12-07T00:00:00+09:00') };
    expect(at('2026-11-27T00:00:00+09:00')).toEqual(next); // 金曜0時ちょうど
    expect(at('2026-11-29T22:00:00+09:00')).toEqual(next); // 日曜
  });
});

describe('🗳 世話役の選挙：投票権・候補', () => {
  it('投票権は、直近30日の縁側が24時間を「超えて」いる氏子・世話役・総代（参拝者・神職は入らない）', async () => {
    await voice(V[0]!, '2026-11-20', 1441);
    await voice(V[1]!, '2026-11-20', 1440); // ちょうど24時間は超えていない
    await voice(V[2]!, '2026-10-20', 3000); // 30日より前
    await voice(V[3]!, '2026-11-20', 3000, OTHER); // 縁側でない
    for (const id of [SA, SW, SD, SK]) await voice(id, '2026-11-20', 3000);
    expect(await voterStatus(db, cfg, V[0]!, now)).toMatchObject({ ok: true, minutes: 1441 });
    expect(await voterStatus(db, cfg, V[1]!, now)).toMatchObject({ ok: false, reason: 'time' });
    expect(await voterStatus(db, cfg, V[2]!, now)).toMatchObject({ ok: false, reason: 'time', minutes: 0 });
    expect(await voterStatus(db, cfg, V[3]!, now)).toMatchObject({ ok: false, reason: 'time', minutes: 0 });
    expect(await voterStatus(db, cfg, SA, now)).toMatchObject({ ok: false, reason: 'rank' });
    expect(await voterStatus(db, cfg, SW, now)).toMatchObject({ ok: true });
    expect(await voterStatus(db, cfg, SD, now)).toMatchObject({ ok: true });
    expect(await voterStatus(db, cfg, SK, now)).toMatchObject({ ok: false, reason: 'rank' });
    // 金曜0時に固める人（その前の日までの30日・候補は除く）
    expect(await eligibleVoters(db, cfg, FRI, [SW])).toEqual([SD, V[0]!].sort());
  });

  it('候補は、氏子を3か月つづけ・氏子になってから縁側120時間。新制度より前の氏子は新制度の日から数える', async () => {
    expect(await candidateStatus(db, cfg, C1, now)).toMatchObject({ ok: false, reason: 'not_started' }); // 新制度の前
    await resetAllShuin(db, 'guji', START);
    await voice(C1, '2026-07-20', 9000); // 新制度の前の時間は数えない
    await voice(C1, '2026-09-10', 7200);
    expect(await candidateStatus(db, cfg, C1, now)).toMatchObject({ ok: true, minutes: 7200 });
    // 新制度より前に昇格の記録がある氏子も、新制度の日から
    await promotedToUjiko(C3, new Date('2026-06-01T00:00:00Z'));
    await voice(C3, '2026-07-01', 9000);
    await voice(C3, '2026-09-10', 7199);
    expect(await candidateStatus(db, cfg, C3, now)).toMatchObject({ ok: false, reason: 'time', minutes: 7199 });
    // 10/1 に氏子になった人は、時間が足りていても 1/1 までは候補でない
    await promotedToUjiko(C2, new Date('2026-10-01T03:00:00Z'));
    await voice(C2, '2026-09-30', 5000); // 氏子になる前
    await voice(C2, '2026-10-05', 8000);
    const c2 = await candidateStatus(db, cfg, C2, now);
    expect(c2).toMatchObject({ ok: false, reason: 'months', minutes: 8000 });
    expect(c2.keptAt?.toISOString().slice(0, 10)).toBe('2027-01-01');
    expect(await candidateStatus(db, withTh({ sewayakuCandidateMonths: 1 }), C2, now)).toMatchObject({ ok: true });
    expect(await candidateStatus(db, cfg, SW, now)).toMatchObject({ ok: false, reason: 'rank' });
  });
});

describe('🗳 世話役の選挙：決まる→はじまる→投票→締め', () => {
  beforeEach(async () => {
    await resetAllShuin(db, 'guji', START);
    await voice(C1, '2026-09-10', 7200); // C1 は候補
    for (const v of V.slice(0, 5)) await voice(v, '2026-11-20', 1500); // 投票できる人 5 人（＋候補でない C1 は自分を除く）
  });

  it('条件を満たすと金土日の選挙が決まり、金曜0時に投票できる人を固め、その人だけが投票・取り消しできる', async () => {
    const [e] = await scheduleSewayakuElections(db, cfg, now);
    expect(e).toMatchObject({ candidateId: C1, status: 'scheduled', startsAt: FRI, endsAt: MON });
    expect(await scheduleSewayakuElections(db, cfg, now)).toEqual([]); // 二重に決めない
    // 金曜より前は投票できない
    expect(await toggleSewayakuVote(db, cfg, V[0]!, C1, now)).toMatchObject({ ok: false, reason: 'no_election', scheduled: { id: e!.id } });
    // 金曜0時：はじまる
    const fri = new Date(FRI.getTime() + 60_000);
    await voice(V[5]!, '2026-11-27', 2000); // 金曜に増えた人は、固めたあとなので入らない
    const [opened] = await openSewayakuElections(db, cfg, fri);
    expect(opened!.voterIds).toEqual([...V.slice(0, 5)].sort());
    expect(await toggleSewayakuVote(db, cfg, V[0]!, C1, fri)).toMatchObject({ ok: true, voted: true });
    expect(await hasSewayakuVote(db, e!.id, V[0]!)).toBe(true);
    expect(await toggleSewayakuVote(db, cfg, V[0]!, C1, fri)).toMatchObject({ ok: true, voted: false }); // 取り消し
    expect(await toggleSewayakuVote(db, cfg, V[5]!, C1, fri)).toMatchObject({ ok: false, reason: 'voter' });
    expect(await toggleSewayakuVote(db, cfg, C1, C1, fri)).toMatchObject({ ok: false, reason: 'self' });
    expect(await toggleSewayakuVote(db, cfg, V[0]!, C2, fri)).toMatchObject({ ok: false, reason: 'no_election' });
    // 月曜0時をすぎたら投票できない
    expect(await toggleSewayakuVote(db, cfg, V[1]!, C1, MON)).toMatchObject({ ok: false, reason: 'no_election' });
  });

  it('月曜0時に締める：投票できる人の6割を超えたら合格。1回だけ。落ちたら縁側40時間でまた候補になる', async () => {
    const [e] = await scheduleSewayakuElections(db, cfg, now);
    const fri = new Date(FRI.getTime() + 60_000);
    await openSewayakuElections(db, cfg, fri);
    for (const v of V.slice(0, 3)) await toggleSewayakuVote(db, cfg, v, C1, fri); // 3/5 ＝ 60%（超えていない）
    expect(await closeDueSewayakuElections(db, cfg, new Date(MON.getTime() - 1))).toEqual([]); // まだ日曜
    const [c] = await closeDueSewayakuElections(db, cfg, MON);
    expect(c).toMatchObject({ votes: 3, voters: 5, passes: false });
    expect(await closeDueSewayakuElections(db, cfg, MON)).toEqual([]); // 1回だけ
    await finishSewayakuElection(db, e!.id, 'failed', MON);
    // 落ちたあと：選挙が終わってから縁側40時間までは候補でない
    const later = new Date('2026-12-10T03:00:00Z');
    await voice(C1, '2026-12-01', 2399);
    expect(await candidateStatus(db, cfg, C1, later)).toMatchObject({ ok: false, reason: 'retry', retry: { minutes: 2399, need: 2400 } });
    expect(await scheduleSewayakuElections(db, cfg, later)).toEqual([]);
    await voice(C1, '2026-12-02', 1);
    const [again] = await scheduleSewayakuElections(db, cfg, later); // 木曜 → その週の金土日
    expect(again).toMatchObject({ candidateId: C1, startsAt: new Date('2026-12-11T00:00:00+09:00') });
  });

  it('4票（80%）なら合格。はじまる前に氏子でなくなったら取りやめ', async () => {
    await scheduleSewayakuElections(db, cfg, now);
    const fri = new Date(FRI.getTime() + 60_000);
    await openSewayakuElections(db, cfg, fri);
    for (const v of V.slice(0, 4)) await toggleSewayakuVote(db, cfg, v, C1, fri);
    expect((await closeDueSewayakuElections(db, cfg, MON))[0]).toMatchObject({ votes: 4, voters: 5, passes: true });
    // 取りやめ
    await promotedToUjiko(C3, new Date('2026-08-02T00:00:00Z'));
    await voice(C3, '2026-09-10', 7200);
    const [e3] = await scheduleSewayakuElections(db, cfg, new Date('2026-12-01T03:00:00Z'));
    expect(e3!.candidateId).toBe(C3);
    await db.update(members).set({ roleIds: [ROLE.sewayaku] }).where(eq(members.id, C3));
    expect(await openSewayakuElections(db, cfg, new Date('2026-12-04T00:01:00+09:00'))).toEqual([]);
    expect((await db.select().from(sewayakuElections).where(eq(sewayakuElections.id, e3!.id)))[0]?.status).toBe('cancelled');
    expect(await currentElectionOf(db, C3)).toBeUndefined();
  });
});

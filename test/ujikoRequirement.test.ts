import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { ema, invites, members, omairi, voiceChannels, voiceUsage } from '../src/db/schema.js';
import { jstWeekStart, ujikoRequirementFrom, ujikoRuleText, EMA_DEFAULT_THRESHOLDS } from '../src/domain/ema.js';
import { activeUjikoPlusCount, ujikoProgress, ujikoWeekActive, ujikoWeekRequirement } from '../src/services/ujikoRequirement.js';
import { emaPromotable } from '../src/services/emaPromotion.js';
import type { GuildConfig } from '../src/config.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const withThresholds = (patch: Partial<GuildConfig['emaThresholds']>): GuildConfig => ({ ...cfg, emaThresholds: { ...cfg.emaThresholds, ...patch } });
const DAY = 86_400_000;

const ENG = '880000000000000001'; // 縁側
const OTHER = '880000000000000002'; // 縁側でない通話
const UJ = ['880000000000000011', '880000000000000012', '880000000000000013', '880000000000000014', '880000000000000015'];
const SW = '880000000000000021';
const LEFT = '880000000000000022';
const SA = '880000000000000031';
const SA2 = '880000000000000032';
const SA3 = '880000000000000033';
const now = new Date('2026-11-26T03:00:00Z'); // 木曜 日本時間12時（週は 11/23 から）
let db: Db, close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    ...UJ.map((id, i) => ({ id, username: `uj${i}`, displayName: `氏子${i}`, roleIds: [ROLE.ujiko] })),
    { id: SW, username: 'sw', displayName: '世話役', roleIds: [ROLE.sewayaku] },
    { id: LEFT, username: 'left', displayName: '抜けた氏子', roleIds: [ROLE.ujiko], leftAt: new Date('2026-11-20T00:00:00Z') },
    { id: SA, username: 'sa', displayName: '参拝者A', roleIds: [ROLE.sanpaisha] },
    { id: SA2, username: 'sa2', displayName: '参拝者B', roleIds: [ROLE.sanpaisha] },
    { id: SA3, username: 'sa3', displayName: '参拝者C', roleIds: [ROLE.sanpaisha] },
  ]);
  await db.insert(voiceChannels).values([{ channelId: ENG, name: '縁側１' }, { channelId: OTHER, name: '宿坊' }]);
});
afterEach(async () => close());

async function voice(memberId: string, date: string, minutes: number, channelId = ENG) {
  await db.insert(voiceUsage).values({ memberId, date, channelId, minutes });
}

let giver = 4900000000000000000n;
async function vote(receiverId: string, at: Date, revoked = false) {
  await db.insert(ema).values({ giverId: String(giver++), receiverId, tier: 'ujiko', message: '', createdAt: at, revokedAt: revoked ? at : null });
}

let invitee = 4950000000000000000n;
async function invited(inviterId: string, rewardedAt: Date | null) {
  await db.insert(invites).values({ memberId: String(invitee++), inviterId, rewardedAt, reward: 0 });
}

async function omairiOf(memberId: string, startedAt: Date, days = 14, status = 'ongoing') {
  await db.insert(omairi).values({ memberId, startedAt, endsAt: new Date(startedAt.getTime() + days * DAY), status });
}

describe('🎐 参拝者→氏子の必要数（毎週きまる）', () => {
  it('人数×6割を切り上げ・最低1枚。週は日本時間の月曜はじまり', () => {
    expect(ujikoRequirementFrom(0, EMA_DEFAULT_THRESHOLDS)).toBe(1);
    expect(ujikoRequirementFrom(1, EMA_DEFAULT_THRESHOLDS)).toBe(1);
    expect(ujikoRequirementFrom(4, EMA_DEFAULT_THRESHOLDS)).toBe(3); // 2.4 → 3
    expect(ujikoRequirementFrom(5, EMA_DEFAULT_THRESHOLDS)).toBe(3);
    expect(ujikoRequirementFrom(10, EMA_DEFAULT_THRESHOLDS)).toBe(6);
    expect(ujikoRequirementFrom(0, { ujikoPercent: 60, ujikoMin: 2 })).toBe(2);
    expect(jstWeekStart(now)).toBe('2026-11-23');
    expect(jstWeekStart(new Date('2026-11-22T15:30:00Z'))).toBe('2026-11-23'); // 月曜 0:30（日本時間）
    expect(jstWeekStart(new Date('2026-11-22T14:59:00Z'))).toBe('2026-11-16'); // 日曜 23:59（日本時間）
    expect(ujikoRuleText(EMA_DEFAULT_THRESHOLDS)).toBe('直近7日に縁側に10時間以上いた氏子以上の人数の6割（切り上げ・最低1枚）');
  });

  it('数えるのは、週の前の7日間に縁側に10時間以上いた、在籍中の氏子以上だけ', async () => {
    await voice(UJ[0]!, '2026-11-17', 300);
    await voice(UJ[0]!, '2026-11-22', 300); // 合計600＝数える
    await voice(UJ[1]!, '2026-11-20', 599); // 少し足りない
    await voice(UJ[2]!, '2026-11-20', 600, OTHER); // 縁側でない
    await voice(UJ[3]!, '2026-11-23', 600); // 今週の分（前の7日間でない）
    await voice(UJ[4]!, '2026-11-15', 600); // 8日前（前の7日間でない）
    await voice(SW, '2026-11-18', 700); // 世話役も氏子以上として数える
    await voice(LEFT, '2026-11-18', 900); // 抜けた人は数えない
    await voice(SA, '2026-11-18', 900); // 参拝者は数えない
    expect(await activeUjikoPlusCount(db, cfg, '2026-11-23', 600)).toBe(2);
    expect(await ujikoWeekRequirement(db, cfg, '2026-11-23')).toEqual({ week: '2026-11-23', active: 2, required: 2 }); // 1.2 → 2
  });

  it('週の人数は、はじめて数えたときの数で固定（あとで増えても変わらない）。時間の基準を変えたら数え直す', async () => {
    await voice(UJ[0]!, '2026-11-20', 600);
    expect(await ujikoWeekActive(db, cfg, '2026-11-23')).toBe(1);
    await voice(UJ[1]!, '2026-11-20', 600);
    expect(await ujikoWeekActive(db, cfg, '2026-11-23')).toBe(1); // 固定
    expect(await ujikoWeekActive(db, withThresholds({ ujikoActiveMinutes: 300 }), '2026-11-23')).toBe(2); // 基準を変えた
  });
});

describe('🎐 参拝者→氏子の進み具合（お参り期間中の票＋招待の補い）', () => {
  /** 11/16 の週は 4 人（必要 3 枚）、11/23 の週は 1 人（必要 1 枚） */
  async function seedWeeks() {
    for (const id of UJ.slice(0, 4)) await voice(id, '2026-11-12', 600);
    await voice(UJ[0]!, '2026-11-19', 600);
  }

  it('必要数は、お参り期間が始まった週の数で固定。期間の前・取り消しの票は数えない', async () => {
    await seedWeeks();
    const start = new Date('2026-11-17T03:00:00Z');
    await omairiOf(SA, start);
    await vote(SA, new Date('2026-11-16T03:00:00Z')); // 期間の前
    await vote(SA, new Date('2026-11-18T03:00:00Z'));
    await vote(SA, new Date('2026-11-25T03:00:00Z'));
    await vote(SA, new Date('2026-11-25T04:00:00Z'), true); // 取り消し
    const p = await ujikoProgress(db, cfg, SA, now);
    expect(p).toMatchObject({ week: '2026-11-16', active: 4, required: 3, votes: 2, invites: 0, total: 2, inOmairi: true, met: false });
    // 今週始まった人は今週の数（1枚）
    await omairiOf(SA2, new Date('2026-11-24T03:00:00Z'));
    expect(await ujikoProgress(db, cfg, SA2, now)).toMatchObject({ week: '2026-11-23', required: 1, total: 0, met: false });
  });

  it('招待した人が参拝者になったら1つ分（3つまで）。期間の前・まだ参拝者でない招待は数えない', async () => {
    await seedWeeks();
    await omairiOf(SA, new Date('2026-11-17T03:00:00Z'));
    await vote(SA, new Date('2026-11-18T03:00:00Z'));
    await invited(SA, new Date('2026-11-16T03:00:00Z')); // 期間の前
    await invited(SA, null); // まだ参拝者になっていない
    for (let i = 0; i < 4; i++) await invited(SA, new Date('2026-11-20T03:00:00Z'));
    const p = await ujikoProgress(db, cfg, SA, now);
    expect(p).toMatchObject({ required: 3, votes: 1, invites: 4, inviteUsed: 3, total: 4, met: true });
    // 招待の補いを0にすると届かない
    expect(await ujikoProgress(db, withThresholds({ inviteSubstituteMax: 0 }), SA, now)).toMatchObject({ inviteUsed: 0, total: 1, met: false });
  });

  it('期間が終わって判定待ちの人は、期間のあとにもらった票を数えない', async () => {
    await omairiOf(SA, new Date('2026-11-01T03:00:00Z'), 14, 'review'); // 11/15 で終わり
    await vote(SA, new Date('2026-11-10T03:00:00Z'));
    await vote(SA, new Date('2026-11-20T03:00:00Z')); // 期間のあと
    expect(await ujikoProgress(db, cfg, SA, now)).toMatchObject({ inOmairi: true, votes: 1, required: 1, met: true });
  });

  it('お参り期間がない参拝者は、直近14日の票と今週の数で数える', async () => {
    await seedWeeks();
    await vote(SA3, new Date(now.getTime() - 20 * DAY)); // 14日より前
    expect(await ujikoProgress(db, cfg, SA3, now)).toMatchObject({ inOmairi: false, week: '2026-11-23', required: 1, votes: 0, met: false });
    await vote(SA3, new Date(now.getTime() - 3 * DAY));
    expect(await ujikoProgress(db, cfg, SA3, now)).toMatchObject({ votes: 1, met: true });
  });

  it('昇格候補：届いた参拝者だけ（週の数は人によって違う）', async () => {
    await seedWeeks();
    await omairiOf(SA, new Date('2026-11-17T03:00:00Z')); // 必要3
    await omairiOf(SA2, new Date('2026-11-24T03:00:00Z')); // 必要1
    await omairiOf(SA3, new Date('2026-11-24T03:00:00Z')); // 必要1
    for (let i = 0; i < 2; i++) await vote(SA, new Date('2026-11-25T03:00:00Z')); // 2/3
    await vote(SA2, new Date('2026-11-25T03:00:00Z')); // 1/1
    expect(await emaPromotable(db, cfg, now)).toEqual([SA2]);
    await vote(SA, new Date('2026-11-25T05:00:00Z')); // 3/3
    expect((await emaPromotable(db, cfg, now)).sort()).toEqual([SA, SA2].sort());
  });
});

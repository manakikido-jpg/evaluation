import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { ema, engawaPairs, members, voiceChannels, voiceUsage } from '../src/db/schema.js';
import { setEmaPromotion } from '../src/services/emaPromotion.js';
import { resetAllShuin, beenTogether } from '../src/services/shuin.js';
import { togetherStats, validEmaCountOf, emaMessagesOf } from '../src/services/ema.js';
import { voterStatus } from '../src/services/sewayakuElection.js';
import { omamoriStatus } from '../src/services/omamori.js';
import { keepCardOf, runUjikoKeep } from '../src/services/ujikoKeep.js';
import { newSystemFloor } from '../src/services/newSystemFloor.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const A = '897000000000000001', B = '897000000000000002';
const ENG = '897000000000000100';
const T0 = new Date('2026-12-07T03:00:00Z'); // ④の日（月曜・日本時間 12:00）
const DAY = 86_400_000;
let db: Db, close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: A, username: 'a', displayName: 'A', roleIds: [ROLE.ujiko] },
    { id: B, username: 'b', displayName: 'B', roleIds: [ROLE.ujiko] },
  ]);
  await db.insert(voiceChannels).values({ channelId: ENG, name: '縁側１' });
});
afterEach(async () => close());

const start = async () => { await setEmaPromotion(db, true, 'guji'); await resetAllShuin(db, 'guji', T0); };
const pair = (date: string, minutes = 40) => db.insert(engawaPairs).values({ memberA: A, memberB: B, date, minutes });
const vote = (at: Date, i: number) => db.insert(ema).values({ giverId: String(898000000000000000n + BigInt(i)), receiverId: A, tier: 'ujiko', message: 'm', createdAt: at, revokedAt: null });

describe('🌸 新制度が始まってからの分だけ数える（2026-11-28 本人の決定）', () => {
  it('始まる前は、制限なし', async () => {
    expect(await newSystemFloor(db)).toMatchObject({ started: false, date: '0000-00-00' });
    await pair('2026-11-01'); await pair('2026-11-02'); await pair('2026-11-03');
    expect(await togetherStats(db, A, B)).toMatchObject({ days: 3 });
  });

  it('絵馬を贈れる条件・結べる相手：④の日より前にいっしょだった日は数えない', async () => {
    await pair('2026-12-05'); await pair('2026-12-06');
    await start();
    expect(await newSystemFloor(db)).toMatchObject({ started: true, date: '2026-12-07' });
    expect(await togetherStats(db, A, B)).toMatchObject({ days: 0 });
    expect(await beenTogether(db, A, B)).toBe(false);
    await pair('2026-12-07'); await pair('2026-12-08'); // ④の日とその次の日
    expect(await togetherStats(db, A, B)).toMatchObject({ days: 2 });
    expect(await beenTogether(db, A, B)).toBe(true);
  });

  it('絵馬の枚数：④より前にもらった絵馬は数えない（キープの数にも入らない）', async () => {
    await vote(new Date(T0.getTime() - DAY), 1);
    await start();
    await vote(new Date(T0.getTime() + DAY), 2);
    const now = new Date(T0.getTime() + 2 * DAY);
    expect(await validEmaCountOf(db, A, now)).toBe(1);
    expect((await emaMessagesOf(db, A, now)).length).toBe(1);
    await runUjikoKeep(db, cfg, now);
    expect(await keepCardOf(db, cfg, A, now)).toMatchObject({ kind: 'keep', p: { total: 1 } });
  });

  it('世話役の投票権・お守りの週：④の日より前の縁側は数えない', async () => {
    const usage = (date: string, minutes: number) => db.insert(voiceUsage).values({ memberId: A, date, channelId: ENG, minutes });
    await usage('2026-12-01', 3000); // ④の前
    await start();
    const now = new Date(T0.getTime() + 2 * DAY); // 12-09
    expect(await voterStatus(db, cfg, A, now)).toMatchObject({ ok: false, minutes: 0 });
    expect(await omamoriStatus(db, cfg, A, now)).toMatchObject({ week: null, reason: 'time', minutes: 0 });
    await usage('2026-12-08', 2500);
    expect(await voterStatus(db, cfg, A, now)).toMatchObject({ ok: true, minutes: 2500 });
    expect(await omamoriStatus(db, cfg, A, now)).toMatchObject({ week: '2026-12-07' });
  });
});

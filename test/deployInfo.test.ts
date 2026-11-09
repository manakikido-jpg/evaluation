import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { deployRuns, recordDeploy, reflectedTimes, runningCommit } from '../src/services/deployInfo.js';
import { makeDb } from './helpers.js';

let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });

describe('🚀 本番に反映した時間', () => {
  it('はじめては最新の 1 つだけに時間を付け、次からは新しい更新に起動した時間を付ける。前の時間は変えない', async () => {
    const t1 = new Date('2026-11-09T06:00:00Z'), t2 = new Date('2026-11-09T07:30:00Z');
    await recordDeploy(db, 'bot', ['b', 'a'], 'abc1234', t1);
    expect([...(await reflectedTimes(db))]).toEqual([['b', t1]]);
    await recordDeploy(db, 'web', ['b', 'a'], 'abc1234', new Date(t1.getTime() + 5000));
    expect((await reflectedTimes(db)).get('b')).toEqual(t1);
    await recordDeploy(db, 'bot', ['c', 'b', 'a'], 'def5678', t2);
    const times = await reflectedTimes(db);
    expect(times.get('c')).toEqual(t2);
    expect(times.get('b')).toEqual(t1);
    expect(times.has('a')).toBe(false);
    expect(await deployRuns(db)).toEqual({ bot: { commit: 'def5678', startedAt: t2 }, web: { commit: 'abc1234', startedAt: new Date(t1.getTime() + 5000) } });
  });
  it('BOT と社務所Web が同時に起動しても、記録が食い違わない', async () => {
    const t = new Date('2026-11-09T06:00:00Z');
    await recordDeploy(db, 'bot', ['a'], '', t);
    await Promise.all([recordDeploy(db, 'bot', ['b', 'a'], '', new Date(t.getTime() + 1000)), recordDeploy(db, 'web', ['b', 'a'], '', new Date(t.getTime() + 2000))]);
    expect([...(await reflectedTimes(db)).keys()].sort()).toEqual(['a', 'b']);
  });
  it('イメージに入れた commit は、正しい形のときだけ短くして使う', () => {
    expect(runningCommit({ GIT_COMMIT: '660c4de1abcdef0123' })).toBe('660c4de');
    expect(runningCommit({ GIT_COMMIT: 'not a commit' })).toBe('');
    expect(runningCommit({})).toBe('');
  });
});

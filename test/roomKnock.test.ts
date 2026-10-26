import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { answerRoomKnock, cancelKnock, recordKnockMessage, requestRoomKnock, resetRoomKnock, roomKnockState, setKnockControl, setRoomKnockMode } from '../src/services/roomKnock.js';
import { makeDb } from './helpers.js';
let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });
const R = 'room', A = 'alice', B = 'bob';
describe('宿のこんこんの永続状態', () => {
  it('初期は自由。自由と取り込み中は受け付けない', async () => {
    expect((await roomKnockState(db, R)).mode).toBe('open');
    expect((await requestRoomKnock(db, R, A, '1', 0)).status).toBe('unavailable');
    await setRoomKnockMode(db, R, 'busy');
    expect((await requestRoomKnock(db, R, A, '1', 0)).status).toBe('unavailable');
  });
  it('同じ部屋への3分制限を保存し、ちょうど3分後には使える', async () => {
    await setRoomKnockMode(db, R, 'knock');
    expect((await requestRoomKnock(db, R, A, '1', 1000)).status).toBe('ok');
    expect(await requestRoomKnock(db, R, A, '2', 2000)).toEqual({ status: 'cooldown', seconds: 179 });
    expect((await requestRoomKnock(db, R, A, '3', 181000)).status).toBe('ok');
  });
  it('別の部屋への制限とは分ける', async () => {
    await setRoomKnockMode(db, R, 'knock'); await setRoomKnockMode(db, 'other', 'knock');
    expect((await requestRoomKnock(db, R, A, '1', 0)).status).toBe('ok');
    expect((await requestRoomKnock(db, 'other', A, '2', 0)).status).toBe('ok');
  });
  it('同時要求を1つへ集約し、同じ人の連打も拒否する', async () => {
    await setRoomKnockMode(db, R, 'knock');
    const results = await Promise.all([requestRoomKnock(db, R, A, '1', 0), requestRoomKnock(db, R, A, '2', 0), requestRoomKnock(db, R, B, '3', 0)]);
    expect(results.filter(r => r.status === 'ok')).toHaveLength(2);
    const p = (await roomKnockState(db, R)).pending!;
    expect(p.users).toEqual([A, B]);
    await recordKnockMessage(db, R, p.id, 'message');
    expect((await roomKnockState(db, R)).pending?.messageId).toBe('message');
  });
  it('返事は同時に1つだけ通り、期限切れと古いボタンは使えない', async () => {
    await setRoomKnockMode(db, R, 'knock'); await requestRoomKnock(db, R, A, '1', 0);
    expect(await answerRoomKnock(db, R, 'wrong', 1)).toBeUndefined();
    const answers = await Promise.all([answerRoomKnock(db, R, '1', 1), answerRoomKnock(db, R, '1', 1)]);
    expect(answers.filter(Boolean)).toHaveLength(1);
    await requestRoomKnock(db, R, B, '2', 10);
    expect(await answerRoomKnock(db, R, '2', 180010)).toBeUndefined();
  });
  it('空室リセットで自由に戻し、旧通知は無効化。連打制限は残す', async () => {
    await setRoomKnockMode(db, R, 'knock'); await setKnockControl(db, R, 'control');
    await requestRoomKnock(db, R, A, '1', 0); await resetRoomKnock(db, R);
    expect(await roomKnockState(db, R)).toEqual({ mode: 'open', last: { alice: 0 }, controlId: 'control' });
    expect(await answerRoomKnock(db, R, '1', 1)).toBeUndefined();
    await setRoomKnockMode(db, R, 'knock');
    expect((await requestRoomKnock(db, R, A, '2', 1)).status).toBe('cooldown');
  });
  it('状態変更や送信失敗後に旧ボタンを無効にし、新しい通知を古い失敗で消さない', async () => {
    await setRoomKnockMode(db, R, 'knock'); await requestRoomKnock(db, R, A, '1', 0);
    await setRoomKnockMode(db, R, 'busy'); expect(await answerRoomKnock(db, R, '1', 1)).toBeUndefined();
    await setRoomKnockMode(db, R, 'knock'); await requestRoomKnock(db, R, B, '2', 1);
    await cancelKnock(db, R, '1'); expect((await roomKnockState(db, R)).pending?.id).toBe('2');
    await cancelKnock(db, R, '2'); expect((await roomKnockState(db, R)).pending).toBeUndefined();
  });
  it('集約は20人まで。期限後は新しい通知にする', async () => {
    await setRoomKnockMode(db, R, 'knock');
    for (let n = 0; n < 20; n++) expect((await requestRoomKnock(db, R, String(n), String(n), 0)).status).toBe('ok');
    expect((await requestRoomKnock(db, R, '21', '21', 1)).status).toBe('full');
    const result = await requestRoomKnock(db, R, '21', 'new', 180000);
    expect(result.status === 'ok' && result.pending.users).toEqual(['21']);
  });
});

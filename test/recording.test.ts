import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cfg, makeDb } from './helpers.js';
import { recordings, type AdminSession } from '../src/db/schema.js';
import type { Db } from '../src/db/client.js';
import { recordingSchema } from '../src/config.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import { RecordingStore, mediaRange, recordingPath } from '../src/services/recording/store.js';
import { RecordingConsent, VoiceMixer, wavHeader } from '../src/services/recording/voice.js';
import { mountRecordings } from '../src/web/recordings.js';
import type { SessionView } from '../src/web/views/layout.js';

let db: Db, close: () => Promise<void>, root: string, store: RecordingStore;
let now: Date;
const enabled = { ...cfg.recording, enabled: true };
const input = { ownerId: 'alice', title: '集まり', kind: 'screen' as const, mime: 'video/webm' };
beforeEach(async () => {
  ({ db, close } = await makeDb());
  root = await mkdtemp(path.join(tmpdir(), 'recording-test-'));
  now = new Date('2026-10-17T12:00:00Z');
  store = new RecordingStore(db, root, () => now);
});
afterEach(async () => { await close(); await rm(root, { recursive: true, force: true }); });

describe('録音・録画の保存', () => {
  it('初期値は無効・設定の上書きで他の値も残る', async () => {
    expect(cfg.recording.enabled).toBe(false);
    await expect(store.create(cfg.recording, input)).rejects.toThrow('有効');
    const overrides = overridesSchema.parse({ recording: enabled });
    expect(applyOverrides(cfg, overrides).recording).toEqual(enabled);
    expect(recordingSchema.safeParse({ retentionDays: 0 }).success).toBe(false);
  });
  it('同じ部分の再送は一度だけ保存・逆順や別の内容は拒否する', async () => {
    const r = await store.create(enabled, input);
    await store.append(r.id, 0, Buffer.from('first'));
    await store.append(r.id, 0, Buffer.from('first'));
    await expect(store.append(r.id, 0, Buffer.from('changed'))).rejects.toThrow('順番');
    await expect(store.append(r.id, 2, Buffer.from('next'))).rejects.toThrow('順番');
    await store.append(r.id, 1, Buffer.from('next'));
    await store.finish(r.id);
    expect((await readFile(recordingPath(root, r.id))).toString()).toBe('firstnext');
    expect((await store.get(r.id))?.bytes).toBe(9);
    await expect(store.append(r.id, 2, Buffer.from('late'))).rejects.toThrow('もう');
  });
  it('保存中の予約容量・同じ人の重複開始・1回の上限を守る', async () => {
    const small = { ...enabled, maxFileMB: 256, maxTotalMB: 512 };
    const r = await store.create(small, input);
    await expect(store.create(small, input)).rejects.toThrow('先に');
    await store.create(small, { ...input, ownerId: 'bob' });
    await expect(store.create(small, { ...input, ownerId: 'carol' })).rejects.toThrow('いっぱい');
    await db.update(recordings).set({ maxBytes: 2 }).where(eq(recordings.id, r.id));
    await expect(store.append(r.id, 0, Buffer.from('123'))).rejects.toThrow('上限');
    await store.remove(r.id);
    expect(await store.create(small, { ...input, ownerId: 'carol' })).toBeDefined();
  });
  it('削除・期限切れでデータを消し、放置された書きこみも片づける', async () => {
    const r = await store.create(enabled, input);
    await store.append(r.id, 0, Buffer.from('private'));
    await store.finish(r.id);
    now = new Date(+now + 8 * 86400000);
    expect(await store.get(r.id)).toBeUndefined();
    await store.cleanup();
    await expect(readFile(recordingPath(root, r.id))).rejects.toThrow();
    const abandoned = await store.create(enabled, input);
    await store.append(abandoned.id, 0, Buffer.from('partial'));
    now = new Date(+now + 3600001);
    await store.cleanup();
    expect(await store.get(abandoned.id)).toBeUndefined();
  });
  it('範囲再生を計算・範囲外や複数範囲を拒否する', () => {
    expect(mediaRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(mediaRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(mediaRange('bytes=8-', 10)).toEqual({ start: 8, end: 9 });
    expect(mediaRange('bytes=10-', 10)).toBeNull();
    expect(mediaRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(() => recordingPath(root, '../../secret')).toThrow();
  });
});

describe('同意と音声', () => {
  it('全員の同意がそろうまで始めず、人の入れ替わり・停止を検知する', () => {
    const consent = new RecordingConsent(['a', 'b']);
    consent.agree('other'); consent.agree('a');
    expect(consent.ready).toBe(false);
    consent.agree('b'); expect(consent.ready).toBe(true);
    expect(consent.matches(['b', 'a'])).toBe(true);
    expect(consent.matches(['a', 'c'])).toBe(false);
    consent.stop(); expect(consent.ready).toBe(false);
  });
  it('同意した人だけを時刻に合わせて重ね、音割れする値は丸める', () => {
    const mixer = new VoiceMixer(new Set(['a', 'b']));
    const pcm = Buffer.alloc(3840);
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(20000, i);
    // 声を受けるまでは heard が false（無音だけの録音は残さない目印）
    mixer.push('other', pcm, 0);
    expect(mixer.heard).toBe(false);
    mixer.push('a', pcm, 0); mixer.push('b', pcm, 0); mixer.push('other', pcm, 20);
    const sound = mixer.drain(40);
    expect(sound.length).toBe(7680);
    expect(sound.readInt16LE(0)).toBe(32767);
    expect(sound.readInt16LE(3840)).toBe(0);
    expect(mixer.drain(40).length).toBe(0);
  });
  it('WAVの長さを、保存した音声の長さで確定する', async () => {
    const r = await store.create(enabled, { ...input, kind: 'voice', mime: 'audio/wav' });
    await store.append(r.id, 0, wavHeader(0));
    await store.append(r.id, 1, Buffer.alloc(3840));
    await store.finish(r.id);
    const b = await readFile(recordingPath(root, r.id));
    expect(b.subarray(0, 4).toString()).toBe('RIFF');
    expect(b.readUInt32LE(40)).toBe(3840);
    expect(b.readUInt32LE(4)).toBe(b.length - 8);
  });
});

function portal(userId: string, guji = false) {
  const app = new Hono<{ Variables: { session: SessionView } }>();
  app.use('*', async (c, next) => {
    c.set('session', { userId, level: guji ? 'guji' : 'shinshoku', csrfToken: 'test-csrf' } as AdminSession);
    await next();
  });
  mountRecordings(app, db, () => ({ ...cfg, recording: enabled }), store);
  return app;
}
describe('記録を見る人', () => {
  it('他人の一覧・再生・削除・終了・追加送信を拒否、本人と宮司は再生できる', async () => {
    const r = await store.create(enabled, input);
    await store.append(r.id, 0, Buffer.from('private-media'));
    await store.finish(r.id);
    const other = portal('bob');
    expect(await (await other.request('/recordings')).text()).not.toContain(r.id);
    for (const action of ['media', 'delete', 'finish', 'chunk']) {
      expect((await other.request(`/recordings/${r.id}/${action}`, { method: action === 'media' ? 'GET' : 'POST' })).status).toBe(404);
    }
    const own = await portal('alice').request(`/recordings/${r.id}/media`, { headers: { range: 'bytes=0-6' } });
    expect(own.status).toBe(206); expect(await own.text()).toBe('private');
    expect((await portal('guji', true).request(`/recordings/${r.id}/media`)).status).toBe(200);
  });
  it('宮司以外は設定を変えられず、同意のない作成は拒否する', async () => {
    expect((await portal('alice').request('/recordings/settings', { method: 'POST' })).status).toBe(403);
    expect((await portal('alice').request('/recordings/create', { method: 'POST', body: new URLSearchParams({ kind: 'screen', title: 'test', mime: 'video/webm' }) })).status).toBe(400);
  });
});

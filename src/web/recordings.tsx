import { recordingSchema } from '../config.js';
import { loadOverrides, saveOverrides, overridesSchema } from '../services/settings.js';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { Hono } from 'hono';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { SessionView } from './views/layout.js';
import { RecordingStore, RecordingError, mediaRange, recordingPath, canReadRecording } from '../services/recording/store.js';
import { RecordingsPage } from './views/recordings.js';
import { audit } from '../services/audit.js';
type Env = { Variables: { session: SessionView } };
export function mountRecordings(app: Hono<Env>, db: Db, cfg: () => GuildConfig, store = new RecordingStore(db), onSettingsSaved?: () => Promise<void>) {
  const owned = async (id: string, session: SessionView) => {
    const r = await store.get(id);
    return r && canReadRecording(r, session.userId, session.level === 'guji') ? r : undefined;
  };
  app.get('/recordings', async c => {
    await store.cleanup();
    const s = c.get('session');
    return c.html(<RecordingsPage session={s} rows={await store.list(s.userId, s.level === 'guji')} cfg={cfg().recording} />);
  });
  app.post('/recordings/settings', async c => {
    const s = c.get('session');
    if (s.level !== 'guji') return c.text('宮司だけが変更できます。', 403);
    const body = await c.req.parseBody();
    const result = recordingSchema.safeParse({ enabled: body.enabled === 'yes', voiceChannelIds: typeof body.voiceChannelIds === 'string' ? body.voiceChannelIds.split(/[,\s]+/).filter(Boolean) : [], retentionDays: Number(body.retentionDays), maxMinutes: Number(body.maxMinutes), maxFileMB: Number(body.maxFileMB), maxTotalMB: Number(body.maxTotalMB) });
    if (!result.success) return c.text('設定の数字・チャンネルIDを確認してください。', 400);
    const prev = await loadOverrides(db);
    await saveOverrides(db, overridesSchema.parse({ ...prev, recording: result.data }), s.userId);
    await audit(db, { actorId: s.userId, action: 'recording.settings', detail: result.data, via: 'web' });
    await onSettingsSaved?.();
    return c.redirect('/recordings');
  });
  app.post('/recordings/create', async c => {
    const s = c.get('session');
    const b = await c.req.parseBody();
    if (b.consent !== 'yes' || (b.kind !== 'screen' && b.kind !== 'camera') || typeof b.title !== 'string' || (b.mime !== 'video/webm' && b.mime !== 'video/mp4')) return c.text('録画の内容を確認してください。', 400);
    try {
      await store.cleanup();
      const r = await store.create(cfg().recording, { ownerId: s.userId, title: b.title, kind: b.kind, mime: b.mime });
      await audit(db, { actorId: s.userId, action: 'recording.create', detail: { id: r.id, kind: r.kind }, via: 'web' });
      return c.json({ id: r.id });
    } catch (e) { if (e instanceof RecordingError) return c.text(e.message, 400); throw e; }
  });
  app.post('/recordings/:id/chunk', async c => {
    const r = await owned(c.req.param('id'), c.get('session'));
    if (!r || r.kind === 'voice' || r.ownerId !== c.get('session').userId) return c.notFound();
    if (!cfg().recording.enabled) return c.text('現在は無効です。', 403);
    if (+store.now() - +r.createdAt > (cfg().recording.maxMinutes + 5) * 60000) return c.text('保存の時間が過ぎました。', 400);
    try { await store.append(r.id, Number(c.req.header('x-chunk-seq')), new Uint8Array(await c.req.arrayBuffer())); return c.json({ ok: true }); }
    catch (e) { if (e instanceof RecordingError) return c.text(e.message, 400); throw e; }
  });
  app.post('/recordings/:id/finish', async c => {
    const s = c.get('session');
    const r = await owned(c.req.param('id'), s);
    if (!r || r.kind === 'voice' || r.ownerId !== s.userId) return c.notFound();
    try { await store.finish(r.id); }
    catch (e) { if (e instanceof RecordingError) return c.text(e.message, 400); throw e; }
    await audit(db, { actorId: s.userId, action: 'recording.finish', detail: { id: r.id }, via: 'web' });
    return c.json({ ok: true });
  });
  app.post('/recordings/:id/delete', async c => {
    const s = c.get('session');
    const r = await owned(c.req.param('id'), s);
    if (!r) return c.notFound();
    if (r.kind === 'voice' && r.status === 'writing') return c.text('先にDiscordで録音を止めてください。', 409);
    await store.remove(r.id);
    await audit(db, { actorId: s.userId, action: 'recording.delete', detail: { id: r.id }, via: 'web' });
    return c.redirect('/recordings');
  });
  app.get('/recordings/:id/media', async c => {
    const r = await owned(c.req.param('id'), c.get('session'));
    if (!r || r.status !== 'ready') return c.notFound();
    const range = mediaRange(c.req.header('range'), r.bytes);
    if (range === null) return c.body(null, 416, { 'Content-Range': `bytes */${r.bytes}` });
    const start = range?.start ?? 0, end = range?.end ?? r.bytes - 1;
    const stream = createReadStream(recordingPath(store.root, r.id), { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers: {
      'Content-Type': r.mime, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${c.req.query('download') === '1' ? 'attachment' : 'inline'}; filename="sakuranomiya-${r.id}.${r.kind === 'voice' ? 'wav' : r.mime === 'video/mp4' ? 'mp4' : 'webm'}"`,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${r.bytes}` } : {}),
    } });
  });
}

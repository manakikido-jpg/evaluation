import { wavHeader } from './voice.js';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, gt, ne, sql, desc } from 'drizzle-orm';
import type { GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { recordings, type Recording } from '../../db/schema.js';

export class RecordingError extends Error {}
export const CHUNK_BYTES = 1024 * 1024;
export const recordingRoot = () => process.env.RECORDINGS_DIR || '/data/recordings';
export function recordingPath(root: string, id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new RecordingError('記録が見つかりません。');
  return path.join(root, `${id}.media`);
}
export const canReadRecording = (r: Recording, userId: string, guji: boolean) => guji || r.ownerId === userId;
export class RecordingStore {
  constructor(readonly db: Db, readonly root = recordingRoot(), readonly now = () => new Date()) {}
  async create(cfg: GuildConfig['recording'], input: Pick<Recording, 'ownerId' | 'title' | 'kind' | 'mime'> & Partial<Pick<Recording, 'channelId' | 'participantIds'>>) {
    if (!cfg.enabled) throw new RecordingError('録音・録画は、まだ有効になっていません。');
    if (!['audio/wav', 'video/webm', 'video/mp4'].includes(input.mime) || (input.kind === 'voice') !== (input.mime === 'audio/wav')) throw new RecordingError('この形式は使えません。');
    const maxBytes = cfg.maxFileMB * 1024 * 1024;
    const now = this.now();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return this.db.transaction(async tx => {
      // BOT と Web の同時作成も、空き容量を予約してから始める。
      await tx.execute(sql`select pg_advisory_xact_lock(20261017)`);
      const rows = await tx.select().from(recordings).where(ne(recordings.status, 'deleted'));
      const used = rows.reduce((n, r) => n + (r.status === 'writing' ? r.maxBytes : r.bytes), 0);
      if (used + maxBytes > cfg.maxTotalMB * 1024 * 1024) throw new RecordingError('保存先がいっぱいです。古い記録を消してください。');
      if (rows.some(r => r.ownerId === input.ownerId && r.status === 'writing')) throw new RecordingError('先に、いまの録音・録画を止めてください。');
      const [row] = await tx.insert(recordings).values({ ...input, title: input.title.trim().slice(0, 80) || '録音・録画', id: randomUUID(), status: 'writing', maxBytes, createdAt: now, updatedAt: now, expiresAt: new Date(+now + cfg.retentionDays * 86400000) }).returning();
      return row!;
    });
  }
  async get(id: string) {
    const [row] = await this.db.select().from(recordings).where(and(eq(recordings.id, id), ne(recordings.status, 'deleted'), gt(recordings.expiresAt, this.now())));
    return row;
  }
  async list(userId: string, guji: boolean) {
    return this.db.select().from(recordings).where(and(ne(recordings.status, 'deleted'), gt(recordings.expiresAt, this.now()), guji ? undefined : eq(recordings.ownerId, userId))).orderBy(desc(recordings.createdAt)).limit(100);
  }
  async append(id: string, seq: number, bytes: Uint8Array) {
    if (!bytes.length || bytes.length > CHUNK_BYTES || !Number.isSafeInteger(seq) || seq < 0) throw new RecordingError('送る内容を確認してください。');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await this.db.transaction(async tx => {
      const [r] = await tx.select().from(recordings).where(eq(recordings.id, id)).for('update');
      if (!r || r.status !== 'writing' || +r.expiresAt <= +this.now()) throw new RecordingError('この記録は、もう書きこめません。');
      if (seq === r.nextSeq - 1 && hash === r.lastHash) return;
      if (seq !== r.nextSeq) throw new RecordingError('送る順番が違います。');
      if (r.bytes + bytes.length > r.maxBytes) throw new RecordingError('記録の大きさが上限になりました。');
      const file = await open(recordingPath(this.root, id), r.bytes ? 'r+' : 'w', 0o600);
      try {
        let done = 0;
        while (done < bytes.length) {
          const result = await file.write(bytes, done, bytes.length - done, r.bytes + done);
          if (!result.bytesWritten) throw new Error('recording write failed');
          done += result.bytesWritten;
        }
        await file.sync();
      } finally { await file.close(); }
      await tx.update(recordings).set({ bytes: r.bytes + bytes.length, nextSeq: seq + 1, lastHash: hash, updatedAt: this.now() }).where(eq(recordings.id, id));
    });
  }
  async finish(id: string) {
    await this.db.transaction(async tx => {
      const [r] = await tx.select().from(recordings).where(eq(recordings.id, id)).for('update');
      if (!r || r.status !== 'writing') return;
      if (!r.bytes) throw new RecordingError('まだ記録がありません。');
      const file = await open(recordingPath(this.root, id), 'r+');
      try {
        await file.truncate(r.bytes);
        if (r.kind === 'voice') await file.write(wavHeader(Math.max(0, r.bytes - 44)), 0, 44, 0);
        await file.sync();
      } finally { await file.close(); }
      await tx.update(recordings).set({ status: 'ready', updatedAt: this.now() }).where(eq(recordings.id, id));
    });
  }
  async remove(id: string) {
    // 行のロックが、書きこみ・終了との競合を防ぐ。
    await this.db.transaction(async tx => {
      await tx.select().from(recordings).where(eq(recordings.id, id)).for('update');
      await unlink(recordingPath(this.root, id)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      await tx.update(recordings).set({ status: 'deleted', bytes: 0, updatedAt: this.now() }).where(eq(recordings.id, id));
    });
  }
  async cleanup() {
    const rows = await this.db.select().from(recordings).where(ne(recordings.status, 'deleted'));
    for (const r of rows) {
      // 止まったアップロード・再起動前の録音も、1 時間更新がなければ片づける。
      if (+r.expiresAt <= +this.now() || (r.status === 'writing' && +r.updatedAt < +this.now() - 3600000)) await this.remove(r.id);
    }
  }
}

/** 単一の範囲だけ受け付ける（動画・音声の途中からの再生）。 */
export function mediaRange(header: string | undefined, size: number): { start: number; end: number } | null | undefined {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2]) || !size) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : null;
}

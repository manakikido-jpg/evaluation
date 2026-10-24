import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { archiveDeleted, archiveEdit, archiveFile, archiveMessage, pruneArchive, searchArchive } from '../src/services/messageArchive.js';
import { makeDb } from './helpers.js';

let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => close());
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const at = new Date('2026-10-24T03:00:00Z');
const msg = (id: string, over: Partial<Parameters<typeof archiveMessage>[1]> = {}) => ({ id, channelId: '900000000000000001', authorId: '800000000000000001', authorName: 'さくら', content: 'こんにちは', createdAt: at, attachments: [], ...over });

describe('📚 書き込みの記録', () => {
  it('文と写真（中身）を残し、動画は名前だけ。書きかえ前の文と、消した時刻・消した人も残す', async () => {
    await archiveMessage(db, msg('m1', { channelName: '宿の部屋', attachments: [
      { name: 'a.png', size: png.length, contentType: 'image/png', url: 'https://cdn/a.png' },
      { name: 'b.mp4', size: 9_000_000, contentType: 'video/mp4', url: 'https://cdn/b.mp4' },
    ] }), async () => png);
    await archiveEdit(db, 'm1', 'こんばんは', new Date('2026-10-24T04:00:00Z'));
    await archiveEdit(db, 'm1', 'こんばんは');
    await archiveDeleted(db, ['m1'], '800000000000000099', new Date('2026-10-24T05:00:00Z'));
    await archiveDeleted(db, ['m1'], undefined, new Date('2026-10-24T06:00:00Z'));
    const [r] = await searchArchive(db, { deleted: true });
    expect(r!.channelName).toBe('宿の部屋');
    expect(r).toMatchObject({ content: 'こんばんは', edits: [{ content: 'こんにちは' }], deletedBy: '800000000000000099', deletedAt: new Date('2026-10-24T05:00:00Z') });
    expect(r!.attachments.map((a) => a.name)).toEqual(['a.png', 'b.mp4']);
    expect(r!.attachments[1]!.fileId).toBeUndefined();
    expect((await archiveFile(db, r!.attachments[0]!.fileId!))?.contentType).toBe('image/png');
  });

  it('さがす（人・言葉）と、90 日より前は消す', async () => {
    await archiveMessage(db, msg('m1'), async () => undefined);
    await archiveMessage(db, msg('m2', { authorId: '800000000000000002', content: '100%_ok', createdAt: new Date('2026-06-01T00:00:00Z') }), async () => undefined);
    expect((await searchArchive(db, { author: '800000000000000002' })).map((r) => r.messageId)).toEqual(['m2']);
    expect((await searchArchive(db, { text: '%_' })).map((r) => r.messageId)).toEqual(['m2']);
    const byName = await searchArchive(db, { authorName: '%' });
    expect(byName).toEqual([]);
    expect((await searchArchive(db, { authorName: 'さく' })).length).toBeGreaterThan(0);
    expect(await pruneArchive(db, at)).toBe(1);
    expect((await searchArchive(db, {})).map((r) => r.messageId)).toEqual(['m1']);
  });
});

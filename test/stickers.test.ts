import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { stickerDrafts } from '../src/db/schema.js';
import { makeDb } from './helpers.js';
import { DiscordHttpError } from '../src/lib/discordRest.js';
import { getSticker, listStickers, moveSticker, prepareSticker, reconcileSticker, registerSticker, rejectSticker, saveSticker, saveStickerConfig, stickerCreatorRole, stickerInputSchema, submitSticker } from '../src/services/stickers.js';
let db: Db, close: () => Promise<void>;
const AUTHOR = '700000000000000001', OTHER = '700000000000000002', ID = '700000000000000009';
const fields = { name: 'おはよう', description: '朝のごあいさつ', tags: '😊' };
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });
async function draft(name = fields.name) {
  const png = await sharp({ create: { width: 640, height: 320, channels: 4, background: '#ff99cc' } }).png().toBuffer();
  return (await saveSticker(db, { id: AUTHOR, name: '製作者' }, { ...fields, name }, await prepareSticker(png)))!;
}
it('画像の実体を復号し、縦横比・透過を保って320px/512KiB以内のPNGにする', async () => {
  const row = await draft(), meta = await sharp(row.imageData).metadata();
  expect(meta).toMatchObject({ width: 320, height: 320, format: 'png', hasAlpha: true });
  const { data } = await sharp(row.imageData).raw().toBuffer({ resolveWithObject: true });
  expect(data[3]).toBe(0);
  expect(row.imageData.length).toBeLessThanOrEqual(512 * 1024);
  await expect(prepareSticker(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  await expect(prepareSticker(new Uint8Array(8 * 1024 * 1024 + 1))).rejects.toThrow('8MB');
  const apng = Buffer.concat([Buffer.from('89504e470d0a1a0a000000086163544c', 'hex'), Buffer.alloc(12)]);
  await expect(prepareSticker(apng)).rejects.toThrow('静止画');
  expect(stickerInputSchema.safeParse({ ...fields, name: 'a' }).success).toBe(false);
  expect(stickerInputSchema.safeParse({ ...fields, description: 'a' }).success).toBe(false);
});
it('本人の下書きだけ編集・申請でき、申請中に内容を差し替えられない', async () => {
  const row = await draft();
  expect(await saveSticker(db, { id: OTHER, name: '他人' }, fields, undefined, row.id)).toBeUndefined();
  expect(await submitSticker(db, row.id, OTHER)).toBeUndefined();
  expect(await submitSticker(db, row.id, AUTHOR)).toMatchObject({ status: 'pending' });
  expect(await saveSticker(db, { id: AUTHOR, name: '本人' }, { ...fields, name: '変更' }, undefined, row.id)).toBeUndefined();
  await rejectSticker(db, row.id, OTHER, '文字を直して');
  expect(await saveSticker(db, { id: AUTHOR, name: '本人' }, { ...fields, name: '変更後' }, undefined, row.id)).toMatchObject({ status: 'draft', name: '変更後' });
});
it('同時登録でもDiscord作成は1回で、登録後の再実行・編集を拒否する', async () => {
  const row = await draft(); await submitSticker(db, row.id, AUTHOR);
  const create = vi.fn(async () => ({ id: ID, name: fields.name }));
  const results = await Promise.all([registerSticker(db, row.id, OTHER, create), registerSticker(db, row.id, OTHER, create)]);
  expect(results.sort()).toEqual(['gone', 'registered']); expect(create).toHaveBeenCalledOnce();
  expect(await getSticker(db, row.id)).toMatchObject({ stickerId: ID, status: 'registered' });
  expect(await registerSticker(db, row.id, OTHER, create)).toBe('gone');
});
it('明確な403は許可待ちへ戻し、通信断・5xxは結果不明として再送しない', async () => {
  for (const error of [new DiscordHttpError('denied', 403), new DiscordHttpError('server', 503), Error('network')]) {
    const row = await draft(); await submitSticker(db, row.id, AUTHOR);
    const create = vi.fn(async () => { throw error; });
    const result = await registerSticker(db, row.id, OTHER, create);
    const certain = error instanceof DiscordHttpError && error.status === 403;
    expect(result).toBe(certain ? 'failed' : 'uncertain');
    if (!certain) { expect(await registerSticker(db, row.id, OTHER, create)).toBe('gone'); expect(create).toHaveBeenCalledOnce(); }
  }
});
it('再起動で登録中のままでも、2分後にDiscordの既存IDと照合できる', async () => {
  const row = await draft();
  await db.update(stickerDrafts).set({ status: 'registering', updatedAt: new Date(Date.now() - 180_000) }).where(eq(stickerDrafts.id, row.id));
  expect(await reconcileSticker(db, row.id, OTHER, ID, async () => [{ id: ID, name: fields.name }], false)).toBe(true);
  expect(await getSticker(db, row.id)).toMatchObject({ status: 'registered', stickerId: ID });
});
it('登録中すぐの照合・別名ID・同名があるときの再送許可を拒否する', async () => {
  const row = await draft();
  await db.update(stickerDrafts).set({ status: 'uncertain' }).where(eq(stickerDrafts.id, row.id));
  expect(await reconcileSticker(db, row.id, OTHER, ID, async () => [{ id: ID, name: fields.name }], false)).toBe(false);
  await db.update(stickerDrafts).set({ updatedAt: new Date(Date.now() - 180_000) }).where(eq(stickerDrafts.id, row.id));
  expect(await reconcileSticker(db, row.id, OTHER, ID, async () => [{ id: ID, name: '別の札' }], false)).toBe(false);
  expect(await reconcileSticker(db, row.id, OTHER, '', async () => [{ id: ID, name: fields.name }], true)).toBe(false);
  expect(await reconcileSticker(db, row.id, OTHER, '', async () => [], false)).toBe(false);
  expect(await reconcileSticker(db, row.id, OTHER, '', async () => [], true)).toBe(true);
  expect(await getSticker(db, row.id)).toMatchObject({ status: 'pending' });
});
it('Webの順番を上下でき、端・存在しないIDでは壊れない。画像は一覧に返さない', async () => {
  const a = await draft('一枚目'), b = await draft('二枚目');
  await moveSticker(db, b.id, 'up', OTHER);
  expect((await listStickers(db)).map(r => r.id)).toEqual([b.id, a.id]);
  expect((await listStickers(db))[0]).not.toHaveProperty('imageData');
  await moveSticker(db, b.id, 'up', OTHER); await moveSticker(db, 9999, 'down', OTHER);
  expect((await listStickers(db)).map(r => r.id)).toEqual([b.id, a.id]);
  await moveSticker(db, b.id, 'down', OTHER);
  expect((await listStickers(db)).map(r => r.id)).toEqual([a.id, b.id]);
  expect(await listStickers(db, OTHER)).toHaveLength(0);
});
it('製作者ロールは設定を優先し、同名複数・削除済み・managedロールを許可しない', async () => {
  const roles = [{ id: AUTHOR, name: 'スタンプ製作者' }];
  expect(await stickerCreatorRole(db, roles)).toBe(AUTHOR);
  expect(await stickerCreatorRole(db, [...roles, { id: OTHER, name: 'スタンプ製作者' }])).toBeUndefined();
  await saveStickerConfig(db, { roleId: OTHER }, AUTHOR);
  expect(await stickerCreatorRole(db, roles)).toBeUndefined();
  expect(await stickerCreatorRole(db, [{ id: OTHER, name: '製作班' }])).toBe(OTHER);
  expect(await stickerCreatorRole(db, [{ id: OTHER, name: '製作班', managed: true }])).toBeUndefined();
});

it('運営が確認した版と異なる申請は登録しない', async () => {
  const row = await draft(); await submitSticker(db, row.id, AUTHOR);
  const create = vi.fn(async () => ({ id: ID, name: fields.name }));
  expect(await registerSticker(db, row.id, OTHER, create, new Date(0))).toBe('gone');
  expect(create).not.toHaveBeenCalled();
  const fresh = (await getSticker(db, row.id))!;
  expect(await registerSticker(db, row.id, OTHER, create, fresh.updatedAt)).toBe('registered');
});

it('照合中に別の運営が状態を更新したら、古い照合結果で上書きしない', async () => {
  const row = await draft();
  await db.update(stickerDrafts).set({ status: 'uncertain', updatedAt: new Date(Date.now() - 180_000) }).where(eq(stickerDrafts.id, row.id));
  const ok = await reconcileSticker(db, row.id, OTHER, '', async () => {
    await db.update(stickerDrafts).set({ status: 'registering', updatedAt: new Date() }).where(eq(stickerDrafts.id, row.id));
    return [];
  }, true);
  expect(ok).toBe(false);
  expect((await getSticker(db, row.id))!.status).toBe('registering');
});

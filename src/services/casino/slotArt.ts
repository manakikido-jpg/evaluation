import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { slotArt } from '../../db/schema.js';
import { detectImage } from '../notices.js';

/**
 * 🦊 AT 機の絵（社務所Web で運営が入れる）。入っていない絵は、画面がコードで描いた仮の絵を使う。
 * 画面には「key → URL」の一覧を渡す（URL に印が付くので、入れ替えるとすぐ新しい絵になる）
 */

export type ArtSlot = { key: string; group: 'bg' | 'char' | 'logo' | 'sym' | 'cab'; label: string; size: string; note: string };

/** 入れられる絵（size はおすすめの大きさ。キャラ・ロゴ・絵柄は背景が透明な PNG / WebP） */
export const AT_ART_SLOTS: ArtSlot[] = [
  { key: 'bg-normal', group: 'bg', label: '通常時の背景（白狐の社・夜）', size: '960×540', note: '液晶いっぱいに出す' },
  { key: 'bg-zenchou', group: 'bg', label: '前兆の背景（鬼の森）', size: '960×540', note: '演出が強いときに切り替わる' },
  { key: 'bg-at', group: 'bg', label: 'AT「白狐ラッシュ」の背景', size: '960×540', note: '流れる線を上に重ねる' },
  { key: 'bg-tokka', group: 'bg', label: '特化ゾーン「白狐乱舞」の背景', size: '960×540', note: '色が回る' },
  { key: 'bg-battle', group: 'bg', label: '継続バトルの背景（決戦の場）', size: '960×540', note: '' },
  { key: 'byakko', group: 'char', label: '白狐（ふつう）', size: '600×800・透明', note: '通常時・AT 中に立っている' },
  { key: 'byakko-attack', group: 'char', label: '白狐（斬りかかる）', size: '800×600・透明', note: 'バトルで攻めるとき' },
  { key: 'byakko-win', group: 'char', label: '白狐（勝った・決めポーズ）', size: '600×800・透明', note: '鬼を斬ったあと・AT 突入' },
  { key: 'byakko-down', group: 'char', label: '白狐（負けた）', size: '600×800・透明', note: 'バトルに負けたとき' },
  { key: 'byakko-cutin', group: 'char', label: '白狐のカットイン（顔のアップ）', size: '1200×400・透明', note: '画面を横切る' },
  { key: 'oni', group: 'char', label: '鬼（ふつう）', size: '600×800・透明', note: '前兆で近づいてくる・バトル' },
  { key: 'oni-attack', group: 'char', label: '鬼（襲いかかる）', size: '800×600・透明', note: 'バトルで攻めてくるとき' },
  { key: 'oni-down', group: 'char', label: '鬼（斬られた）', size: '600×800・透明', note: '白狐が勝ったとき' },
  { key: 'logo-rush', group: 'logo', label: '「白狐ラッシュ」のロゴ', size: '900×300・透明', note: 'AT 突入' },
  { key: 'logo-ranbu', group: 'logo', label: '「白狐乱舞」のロゴ', size: '900×300・透明', note: '特化ゾーン' },
  { key: 'logo-battle', group: 'logo', label: '「決戦」のロゴ', size: '900×300・透明', note: '継続バトルの始まり' },
  { key: 'logo-title', group: 'logo', label: '台の名前「鬼斬り白狐」', size: '900×240・透明', note: '筐体のいちばん上' },
  { key: 'cab-gimmick', group: 'cab', label: '役物（台の上の白狐の面）', size: '500×500・透明', note: '大きな当たりで液晶の上に降りてきて光る' },
  { key: 'cab-panel', group: 'cab', label: '腰パネル（ボタンの下の飾りの絵）', size: '900×360', note: '台のいちばん下に出る' },
  { key: 'sym-w7', group: 'sym', label: 'リールの絵柄: 白狐7', size: '200×200・透明', note: '' },
  { key: 'sym-r7', group: 'sym', label: 'リールの絵柄: 鬼7', size: '200×200・透明', note: '' },
  { key: 'sym-bar', group: 'sym', label: 'リールの絵柄: BAR', size: '200×200・透明', note: '' },
  { key: 'sym-bell', group: 'sym', label: 'リールの絵柄: ベル', size: '200×200・透明', note: '' },
  { key: 'sym-replay', group: 'sym', label: 'リールの絵柄: リプレイ', size: '200×200・透明', note: '' },
  { key: 'sym-cherry', group: 'sym', label: 'リールの絵柄: チェリー', size: '200×200・透明', note: '' },
  { key: 'sym-suika', group: 'sym', label: 'リールの絵柄: スイカ', size: '200×200・透明', note: '' },
];
export const isArtKey = (k: string) => AT_ART_SLOTS.some((s) => s.key === k);
/** 1 枚の大きさの上限（バイト） */
export const ART_MAX_BYTES = 4 * 1024 * 1024;

export async function saveArt(db: Db, key: string, data: Uint8Array): Promise<'ok' | 'bad_key' | 'bad_image' | 'too_big'> {
  if (!isArtKey(key)) return 'bad_key';
  if (data.byteLength > ART_MAX_BYTES) return 'too_big';
  const kind = detectImage(data);
  if (!kind) return 'bad_image';
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
  await db
    .insert(slotArt)
    .values({ key, contentType: kind.type, data, hash })
    .onConflictDoUpdate({ target: slotArt.key, set: { contentType: kind.type, data, hash, updatedAt: new Date() } });
  return 'ok';
}

export async function loadArt(db: Db, key: string): Promise<{ contentType: string; data: Uint8Array; hash: string } | undefined> {
  const [row] = await db.select().from(slotArt).where(eq(slotArt.key, key));
  return row && { contentType: row.contentType, data: row.data, hash: row.hash };
}

export async function deleteArt(db: Db, key: string): Promise<void> {
  await db.delete(slotArt).where(eq(slotArt.key, key));
}

/** 入っている絵の URL（key → /casino/art/key?v=印）。中身は読まない */
export async function artUrls(db: Db): Promise<Record<string, string>> {
  const rows = await db.select({ key: slotArt.key, hash: slotArt.hash }).from(slotArt);
  return Object.fromEntries(rows.filter((r) => isArtKey(r.key)).map((r) => [r.key, `/casino/art/${r.key}?v=${r.hash}`]));
}

import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';

/**
 * ⛩ 「御神籤を引く」ボタンの置き場所（/パネル おみくじ で置いたチャンネルと、今のボタンの書き込み）。
 * ボタンは、そのチャンネルのいちばん下に出し続ける
 */
const KEY = 'omikuji_panel';
export type OmikujiPanelPlace = { channelId?: string; messageId?: string };

const sf = (x: unknown) => (typeof x === 'string' && /^\d{17,20}$/.test(x) ? x : undefined);

export async function loadOmikujiPanel(db: Db): Promise<OmikujiPanelPlace> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = (row?.value ?? {}) as Record<string, unknown>;
  return { channelId: sf(v.channelId), messageId: sf(v.messageId) };
}

export async function saveOmikujiPanel(db: Db, place: OmikujiPanelPlace, by: string): Promise<void> {
  const value = { channelId: place.channelId ?? null, messageId: place.messageId ?? null };
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
}

/** チャンネルへの操作（Discord をテストで差しかえられるように） */
export type PanelChannelOps = {
  /** いちばん新しい書き込みの ID（なければ undefined） */
  lastMessageId(): Promise<string | undefined>;
  /** ボタンを出して、その書き込みの ID を返す */
  send(): Promise<string>;
  remove(messageId: string): Promise<void>;
};

/**
 * ボタンがいちばん下になければ、下に出し直す。新しいボタンを出して覚えてから、前のボタンを消す
 * （消したときの「消された」の知らせで、止めたとまちがえないように）
 */
export async function restickPanel(place: OmikujiPanelPlace, ops: PanelChannelOps, save: (p: OmikujiPanelPlace) => Promise<void>): Promise<'ok' | 'moved'> {
  if (!place.channelId) return 'ok';
  if (place.messageId && (await ops.lastMessageId()) === place.messageId) return 'ok';
  const messageId = await ops.send();
  await save({ channelId: place.channelId, messageId });
  if (place.messageId) await ops.remove(place.messageId).catch(() => undefined);
  return 'moved';
}

import { eq, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
const PREFIX = 'voice-mute:';
export type ServerMuteState = { sessionId: string | null; waiting: boolean };
function parse(value: unknown): ServerMuteState | undefined {
  if (!value || typeof value !== 'object' || !('waiting' in value) || typeof value.waiting !== 'boolean') return;
  const sessionId = 'sessionId' in value && typeof value.sessionId === 'string' ? value.sessionId : null;
  return { sessionId, waiting: value.waiting };
}
export async function muteState(db: Db, id: string): Promise<ServerMuteState | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, PREFIX+id));
  return parse(row?.value);
}
export async function mutedMemberIds(db: Db): Promise<string[]> {
  const rows = await db.select().from(settings).where(like(settings.key, PREFIX+'%'));
  return rows.filter(row=>parse(row.value)).map(row=>row.key.slice(PREFIX.length));
}
export async function saveMuteState(db: Db, id: string, value?: ServerMuteState): Promise<void> {
  if (!value) { await db.delete(settings).where(eq(settings.key,PREFIX+id)); return; }
  await db.insert(settings).values({key:PREFIX+id,value,updatedBy:'system'})
    .onConflictDoUpdate({target:settings.key,set:{value,updatedBy:'system',updatedAt:new Date()}});
}

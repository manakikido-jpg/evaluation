import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { InviteLinkApp } from '../src/discord/inviteLinks.js';
import { inviteBlocks, isInviteBlocked, setInviteBlock } from '../src/services/inviteBlock.js';
import { cfg, makeDb } from './helpers.js';

const BAD = '815208713874584412', OK = '815208713874584413';
let db: Db, close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await makeDb()));
afterEach(async () => close());

describe('🚫 招待を作れない人', () => {
  it('登録・外す。二重に登録しない', async () => {
    expect(await setInviteBlock(db, BAD, true, 'admin', 'サブ垢の疑い')).toBe(true);
    expect(await setInviteBlock(db, BAD, true, 'admin')).toBe(false);
    expect(await isInviteBlocked(db, BAD)).toBe(true);
    expect(await isInviteBlocked(db, OK)).toBe(false);
    expect((await inviteBlocks(db))[0]?.note).toBe('サブ垢の疑い');
    expect(await setInviteBlock(db, BAD, false, 'admin')).toBe(true);
    expect(await isInviteBlocked(db, BAD)).toBe(false);
  });

  it('登録した人が作った招待だけ、すぐ消す', async () => {
    await setInviteBlock(db, BAD, true, 'admin');
    const app = new InviteLinkApp(db, () => cfg);
    const inv = (inviterId: string | null, guildId = cfg.guildId) => ({ code: 'abc', guild: { id: guildId }, inviterId, delete: vi.fn(async () => undefined) });
    const bad = inv(BAD);
    expect(await app.onInviteCreate(bad as never)).toBe(true);
    expect(bad.delete).toHaveBeenCalledOnce();
    const ok = inv(OK);
    expect(await app.onInviteCreate(ok as never)).toBe(false);
    expect(ok.delete).not.toHaveBeenCalled();
    expect(await app.onInviteCreate(inv(BAD, '100000000000000000') as never)).toBe(false);
    expect(await app.onInviteCreate(inv(null) as never)).toBe(false);
  });
});

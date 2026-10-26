import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { recordInvite } from '../src/services/invites.js';
import { giveShuin } from '../src/services/shuin.js';
import { isStaffAlt, setStaffAlt, staffAlts } from '../src/services/staffAlts.js';
import { makeDb } from './helpers.js';

const ALT = '840000000000000001', OWNER = '840000000000000002', OTHER = '840000000000000003';
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([ALT, OWNER, OTHER].map((id) => ({ id, username: id, displayName: id })));
});
afterEach(async () => close());

describe('🕶 運営のサブアカウント', () => {
  it('登録すると銭を 0 にして、そのあと銭が入らない。外すとまた入る', async () => {
    await addCoins(db, ALT, 500, 'admin_grant');
    expect(await setStaffAlt(db, ALT, true, 'guji', OWNER, '見回り用')).toBe(true);
    expect(await setStaffAlt(db, ALT, true, 'guji', OWNER)).toBe(false);
    expect(await isStaffAlt(db, ALT)).toBe(true);
    expect((await staffAlts(db))[0]).toMatchObject({ ownerId: OWNER, note: '見回り用' });
    expect((await walletOf(db, ALT)).balance).toBe(0);
    expect(await addCoins(db, ALT, 300, 'admin_grant')).toBe(0);
    expect((await walletOf(db, ALT)).balance).toBe(0);
    await setStaffAlt(db, ALT, false, 'guji');
    expect(await addCoins(db, ALT, 300, 'admin_grant')).toBe(300);
  });

  it('朱印を押せない・押されない。招待の記録に入らない', async () => {
    await setStaffAlt(db, ALT, true, 'guji', OWNER);
    await expect(giveShuin(db, { giverId: ALT, receiverId: OTHER, weight: 1, giverRank: 'sanpaisha' })).rejects.toThrow();
    await expect(giveShuin(db, { giverId: OTHER, receiverId: ALT, weight: 1, giverRank: 'sanpaisha' })).rejects.toThrow();
    expect(await recordInvite(db, ALT, OWNER, 'link')).toBe(false);
    expect(await recordInvite(db, OTHER, ALT, 'link')).toBe(false);
    expect(await recordInvite(db, OTHER, OWNER, 'link')).toBe(true);
  });
});

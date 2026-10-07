import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShuinApp } from '../src/discord/app.js';
import type { Db } from '../src/db/client.js';
import { listMembers, recordJoin } from '../src/services/members.js';
import { giveShuin, goenOf, goshuinchoOf } from '../src/services/shuin.js';
import { grantSpecialGoen, revokeSpecialGoen, specialGoenDm, specialGoenLog, takeUncheckedSpecialGoen, validSpecialGoen } from '../src/services/specialGoen.js';
import { cfg, makeDb, ROLE } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => close());

const A = '880000000000000001';
const B = '880000000000000002';
const G = '880000000000000003';
const nonce = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

describe('✨ 特別ご縁', () => {
  it('朱印のご縁に足して数える。取り消すと減る。同じ番号は 1 回だけ', async () => {
    await recordJoin(db, { id: A, username: 'a', displayName: 'A', avatarUrl: null, roleIds: [ROLE.sanpaisha], isBot: false, joinedAt: null });
    await giveShuin(db, { giverId: B, receiverId: A, weight: 2, giverRank: 'ujiko' });
    expect(validSpecialGoen(0)).toBe(false);
    expect(validSpecialGoen(1001)).toBe(false);
    const r = await grantSpecialGoen(db, { memberId: A, amount: 15, reason: 'お礼', by: G, nonce: nonce(1) });
    expect(r.status).toBe('ok');
    expect(await grantSpecialGoen(db, { memberId: A, amount: 15, reason: 'お礼', by: G, nonce: nonce(1) })).toEqual({ status: 'duplicate' });
    await grantSpecialGoen(db, { memberId: A, amount: 5, reason: 'もう少し', by: G, nonce: nonce(2) });
    expect(await goenOf(db, A)).toBe(22);
    expect(await goshuinchoOf(db, A)).toMatchObject({ goen: 22, special: 20, receivedCount: 1 });
    expect((await listMembers(db, {})).rows.find((m) => m.id === A)?.goen).toBe(22);
    if (r.status !== 'ok') return;
    // ほかの人の記録は取り消せない。2 回目は何もしない
    expect(await revokeSpecialGoen(db, r.row.id, B, G)).toBeUndefined();
    expect(await revokeSpecialGoen(db, r.row.id, A, G)).toMatchObject({ amount: 15, revokedBy: G });
    expect(await revokeSpecialGoen(db, r.row.id, A, G)).toBeUndefined();
    expect(await goenOf(db, A)).toBe(7);
    expect(specialGoenDm(5, 'お礼', 7)).toContain('特別ご縁 +5');
    expect(specialGoenLog('grant', A, G, 5, 'お礼', 7)).toBe(`✨ <@${G}> が <@${A}> に特別ご縁 +5（お礼）→ ご縁 7`);
  });

  it('BOT が 1 分ごとに、振られた人の昇格を確かめる（1 回だけ）', async () => {
    await recordJoin(db, { id: A, username: 'a', displayName: 'A', avatarUrl: null, roleIds: [ROLE.sanpaisha], isBot: false, joinedAt: null });
    await grantSpecialGoen(db, { memberId: A, amount: 20, reason: 'お礼', by: G, nonce: nonce(3) });
    const roles = new Map<string, object>([[ROLE.sanpaisha, {}]]);
    const add = vi.fn(async (id: string) => void roles.set(id, {}));
    const remove = vi.fn(async (ids: string[]) => void ids.forEach((id) => roles.delete(id)));
    const send = vi.fn(async () => ({ id: 'm' }));
    const member: Record<string, unknown> = { id: A, user: { id: A, bot: false, username: 'a' }, displayName: 'A', roles: { cache: roles, add, remove } };
    const guild = { id: cfg.guildId, members: { fetch: async () => member } };
    member.guild = guild;
    const client = { users: { fetch: async () => ({ send: vi.fn() }) }, channels: { fetch: async () => ({ isSendable: () => true, send }) } };
    const app = new ShuinApp(client as never, db, cfg);
    await app.checkSpecialGoen(guild as never);
    expect(add).toHaveBeenCalledWith(ROLE.ujiko, expect.stringContaining('ご縁 20'));
    expect(roles.has(ROLE.ujiko)).toBe(true);
    // もう確かめたので、次は何もしない
    expect(await takeUncheckedSpecialGoen(db)).toEqual([]);
    await app.checkSpecialGoen(guild as never);
    expect(add).toHaveBeenCalledTimes(1);
  });
});

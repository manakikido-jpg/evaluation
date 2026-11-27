import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { engawaPairs, invites, members, omairi } from '../src/db/schema.js';
import { setEmaPromotion } from '../src/services/emaPromotion.js';
import { resetAllShuin } from '../src/services/shuin.js';
import { checkGiveEma } from '../src/services/ema.js';
import { setNewSystemRoles } from '../src/services/ujikoKeep.js';
import { aramitamaProgress, aramitamaRoleId, runAramitamaReturn } from '../src/services/aramitama.js';
import { decideOmairi } from '../src/services/admission.js';
import { startOmairi } from '../src/services/applications.js';
import { aramitamaBlocks } from '../src/discord/aramitamaGate.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const A = '893000000000000001'; // 参拝者 → 荒魂
const U = '893000000000000002'; // 氏子
const STAFF = '893000000000000009';
const ARA_ROLE = '893000000000008888';
const DAY = 86_400_000;
const T0 = new Date('2026-12-01T03:00:00Z');
let db: Db, close: () => Promise<void>;
const discord = { addRole: vi.fn(async () => undefined), removeRole: vi.fn(async () => undefined), sendDm: vi.fn(async () => true), kick: vi.fn(async () => undefined) };
const ctx = () => ({ db, cfg, discord }) as never;
const actor = { id: STAFF, level: 'guji', via: 'web' } as never;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const f of Object.values(discord)) f.mockClear();
  await db.insert(members).values([
    { id: A, username: 'a', displayName: 'あら', roleIds: [ROLE.sanpaisha] },
    { id: U, username: 'u', displayName: '氏子', roleIds: [ROLE.ujiko] },
    { id: STAFF, username: 'g', displayName: '宮司', roleIds: [] },
  ]);
  await startOmairi(db, A, 14, new Date(T0.getTime() - 20 * DAY));
});
afterEach(async () => close());

const start = async () => {
  await setEmaPromotion(db, true, 'guji');
  await resetAllShuin(db, 'guji', T0);
  await setNewSystemRoles(db, { aramitama: ARA_ROLE }, 'guji');
};
const invite = (i: number, at: Date | null) => db.insert(invites).values({ memberId: String(894000000000000000n + BigInt(i)), inviterId: A, qualifiedAt: at });

describe('🔥 荒魂', () => {
  it('③④の前・ロールが未設定のあいだは、荒魂にできない', async () => {
    expect(await aramitamaRoleId(db)).toBeNull();
    expect(await decideOmairi(ctx(), actor, A, 'aramitama', T0)).toBe('no_role');
    expect((await db.select().from(omairi))[0]!.status).toBe('ongoing');
    await setEmaPromotion(db, true, 'guji');
    await resetAllShuin(db, 'guji', T0);
    expect(await aramitamaRoleId(db)).toBeNull(); // ロールがまだ
    await setNewSystemRoles(db, { aramitama: ARA_ROLE }, 'guji');
    expect(await aramitamaRoleId(db)).toBe(ARA_ROLE);
  });

  it('判定で荒魂にする：荒魂ロールを付け、参拝者ロールを外し、DM する。2回目は判定済み', async () => {
    await start();
    expect(await decideOmairi(ctx(), actor, A, 'aramitama', T0)).toBe('ok');
    expect(discord.addRole).toHaveBeenCalledWith(cfg.guildId, A, ARA_ROLE, expect.any(String));
    expect(discord.removeRole).toHaveBeenCalledWith(cfg.guildId, A, ROLE.sanpaisha, expect.any(String));
    expect(discord.sendDm).toHaveBeenCalledTimes(1);
    expect(discord.kick).not.toHaveBeenCalled();
    expect((await db.select().from(omairi))[0]!.status).toBe('aramitama');
    expect(await decideOmairi(ctx(), actor, A, 'aramitama', T0)).toBe('not_found');
  });

  it('荒魂になってからの招待が3人そろうと、お参り期間を最初から始める（前の招待は数えない）', async () => {
    await start();
    await invite(0, new Date(Date.now() - DAY)); // 荒魂になる前の招待
    await decideOmairi(ctx(), actor, A, 'aramitama', T0);
    const since = (await db.select().from(omairi))[0]!.decidedAt!;
    const later = new Date(since.getTime() + 60_000);
    await invite(1, later); await invite(2, later); await invite(3, null); // 3人目はまだ4時間いない
    expect(await aramitamaProgress(db, cfg, A)).toMatchObject({ invites: 2, need: 3 });
    expect(await runAramitamaReturn(db, cfg, later)).toEqual([]);
    await invite(4, later);
    const now = new Date(since.getTime() + DAY);
    expect(await runAramitamaReturn(db, cfg, now)).toEqual([A]);
    const [row] = await db.select().from(omairi);
    expect(row).toMatchObject({ status: 'ongoing', extendedCount: 0 });
    expect(row!.endsAt.getTime()).toBe(now.getTime() + cfg.omairi.days * DAY);
    expect(await aramitamaProgress(db, cfg, A)).toBeNull();
    expect(await runAramitamaReturn(db, cfg, now)).toEqual([]); // 1回だけ
  });

  it('荒魂は絵馬を贈れない・受け取れない。止める操作は絵馬・結び・キャスト', async () => {
    await start();
    await db.update(members).set({ roleIds: [ARA_ROLE] }).where(eq(members.id, A));
    const [x, y] = A < U ? [A, U] : [U, A];
    await db.insert(engawaPairs).values(['2026-12-02', '2026-12-03', '2026-12-04'].map((date) => ({ memberA: x, memberB: y, date, minutes: 40 })));
    expect(await checkGiveEma(db, cfg, U, A)).toEqual({ ok: false, reason: 'aramitama' });
    expect(await checkGiveEma(db, cfg, A, U)).toEqual({ ok: false, reason: 'aramitama' });
    for (const id of ['ema:give:1', 'shuin:give:1', 'shuin:unmet:1', 'cast:x', 'control:musubi:x']) expect(aramitamaBlocks({ customId: id })).toBe(true);
    for (const id of ['shuin:card:1', 'casino:x', 'omikuji:x']) expect(aramitamaBlocks({ customId: id })).toBe(false);
    expect(aramitamaBlocks({ command: 'cast' })).toBe(true);
    expect(aramitamaBlocks({ command: 'omikuji' })).toBe(false);
  });
});

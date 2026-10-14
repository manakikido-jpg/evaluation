import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { RoleGuardApp } from '../src/discord/roleGuard.js';
import { listAudit } from '../src/services/audit.js';
import { judgeRoleChange } from '../src/services/roleGuard.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const SELF = '790000000000000001';
const TARGET = '790000000000000002';
const STAFF = '790000000000000003';
const KPRO = '790000000000000004';
const GUJI = '790000000000000005';
const OWNER = '790000000000000006';
const VIP = '790000000000000100';

describe('🛡 ロールの見張り: 判定', () => {
  const base = { mode: 'revert' as const, executorIsBot: false, selfId: SELF, trustedBotIds: [KPRO], executorIsGuji: false };
  it('このBOT・信用するBOT・宮司・本人の選択はそのまま。ほかは設定どおり', () => {
    expect(judgeRoleChange({ ...base, executorId: SELF })).toBe('ok');
    expect(judgeRoleChange({ ...base, executorId: KPRO, executorIsBot: true })).toBe('ok');
    expect(judgeRoleChange({ ...base, executorId: GUJI, executorIsGuji: true })).toBe('ok');
    expect(judgeRoleChange({ ...base, executorId: TARGET, selfSelect: true })).toBe('ok');
    expect(judgeRoleChange({ ...base, executorId: STAFF })).toBe('revert');
    expect(judgeRoleChange({ ...base, executorId: '790000000000000009', executorIsBot: true })).toBe('revert');
    expect(judgeRoleChange({ ...base, mode: 'alert', executorId: STAFF })).toBe('alert');
    expect(judgeRoleChange({ ...base, mode: 'off', executorId: STAFF })).toBe('ok');
    // だれか分からないときは戻さない
    expect(judgeRoleChange({ ...base, executorId: null })).toBe('alert');
  });
});

describe('🛡 ロールの見張り: Discord', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => {
    await close();
  });

  function setup(mode: 'off' | 'alert' | 'revert', executorId: string | null, executorRoles: string[] = [], manageRoles = true) {
    const c: GuildConfig = { ...cfg, channels: { ...cfg.channels, log: '790000000000000900' }, security: { roleGuard: mode, trustedBotIds: [KPRO] } };
    const sent: string[] = [];
    const discord = { sendMessage: vi.fn(async (_ch: string, b: { content?: string }) => (sent.push(b.content ?? ''), { id: '1' })) };
    const roles = { add: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
    const entry = {
      targetId: TARGET,
      executorId,
      createdTimestamp: Date.now(),
      changes: [{ key: '$add', new: [{ id: VIP }] }],
    };
    const executor = executorId
      ? { user: { bot: false }, roles: { cache: new Map(executorRoles.map((r) => [r, {}])) }, permissions: { has: () => manageRoles } }
      : null;
    const guild = {
      id: c.guildId,
      ownerId: OWNER,
      roles: { cache: new Map([[VIP, { managed: false }]]) },
      fetchAuditLogs: async () => ({ entries: { find: (f: (e: typeof entry) => boolean) => (f(entry) ? entry : undefined) } }),
      members: { fetch: async () => executor },
    };
    const member = { id: TARGET, guild, client: { user: { id: SELF } }, roles: { ...roles, cache: new Map([[VIP, {}]]) } };
    const old = { partial: false, roles: { cache: new Map() } };
    const app = new RoleGuardApp(db, () => c, discord, async () => undefined);
    return { app, member, old, roles, sent };
  }

  it('神職が手で付けたロールを元に戻して知らせる（記録に残る）', async () => {
    const s = setup('revert', STAFF);
    await s.app.onMemberUpdate(s.old as never, s.member as never);
    expect(s.roles.remove).toHaveBeenCalledWith([VIP], expect.any(String));
    expect(s.sent[0]).toContain('BOT を通さないロールの変更');
    expect(s.sent[0]).toContain('元に戻しました');
    expect((await listAudit(db, { action: 'security.role_reverted' }))[0]).toMatchObject({ actorId: STAFF, targetId: TARGET });
  });

  it('知らせるだけの設定なら戻さない。宮司・信用するBOT・本人の選択は何もしない', async () => {
    const a = setup('alert', STAFF);
    await a.app.onMemberUpdate(a.old as never, a.member as never);
    expect(a.roles.remove).not.toHaveBeenCalled();
    expect(a.sent[0]).toContain('知らせるだけ');
    for (const [who, roles, manage] of [
      [GUJI, [ROLE.guji], true],
      [KPRO, [], true],
      [OWNER, [], true],
      [TARGET, [], false],
    ] as const) {
      const s = setup('revert', who, [...roles], manage);
      await s.app.onMemberUpdate(s.old as never, s.member as never);
      expect(s.roles.remove).not.toHaveBeenCalled();
      expect(s.sent).toHaveLength(0);
    }
    // 「ロールの管理」を持つ人が自分に付けたのは戻す
    const self = setup('revert', TARGET, [], true);
    await self.app.onMemberUpdate(self.old as never, self.member as never);
    expect(self.roles.remove).toHaveBeenCalled();
  });
});

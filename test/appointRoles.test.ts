import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection } from 'discord.js';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { AppointRolesApp } from '../src/discord/appointRoles.js';
import { appointRoleChanges, loadAppointRoles, saveAppointRoles } from '../src/services/appointRoles.js';
import { listAudit } from '../src/services/audit.js';
import { cfg, makeDb } from './helpers.js';

const EJI = '870000000000000101', SHINEJI = '870000000000000102', TAIFU = '870000000000000103', SHINTAIFU = '870000000000000104';
const ranks: GuildConfig['ranks'] = [
  ...cfg.ranks,
  { key: 'eji', name: '衛士', emoji: '', roleId: EJI, weight: 6, auto: false, requiredGoen: 0, voicePercent: 100 },
  { key: 'taifu', name: '大夫', emoji: '', roleId: TAIFU, weight: 8, auto: false, requiredGoen: 0, voicePercent: 100 },
];
const conf = { ...cfg, ranks } as GuildConfig;
const map = { eji: SHINEJI, taifu: SHINTAIFU };
const set = (...ids: string[]) => new Set(ids);

describe('🎖 任命したときに一緒に付けるロール', () => {
  it('役職が付いたら一緒に付け、上がったら・外れたら前のものを外す', () => {
    expect(appointRoleChanges(ranks, map, set(), set(EJI))).toEqual({ add: [SHINEJI], remove: [] });
    // もう持っていれば付けない
    expect(appointRoleChanges(ranks, map, set(), set(EJI, SHINEJI))).toEqual({ add: [], remove: [] });
    // 役職が上がった: 新しい方を付け、前の方を外す（前の役職のロールが残っていても）
    expect(appointRoleChanges(ranks, map, set(EJI, SHINEJI), set(EJI, SHINEJI, TAIFU))).toEqual({ add: [SHINTAIFU], remove: [SHINEJI] });
    // 一緒のロールを決めていない上の役職でも、上がったら外す
    expect(appointRoleChanges(ranks, map, set(EJI, SHINEJI), set(EJI, SHINEJI, cfg.ranks.find((r) => r.key === 'guji')!.roleId))).toEqual({ add: [], remove: [SHINEJI] });
    // 低い役職が付いても外さない
    expect(appointRoleChanges(ranks, map, set(TAIFU, SHINTAIFU), set(TAIFU, SHINTAIFU, EJI))).toEqual({ add: [SHINEJI], remove: [] });
    // その役職が外れたら一緒に外す
    expect(appointRoleChanges(ranks, map, set(EJI, SHINEJI), set(SHINEJI))).toEqual({ add: [], remove: [SHINEJI] });
    // 役職に関係ないロールの変化では何もしない
    expect(appointRoleChanges(ranks, map, set(EJI, SHINEJI), set(EJI, SHINEJI, '870000000000000999'))).toEqual({ add: [], remove: [] });
    // 役職そのもののロールは、一緒のロールとして付け外ししない
    expect(appointRoleChanges(ranks, { eji: TAIFU }, set(), set(EJI))).toEqual({ add: [], remove: [] });
  });

  describe('Discord', () => {
    let db: Db, close: () => Promise<void>;
    beforeEach(async () => { ({ db, close } = await makeDb()); });
    afterEach(async () => { await close(); });
    const fake = (ids: string[], partial = false) => {
      const cache = new Collection(ids.map((id) => [id, { id }]));
      return {
        partial, guild: { id: cfg.guildId }, id: '870000000000000201', user: { bot: false },
        roles: { cache, add: vi.fn(async (id: string) => { cache.set(id, { id }); }), remove: vi.fn(async (id: string) => { cache.delete(id); }) },
      };
    };
    it('付いたら付け、上がったら外して記録する。前のロールが分からないときと、設定がないときは何もしない', async () => {
      const app = new AppointRolesApp(db, () => conf);
      const m = fake([EJI]);
      await app.onMemberUpdate(fake([]) as never, m as never);
      expect(m.roles.add).not.toHaveBeenCalled();
      await saveAppointRoles(db, map, 'guji');
      expect(await loadAppointRoles(db)).toEqual(map);
      await app.onMemberUpdate(fake([]) as never, m as never);
      expect(m.roles.add).toHaveBeenCalledWith(SHINEJI, expect.any(String));
      const up = fake([EJI, SHINEJI, TAIFU]);
      await app.onMemberUpdate(fake([EJI, SHINEJI]) as never, up as never);
      expect(up.roles.add).toHaveBeenCalledWith(SHINTAIFU, expect.any(String));
      expect(up.roles.remove).toHaveBeenCalledWith(SHINEJI, expect.any(String));
      expect(await listAudit(db, { action: 'ranks.appoint_role_add' })).toHaveLength(2);
      expect(await listAudit(db, { action: 'ranks.appoint_role_remove' })).toHaveLength(1);
      const unknown = fake([EJI]);
      await app.onMemberUpdate(fake([], true) as never, unknown as never);
      expect(unknown.roles.add).not.toHaveBeenCalled();
    });
  });
});

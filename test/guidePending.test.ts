import { GuildMemberFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import { GuidePendingApp, guideAction, guideRoleOf } from '../src/discord/guidePending.js';
import { cfg as baseCfg, ROLE } from './helpers.js';

const GUIDE = '100000000000000071';
const EMA = '100000000000000072';
const cfg: GuildConfig = { ...baseCfg, roles: { ...baseCfg.roles, emaPending: EMA, guidePending: GUIDE } };

describe('🧭 案内待ち', () => {
  it('参加時の質問を終えたら付ける。承認（絵馬待ち・役職）で外す。BOT には付けない', () => {
    expect(guideAction(cfg, GUIDE, { isBot: false, completed: true, roleIds: [] })).toBe('add');
    expect(guideAction(cfg, GUIDE, { isBot: false, completed: false, roleIds: [] })).toBeUndefined();
    expect(guideAction(cfg, GUIDE, { isBot: false, completed: true, roleIds: [GUIDE] })).toBeUndefined();
    expect(guideAction(cfg, GUIDE, { isBot: false, completed: true, roleIds: [GUIDE, EMA] })).toBe('remove');
    expect(guideAction(cfg, GUIDE, { isBot: false, completed: true, roleIds: [GUIDE, ROLE.sanpaisha] })).toBe('remove');
    // もう参拝者の人には付けない
    expect(guideAction(cfg, GUIDE, { isBot: false, completed: true, roleIds: [ROLE.ujiko] })).toBeUndefined();
    expect(guideAction(cfg, GUIDE, { isBot: true, completed: true, roleIds: [] })).toBeUndefined();
  });

  it('ロール: 設定になければ、名前に「案内待ち」を含むロール', () => {
    const roles = [
      { id: '1', name: '参拝者' },
      { id: '2', name: '🧭 案内 待ち' },
    ];
    expect(guideRoleOf(cfg, roles)).toBe(GUIDE);
    expect(guideRoleOf(baseCfg, roles)).toBe('2');
    expect(guideRoleOf(baseCfg, [{ id: '1', name: '参拝者' }])).toBeUndefined();
  });

  /** discord.js のメンバーの代わり（使うところだけ） */
  const fakeMember = (id: string, o: { flags?: number; pending?: boolean; roleIds?: string[]; bot?: boolean } = {}) => {
    const roleIds = new Set(o.roleIds ?? []);
    const log: string[] = [];
    const flags = { has: (f: number) => ((o.flags ?? 0) & f) === f };
    const m = {
      id,
      pending: o.pending ?? false,
      flags,
      user: { bot: o.bot ?? false },
      guild: { id: cfg.guildId, roles: { cache: new Map() } },
      roles: {
        cache: { keys: () => roleIds.values() },
        add: async (r: string) => (roleIds.add(r), log.push(`add ${r}`)),
        remove: async (r: string) => (roleIds.delete(r), log.push(`remove ${r}`)),
      },
    };
    return { m, log, roleIds };
  };

  it('入った瞬間に付ける。承認されたら外す', async () => {
    const app = new GuidePendingApp(() => cfg);
    const joined = fakeMember('1', {});
    await app.onMemberAdd(joined.m as never);
    expect(joined.log).toEqual([`add ${GUIDE}`]);
    const approved = fakeMember('1', { roleIds: [GUIDE, EMA] });
    await app.onMemberUpdate(joined.m as never, approved.m as never);
    expect(approved.log).toEqual([`remove ${GUIDE}`]);
    const bot = fakeMember('2', { bot: true });
    await app.onMemberAdd(bot.m as never);
    expect(bot.log).toEqual([]);
  });

  it('起動したとき: 全員を合わせる', async () => {
    const app = new GuidePendingApp(() => cfg);
    const a = fakeMember('1', { flags: GuildMemberFlags.CompletedOnboarding });
    const b = fakeMember('2', { flags: GuildMemberFlags.CompletedOnboarding, roleIds: [GUIDE, ROLE.sanpaisha] });
    const c = fakeMember('3', {});
    const d = fakeMember('4', { roleIds: [ROLE.ujiko] });
    const guild = { roles: { cache: new Map() }, members: { cache: new Map([a, b, c, d].map((x) => [x.m.id, x.m])) } };
    await app.attach(guild as never);
    // 質問を終えたかは問わない。もう役職がある人には付けない
    expect([a.log, b.log, c.log, d.log]).toEqual([[`add ${GUIDE}`], [`remove ${GUIDE}`], [`add ${GUIDE}`], []]);
  });
});

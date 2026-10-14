import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { listAudit } from '../src/services/audit.js';
import { createRoleRequest, decideRoleRequest, finishRoleRequest, needsApproval, recentRoleRequests } from '../src/services/roleRequests.js';
import { cfg, makeDb } from './helpers.js';

const A = '790000000000000011';
const B = '790000000000000012';
const T = '790000000000000013';
const FREE = '790000000000000200';
const VIP = '790000000000000201';

describe('🛡 ロールの承認制', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => {
    await close();
  });

  it('神職は許可リスト以外に承認がいる。宮司・オフならいらない', () => {
    const c: GuildConfig = { ...cfg, security: { ...cfg.security, roleApproval: true, freeRoleIds: [FREE] } };
    expect(needsApproval(c, 'shinshoku', VIP)).toBe(true);
    expect(needsApproval(c, 'shinshoku', FREE)).toBe(false);
    expect(needsApproval(c, 'guji', VIP)).toBe(false);
    expect(needsApproval({ ...c, security: { ...c.security, roleApproval: false } }, 'shinshoku', VIP)).toBe(false);
    // はじめは承認制がオン・許可リストは空
    expect(cfg.security.roleApproval).toBe(true);
    expect(cfg.security.freeRoleIds).toEqual([]);
  });

  it('頼んだ本人は決められない。別の人が決めるのは 1 回だけ。記録に残る', async () => {
    const r = await createRoleRequest(db, { kind: 'give', memberId: T, roleId: VIP, reason: 'イベント係', requestedBy: A });
    expect(r.status).toBe('pending');
    expect((await decideRoleRequest(db, r.id, A, true)).status).toBe('self');
    const [x, y] = await Promise.all([decideRoleRequest(db, r.id, B, true), decideRoleRequest(db, r.id, B, false)]);
    expect([x.status, y.status].sort()).toEqual(['decided', 'ok']);
    expect((await decideRoleRequest(db, 999, B, true)).status).toBe('not_found');
    await finishRoleRequest(db, r.id, false, '付けられませんでした');
    const [row] = await recentRoleRequests(db);
    expect(row).toMatchObject({ decidedBy: B, result: '付けられませんでした' });
    expect((await listAudit(db, { action: 'role.request' })).length).toBe(1);
  });
});

describe('🛡 ロールの承認制（Discord の流れ）', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => {
    await close();
  });

  it('神職の /ロール は承認待ち → 別の神職が承認すると BOT が付ける', async () => {
    const { TempGrantApp } = await import('../src/discord/tempGrants.js');
    const { ROLE } = await import('./helpers.js');
    const c: GuildConfig = { ...cfg, channels: { ...cfg.channels, log: '790000000000000900' } };
    const sent: { content?: string; components?: unknown[] }[] = [];
    const discord = {
      sendMessage: async (_ch: string, b: { content?: string; components?: unknown[] }) => (sent.push(b), { id: '1' }),
      addRole: async () => undefined,
      removeRole: async () => undefined,
    };
    const added: string[] = [];
    discord.addRole = async (...a: unknown[]) => void added.push(String(a[2]));
    const app = new TempGrantApp(db, () => c, discord as never);
    const roleObj = { id: VIP, name: 'VIP', position: 1, managed: false, color: 0, permissions: { bitfield: 0n }, tags: null as { botId: string } | null };
    const guild = {
      roles: { cache: new Map([[VIP, roleObj], ['790000000000000999', { ...roleObj, id: '790000000000000999', name: 'bot', position: 10, tags: { botId: '790000000000000998' } }]]) },
      members: { fetch: async () => ({ roles: { cache: new Map() } }) },
    };
    const staff = (id: string) => ({ roles: { cache: new Map([[ROLE.shinshoku, {}]]) }, id });
    const replies: string[] = [];
    const cmd = {
      inCachedGuild: () => true,
      guildId: c.guildId,
      isButton: () => false,
      isChatInputCommand: () => true,
      commandName: 'role',
      member: staff(A),
      user: { id: A },
      guild,
      client: { user: { id: '790000000000000998' } },
      options: {
        getSubcommand: () => 'give',
        getMember: () => ({ roles: { cache: new Map() } }),
        getUser: () => ({ id: T, toString: () => `<@${T}>` }),
        getRole: () => ({ id: VIP, toString: () => `<@&${VIP}>` }),
        getString: () => 'イベント係',
      },
      deferReply: async () => undefined,
      editReply: async (t: string) => void replies.push(t),
      reply: async () => undefined,
    };
    await app.onInteraction(cmd as never);
    expect(replies[0]).toContain('承認待ち');
    expect(added).toEqual([]);
    expect(sent[0]?.content).toContain('ロールの承認待ち');
    const [req] = await recentRoleRequests(db);
    const button = (who: string) => ({
      inCachedGuild: () => true,
      guildId: c.guildId,
      isButton: () => true,
      customId: `rolereq:approve:${req!.id}`,
      member: staff(who),
      user: { id: who },
      guild,
      client: { user: { id: '790000000000000998' } },
      message: { content: sent[0]!.content, edit: async () => undefined },
      deferReply: async () => undefined,
      editReply: async (t: string) => void replies.push(t),
      reply: async (t: { content: string }) => void replies.push(t.content),
    });
    // 頼んだ本人は承認できない
    await app.onInteraction(button(A) as never);
    expect(replies.at(-1)).toContain('自分で頼んだもの');
    expect(added).toEqual([]);
    await app.onInteraction(button(B) as never);
    expect(replies.at(-1)).toContain('承認しました');
    expect(added).toEqual([VIP]);
  });
});

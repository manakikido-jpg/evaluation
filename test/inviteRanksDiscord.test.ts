import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShuinApp } from '../src/discord/app.js';
import type { Db } from '../src/db/client.js';
import { recordInvite } from '../src/services/invites.js';
import { recordJoin } from '../src/services/members.js';
import { walletOf } from '../src/services/economy.js';
import { cfg, makeDb, ROLE } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });

it('Discordの手動ロール更新から招待報酬を2段階で払い、DMと運営へ1回ずつ知らせる', async () => {
  const inviter = '870000000000000091';
  const invited = '870000000000000092';
  await recordJoin(db, { id: inviter, username: 'inviter', displayName: '招待した人', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
  await recordInvite(db, invited, inviter);
  const dm = vi.fn(async () => undefined);
  const send = vi.fn(async () => ({ id: 'message' }));
  const client = { users: { fetch: async () => ({ send: dm }) }, channels: { fetch: async () => ({ isSendable: () => true, send }) } };
  const app = new ShuinApp(client as never, db, cfg);
  const roles = new Map([[ROLE.sanpaisha as string, {}]]);
  const member = { id: invited, guild: { id: cfg.guildId }, user: { username: 'invited', bot: false }, displayName: '招待された人', displayAvatarURL: () => '', roles: { cache: roles } };
  await app.onMemberUpdate(member as never);
  expect((await walletOf(db, inviter)).balance).toBe(150);
  roles.clear(); roles.set(ROLE.ujiko, {});
  await app.onMemberUpdate(member as never);
  await app.onMemberUpdate(member as never);
  roles.clear(); await app.onMemberUpdate(member as never);
  roles.set(ROLE.ujiko, {}); await app.onMemberUpdate(member as never);
  expect((await walletOf(db, inviter)).balance).toBe(500);
  expect(dm).toHaveBeenCalledTimes(2); expect(send).toHaveBeenCalledTimes(2);
  expect(dm).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('氏子になったため、招待報酬350銭'), allowedMentions: { parse: [] } }));
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining(inviter), allowedMentions: { parse: [] } }));
});

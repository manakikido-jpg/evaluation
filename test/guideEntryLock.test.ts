import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { guideReceptions, settings } from '../src/db/schema.js';
import { GuideEntryLocks } from '../src/discord/guideEntryLock.js';
import { assignGuide, completeGuide, guideConfigSchema, moveGuideReception, openGuideReception, registerGuide, setGuideStatus } from '../src/services/guideReception.js';
import { recordJoin } from '../src/services/members.js';
import { cfg, makeDb } from './helpers.js';
const G = '870000000000000001', V = '870000000000000003', VC = '870000000000000004', ROLE = '870000000000000006';
const OTHER = '870000000000000009', MEMBER = '870000000000000010', STAFF = '870000000000000011', OTHER_VC = '870000000000000012';
const now = new Date('2026-11-26T01:00:00Z');
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const id of [G, V]) await recordJoin(db, { id, username: id, displayName: id, avatarUrl: null, roleIds: [], isBot: false, joinedAt: now });
  await registerGuide(db, G); await setGuideStatus(db, G, 'active', 'staff');
});
afterEach(async () => { await close(); });
type Rule = { id: string; type: 0 | 1; allow: PermissionsBitField; deny: PermissionsBitField };
const rule = (id: string, type: 0 | 1, allow: bigint[] = [], deny: bigint[] = []): Rule => ({ id, type, allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) });
const P = PermissionFlagsBits;
function fixture() {
  const server = new Collection<string, Rule>([
    [cfg.guildId, rule(cfg.guildId, 0, [P.ViewChannel])],
    [MEMBER, rule(MEMBER, 0, [P.Connect, P.Speak])],
    [OTHER, rule(OTHER, 1, [P.Connect, P.SendMessages])],
  ]);
  const clone = (o: Rule) => rule(o.id, o.type, [...o.allow.toArray()].map(x => P[x]), [...o.deny.toArray()].map(x => P[x]));
  const member = (id: string, roles: string[]) => ({ id, roles: { cache: new Collection(roles.map(r => [r, { id: r }])) } });
  const people = new Collection([[G, member(G, [ROLE])], [V, member(V, [MEMBER])], [OTHER, member(OTHER, [MEMBER])]]);
  const connected = new Collection([[G, people.get(G)!], [V, people.get(V)!]]);
  const edit = vi.fn(async (id: string, patch: { Connect: boolean | null }, options: { type: 0 | 1 }) => {
    const r = server.get(id) ?? rule(id, options.type);
    r.allow.remove(P.Connect); r.deny.remove(P.Connect);
    if (patch.Connect === true) r.allow.add(P.Connect);
    if (patch.Connect === false) r.deny.add(P.Connect);
    server.set(id, r);
    // discord.js と同じく、REST完了だけでは古いチャンネルキャッシュを更新しない。
  });
  const del = vi.fn(async (id: string) => { server.delete(id); });
  const channel = () => ({ id: VC, type: 2, members: connected, permissionOverwrites: { cache: new Collection([...server].map(([id, o]) => [id, clone(o)])), edit, delete: del } });
  const guild = { id: cfg.guildId, channels: { cache: new Collection([[VC, channel()]]), fetch: vi.fn(async () => channel()) }, members: { cache: people, me: null } };
  const config = { ...guideConfigSchema.parse({ voiceChannelIds: [VC], roleId: ROLE }), guideRoleIds: [ROLE] };
  const configGetter = () => ({ ...cfg, admin: { gujiRoleIds: [STAFF], shinshokuRoleIds: [] } });
  const locks = new GuideEntryLocks(db, configGetter);
  // Discordの優先順：everyone → ロールの拒否/許可を集約 → 個人の拒否/許可。
  const canConnect = (id: string, roles: string[]) => {
    const bit = P.Connect;
    let bits = bit;
    const base = server.get(cfg.guildId); if (base) bits = (bits & ~base.deny.bitfield) | base.allow.bitfield;
    let allow = 0n, deny = 0n;
    for (const roleId of roles) { const o = server.get(roleId); if (o) { allow |= o.allow.bitfield; deny |= o.deny.bitfield; } }
    bits = (bits & ~deny) | allow;
    const personal = server.get(id); if (personal?.type === 1) bits = (bits & ~personal.deny.bitfield) | personal.allow.bitfield;
    return (bits & bit) !== 0n;
  };
  return { server, guild, config, locks, edit, del, connected, canConnect, configGetter };
}
async function assigned() {
  const r = (await openGuideReception(db, V, VC, now))!;
  await assignGuide(db, r.id, G); return r;
}

describe('案内中の入室停止と復元', () => {
  it('一般のロール・個人の許可も止め、案内人・運営・現在の参加者は接続できる', async () => {
    await assigned(); const f = fixture();
    expect(await f.locks.sync(f.guild as never, f.config)).toEqual(new Set());
    expect(f.canConnect(OTHER, [MEMBER])).toBe(false);
    expect(f.canConnect('new', [MEMBER])).toBe(false);
    expect(f.canConnect(G, [ROLE])).toBe(true); expect(f.canConnect(V, [MEMBER])).toBe(true);
    expect(f.canConnect('guide2', [ROLE])).toBe(true); expect(f.canConnect('staff', [STAFF])).toBe(true);
    expect(f.server.get(cfg.guildId)!.allow.has(P.ViewChannel)).toBe(true);
    expect(f.server.get(MEMBER)!.allow.has(P.Speak)).toBe(true);
    expect(f.server.get(OTHER)!.allow.has(P.SendMessages)).toBe(true);
    const patches = f.edit.mock.calls.map(c => c[1].Connect);
    const firstDeny = patches.indexOf(false);
    expect(firstDeny).toBeGreaterThan(0);
    expect(patches.slice(firstDeny)).not.toContain(true);
    const calls = f.edit.mock.calls.length;
    await f.locks.sync(f.guild as never, f.config); expect(f.edit).toHaveBeenCalledTimes(calls);
  });
  it('完了後は元のConnectだけを復元し、新設した空の上書きも片付ける。再起動・古いキャッシュでも復元できる', async () => {
    const r = await assigned(); const f = fixture();
    const original = [...f.server].map(([id, o]) => [id, o.allow.bitfield, o.deny.bitfield]);
    await f.locks.sync(f.guild as never, f.config);
    await completeGuide(db, r.id, G, now);
    await new GuideEntryLocks(db, f.configGetter).sync(f.guild as never, f.config);
    expect([...f.server].map(([id, o]) => [id, o.allow.bitfield, o.deny.bitfield])).toEqual(original);
    expect((await db.select().from(settings).where(eq(settings.key, 'guide.entry_locks')))[0]!.value).toEqual({});
  });
  it('退出・設定解除でも復元し、別の案内が同室で続いていれば閉じたままにする', async () => {
    await assigned(); const f = fixture();
    await f.locks.sync(f.guild as never, f.config);
    f.connected.delete(G);
    await f.locks.sync(f.guild as never, f.config); expect(f.canConnect(OTHER, [MEMBER])).toBe(true);
    f.connected.set(G, f.guild.members.cache.get(G)!);
    await f.locks.sync(f.guild as never, f.config); expect(f.canConnect(OTHER, [MEMBER])).toBe(false);
    await f.locks.sync(f.guild as never, { ...f.config, voiceChannelIds: [] }); expect(f.canConnect(OTHER, [MEMBER])).toBe(true);
  });
  it('権限編集失敗は記録を残して再試行する。復元の失敗でも元の値を失わない', async () => {
    await assigned(); const f = fixture(); f.edit.mockRejectedValueOnce(new Error('Missing Permissions'));
    expect(await f.locks.sync(f.guild as never, f.config)).toEqual(new Set([VC]));
    expect((await db.select().from(settings).where(eq(settings.key, 'guide.entry_locks')))[0]!.value).toHaveProperty(VC);
    await f.locks.sync(f.guild as never, f.config); expect(f.canConnect(OTHER, [MEMBER])).toBe(false);
    f.connected.clear(); f.edit.mockRejectedValueOnce(new Error('restore failed'));
    expect(await f.locks.sync(f.guild as never, f.config)).toEqual(new Set([VC]));
    await new GuideEntryLocks(db, f.configGetter).sync(f.guild as never, f.config);
    expect(f.canConnect(OTHER, [MEMBER])).toBe(true);
  });
  it('復元中に追加された別の権限を消さず、運営が変更したConnectも尊重する', async () => {
    await assigned(); const f = fixture(); await f.locks.sync(f.guild as never, f.config);
    f.server.get(V)!.allow.add(P.Speak);
    f.server.get(OTHER)!.deny.remove(P.Connect); // 運営が中立へ変更
    f.connected.clear(); await f.locks.sync(f.guild as never, f.config);
    expect(f.server.get(V)!.allow.has(P.Speak)).toBe(true); expect(f.server.get(V)!.allow.has(P.Connect)).toBe(false);
    expect(f.server.get(OTHER)!.deny.has(P.Connect)).toBe(false);
  });
  it('移動先だけを制限し、移動元を元に戻す', async () => {
    await assigned(); const first = fixture(), second = fixture();
    await first.locks.sync(first.guild as never, first.config);
    await moveGuideReception(db, V, VC, OTHER_VC);
    const fetchFirst = first.guild.channels.fetch.getMockImplementation()!;
    first.guild.channels.fetch.mockImplementation(async (id?: string) => id === OTHER_VC ? second.guild.channels.fetch() : fetchFirst());
    await first.locks.sync(first.guild as never, { ...first.config, voiceChannelIds: [VC, OTHER_VC] });
    expect(first.canConnect(OTHER, [MEMBER])).toBe(true);
    expect(second.canConnect(OTHER, [MEMBER])).toBe(false);
    expect(second.canConnect(V, [MEMBER])).toBe(true);
  });
  it('参加者が退出して許可から拒否へ切り替える途中で失敗しても、元の中立へ復元する', async () => {
    await assigned(); const f = fixture(); const extra = '870000000000000050';
    f.connected.set(extra, { id: extra, roles: { cache: new Collection() } });
    await f.locks.sync(f.guild as never, f.config);
    f.connected.delete(extra); f.edit.mockRejectedValueOnce(new Error('timeout'));
    expect(await f.locks.sync(f.guild as never, f.config)).toEqual(new Set([VC]));
    f.connected.clear(); await f.locks.sync(f.guild as never, f.config);
    expect(f.server.has(extra)).toBe(false);
  });
  it('同時の同期は直列化し、元の値を制限後の値で上書きしない', async () => {
    await assigned(); const f = fixture();
    await Promise.all([f.locks.sync(f.guild as never, f.config), f.locks.sync(f.guild as never, f.config)]);
    await db.update(guideReceptions).set({ status: 'done' });
    await f.locks.sync(f.guild as never, f.config); expect(f.canConnect(OTHER, [MEMBER])).toBe(true);
  });
});

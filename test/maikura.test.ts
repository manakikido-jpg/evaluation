import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, PermissionsBitField, PermissionFlagsBits, type Interaction } from 'discord.js';
import { MaikuraApp, maikuraPanel } from '../src/discord/maikura.js';
import { auditLogs, settings } from '../src/db/schema.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const roleId = '800000000000000001';
function harness(panel = false, staff = false) {
  const role = { id: roleId, name: '舞倉', managed: false, editable: true, permissions: new PermissionsBitField() };
  const roles = new Collection([[roleId, role]]);
  const owned = new Collection<string, unknown>(staff ? [[ROLE.shinshoku, {}]] : []);
  const add = vi.fn(async (id: string) => { owned.set(id, roles.get(id)); });
  const member = { user: { bot: false }, roles: { cache: owned, add } };
  const create = vi.fn(async () => { roles.set(roleId, role); return role; });
  const send = vi.fn(async () => ({}));
  const interaction = {
    isChatInputCommand: () => panel, isButton: () => !panel, inCachedGuild: () => true,
    commandName: 'panel', options: { getSubcommand: () => 'maikura' }, customId: 'maikura:join', guildId: cfg.guildId,
    user: { id: '700000000000000001' },
    guild: { members: { fetch: vi.fn(async () => member), fetchMe: vi.fn(async () => ({})) }, roles: { fetch: vi.fn(async () => roles), create } },
    channel: { id: '700000000000000002', isSendable: () => true, send },
    deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined),
  };
  return { i: interaction as unknown as Interaction, interaction, roles, role, owned, add, create, send };
}

describe('舞倉の参加パネル', () => {
  let env: Awaited<ReturnType<typeof makeDb>>;
  beforeEach(async () => { env = await makeDb(); });
  afterEach(async () => { await env.close(); });
  it('運営がPOPを置くと、権限なしの舞倉ロールを用意して記録する', async () => {
    const h = harness(true, true); h.roles.clear();
    await new MaikuraApp(env.db, () => cfg).onInteraction(h.i);
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ name: '舞倉', permissions: 0n, mentionable: false }));
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ content: '**舞倉に参加したい方はこちらへ**' }));
    expect((await env.db.select().from(settings).where(eq(settings.key, 'maikura_role')))[0]!.value).toEqual({ roleId });
    expect((await env.db.select().from(auditLogs))[0]!.action).toBe('maikura.panel');
    await new MaikuraApp(env.db, () => cfg).onInteraction(h.i);
    expect(h.create).toHaveBeenCalledTimes(1);
  });
  it('普通のメンバーはパネルを置けない', async () => {
    const h = harness(true); h.roles.clear();
    await new MaikuraApp(env.db, () => cfg).onInteraction(h.i);
    expect(h.send).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
    expect(h.interaction.editReply).toHaveBeenCalledWith('神職・宮司のみ置けます。');
  });
  it('本人にだけ付け、同時に押しても一回だけ付与して記録する', async () => {
    const h = harness(); const app = new MaikuraApp(env.db, () => cfg);
    await Promise.all([app.onInteraction(h.i), app.onInteraction(h.i)]);
    expect(h.add).toHaveBeenCalledTimes(1); expect(h.add.mock.calls[0]![0]).toBe(roleId);
    const logs = await env.db.select().from(auditLogs);
    expect(logs).toHaveLength(1); expect(logs[0]).toMatchObject({ action: 'maikura.join', actorId: h.interaction.user.id, targetId: h.interaction.user.id });
    expect(h.owned.has(roleId)).toBe(true);
    expect(h.interaction.editReply).toHaveBeenCalledWith('「舞倉」ロールはすでに付いています。');
  });
  it.each(['運営権限', '管理対象', '上下関係', '同名重複', '役職', '機能用'])('%sのロールを本人に付けない', async kind => {
    const h = harness();
    if (kind === '運営権限') h.role.permissions.add(PermissionFlagsBits.Administrator);
    if (kind === '管理対象') h.role.managed = true;
    if (kind === '上下関係') h.role.editable = false;
    if (kind === '同名重複') h.roles.set('800000000000000002', { ...h.role, id: '800000000000000002' });
    if (kind === '役職' || kind === '機能用') {
      h.roles.clear(); h.role.id = kind === '役職' ? ROLE.sanpaisha : ROLE.yakudoshi; h.roles.set(h.role.id, h.role);
    }
    await new MaikuraApp(env.db, () => cfg).onInteraction(h.i);
    expect(h.add).not.toHaveBeenCalled(); expect(await env.db.select().from(auditLogs)).toHaveLength(0);
  });
  it('ロールがないときは本人のボタンで作らない', async () => {
    const h = harness(); h.roles.clear();
    await new MaikuraApp(env.db, () => cfg).onInteraction(h.i);
    expect(h.create).not.toHaveBeenCalled(); expect(h.add).not.toHaveBeenCalled();
    expect(h.interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('/パネル 舞倉'));
  });
  it('付与に失敗したら成功や内部エラーを表示しない', async () => {
    const h = harness(); h.add.mockRejectedValueOnce(new Error('内部SQLの詳細'));
    await new MaikuraApp(env.db, () => cfg).onInteraction(h.i);
    expect(await env.db.select().from(auditLogs)).toHaveLength(0);
    expect(h.interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('BOTの権限'));
  });
  it('APIの返事のあともロールを確認できなければ成功を記録しない', async () => {
    const h = harness(); h.add.mockImplementationOnce(async () => undefined);
    await new MaikuraApp(env.db, () => cfg).onInteraction(h.i);
    expect(await env.db.select().from(auditLogs)).toHaveLength(0);
    expect(h.interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('ロールを確認できませんでした'));
  });
  it('別のサーバーの操作は受け付けない', async () => {
    const h = harness(); h.interaction.guildId = '800000000000000009';
    await new MaikuraApp(env.db, () => cfg).onInteraction(h.i);
    expect(h.interaction.deferReply).not.toHaveBeenCalled(); expect(h.add).not.toHaveBeenCalled();
  });
  it('POPの下に参加ボタンがあり、メンションを送らない', () => {
    const panel = maikuraPanel();
    expect(panel.embeds[0]!.image.url).toBe('attachment://maikura-pop.png');
    expect(panel.components[0]!.components[0]).toMatchObject({ custom_id: 'maikura:join', label: '舞倉に参加する' });
    expect(panel.allowedMentions.parse).toEqual([]);
  });
});

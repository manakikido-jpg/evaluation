import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, type Guild } from 'discord.js';
import type { Db } from '../src/db/client.js';
import { GuideReceptionApp } from '../src/discord/guideReception.js';
import { GuideWaitingNames } from '../src/discord/guideWaitingName.js';
import { guideConfigSchema, saveGuideConfig, registerGuide, setGuideStatus, setGuideWaiting } from '../src/services/guideReception.js';
import { recordJoin } from '../src/services/members.js';
import { cfg, makeDb } from './helpers.js';
const A = '870000000000000001', B = '870000000000000002', VC = '870000000000000004', ROLE = '870000000000000006';
const config = guideConfigSchema.parse({ voiceChannelIds: [VC], roleId: ROLE });
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const id of [A, B]) {
    await recordJoin(db, { id, username: id, displayName: id, avatarUrl: null, roleIds: [], isBot: false, joinedAt: new Date() });
    await registerGuide(db, id);
    await setGuideStatus(db, id, 'active', 'staff');
  }
});
afterEach(async () => { vi.restoreAllMocks(); await close(); });
function fixture(name = '案内所') {
  const ch = { type: 2, name, members: new Collection(), setName: vi.fn(async (next: string) => { ch.name = next; }) };
  const people = new Map([A, B].map(id => [id, { user: { bot: false }, roles: { cache: new Collection([[ROLE, {}]]) }, presence: { status: 'online' } }]));
  const guild = { id: cfg.guildId, roles: { cache: new Collection([[ROLE, { id: ROLE, name: '案内人' }]]) }, channels: { cache: new Map([[VC, ch]]) }, members: { fetch: vi.fn(async ({ user }: { user: string }) => people.get(user)) } } as unknown as Guild;
  return { ch, people, guild, names: new GuideWaitingNames(db) };
}
describe('案内所の待機表示', () => {
  it('実際の待機ボタンで表示し、毎分処理で承認停止を反映する', async () => {
    const { ch, guild } = fixture();
    await saveGuideConfig(db, config, A);
    const app = new GuideReceptionApp(db, () => cfg, {} as never);
    const interaction = { isButton: () => true, inCachedGuild: () => true, customId: 'guide:wait', guildId: cfg.guildId, guild, user: { id: A }, deferReply: vi.fn(), editReply: vi.fn() };
    await app.onInteraction(interaction as never);
    expect(ch.name).toBe('案内所（入室⭕）');
    await setGuideStatus(db, A, 'paused', 'staff');
    await app.tick(guild);
    expect(ch.name).toBe('案内所');
  });
  it('待機中だけ表示し、最後の案内人の停止で元へ戻す。毎分の同期では連打しない', async () => {
    const { ch, guild, names } = fixture();
    await names.sync(guild, config, 1000);
    expect(ch.setName).not.toHaveBeenCalled();
    await setGuideWaiting(db, A, true);
    await names.sync(guild, config, 2000);
    expect(ch.name).toBe('案内所（入室⭕）');
    await setGuideWaiting(db, B, true);
    await setGuideWaiting(db, A, false);
    await names.sync(guild, config, 3000);
    expect(ch.setName).toHaveBeenCalledTimes(1);
    await setGuideWaiting(db, B, false);
    await names.sync(guild, config, 4000);
    expect(ch.name).toBe('案内所');
    expect(ch.setName).toHaveBeenCalledTimes(2);
  });
  it('再起動後も元名を覚え、設定から外したVCを復元する', async () => {
    const { ch, guild, names } = fixture('🌸 案内所・一');
    await setGuideWaiting(db, A, true);
    await names.sync(guild, config, 1000);
    await new GuideWaitingNames(db).sync(guild, { ...config, voiceChannelIds: [] }, 2000);
    expect(ch.name).toBe('🌸 案内所・一');
  });
  it('再起動を挟む連打も2回/10分に抑え、待った後に最新状態を表示する', async () => {
    const { ch, guild, names } = fixture();
    await setGuideWaiting(db, A, true); await names.sync(guild, config, 1000);
    await setGuideWaiting(db, A, false); await names.sync(guild, config, 2000);
    await setGuideWaiting(db, A, true); await new GuideWaitingNames(db).sync(guild, config, 3000);
    expect(ch.name).toBe('案内所');
    await new GuideWaitingNames(db).sync(guild, config, 602001);
    expect(ch.name).toBe('案内所（入室⭕）');
  });
  it('権限エラーを連打せず、後で再試行して元の名前も戻せる', async () => {
    const { ch, guild, names } = fixture();
    ch.setName.mockRejectedValueOnce(new Error('Missing Permissions'));
    await setGuideWaiting(db, A, true); await names.sync(guild, config, 1000);
    await names.sync(guild, config, 61000);
    expect(ch.name).toBe('案内所（入室⭕）');
    await setGuideWaiting(db, A, false); await names.sync(guild, config, 62000);
    expect(ch.setName).toHaveBeenCalledTimes(2);
    await names.sync(guild, config, 602001);
    expect(ch.name).toBe('案内所');
  });
  it('承認停止・ロール剥奪・退会・BOTは待機に数えない', async () => {
    const { ch, guild, people, names } = fixture();
    await setGuideWaiting(db, A, true); people.get(A)!.roles.cache.clear();
    await names.sync(guild, config, 1000); expect(ch.setName).not.toHaveBeenCalled();
    await setGuideWaiting(db, B, true); people.get(B)!.user.bot = true;
    await names.sync(guild, config, 2000); expect(ch.setName).not.toHaveBeenCalled();
    people.delete(A); people.get(B)!.user.bot = false;
    await setGuideStatus(db, B, 'paused', 'staff');
    await names.sync(guild, config, 3000); expect(ch.setName).not.toHaveBeenCalled();
  });
  it('Presenceを使うときはオフラインで表示せず、使わないときは待機設定に従う', async () => {
    const { ch, guild, people } = fixture();
    await setGuideWaiting(db, A, true); people.get(A)!.presence.status = 'offline';
    await new GuideWaitingNames(db, true).sync(guild, config, 1000);
    expect(ch.setName).not.toHaveBeenCalled();
    await new GuideWaitingNames(db, false).sync(guild, config, 2000);
    expect(ch.name).toBe('案内所（入室⭕）');
  });
  it('手動変更の名前を尊重し、案内担当や別チャンネルは変えない', async () => {
    const { ch, guild, names } = fixture();
    await setGuideWaiting(db, A, true); await names.sync(guild, config, 1000);
    ch.name = '新しい案内所';
    await setGuideWaiting(db, A, false); await names.sync(guild, config, 2000);
    expect(ch.name).toBe('新しい案内所');
    await setGuideWaiting(db, A, true); await names.sync(guild, { ...config, dutyChannelId: VC }, 3000);
    expect(ch.setName).toHaveBeenCalledTimes(1);
  });
  it('同時同期でも送信は一度で、長い元名も復元できる', async () => {
    const original = 'あ'.repeat(100);
    const { ch, guild, names } = fixture(original);
    await setGuideWaiting(db, A, true);
    await Promise.all([names.sync(guild, config, 1000), names.sync(guild, config, 1000)]);
    expect(ch.name.length).toBe(100); expect(ch.setName).toHaveBeenCalledTimes(1);
    await setGuideWaiting(db, A, false); await names.sync(guild, config, 2000);
    expect(ch.name).toBe(original);
  });
});

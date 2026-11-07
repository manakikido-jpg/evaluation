import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, type Guild } from 'discord.js';
import type { Db } from '../src/db/client.js';
import { GuideReceptionApp } from '../src/discord/guideReception.js';
import { GuideWaitingNames } from '../src/discord/guideWaitingName.js';
import { guideConfigSchema, saveGuideConfig, registerGuide, setGuideDuty, setGuideStatus, setGuideWaiting } from '../src/services/guideReception.js';
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
  const people = new Map([A, B].map(id => [id, { id, displayName: id, voice: { channelId: null as string | null }, user: { bot: false }, roles: { cache: new Collection([[ROLE, {}]]) }, presence: { status: 'online' } }]));
  const guild = { id: cfg.guildId, roles: { cache: new Collection([[ROLE, { id: ROLE, name: '案内人' }]]) }, channels: { cache: new Map([[VC, ch]]) }, members: { cache: new Collection(people), fetch: vi.fn(async ({ user }: { user: string }) => people.get(user)) } } as unknown as Guild;
  return { ch, people, guild, names: new GuideWaitingNames(db) };
}
describe('案内所の待機表示', () => {
  it('すでに担当中のボタンを再度押しても、待機とは独立して表示を同期する', async () => {
    const { ch, guild } = fixture(); await saveGuideConfig(db, config, A); await setGuideDuty(db, A, true, A);
    const app = new GuideReceptionApp(db, () => cfg, {} as never);
    const i = { isButton: () => true, inCachedGuild: () => true, customId: 'guide:duty', guildId: cfg.guildId, guild, user: { id: A }, deferReply: vi.fn(), editReply: vi.fn() };
    await app.onInteraction(i as never);
    expect(i.editReply).toHaveBeenCalledWith('もう案内担当になっています。');
    expect(ch.name).toBe('案内所（入室⭕）');
  });
  it('1人の取得に失敗しても、ほかに確認できた担当者がいれば入室可にする', async () => {
    const { ch, guild, people, names } = fixture(); await setGuideDuty(db, A, true, A); await setGuideDuty(db, B, true, B); await setGuideDuty(db, A, true, A);
    const fetch = vi.spyOn(guild.members, 'fetch').mockImplementation(async ({ user }: any) => {
      if (user === A) throw new Error('timeout');
      return people.get(user) as never;
    });
    await names.sync(guild, config, 1000);
    expect(ch.name).toBe('案内所（入室⭕）'); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('待機中の案内人だけでは入室⭕にしない（案内担当がいるときだけ）', async () => {
    const { ch, guild, names } = fixture('案内所（入室⭕）'); await setGuideWaiting(db, A, true);
    await names.sync(guild, config, 1000);
    expect(ch.name).toBe('案内所（案内人不在）');
  });

  it('待機を押していない案内担当でも入室可とし、終了したら不在に戻す', async () => {
    const { ch, guild, names } = fixture();
    await setGuideDuty(db, A, true, A);
    await names.sync(guild, config, 1000);
    expect(ch.name).toBe('案内所（入室⭕）');
    await setGuideDuty(db, A, false, A);
    await names.sync(guild, config, 2000);
    expect(ch.name).toBe('案内所（案内人不在）');
  });
  it('案内担当ボタンの開始/終了で同期する。DBの待機設定や承認とは分ける', async () => {
    const { ch, guild } = fixture(); await saveGuideConfig(db, config, A);
    await setGuideStatus(db, A, 'paused', A);
    const app = new GuideReceptionApp(db, () => cfg, {} as never);
    const interaction = (action: string) => ({ isButton: () => true, inCachedGuild: () => true, customId: `guide:${action}`, guildId: cfg.guildId, guild, user: { id: A }, deferReply: vi.fn(), editReply: vi.fn() });
    await app.onInteraction(interaction('duty') as never);
    expect(ch.name).toBe('案内所（入室⭕）');
    await app.onInteraction(interaction('dutyoff') as never);
    expect(ch.name).toBe('案内所（案内人不在）');
  });
  it('担当が終わったら、待機中の人が残っていても不在にする', async () => {
    const { ch, guild, names } = fixture();
    await setGuideDuty(db, A, true, A); await setGuideWaiting(db, B, true);
    await names.sync(guild, config, 1000);
    expect(ch.name).toBe('案内所（入室⭕）');
    await setGuideDuty(db, A, false, A); await names.sync(guild, config, 2000);
    expect(ch.name).toBe('案内所（案内人不在）');
  });
  it('再起動後の担当中や、オフライン表示での明示的な担当を見失わない', async () => {
    const { ch, guild, people } = fixture(); people.get(A)!.presence.status = 'offline';
    await setGuideDuty(db, A, true, A);
    await new GuideWaitingNames(db, true).sync(guild, config, 1000);
    expect(ch.name).toBe('案内所（入室⭕）');
    await new GuideWaitingNames(db, true).sync(guild, config, 2000);
    expect(ch.setName).toHaveBeenCalledTimes(1);
  });
  it('VC接続中の担当者はオフライン表示でも在席と判定する', async () => {
    const { ch, guild, people } = fixture();
    await setGuideDuty(db, A, true, A); people.get(A)!.presence.status = 'offline'; people.get(A)!.voice.channelId = VC;
    await new GuideWaitingNames(db, true).sync(guild, config, 1000);
    expect(ch.name).toBe('案内所（入室⭕）');
  });
  it('取得失敗で不在へ変えず、回復した後に最新状態を反映する', async () => {
    const { ch, guild, names } = fixture(); await setGuideDuty(db, A, true, A);
    await names.sync(guild, config, 1000);
    vi.spyOn(guild.members, 'fetch').mockRejectedValueOnce(new Error('timeout'));
    await names.sync(guild, config, 2000);
    expect(ch.name).toBe('案内所（入室⭕）'); expect(ch.setName).toHaveBeenCalledTimes(1);
    await setGuideDuty(db, A, false, A); await names.sync(guild, config, 3000);
    expect(ch.name).toBe('案内所（案内人不在）');
  });
  it('担当がいても退会/ロール剥奪/BOTは除外し、確認できた不在を表示する', async () => {
    const { ch, guild, people, names } = fixture(); await setGuideDuty(db, A, true, A); await setGuideDuty(db, B, true, B);
    people.get(A)!.roles.cache.clear(); people.get(B)!.user.bot = true;
    await names.sync(guild, config, 1000); expect(ch.name).toBe('案内所（案内人不在）');
    people.get(B)!.user.bot = false; people.delete(B);
    vi.spyOn(guild.members, 'fetch').mockImplementation(async ({ user }: any) => {
      if (user === B) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
      return people.get(user) as never;
    });
    await names.sync(guild, config, 2000); expect(ch.setName).toHaveBeenCalledTimes(1);
  });

  it('最初から不在でも表示し、再起動で連打せず対象解除で元へ戻す', async () => {
    const { ch, guild, names } = fixture();
    await names.sync(guild, config, 1000);
    expect(ch.name).toBe('案内所（案内人不在）');
    await new GuideWaitingNames(db).sync(guild, config, 2000);
    expect(ch.setName).toHaveBeenCalledTimes(1);
    await new GuideWaitingNames(db).sync(guild, { ...config, voiceChannelIds: [] }, 3000);
    expect(ch.name).toBe('案内所');
  });
  it('既存の表示付き名でも待機と不在の表示を重ねない', async () => {
    const { ch, guild, names } = fixture('案内所（案内人不在）');
    await setGuideDuty(db, A, true, A); await names.sync(guild, config, 1000);
    expect(ch.name).toBe('案内所（入室⭕）');
    await setGuideDuty(db, A, false, A); await names.sync(guild, config, 2000);
    expect(ch.name).toBe('案内所（案内人不在）');
  });
  it('待機ボタンだけでは入室⭕にしない', async () => {
    const { ch, guild } = fixture();
    await saveGuideConfig(db, config, A);
    const app = new GuideReceptionApp(db, () => cfg, {} as never);
    const interaction = { isButton: () => true, inCachedGuild: () => true, customId: 'guide:wait', guildId: cfg.guildId, guild, user: { id: A }, deferReply: vi.fn(), editReply: vi.fn() };
    await app.onInteraction(interaction as never);
    expect(ch.name).toBe('案内所（案内人不在）');
  });
  it('最後の案内人の停止で不在表示に変える。毎分の同期では連打しない', async () => {
    const { ch, guild, names } = fixture();
    await setGuideDuty(db, A, true, A);
    await names.sync(guild, config, 2000);
    expect(ch.name).toBe('案内所（入室⭕）');
    await setGuideDuty(db, B, true, B);
    await setGuideDuty(db, A, false, A);
    await names.sync(guild, config, 3000);
    expect(ch.setName).toHaveBeenCalledTimes(1);
    await setGuideDuty(db, B, false, B);
    await names.sync(guild, config, 4000);
    expect(ch.name).toBe('案内所（案内人不在）');
    expect(ch.setName).toHaveBeenCalledTimes(2);
  });
  it('再起動後も元名を覚え、設定から外したVCを復元する', async () => {
    const { ch, guild, names } = fixture('🌸 案内所・一');
    await setGuideDuty(db, A, true, A);
    await names.sync(guild, config, 1000);
    await new GuideWaitingNames(db).sync(guild, { ...config, voiceChannelIds: [] }, 2000);
    expect(ch.name).toBe('🌸 案内所・一');
  });
  it('再起動を挟む連打も2回/10分に抑え、待った後に最新状態を表示する', async () => {
    const { ch, guild, names } = fixture();
    await setGuideDuty(db, A, true, A); await names.sync(guild, config, 1000);
    await setGuideDuty(db, A, false, A); await names.sync(guild, config, 2000);
    await setGuideDuty(db, A, true, A); await new GuideWaitingNames(db).sync(guild, config, 3000);
    expect(ch.name).toBe('案内所（案内人不在）');
    await new GuideWaitingNames(db).sync(guild, config, 602001);
    expect(ch.name).toBe('案内所（入室⭕）');
  });
  it('権限エラーを連打せず、後で再試行して元の名前も戻せる', async () => {
    const { ch, guild, names } = fixture();
    ch.setName.mockRejectedValueOnce(new Error('Missing Permissions'));
    await setGuideDuty(db, A, true, A); await names.sync(guild, config, 1000);
    await names.sync(guild, config, 61000);
    expect(ch.name).toBe('案内所（入室⭕）');
    await setGuideDuty(db, A, false, A); await names.sync(guild, config, 62000);
    expect(ch.setName).toHaveBeenCalledTimes(2);
    await names.sync(guild, config, 602001);
    expect(ch.name).toBe('案内所（案内人不在）');
  });
  it('ロール剥奪・退会・BOTは担当に数えない', async () => {
    const { ch, guild, people, names } = fixture();
    await setGuideDuty(db, A, true, A); people.get(A)!.roles.cache.clear();
    await names.sync(guild, config, 1000); expect(ch.name).toBe('案内所（案内人不在）');
    await setGuideDuty(db, B, true, B); people.get(B)!.user.bot = true;
    await names.sync(guild, config, 2000); expect(ch.name).toBe('案内所（案内人不在）');
  });
  it('担当中は、Presenceを使うときもオフライン表示で不在にしない', async () => {
    const { ch, guild, people } = fixture();
    await setGuideDuty(db, A, true, A); people.get(A)!.presence.status = 'offline';
    await new GuideWaitingNames(db, true).sync(guild, config, 1000);
    expect(ch.name).toBe('案内所（入室⭕）');
  });
  it('手動変更の名前を尊重し、案内担当や別チャンネルは変えない', async () => {
    const { ch, guild, names } = fixture();
    await setGuideDuty(db, A, true, A); await names.sync(guild, config, 1000);
    ch.name = '新しい案内所';
    await setGuideDuty(db, A, false, A); await names.sync(guild, config, 2000);
    expect(ch.name).toBe('新しい案内所（案内人不在）');
    await setGuideDuty(db, A, true, A); await names.sync(guild, { ...config, dutyChannelId: VC }, 3000);
    expect(ch.setName).toHaveBeenCalledTimes(2);
  });
  it('同時同期でも送信は一度で、長い元名も復元できる', async () => {
    const original = 'あ'.repeat(100);
    const { ch, guild, names } = fixture(original);
    await setGuideDuty(db, A, true, A);
    await Promise.all([names.sync(guild, config, 1000), names.sync(guild, config, 1000)]);
    expect(ch.name.length).toBe(100); expect(ch.setName).toHaveBeenCalledTimes(1);
    await names.sync(guild, { ...config, voiceChannelIds: [] }, 2000);
    expect(ch.name).toBe(original);
  });
  it('階級で案内人のロールが分かれても、担当・終了のボタンが使え、お知らせは案内人のロール全部に届く', async () => {
    const G1 = '870000000000000011', G2 = '870000000000000012', OTHER = '870000000000000013';
    const { ch, guild, people } = fixture();
    // 元の「案内人」ロールは外して、階級のロールだけにする（名前に「案内人」が入る G1 と、入らない G2）
    (guild.roles.cache as Collection<string, unknown>).set(G1, { id: G1, name: '案内人（一級）' }).set(G2, { id: G2, name: '見習い' }).set(OTHER, { id: OTHER, name: '参拝者' });
    people.get(A)!.roles.cache = new Collection([[G1, {}]]);
    people.get(B)!.roles.cache = new Collection([[G2, {}]]);
    await saveGuideConfig(db, config, A);
    const send = vi.fn(async () => undefined);
    const app = new GuideReceptionApp(db, () => cfg, {} as never);
    const interaction = (user: string, action: string) => ({ isButton: () => true, inCachedGuild: () => true, customId: `guide:${action}`, guildId: cfg.guildId, guild, channel: { isSendable: () => true, send }, user: { id: user }, deferReply: vi.fn(), editReply: vi.fn() });
    const a = interaction(A, 'duty');
    await app.onInteraction(a as never);
    expect(a.editReply).toHaveBeenCalledWith(expect.stringContaining('案内担当をはじめました'));
    expect(ch.name).toBe('案内所（入室⭕）');
    const notice = (send.mock.calls[0] as unknown as [{ content: string; allowedMentions: { roles: string[] } }])[0];
    expect(notice.allowedMentions.roles).toEqual([ROLE, G1]);
    expect(notice.content).toContain(`<@&${G1}>`);
    // 名前に「案内人」がない階級ロールは、社務所Web で足すまでは案内人ではない
    const b = interaction(B, 'duty');
    await app.onInteraction(b as never);
    expect(b.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('案内人ロールが必要です') }));
    await saveGuideConfig(db, { ...config, extraRoleIds: [G2] }, A);
    const b2 = interaction(B, 'duty');
    await app.onInteraction(b2 as never);
    expect(b2.editReply).toHaveBeenCalledWith(expect.stringContaining('案内担当をはじめました'));
    const end = interaction(A, 'dutyoff');
    await app.onInteraction(end as never);
    expect(end.editReply).toHaveBeenCalledWith('案内担当を終了しました。');
    await app.onInteraction(interaction(B, 'dutyoff') as never);
    expect(ch.name).toBe('案内所（案内人不在）');
  });
});

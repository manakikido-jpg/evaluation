import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { employeePayroll, guideEmployees, guideReceptions } from '../src/db/schema.js';
import { assignGuide, completeGuide, leaveGuideReception, loadGuideConfig, openGuideReception, parseGuideLinks, registerGuide, saveGuideConfig, setGuideStatus, setGuideWaiting } from '../src/services/guideReception.js';
import { GuideReceptionApp, guideVisitorPanel } from '../src/discord/guideReception.js';
import * as economy from '../src/services/economy.js';
import { recordJoin } from '../src/services/members.js';
import { makeDb, cfg } from './helpers.js';
const GUIDE = '870000000000000001', OTHER = '870000000000000002', VISITOR = '870000000000000003', VOICE = '870000000000000004', STAFF = '870000000000000005', ROLE = '870000000000000006';
const now = new Date('2026-10-09T03:00:00Z');
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const id of [GUIDE, OTHER, VISITOR]) await recordJoin(db, { id, username: id, displayName: id, avatarUrl: null, roleIds: [], isBot: false, joinedAt: now });
});
afterEach(async () => { vi.restoreAllMocks(); await close(); });
async function active(id = GUIDE) { await registerGuide(db, id); await setGuideStatus(db, id, 'active', 'staff'); }
async function reception(time = now) { return (await openGuideReception(db, VISITOR, VOICE, time))!; }

describe('案内の受付と給与', () => {
  it('貼り付けた案内文から複数リンクと見えない区切りを読み、不正な行を拒否する', () => {
    const text = '<:a_001:1557360345054715924> ⁠https://discord.com/channels/1553060517642240011/1553189423200473188\n<:a_006:1557360917057110046> https://discord.com/channels/1553060517642240011/1553189433052889238 ⁠https://discord.com/channels/1553060517642240011/1553487265525923971';
    expect(parseGuideLinks({ bulkLinks: text }).map(l => l.channelIds)).toEqual([['1553189423200473188'], ['1553189433052889238', '1553487265525923971']]);
    expect(() => parseGuideLinks({ bulkLinks: '不正な案内文' })).toThrow();
    expect(() => parseGuideLinks({ bulkLinks: Array(11).fill(text.split('\n')[0]).join('\n') })).toThrow();
    expect(() => parseGuideLinks({ bulkLinks: '<:a_001:1557360345054715924> https://example.com' })).toThrow();
  });
  it('初期150銭・7チャンネルのリンクを読み、保存時に不正な設定を拒否する', async () => {
    const c = await loadGuideConfig(db);
    expect(c.salary).toBe(150);
    expect(c.links.flatMap(l => l.channelIds)).toHaveLength(7);
    expect(parseGuideLinks({ emoji_0: '<:a_001:1557360345054715924>', links_0: 'https://discord.com/channels/1553060517642240011/1553189423200473188 <#1553189424697970738>' })[0]?.channelIds).toEqual(['1553189423200473188', '1553189424697970738']);
    expect(() => parseGuideLinks({ emoji_0: '不正', links_0: VOICE })).toThrow();
    await expect(saveGuideConfig(db, { ...c, salary: -1 }, GUIDE)).rejects.toThrow();
    await saveGuideConfig(db, { ...c, salary: 200, voiceChannelIds: [VOICE] }, GUIDE);
    expect((await loadGuideConfig(db)).salary).toBe(200);
  });
  it('申請の連打で承認が消えず、未承認・休止中は待機や担当にできない', async () => {
    await registerGuide(db, GUIDE);
    expect(await setGuideWaiting(db, GUIDE, true)).toBe(false);
    const r = await reception();
    expect(await assignGuide(db, r.id, GUIDE)).toBeUndefined();
    await setGuideStatus(db, GUIDE, 'active', 'staff');
    await registerGuide(db, GUIDE);
    expect(await setGuideWaiting(db, GUIDE, true)).toBe(true);
    await setGuideStatus(db, GUIDE, 'paused', 'staff');
    expect(await setGuideWaiting(db, GUIDE, true)).toBe(false);
    expect((await db.select().from(guideEmployees))[0]?.waiting).toBe(false);
  });
  it('同時入室・継続在室を重複受付せず、出入りの10分制限を守る', async () => {
    const rows = await Promise.all([reception(), reception()]);
    expect(rows.filter(Boolean)).toHaveLength(1);
    expect(await openGuideReception(db, VISITOR, VOICE, new Date(+now + 20 * 60_000))).toBeUndefined();
    await leaveGuideReception(db, VISITOR, now);
    expect(await openGuideReception(db, VISITOR, VOICE, new Date(+now + 9 * 60_000))).toBeUndefined();
    expect(await openGuideReception(db, VISITOR, VOICE, new Date(+now + 10 * 60_000))).toBeDefined();
  });
  it('担当は1人だけ。本人の自己案内・他人の完了・退出後の完了を拒否する', async () => {
    await active(); await active(OTHER); await active(VISITOR);
    const r = await reception();
    expect(await assignGuide(db, r.id, VISITOR)).toBeUndefined();
    const assigned = await Promise.all([assignGuide(db, r.id, GUIDE), assignGuide(db, r.id, OTHER)]);
    expect(assigned.filter(Boolean)).toHaveLength(1);
    const owner = assigned.find(Boolean)!.guideId!;
    expect(await completeGuide(db, r.id, owner === GUIDE ? OTHER : GUIDE, now)).toBeUndefined();
    await leaveGuideReception(db, VISITOR, now);
    expect(await completeGuide(db, r.id, owner, now)).toBeUndefined();
  });
  it('完了連打は150銭を1回。同じ利用者の日額制限を担当者間でも守り、翌日は支払う', async () => {
    await active(); await active(OTHER);
    let r = await reception(); await assignGuide(db, r.id, GUIDE);
    const results = await Promise.all([completeGuide(db, r.id, GUIDE, now), completeGuide(db, r.id, GUIDE, now)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await economy.walletOf(db, GUIDE)).balance).toBe(150);
    expect(await openGuideReception(db, VISITOR, VOICE, new Date(+now + 20 * 60_000))).toBeUndefined();
    await leaveGuideReception(db, VISITOR, now);
    r = await reception(new Date(+now + 20 * 60_000)); await assignGuide(db, r.id, OTHER);
    expect((await completeGuide(db, r.id, OTHER, now))?.amount).toBe(0);
    await leaveGuideReception(db, VISITOR, now);
    const next = new Date('2026-10-09T15:00:00Z');
    r = await reception(next); await assignGuide(db, r.id, OTHER);
    expect((await completeGuide(db, r.id, OTHER, next))?.amount).toBe(150);
    expect(await db.select().from(employeePayroll)).toHaveLength(2);
  });
  it('0銭で給与停止。発行失敗は完了・給与台帳ごと戻す', async () => {
    await active(); let r = await reception(); await assignGuide(db, r.id, GUIDE);
    const spy = vi.spyOn(economy, 'addCoins').mockRejectedValueOnce(new Error('発行失敗'));
    await expect(completeGuide(db, r.id, GUIDE, now)).rejects.toThrow('発行失敗');
    expect((await db.select().from(guideReceptions))[0]?.status).toBe('assigned');
    expect(await db.select().from(employeePayroll)).toHaveLength(0);
    spy.mockRestore();
    await saveGuideConfig(db, { ...(await loadGuideConfig(db)), salary: 0 }, GUIDE);
    expect((await completeGuide(db, r.id, GUIDE, now))?.amount).toBe(0);
    expect((await economy.walletOf(db, GUIDE)).balance).toBe(0);
  });
  it('通知失敗を再試行し、案内投稿を増やさず待機中の案内人だけへDMする', async () => {
    await active(); await active(OTHER); await setGuideWaiting(db, GUIDE, true);
    const config = { ...(await loadGuideConfig(db)), voiceChannelIds: [VOICE], staffChannelId: STAFF, roleId: ROLE };
    await saveGuideConfig(db, config, GUIDE);
    const visitor = { id: VISITOR, user: { bot: false }, roles: { cache: new Map() }, voice: { channelId: VOICE } };
    const guide = { id: GUIDE, user: { bot: false }, roles: { cache: new Map([[ROLE, {}]]) }, voice: { channelId: VOICE } };
    const guild = { id: cfg.guildId, roles: { cache: { filter: () => ({ size: 0 }) } }, channels: { cache: new Map([[VOICE, { type: 2, members: new Map([[VISITOR, visitor], [GUIDE, guide]]) }]]) }, members: { cache: new Map([[VISITOR, visitor], [GUIDE, guide]]), fetch: vi.fn(async () => guide) } };
    const discord = { sendMessage: vi.fn(async (ch: string) => { if (ch === STAFF && discord.sendMessage.mock.calls.filter(x => x[0] === STAFF).length === 1) throw new Error('通知失敗'); return { id: 'message' }; }), editMessage: vi.fn(), sendDm: vi.fn(async (_id: string, _text: string) => true) };
    const app = new GuideReceptionApp(db, () => cfg, discord as never);
    await app.tick(guild as never); await app.tick(guild as never); await app.tick(guild as never);
    expect(discord.sendMessage.mock.calls.filter(x => x[0] === VOICE)).toHaveLength(1);
    expect(discord.sendMessage.mock.calls.filter(x => x[0] === STAFF)).toHaveLength(2);
    expect(discord.sendDm).toHaveBeenCalledOnce();
    expect(discord.sendDm.mock.calls[0]?.[0]).toBe(GUIDE);
    expect((await db.select().from(guideReceptions))[0]?.notifiedAt).toBeTruthy();
  });
  it('部屋の案内は通知対象を限定し、退出時にはボタンを止める', async () => {
    const r = await reception();
    const panel = guideVisitorPanel(r, await loadGuideConfig(db));
    expect(panel.allowed_mentions).toEqual({ parse: [], users: [VISITOR] });
    expect(panel.content).toContain('<:a_006:1557360917057110046>');
    const [left] = await leaveGuideReception(db, VISITOR, now);
    expect(guideVisitorPanel(left!, await loadGuideConfig(db)).content).toContain('退出済み');
  });
});

describe('案内人の受付のパネルを、いつもいちばん下に', () => {
  it('出したチャンネルを覚え、書きこみがあれば少し待って下に出し直し、古いパネルを消す', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { addGuidePanelChannel, guidePanelChannels } = await import('../src/services/guideReception.js');
      const { isGuidePanel, guideEmployeePanel } = await import('../src/discord/guideReception.js');
      const CH = '870000000000000101', BOT = '870000000000000999';
      await addGuidePanelChannel(db, CH);
      await addGuidePanelChannel(db, CH);
      expect(await guidePanelChannels(db)).toEqual([CH]);
      const panelComponents = [{ components: [{ customId: 'guide:register' }] }];
      expect(isGuidePanel({ components: panelComponents } as never)).toBe(true);
      expect(isGuidePanel({ components: [] } as never)).toBe(false);
      const deleted = vi.fn(async () => undefined);
      const oldPanel = { author: { id: BOT }, components: panelComponents, delete: deleted };
      const talk = { author: { id: OTHER }, components: [] };
      const recent = new Map<string, unknown>([['2', talk], ['1', oldPanel]]);
      const send = vi.fn(async () => ({ id: 'new' }));
      const channel = { id: CH, isSendable: () => true, messages: { fetch: async () => Object.assign(recent, { first: () => talk }) } };
      const app = new GuideReceptionApp(db, () => cfg, { sendMessage: send } as never);
      const msg = { inGuild: () => true, guildId: cfg.guildId, channelId: CH, channel, author: { id: OTHER }, components: [], client: { user: { id: BOT } } };
      await app.onMessage(msg as never);
      expect(send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(3_100);
      expect(send).toHaveBeenCalledWith(CH, guideEmployeePanel());
      expect(deleted).toHaveBeenCalledOnce();
      // ほかのチャンネルでは何もしない
      send.mockClear();
      await app.onMessage({ ...msg, channelId: '870000000000000102' } as never);
      await vi.advanceTimersByTimeAsync(3_100);
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('案内完了で案内リンクのメッセージを消す', () => {
  it('「案内完了」を押すと、VC のチャットの案内メッセージを消す', async () => {
    await active();
    const r = await reception();
    await db.update(guideReceptions).set({ messageId: '870000000000000555', notifiedAt: now }).where(eq(guideReceptions.id, r.id));
    await assignGuide(db, r.id, GUIDE);
    const del = vi.fn(async () => undefined);
    const app = new GuideReceptionApp(db, () => cfg, { deleteMessage: del, editMessage: vi.fn(), sendMessage: vi.fn(async () => ({ id: 'x' })), sendDm: vi.fn(async () => true) } as never);
    await saveGuideConfig(db, { ...(await loadGuideConfig(db)), roleId: ROLE }, 'staff');
    const inVoice = { voice: { channelId: VOICE }, roles: { cache: new Map([[ROLE, {}]]) } };
    const i = {
      isButton: () => true, customId: `guide:done:${r.id}`, inCachedGuild: () => true, guildId: cfg.guildId, user: { id: GUIDE }, channelId: VOICE,
      message: { components: [] },
      guild: { members: { fetch: async () => inVoice }, roles: { cache: { filter: () => ({ size: 0 }) } } },
      deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined),
    };
    await app.onInteraction(i as never);
    expect(del).toHaveBeenCalledWith(VOICE, '870000000000000555');
    expect((await db.select().from(guideReceptions))[0]?.status).toBe('done');
  });
});

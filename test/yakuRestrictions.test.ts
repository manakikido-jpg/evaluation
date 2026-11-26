import { describe, expect, it, vi } from 'vitest';
import type { Guild, Interaction, VoiceState } from 'discord.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { ShopApp } from '../src/discord/shop.js';
import { YakuVoiceApp } from '../src/discord/yakuVoice.js';
import { replyYakuBlocked, yakuInteractionBlocked } from '../src/discord/yakuInteractionGate.js';
import { casinoAllowed } from '../src/web/casino.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { giveYaku } from '../src/services/moderation.js';
import { recordJoin } from '../src/services/members.js';
import { listItems, seedDefaultItems } from '../src/services/shop.js';
import { activeYakuCount, yakubaraiWaiting } from '../src/services/yaku.js';
import { isYakudoshi, yakuBlocks, YAKU_BLOCKED } from '../src/services/yakuGate.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const USER = '770000000000000010';
const STAFF = '770000000000000001';

describe('👹 厄の制限: どれを止めるか', () => {
  it('厄年ロールがあるかで見分ける', () => {
    expect(isYakudoshi(cfg, [ROLE.ujiko, ROLE.yakudoshi])).toBe(true);
    expect(isYakudoshi(cfg, [ROLE.ujiko])).toBe(false);
  });

  it('送金・市場・キャスト・カジノ・じゃんけん・贈る・お年玉・絵馬は止め、チケット・おみくじ・物御籤・授与所は通す', () => {
    for (const command of ['sokin', 'ichiba', 'cast', 'casino', 'shinpu', 'janken', 'present']) expect(yakuBlocks({ command })).toBe(true);
    for (const customId of ['sokin:ok:1', 'market:buy:1', 'cast:pick:1', 'otoshi:claim:3', 'koban:give:1', 'items:give:x', 'ema:give:1', 'ema:vote:1', 'lottery:enter', 'janken:pick'])
      expect(yakuBlocks({ customId })).toBe(true);
    for (const command of ['omikuji', 'gacha', 'soudan', 'menzaifu', 'shop', 'help', 'items', 'zandaka']) expect(yakuBlocks({ command })).toBe(false);
    for (const customId of ['ticket:open', 'omikuji:draw', 'gacha:draw', 'shop:open', 'menzaifu:buy', 'items:pick', 'ema:card:1'])
      expect(yakuBlocks({ customId })).toBe(false);
  });

  function inter(roleIds: string[], o: { customId?: string; command?: string }) {
    return {
      guildId: cfg.guildId, user: { id: USER, bot: false },
      member: { roles: { cache: new Map(roleIds.map((r) => [r, {}])) } },
      inCachedGuild: () => true,
      isChatInputCommand: () => Boolean(o.command), isAutocomplete: () => false, isRepliable: () => true,
      ...(o.command ? { commandName: o.command } : {}),
      ...(o.customId ? { customId: o.customId } : {}),
      reply: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('入口で止めて本人だけに案内する。運営と厄でない人は止めない', async () => {
    const i = inter([ROLE.ujiko, ROLE.yakudoshi], { command: 'sokin' });
    expect(yakuInteractionBlocked(cfg, i as unknown as Interaction)).toBe(true);
    await replyYakuBlocked(i as unknown as Interaction);
    expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: YAKU_BLOCKED }));
    expect(yakuInteractionBlocked(cfg, inter([ROLE.ujiko], { command: 'sokin' }) as unknown as Interaction)).toBe(false);
    expect(yakuInteractionBlocked(cfg, inter([ROLE.shinshoku, ROLE.yakudoshi], { command: 'sokin' }) as unknown as Interaction)).toBe(false);
    expect(yakuInteractionBlocked(cfg, inter([ROLE.ujiko, ROLE.yakudoshi], { command: 'omikuji' }) as unknown as Interaction)).toBe(false);
    expect(yakuInteractionBlocked(cfg, inter([ROLE.ujiko, ROLE.yakudoshi], { customId: 'otoshi:claim:1' }) as unknown as Interaction)).toBe(true);
  });

  it('カジノWeb には入れない', () => {
    expect(casinoAllowed(cfg, [ROLE.ujiko, ROLE.yakudoshi])).toBe(false);
  });
});

describe('👹 厄の制限: 通話は縁側だけ', () => {
  function state(channel: { id: string; name: string; members?: Map<string, unknown> } | null, roleIds: string[], calls: string[]) {
    const guild = { id: cfg.guildId, afkChannelId: 'afk', voiceStates: { cache: new Map() } } as unknown as Guild;
    return {
      guild, channelId: channel?.id ?? null, channel,
      member: { id: USER, user: { bot: false }, roles: { cache: new Map(roleIds.map((r) => [r, {}])) }, send: async () => void calls.push('dm') },
      disconnect: async () => void calls.push('disconnect'),
    } as unknown as VoiceState;
  }

  it('縁側でない通話に入ったら切って DM（10 分に 1 回まで）。縁側・奥の院・運営がいる通話・厄でない人はそのまま', async () => {
    const app = new YakuVoiceApp(() => cfg);
    const calls: string[] = [];
    const yaku = [ROLE.ujiko, ROLE.yakudoshi];
    expect(await app.check(state({ id: 'v1', name: '縁側1' }, yaku, calls))).toBe(false);
    expect(await app.check(state({ id: 'afk', name: '奥の院' }, yaku, calls))).toBe(false);
    expect(await app.check(state({ id: 'v2', name: '遊郭の部屋' }, [ROLE.ujiko], calls))).toBe(false);
    expect(calls).toEqual([]);
    expect(await app.check(state({ id: 'v2', name: '遊郭の部屋' }, yaku, calls), 0)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['disconnect', 'dm']);
    expect(await app.check(state({ id: 'v3', name: '宿' }, yaku, calls), 60_000)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['disconnect', 'dm', 'disconnect']);
    // 運営がいる通話（面接など）は切らない
    const staffIn = new Map([[STAFF, { id: STAFF, roles: { cache: new Map([[ROLE.shinshoku, {}]]) } }]]);
    expect(await app.check(state({ id: 'v4', name: '面接', members: staffIn }, yaku, calls), 120_000)).toBe(false);
  });
});

describe('👹 厄の制限: 授与所は厄祓いだけ', () => {
  function inter(customId: string, roleIds: string[], value?: string) {
    const i = {
      customId, guildId: cfg.guildId, user: { id: USER }, values: value ? [value] : [],
      member: { premiumSince: null, roles: { cache: new Map(roleIds.map((r) => [r, {}])) } },
      inCachedGuild: () => true, isButton: () => value === undefined, isStringSelectMenu: () => value !== undefined,
      isModalSubmit: () => false, isChatInputCommand: () => false, isUserSelectMenu: () => false,
      isChannelSelectMenu: () => false, isRepliable: () => true,
      deferred: false, replied: false,
      deferReply: vi.fn(async () => { i.deferred = true; }), deferUpdate: vi.fn(async () => { i.deferred = true; }),
      reply: vi.fn().mockResolvedValue(undefined), editReply: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined), showModal: vi.fn().mockResolvedValue(undefined),
    };
    return i;
  }

  it('ほかの品は選べず・受けられず、厄祓いは申し込める（面接待ち）', async () => {
    const { db, close } = await makeDb();
    const sent: string[] = [];
    const discord = { sendDm: async () => true, sendMessage: async (c: string) => { sent.push(c); return { id: '1' }; }, addRole: async () => undefined, removeRole: async () => undefined } as unknown as DiscordActions;
    await seedDefaultItems(db, { colors: [], titles: [] });
    await recordJoin(db, { id: USER, username: USER, displayName: USER, avatarUrl: null, roleIds: [ROLE.ujiko], isBot: false, joinedAt: null });
    expect((await giveYaku({ db, cfg, discord }, { id: STAFF, level: 'shinshoku', via: 'web' }, USER, '誹謗中傷', false)).status).toBe('warned');
    await addCoins(db, USER, cfg.economy.menzaifuPrice + 500, 'adjust');
    const shop = new ShopApp(db, () => cfg, discord);
    const items = await listItems(db);
    const omikuji = items.find((x) => x.kind === 'omikuji_extra')!;
    const harai = items.find((x) => x.kind === 'menzaifu')!;
    expect(harai.name).toBe('厄祓い');
    const yaku = [ROLE.ujiko, ROLE.yakudoshi];

    const pick = inter('shop:pick:fun', yaku, String(omikuji.id));
    await shop.onInteraction(pick as unknown as Interaction);
    expect(JSON.stringify(pick.update.mock.calls[0])).toContain('厄のあいだ');
    const buy = inter(`shop:buy:${omikuji.id}`, yaku);
    await shop.onInteraction(buy as unknown as Interaction);
    expect(JSON.stringify(buy.editReply.mock.calls[0])).toContain('厄のあいだ');
    const present = inter(`shop:present:${omikuji.id}`, yaku);
    await shop.onInteraction(present as unknown as Interaction);
    expect(present.reply).toHaveBeenCalledWith(expect.objectContaining({ content: YAKU_BLOCKED }));
    expect((await walletOf(db, USER)).balance).toBe(cfg.economy.menzaifuPrice + 500);

    const ok = inter(`shop:buy:${harai.id}`, yaku);
    await shop.onInteraction(ok as unknown as Interaction);
    expect(JSON.stringify(ok.editReply.mock.calls[0])).toContain('面接');
    expect((await walletOf(db, USER)).balance).toBe(500);
    expect(await activeYakuCount(db, USER)).toBe(1);
    expect(await yakubaraiWaiting(db, USER)).toBeTruthy();
    expect(sent).toContain(cfg.channels.log);
    await close();
  });
});

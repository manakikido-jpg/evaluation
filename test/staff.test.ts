import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { ShuinApp } from '../src/discord/app.js';
import { StaffApp } from '../src/discord/staff.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { recentActivity } from '../src/services/activity.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { recordJoin } from '../src/services/members.js';
import { activeYakuCount } from '../src/services/yaku.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const STAFF = '830000000000000001';
const USER = '830000000000000002';
const OTHER = '830000000000000003';

let db: Db;
let close: () => Promise<void>;
let calls: string[];
let staff: StaffApp;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  calls = [];
  const discord: DiscordActions = {
    addRole: async (_g, u, r) => void calls.push(`addRole ${u} ${r}`),
    removeRole: async (_g, u, r) => void calls.push(`removeRole ${u} ${r}`),
    sendDm: async (u) => (calls.push(`dm ${u}`), true),
    ban: async (_g, u) => void calls.push(`ban ${u}`),
    unban: async () => undefined,
    kick: async (_g, u) => void calls.push(`kick ${u}`),
    editMessage: async () => undefined,
    sendMessage: async () => ({ id: '0' }),
    deleteMessage: async () => undefined,
    guildChannels: async () => [],
    guildRoles: async () => [],
    editChannel: async () => undefined,
    setChannelOverwrite: async () => undefined,
    pinMessage: async () => undefined,
  };
  staff = new StaffApp({ channels: { fetch: async () => null } } as never, db, cfg, discord, 'https://shamusho.example.com');
  for (const [id, roles] of [
    [STAFF, [ROLE.shinshoku]],
    [USER, [ROLE.ujiko]],
    [OTHER, [ROLE.ujiko]],
  ] as const) {
    await recordJoin(db, { id, username: id, displayName: `n${id.slice(-1)}`, avatarUrl: null, roleIds: [...roles], isBot: false, joinedAt: null });
  }
});
afterEach(async () => {
  await close();
});

type Reply = { content?: string | null; components?: { components: { data: { custom_id?: string } }[] }[]; embeds?: unknown[] };

function member(id: string, roleIds: string[]) {
  return { id, roles: { cache: new Map(roleIds.map((r) => [r, {}])) } };
}

function command(userId: string, roleIds: string[], name: string, opts: { sub?: string; user?: string; strings?: Record<string, string> } = {}) {
  const replies: Reply[] = [];
  const i = {
    guildId: cfg.guildId,
    user: { id: userId },
    member: member(userId, roleIds),
    commandName: name,
    deferred: false,
    replied: false,
    inCachedGuild: () => true,
    isChatInputCommand: () => true,
    isButton: () => false,
    isRepliable: () => true,
    options: {
      getSubcommand: () => opts.sub,
      getUser: () => (opts.user ? { id: opts.user } : null),
      getString: (k: string) => opts.strings?.[k] ?? null,
    },
    async deferReply() {
      i.deferred = true;
    },
    async reply(p: Reply) {
      replies.push(p);
    },
    async editReply(p: Reply) {
      replies.push(p);
    },
    async followUp(p: Reply) {
      replies.push(p);
    },
  };
  return { i, replies };
}

function button(userId: string, roleIds: string[], customId: string) {
  const replies: Reply[] = [];
  const i = {
    guildId: cfg.guildId,
    user: { id: userId },
    member: member(userId, roleIds),
    customId,
    deferred: false,
    replied: false,
    inCachedGuild: () => true,
    isChatInputCommand: () => false,
    isButton: () => true,
    isRepliable: () => true,
    async deferUpdate() {
      i.deferred = true;
    },
    async update(p: Reply) {
      replies.push(p);
    },
    async editReply(p: Reply) {
      replies.push(p);
    },
    async followUp(p: Reply) {
      replies.push(p);
    },
  };
  return { i, replies };
}

const customIdOf = (r: Reply | undefined, n = 0) => r?.components?.[0]?.components[n]?.data.custom_id;

describe('神職用コマンド', () => {
  it('神職以外は使えない', async () => {
    const { i, replies } = command(USER, [ROLE.ujiko], 'yaku', { sub: 'add', user: OTHER, strings: { reason: '誹謗中傷' } });
    await staff.onInteraction(i as never);
    expect(replies[0]?.content).toBe('神職・宮司のみ使えます。');
    expect(await activeYakuCount(db, OTHER)).toBe(0);
  });

  it('/yaku add → 1 つ目は注意、2 つ目は確認ボタン → BAN', async () => {
    const first = command(STAFF, [ROLE.shinshoku], 'yaku', { sub: 'add', user: USER, strings: { reason: '誹謗中傷', note: '通話で' } });
    await staff.onInteraction(first.i as never);
    expect(first.replies.at(-1)?.content).toContain('厄を付けました（1 つ目・注意）');
    expect(calls).toContain(`addRole ${USER} ${ROLE.yakudoshi}`);

    const second = command(STAFF, [ROLE.shinshoku], 'yaku', { sub: 'add', user: USER, strings: { reason: 'スパム・宣伝' } });
    await staff.onInteraction(second.i as never);
    expect(second.replies.at(-1)?.content).toContain('BAN');
    const confirmId = customIdOf(second.replies.at(-1))!;
    expect(confirmId).toMatch(/^yaku:confirm:/);
    expect(calls.filter((c) => c.startsWith('ban'))).toHaveLength(0);

    // ほかの神職は同じボタンを使えない
    const other = button('830000000000000009', [ROLE.shinshoku], confirmId);
    await staff.onInteraction(other.i as never);
    expect(other.replies[0]?.content).toContain('期限が切れました');

    const ok = button(STAFF, [ROLE.shinshoku], confirmId);
    await staff.onInteraction(ok.i as never);
    expect(ok.replies.at(-1)?.content).toContain('BAN になりました');
    expect(calls).toContain(`ban ${USER}`);
  });

  it('/ban（一発 BAN）', async () => {
    const { i, replies } = command(STAFF, [ROLE.shinshoku], 'ban', { user: USER, strings: { reason: '個人情報の晒し' } });
    await staff.onInteraction(i as never);
    expect(replies.at(-1)?.content).toContain('BAN しました');
    expect(calls).toEqual([`dm ${USER}`, `ban ${USER}`]);
  });

  it('/member は状況をまとめて表示（管理画面へのリンク付き）', async () => {
    await addCoins(db, USER, 42, 'adjust');
    const { i, replies } = command(STAFF, [ROLE.shinshoku], 'member', { user: USER });
    await staff.onInteraction(i as never);
    const embed = replies.at(-1)?.embeds?.[0] as { description: string; url: string };
    expect(embed.description).toContain('🌸花びら 42');
    expect(embed.url).toBe(`https://shamusho.example.com/members/${USER}`);
  });

  it('/memo と /yaku list', async () => {
    const memo = command(STAFF, [ROLE.shinshoku], 'memo', { user: USER, strings: { body: '様子見' } });
    await staff.onInteraction(memo.i as never);
    expect(memo.replies.at(-1)?.content).toContain('メモを残しました');
    const list = command(STAFF, [ROLE.shinshoku], 'yaku', { sub: 'list' });
    await staff.onInteraction(list.i as never);
    expect(list.replies.at(-1)?.content).toBe('厄が付いている方はいません。');
  });
});

describe('/menzaifu', () => {
  it('厄があって花びらが足りれば購入ボタン → 祓える', async () => {
    const give = command(STAFF, [ROLE.shinshoku], 'yaku', { sub: 'add', user: USER, strings: { reason: '誹謗中傷' } });
    await staff.onInteraction(give.i as never);
    await addCoins(db, USER, cfg.economy.menzaifuPrice, 'adjust');

    const view = command(USER, [ROLE.ujiko, ROLE.yakudoshi], 'menzaifu');
    await staff.onInteraction(view.i as never);
    expect(customIdOf(view.replies.at(-1))).toBe('menzaifu:buy');

    const buy = button(USER, [ROLE.ujiko, ROLE.yakudoshi], 'menzaifu:buy');
    await staff.onInteraction(buy.i as never);
    expect(buy.replies.at(-1)?.content).toContain('厄を 1 つ祓いました');
    expect(await activeYakuCount(db, USER)).toBe(0);
    expect((await walletOf(db, USER)).balance).toBe(0);
    expect(calls).toContain(`removeRole ${USER} ${ROLE.yakudoshi}`);
  });

  it('花びらが足りなければボタンは出ない', async () => {
    const give = command(STAFF, [ROLE.shinshoku], 'yaku', { sub: 'add', user: USER, strings: { reason: '誹謗中傷' } });
    await staff.onInteraction(give.i as never);
    const view = command(USER, [ROLE.ujiko], 'menzaifu');
    await staff.onInteraction(view.i as never);
    expect(view.replies.at(-1)?.components).toEqual([]);
    expect(view.replies.at(-1)?.content).toContain('足りません');
  });
});

describe('1 分ごとの処理', () => {
  it('通話している人（2 人以上）に通話時間、発言数も書き込む', async () => {
    const app = new ShuinApp({} as never, db, cfg);
    const vm = (id: string, deaf = false) => [id, { id, user: { bot: false }, voice: { deaf } }] as const;
    const guild = {
      afkChannelId: 'afk',
      channels: {
        cache: new Map([
          ['vc1', { id: 'vc1', isVoiceBased: () => true, members: new Map([vm(USER), vm(OTHER)]) }],
          ['vc2', { id: 'vc2', isVoiceBased: () => true, members: new Map([vm(STAFF)]) }],
          ['txt', { id: 'txt', isVoiceBased: () => false }],
        ]),
      },
    };
    await app.onMessage({ guildId: cfg.guildId, channelId: 'x', author: { id: USER, bot: false } } as never);
    await app.onMessage({ guildId: cfg.guildId, channelId: 'x', author: { id: USER, bot: false } } as never);
    const now = new Date('2026-09-25T03:00:00Z');
    await app.everyMinute(guild as never, now);
    const [u] = await recentActivity(db, USER);
    expect(u).toMatchObject({ vcMinutes: 1, messageCount: 2 });
    expect(await recentActivity(db, STAFF)).toEqual([]);
  });
});

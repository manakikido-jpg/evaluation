import { MessageType } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { ShuinApp } from '../src/discord/app.js';
import { shuinId } from '../src/discord/ids.js';
import { giveShuin } from '../src/services/shuin.js';
import { cfg, makeDb, ROLE } from './helpers.js';

/* Discord のオブジェクトを最小限まねた偽物で、ShuinApp の動きを確かめる */

type Sent = { channelId: string; content: string; allowedMentions?: unknown };

function fakeMember(id: string, roleIds: string[], bot = false) {
  const cache = new Map(roleIds.map((r) => [r, {}]));
  return {
    id,
    get guild() {
      return guild;
    },
    user: { id, bot },
    displayName: `user${id.slice(-2)}`,
    displayAvatarURL: () => 'https://example.com/a.png',
    toString: () => `<@${id}>`,
    roles: {
      cache,
      add: vi.fn(async (roleId: string) => void cache.set(roleId, {})),
      remove: vi.fn(async (ids: string[]) => ids.forEach((r) => cache.delete(r))),
    },
  };
}
type FakeMember = ReturnType<typeof fakeMember>;

let db: Db;
let close: () => Promise<void>;
let members: Map<string, FakeMember>;
let sent: Sent[];
let app: ShuinApp;

const guild = {
  members: {
    fetch: async (arg: string | { user: string; force?: boolean }) => {
      const id = typeof arg === 'string' ? arg : arg.user;
      const m = members.get(id);
      if (!m) throw new Error('Unknown Member');
      return m;
    },
  },
};

beforeEach(async () => {
  ({ db, close } = await makeDb());
  members = new Map();
  sent = [];
  const client = {
    channels: {
      fetch: async (channelId: string) => ({
        isSendable: () => true,
        send: async (p: { content: string; allowedMentions?: unknown }) => void sent.push({ channelId, ...p }),
      }),
    },
  };
  app = new ShuinApp(client as never, db, cfg);
});
afterEach(async () => {
  await close();
});

function add(id: string, ...roleIds: string[]) {
  const m = fakeMember(id, roleIds);
  members.set(id, m);
  return m;
}

type Kind = 'button' | 'userMenu' | 'slash';

function interaction(kind: Kind, user: FakeMember, extra: Record<string, unknown>) {
  const replies: { content?: string; embeds?: { title?: string; description?: string }[]; flags?: unknown }[] = [];
  const i = {
    id: 'i',
    guildId: cfg.guildId,
    guild,
    member: user,
    user: user.user,
    deferred: false,
    replied: false,
    deferOptions: undefined as unknown,
    inCachedGuild: () => true,
    isUserContextMenuCommand: () => kind === 'userMenu',
    isChatInputCommand: () => kind === 'slash',
    isButton: () => kind === 'button',
    isRepliable: () => true,
    async deferReply(opts: unknown) {
      i.deferred = true;
      i.deferOptions = opts;
    },
    async editReply(p: (typeof replies)[number]) {
      replies.push(p);
    },
    async reply(p: (typeof replies)[number]) {
      i.replied = true;
      replies.push(p);
    },
    async followUp(p: (typeof replies)[number]) {
      replies.push(p);
    },
    ...extra,
  };
  return { i, replies };
}

const G = '400000000000000001';
const G2 = '400000000000000002';
const R = '400000000000000009';

describe('ShuinApp', () => {
  it('ボタンで朱印を押すと、本人に結果を返して #記録 にログを残す', async () => {
    const giver = add(G, ROLE.sewayaku);
    add(R, ROLE.sanpaisha);
    const { i, replies } = interaction('button', giver, { customId: shuinId('give', R) });
    await app.onInteraction(i as never);

    expect(replies[0]?.content).toBe(`🌸 <@${R}> さまに朱印を押しました（格 3・ご縁 +3）`);
    expect(sent).toEqual([expect.objectContaining({ channelId: cfg.channels.log, content: expect.stringContaining('朱印') })]);
  });

  it('右クリックの「朱印を押す」でも押せて、基準を超えたら昇格して #慶事 で発表する', async () => {
    const receiver = add(R, ROLE.sanpaisha);
    const g1 = add(G, ROLE.guji);
    const g2 = add(G2, ROLE.guji);

    await app.onInteraction(interaction('userMenu', g1, { commandName: '朱印を押す', targetId: R }).i as never);
    expect(sent.filter((s) => s.channelId === cfg.channels.keiji)).toHaveLength(0);

    await app.onInteraction(interaction('userMenu', g2, { commandName: '朱印を押す', targetId: R }).i as never);

    expect(receiver.roles.add).toHaveBeenCalledWith(ROLE.ujiko, expect.any(String));
    expect(receiver.roles.remove).toHaveBeenCalledWith([ROLE.sanpaisha], expect.any(String));
    const keiji = sent.filter((s) => s.channelId === cfg.channels.keiji);
    expect(keiji).toHaveLength(1);
    expect(keiji[0]?.content).toContain('**🍃 氏子** になられました。（ご縁 20）');
    expect(keiji[0]?.allowedMentions).toEqual({ parse: [], users: [R] });
  });

  it('同じ相手に同時に押されても、昇格の発表は 1 回だけ', async () => {
    const receiver = add(R, ROLE.sanpaisha);
    await giveShuin(db, { giverId: '400000000000000100', receiverId: R, weight: 10, giverRank: 'guji' });
    const givers = ['400000000000000101', '400000000000000102', '400000000000000103'].map((id) => add(id, ROLE.guji));

    await Promise.all(
      givers.map((g) => app.onInteraction(interaction('button', g, { customId: shuinId('give', R) }).i as never)),
    );

    expect(sent.filter((s) => s.channelId === cfg.channels.keiji)).toHaveLength(1);
    expect(receiver.roles.cache.has(ROLE.ujiko)).toBe(true);
  });

  it('キャッシュのロールが古くても、最新のロールで確かめて二重に昇格しない', async () => {
    // キャッシュ上はまだ参拝者だが、実際はもう氏子になっている
    const stale = fakeMember(R, [ROLE.sanpaisha]);
    const fresh = fakeMember(R, [ROLE.ujiko]);
    members.set(R, stale);
    const realFetch = guild.members.fetch;
    guild.members.fetch = async (arg) =>
      typeof arg === 'object' && arg.force ? (fresh as FakeMember) : realFetch(arg);
    try {
      await giveShuin(db, { giverId: '400000000000000100', receiverId: R, weight: 10, giverRank: 'guji' });
      const giver = add(G, ROLE.guji);
      await app.onInteraction(interaction('button', giver, { customId: shuinId('give', R) }).i as never);
    } finally {
      guild.members.fetch = realFetch;
    }
    expect(sent.filter((s) => s.channelId === cfg.channels.keiji)).toHaveLength(0);
    expect(stale.roles.add).not.toHaveBeenCalled();
    expect(fresh.roles.add).not.toHaveBeenCalled();
  });

  it('2 回目は「すでに押しています」', async () => {
    const giver = add(G, ROLE.ujiko);
    add(R, ROLE.sanpaisha);
    await app.onInteraction(interaction('button', giver, { customId: shuinId('give', R) }).i as never);
    const { i, replies } = interaction('button', giver, { customId: shuinId('give', R) });
    await app.onInteraction(i as never);
    expect(replies[0]?.content).toContain('すでに朱印を押しています');
  });

  it('取り消しボタン', async () => {
    const giver = add(G, ROLE.ujiko);
    add(R, ROLE.sanpaisha);
    await app.onInteraction(interaction('button', giver, { customId: shuinId('give', R) }).i as never);
    const { i, replies } = interaction('button', giver, { customId: shuinId('revoke', R) });
    await app.onInteraction(i as never);
    expect(replies[0]?.content).toContain('取り消しました（ご縁 -2）');
  });

  it('/goshuin は御朱印帳を表示し、昇格漏れがあれば直す', async () => {
    const owner = add(R, ROLE.sanpaisha);
    await giveShuin(db, { giverId: G, receiverId: R, weight: 25, giverRank: 'guji' });
    const viewer = add(G, ROLE.ujiko);

    const { i, replies } = interaction('slash', viewer, {
      commandName: 'goshuin',
      options: { getUser: () => owner.user, getBoolean: () => null },
    });
    await app.onInteraction(i as never);

    expect(replies[0]?.embeds?.[0]?.title).toBe(`📕 user09 さまの御朱印帳`);
    expect(owner.roles.cache.has(ROLE.ujiko)).toBe(true);
    expect(sent.some((s) => s.channelId === cfg.channels.keiji)).toBe(true);
  });

  it('/goshuin 公開:true なら全員に見える形で返す', async () => {
    const viewer = add(G, ROLE.ujiko);
    const { i } = interaction('slash', viewer, {
      commandName: 'goshuin',
      options: { getUser: () => null, getBoolean: () => true },
    });
    await app.onInteraction(i as never);
    expect(i.deferOptions).toEqual({});
  });

  it('ほかのサーバーからの操作は無視する', async () => {
    const giver = add(G, ROLE.ujiko);
    add(R, ROLE.sanpaisha);
    const { i, replies } = interaction('button', giver, { customId: shuinId('give', R), guildId: '999999999999999999' });
    await app.onInteraction(i as never);
    expect(replies).toHaveLength(0);
  });

  it('処理中にエラーが起きたら、本人にお詫びを返す', async () => {
    const giver = add(G, ROLE.ujiko);
    add(R, ROLE.sanpaisha);
    const broken = new ShuinApp({ channels: { fetch: async () => null } } as never, {} as Db, cfg);
    const { i, replies } = interaction('button', giver, { customId: shuinId('give', R) });
    await broken.onInteraction(i as never);
    expect(replies.at(-1)?.content).toContain('うまく処理できませんでした');
  });
});

describe('#絵馬', () => {
  function msg(channelId: string, bot = false, type = MessageType.Default) {
    const reply = vi.fn(async () => undefined);
    return {
      m: { channelId, author: { id: R, bot }, type, inGuild: () => true, reply },
      reply,
    };
  }

  it('自己紹介の投稿に御朱印帳ボタンを付ける（通知は飛ばさない）', async () => {
    const { m, reply } = msg(cfg.channels.ema ?? '900000000000000003');
    const withEma = new ShuinApp({} as never, db, { ...cfg, channels: { ...cfg.channels, ema: '900000000000000003' } });
    await withEma.onMessage(m as never);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `📕 <@${R}> さまの御朱印帳`,
        allowedMentions: { parse: [], repliedUser: false },
      }),
    );
  });

  it('ほかのチャンネル・BOT・返信には付けない', async () => {
    const withEma = new ShuinApp({} as never, db, { ...cfg, channels: { ...cfg.channels, ema: '900000000000000003' } });
    for (const { m, reply } of [
      msg('900000000000000004'),
      msg('900000000000000003', true),
      msg('900000000000000003', false, MessageType.Reply),
    ]) {
      await withEma.onMessage(m as never);
      expect(reply).not.toHaveBeenCalled();
    }
  });
});

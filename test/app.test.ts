import { MessageType } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { ShuinApp } from '../src/discord/app.js';
import { shuinId } from '../src/discord/ids.js';
import { walletOf, grantJoinBonus } from '../src/services/economy.js';
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
    user: { id, bot, username: `user${id.slice(-2)}` },
    displayName: `user${id.slice(-2)}`,
    send: vi.fn(async (_p: unknown) => undefined),
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
  id: cfg.guildId,
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
    users: { fetch: async (id: string) => members.get(id)! },
    channels: {
      fetch: async (channelId: string) => ({
        isSendable: () => true,
        send: async (p: { content: string; allowedMentions?: unknown }) => { sent.push({ channelId, ...p }); return { id: 'message' }; },
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

type Kind = 'button' | 'userMenu' | 'slash' | 'stringSelect';

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
    isStringSelectMenu: () => kind === 'stringSelect',
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
  it('通話の一覧は昇格後に開き直すとチェックが外れ、押し直すと戻る', async () => {
    const giver = add(G, ROLE.sanpaisha);
    const receiver = add(R, ROLE.sanpaisha);
    const channel = { isVoiceBased: () => true, members: new Map([[G, giver], [R, receiver]]) };
    Object.assign(giver, { voice: { channel } });
    await giveShuin(db, { giverId: G, receiverId: R, weight: 1, giverRank: 'sanpaisha' });
    const list = async () => {
      const b = interaction('button', giver, { customId: shuinId('vc', '950000000000000001') });
      await app.onInteraction(b.i as never);
      return JSON.stringify((b.replies[0] as { components?: unknown[] } | undefined)?.components);
    };
    expect(await list()).toContain('✅');
    giver.roles.cache.delete(ROLE.sanpaisha);
    giver.roles.cache.set(ROLE.ujiko, {});
    const fresh = await list();
    expect(fresh).not.toContain('✅');
    expect(fresh).toContain('📕');
    const press = interaction('button', giver, { customId: shuinId('give', R) });
    await app.onInteraction(press.i as never);
    expect(press.replies[0]?.content).toContain('格 2・ご縁 +1');
    expect(await list()).toContain('✅');
  });

  it('#絵馬 のひな形の「🌸 朱印を押す」: そのチャンネルに投稿している人から選び、選ぶと朱印を押す', async () => {
    const { recordJoin } = await import('../src/services/members.js');
    const giver = add(G, ROLE.sewayaku);
    add(R, ROLE.sanpaisha);
    await recordJoin(db, { id: R, username: 'r', displayName: 'あいて', avatarUrl: null, roleIds: [ROLE.sanpaisha], isBot: false, joinedAt: null });
    const messages = new Map([
      ['m2', { id: 'm2', author: { id: R, bot: false }, createdTimestamp: 2000 }],
      ['m1', { id: 'm1', author: { id: 'BOT', bot: true }, createdTimestamp: 1000 }],
    ]);
    const channel = { messages: { fetch: async () => messages } };
    const b = interaction('button', giver, { customId: 'shuin:pick', channelId: 'C1', channel, editReply: undefined });
    const shown: unknown[] = [];
    (b.i as Record<string, unknown>).editReply = async (p: unknown) => void shown.push(p);
    await app.onInteraction(b.i as never);
    const view = shown[0] as { content: string; components: { toJSON(): unknown }[] };
    expect(view.content).toContain('このチャンネルに投稿している 1 人');
    expect(JSON.stringify(view.components.map((c) => c.toJSON()))).toContain(`"value":"${R}"`);
    const sel = interaction('stringSelect', giver, { customId: 'shuin:pickone', values: [R] });
    await app.onInteraction(sel.i as never);
    expect(sel.replies.at(-1)!.content).toBe(`🌸 <@${R}> さまに朱印を押しました（格 3・ご縁 +3）`);
  });

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

    expect(replies[0]?.embeds?.[0]?.title).toBe(`📕 user09 さまのプロフィール`);
    // ほかの人の残高は出さない
    expect(JSON.stringify(replies[0]?.embeds)).not.toContain(cfg.economy.currencyName);
    expect(owner.roles.cache.has(ROLE.ujiko)).toBe(true);
    expect(sent.some((s) => s.channelId === cfg.channels.keiji)).toBe(true);
  });

  it('/goshuin 公開:true なら全員に見える形で返す（残高は出さない）', async () => {
    const viewer = add(G, ROLE.ujiko);
    const { i, replies } = interaction('slash', viewer, {
      commandName: 'goshuin',
      options: { getUser: () => null, getBoolean: () => true },
    });
    await app.onInteraction(i as never);
    expect(i.deferOptions).toEqual({});
    expect(JSON.stringify(replies[0]?.embeds)).not.toContain(cfg.economy.currencyName);
  });

  it('自分の御朱印帳を自分だけに見えるように開いたときは、残高が出る', async () => {
    const viewer = add(G, ROLE.ujiko);
    const { i, replies } = interaction('slash', viewer, {
      commandName: 'goshuin',
      options: { getUser: () => null, getBoolean: () => null },
    });
    await app.onInteraction(i as never);
    expect(JSON.stringify(replies[0]?.embeds)).toContain(cfg.economy.currencyName);
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

  it('自己紹介（#絵馬-男性 など）にも、ほかのチャンネル・BOT・返信にも何も付けない', async () => {
    const withEma = new ShuinApp({} as never, db, { ...cfg, channels: { ...cfg.channels, ema: '900000000000000003' } });
    for (const { m, reply } of [
      msg('900000000000000003'),
      msg('900000000000000004'),
      msg('900000000000000003', true),
      msg('900000000000000003', false, MessageType.Reply),
    ]) {
      await withEma.onMessage(m as never);
      expect(reply).not.toHaveBeenCalled();
    }
  });
});


describe('参拝者ロールで初期通貨を発行', () => {
  it('手動のロール付与でも発行し、本人と運営へ1回だけ知らせる', async () => {
    const id = '700000000000000090';
    const old = fakeMember(id, []);
    const m = add(id, ROLE.sanpaisha);
    await Promise.all([app.onMemberUpdate(m as never, old as never), app.onMemberUpdate(m as never, old as never)]);
    expect((await walletOf(db, id)).balance).toBe(cfg.economy.joinBonus);
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.send.mock.calls[0]?.[0]).toMatchObject({ content: expect.stringContaining('初期通貨を発行されました。'), allowedMentions: { parse: [] } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channelId: cfg.channels.log, content: expect.stringContaining('初期通貨発行完了'), allowedMentions: { parse: [] } });
    await app.onMemberUpdate(m as never, m as never);
    await app.onMemberUpdate(old as never, m as never);
    await app.onMemberUpdate(m as never, old as never);
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect((await walletOf(db, id)).balance).toBe(cfg.economy.joinBonus);
  });
  it('DMが届かなくても発行し、運営の記録を出す', async () => {
    const m = add('700000000000000091', ROLE.sanpaisha);
    m.send.mockRejectedValue(new Error('DM disabled'));
    await app.onMemberUpdate(m as never, fakeMember(m.id, []) as never);
    expect((await walletOf(db, m.id)).balance).toBe(cfg.economy.joinBonus);
    expect(sent[0]?.content).toContain('本人へのDMは届きませんでした');
  });
  it('参拝者以外・BOT・別のサーバーには配らず、承認時の発行済みも重ねない', async () => {
    const other = add('700000000000000092', ROLE.ujiko);
    const bot = fakeMember('700000000000000093', [ROLE.sanpaisha], true);
    const foreign = { ...fakeMember('700000000000000094', [ROLE.sanpaisha]), guild: { id: '900000000000000099' } };
    for (const m of [other, bot, foreign]) {
      await app.onMemberUpdate(m as never);
      expect((await walletOf(db, m.id)).balance).toBe(0);
    }
    const paid = add('700000000000000095', ROLE.sanpaisha);
    await grantJoinBonus(db, paid.id, cfg.economy.joinBonus);
    await app.onMemberUpdate(paid as never, fakeMember(paid.id, []) as never);
    expect(paid.send).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});


describe('起動と定期確認で未払い招待報酬を拾う', () => {
  it('起動時の最新メンバー同期から過去の参拝者分を払う', async () => {
    const { recordInvite } = await import('../src/services/invites.js');
    const inviter = add('700000000000000080', ROLE.sanpaisha);
    const guest = add('700000000000000081', ROLE.sanpaisha);
    await recordInvite(db, guest.id, inviter.id, 'link');
    await app.syncAll(members.values() as never);
    expect((await walletOf(db, inviter.id)).balance).toBe(cfg.economy.inviteSanpaishaReward);
    expect(inviter.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('招待報酬150銭') }));
    expect(sent.some(x => x.content.includes('招待報酬の支払い完了'))).toBe(true);
    await app.reconcileInviteRewards(guild as never);
    expect(inviter.send).toHaveBeenCalledTimes(1);
    expect((await walletOf(db, inviter.id)).balance).toBe(150);
  });

  it('現在の役職・在籍を取り直し、失敗後に再確認しても二重払いしない', async () => {
    const { recordInvite } = await import('../src/services/invites.js');
    const { recordJoin } = await import('../src/services/members.js');
    const id = '700000000000000082', invited = '700000000000000083';
    for (const who of [id, invited]) await recordJoin(db, { id: who, username: who, displayName: who, avatarUrl: null, roleIds: [ROLE.sanpaisha], isBot: false, joinedAt: new Date() });
    await recordInvite(db, invited, id, 'link');
    // 招待者がDiscordにいない間は、古いDBの在籍だけで支払わない。
    const guest = add(invited, ROLE.sanpaisha);
    await app.reconcileInviteRewards(guild as never);
    expect((await walletOf(db, id)).balance).toBe(0);
    add(id, ROLE.sanpaisha);
    // 昇格の記録が残っていても、現在ロールが外れていれば保留。
    guest.roles.cache.clear();
    await app.reconcileInviteRewards(guild as never);
    expect((await walletOf(db, id)).balance).toBe(0);
    guest.roles.cache.set(ROLE.sanpaisha, {});
    // ロール更新でDBが追いついたあと、定期確認と昇格処理が同時でも1回。
    await app.onMemberUpdate(guest as never);
    await Promise.all([app.reconcileInviteRewards(guild as never), app.reconcileInviteRewards(guild as never)]);
    expect((await walletOf(db, id)).balance).toBe(150);
  });
});

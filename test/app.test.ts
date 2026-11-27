import { MessageType } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { ShuinApp } from '../src/discord/app.js';
import { shuinId } from '../src/discord/ids.js';
import { walletOf, grantJoinBonus } from '../src/services/economy.js';
import { giveShuin } from '../src/services/shuin.js';
import { shuin, voiceChannels, voiceUsage, evaluationTimeDeductions } from '../src/db/schema.js';
import { recordJoin } from '../src/services/members.js';
import { cfg, makeDb, ROLE } from './helpers.js';

/* Discord のオブジェクトを最小限まねた偽物で、ShuinApp の動きを確かめる */

type Sent = { channelId: string; content: string; embeds?: unknown[]; allowedMentions?: unknown };

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

type Kind = 'button' | 'userMenu' | 'slash' | 'stringSelect' | 'modal';

function interaction(kind: Kind, user: FakeMember, extra: Record<string, unknown>) {
  const replies: { content?: string; embeds?: { title?: string; description?: string }[]; flags?: unknown }[] = [];
  const shownModals: { customId?: string }[] = [];
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
    isModalSubmit: () => kind === 'modal',
    async showModal(m: { data?: { custom_id?: string }; customId?: string }) {
      i.replied = true;
      shownModals.push({ customId: m.customId ?? m.data?.custom_id });
    },
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
  return { i, replies, shownModals };
}

const G = '400000000000000001';
const G2 = '400000000000000002';
const R = '400000000000000009';

async function seedEligibility(count = 38, minutes = 1200) {
  await recordJoin(db, { id: R, username: 'r', displayName: 'あいて', avatarUrl: null, roleIds: [ROLE.sanpaisha], isBot: false, joinedAt: null });
  await db.insert(voiceChannels).values({ channelId: '950000000000000001', name: '縁側1' });
  await db.insert(voiceUsage).values({ memberId: R, channelId: '950000000000000001', date: '2026-11-05', minutes });
  if (count) await db.insert(shuin).values(Array.from({ length: count }, (_, i) => ({ giverId: String(470000000000000000n + BigInt(i)), receiverId: R, weight: 1, giverRank: 'sanpaisha' })));
}

describe('ShuinApp', () => {
  it('ご縁39の間は氏子以上へ上がらず、ご縁40になって20時間を満たすと上がる（特別ご縁もご縁に数える）', async () => {
    const receiver = add(R, ROLE.sanpaisha);
    await seedEligibility(39);
    await app.checkEvaluationPromotions(guild as never);
    expect(receiver.roles.add).not.toHaveBeenCalled();
    const { grantSpecialGoen } = await import('../src/services/specialGoen.js');
    await grantSpecialGoen(db, { memberId: R, amount: 1, reason: '試験の特別ご縁', by: G, nonce: '00000000-0000-0000-0000-000000000091' });
    await app.checkSpecialGoen(guild as never);
    expect(receiver.roles.add).toHaveBeenCalledTimes(1);
    expect(receiver.roles.add).toHaveBeenCalledWith(ROLE.ujiko, expect.any(String));
  });

  it('ご縁40でも19時間59分では上がらず、毎分の非ミュート観測で20時間に届けば1回昇格する', async () => {
    const receiver = add(R, ROLE.sanpaisha);
    await seedEligibility(40, 1199);
    const now = new Date('2026-11-06T03:00:00Z');
    await app.checkEvaluationPromotions(guild as never, now);
    expect(receiver.roles.add).not.toHaveBeenCalled();
    const room = { id: '950000000000000001', name: '縁側1', parentId: null, parent: null, isVoiceBased: () => true,
      members: new Map([[R, { ...receiver, voice: { mute: true, deaf: false } }]]) };
    const voiceGuild = { ...guild, afkChannelId: null, channels: { cache: new Map([[room.id, room]]) } };
    await app.everyMinute(voiceGuild as never, now);
    expect(receiver.roles.add).not.toHaveBeenCalled();
    room.members.get(R)!.voice.mute = false;
    await app.everyMinute(voiceGuild as never, new Date(now.getTime() + 60000));
    expect(receiver.roles.add).toHaveBeenCalledWith(ROLE.ujiko, expect.any(String));
    await app.everyMinute(voiceGuild as never, new Date(now.getTime() + 120000));
    expect(receiver.roles.add).toHaveBeenCalledTimes(1);
    expect(sent.filter(s => s.channelId === cfg.channels.keiji)).toHaveLength(1);
  });

  it('過去控除で20時間を割る人は御朱印帳からも昇格せず、控除後も達成なら再確認で上がる', async () => {
    const receiver = add(R, ROLE.sanpaisha);
    await seedEligibility(40);
    await db.insert(evaluationTimeDeductions).values({ memberId: R, date: '2026-11-05', channelId: '950000000000000001', minutes: 1, reason: '確認済みの過去ミュート', updatedBy: G });
    const viewer = add(G, ROLE.ujiko);
    await app.onInteraction(interaction('slash', viewer, { commandName: 'goshuin', options: { getUser: () => receiver.user, getBoolean: () => null } }).i as never);
    await app.checkEvaluationPromotions(guild as never);
    expect(receiver.roles.add).not.toHaveBeenCalled();
    await db.insert(voiceUsage).values({ memberId: R, date: '2026-11-06', channelId: '950000000000000001', minutes: 1, rankRecordedMinutes: 1, sanpaishaMinutes: 1, evaluationRecordedMinutes: 1, evaluationEligibleMinutes: 1 });
    await app.checkEvaluationPromotions(guild as never, new Date('2026-11-06T03:00:00Z'));
    expect(receiver.roles.add).toHaveBeenCalledTimes(1);
  });

  it('取消済みの御朱印はご縁40に含めない', async () => {
    const receiver = add(R, ROLE.sanpaisha);
    await seedEligibility(40);
    const { revokeShuin } = await import('../src/services/shuin.js');
    await revokeShuin(db, { giverId: '470000000000000000', receiverId: R });
    await app.checkEvaluationPromotions(guild as never);
    expect(receiver.roles.add).not.toHaveBeenCalled();
  });

  it('既に氏子の人の上位昇格は、従来のご縁条件を使う', async () => {
    const receiver = add(R, ROLE.ujiko);
    await giveShuin(db, { giverId: G2, receiverId: R, weight: 100, giverRank: 'guji' });
    const viewer = add(G, ROLE.ujiko);
    await app.onInteraction(interaction('slash', viewer, { commandName: 'goshuin', options: { getUser: () => receiver.user, getBoolean: () => null } }).i as never);
    expect(receiver.roles.add).toHaveBeenCalledWith(ROLE.sewayaku, expect.any(String));
  });

  it('条件を満たしていても運営サブは自動昇格しない', async () => {
    const receiver = add(R, ROLE.sanpaisha);
    await seedEligibility(40);
    const { setStaffAlt } = await import('../src/services/staffAlts.js');
    await setStaffAlt(db, R, true, G);
    await app.checkEvaluationPromotions(guild as never);
    expect(receiver.roles.add).not.toHaveBeenCalled();
  });

  it('条件を満たした記録があっても退出者は自動昇格しない', async () => {
    const receiver = add(R, ROLE.sanpaisha);
    await seedEligibility(40);
    const { recordLeave } = await import('../src/services/members.js');
    await recordLeave(db, R);
    await app.checkEvaluationPromotions(guild as never);
    expect(receiver.roles.add).not.toHaveBeenCalled();
  });

  it('縁側の共有入口から本人だけのパネルを開く。本人・通話・公開設定を守る', async () => {
    const { controlId } = await import('../src/discord/controlPanel.js');
    const CH = '950000000000000001';
    const viewer = add(G, ROLE.ujiko);
    Object.assign(viewer, { voice: { channel: { id: CH, name: '縁側' } } });
    const open = interaction('button', viewer, { customId: controlId('open', CH) });
    await app.onInteraction(open.i as never);
    expect(open.replies[0]?.flags).toBe(64 | 32768);
    expect(JSON.stringify(open.replies)).toContain('プロフィール');
    expect(JSON.stringify(open.replies)).not.toContain('control:ema:');
    const wrong = interaction('button', viewer, { customId: controlId('profile', CH, R) });
    await app.onInteraction(wrong.i as never);
    expect(wrong.replies[0]?.content).toContain('本人');
    const hidden = interaction('button', viewer, { customId: controlId('ema', CH, G) });
    await app.onInteraction(hidden.i as never);
    expect(hidden.replies[0]?.content).toContain('まだ始まっていません');
    Object.assign(viewer, { voice: {} });
    const left = interaction('button', viewer, { customId: controlId('open', CH) });
    await app.onInteraction(left.i as never);
    expect(left.replies[0]?.content).toContain('入ってから');
  });

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

  it('右クリックの朱印も、ご縁40と20時間に達してから昇格し、#慶事で発表する', async () => {
    await seedEligibility(20);
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
    expect(keiji[0]?.content).toBe(cfg.ranks.map((r) => `<@&${r.roleId}>`).join(' ') + ' 新しい仲間をお迎えください。');
    expect(keiji[0]?.embeds).toEqual([expect.objectContaining({ description: expect.stringContaining('**🍃 氏子** になられました。'), fields: expect.arrayContaining([{ name: 'ご縁', value: '40', inline: true }]) })]);
    expect(keiji[0]?.allowedMentions).toEqual({ parse: [], users: [], roles: cfg.ranks.map((r) => r.roleId) });
  });

  it('役職全体への昇格通知も通知OKだけに届け、通知NGの設定を守る', async () => {
    await seedEligibility();
    const original = cfg.notify;
    cfg.notify = { okRoleId: '100000000000000080', ngRoleId: '100000000000000081' };
    try {
      add(R, ROLE.sanpaisha);
      const giver = add(G, ROLE.guji);
      await giveShuin(db, { giverId: G2, receiverId: R, weight: 10, giverRank: 'guji' });
      await app.onInteraction(interaction('button', giver, { customId: shuinId('give', R) }).i as never);
      const keiji = sent.filter((s) => s.channelId === cfg.channels.keiji);
      expect(keiji).toHaveLength(1);
      expect(keiji[0]?.content).toBe('<@&100000000000000080> 新しい仲間をお迎えください。');
      expect(keiji[0]?.allowedMentions).toEqual({ parse: [], users: [], roles: ['100000000000000080'] });
    } finally { cfg.notify = original; }
  });

  it('同じ相手に同時に押されても、昇格の発表は 1 回だけ', async () => {
    await seedEligibility();
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
    await seedEligibility();
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
    await seedEligibility(39);
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


describe('毎分の浮上ボーナス', () => {
  it('評価用の時間は当時の参拝者と縁側に限り、昇格後・別の部屋・BOT・AFKを足さない', async () => {
    const { voiceUsage } = await import('../src/db/schema.js');
    const visitor = add('700000000000000091', ROLE.sanpaisha);
    const upper = add('700000000000000092', ROLE.sanpaisha, ROLE.ujiko);
    const afk = add('700000000000000093', ROLE.sanpaisha);
    const bot = fakeMember('700000000000000094', [ROLE.sanpaisha], true);
    const room = { id: 'engawa', name: '🌸 大きな縁側１', parentId: null, parent: null, isVoiceBased: () => true,
      members: new Map([visitor, upper, bot].map(m => [m.id, { ...m, voice: { deaf: false } }])) };
    const afkRoom = { ...room, id: 'afk', members: new Map([[afk.id, { ...afk, voice: { deaf: false } }]]) };
    const voiceGuild = { ...guild, afkChannelId: 'afk', channels: { cache: new Map([['engawa', room], ['afk', afkRoom]]) } };
    await app.everyMinute(voiceGuild as never, new Date('2026-11-06T03:00:00Z'));
    visitor.roles.cache.set(ROLE.ujiko, {});
    await app.everyMinute(voiceGuild as never, new Date('2026-11-06T03:01:00Z'));
    visitor.roles.cache.delete(ROLE.ujiko); room.name = '宿坊';
    await app.everyMinute(voiceGuild as never, new Date('2026-11-06T03:02:00Z'));
    const rows = await db.select().from(voiceUsage);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.memberId === visitor.id)).toMatchObject({ minutes: 3, rankRecordedMinutes: 3, sanpaishaMinutes: 1 });
    expect(rows.find(r => r.memberId === upper.id)).toMatchObject({ minutes: 3, rankRecordedMinutes: 3, sanpaishaMinutes: 0 });
  });

  it('評価は本人/サーバーのマイクとスピーカーの全ミュートを除外し、原本の滞在を保つ', async () => {
    const { voiceUsage } = await import('../src/db/schema.js');
    const visitor=add('700000000000000095',ROLE.sanpaisha),clear={mute:false,deaf:false,selfMute:false,serverMute:false,selfDeaf:false,serverDeaf:false};
    const member={...visitor,voice:{...clear}},room={id:'engawa-mute',name:'縁側１',parentId:null,parent:null,isVoiceBased:()=>true,members:new Map([[visitor.id,member]])};
    const voiceGuild={...guild,afkChannelId:'afk',channels:{cache:new Map([[room.id,room]])}};
    const states=[clear,...Object.keys(clear).map(key=>({...clear,[key]:true})),{}];
    for(const [index,state]of states.entries()){member.voice=state as typeof clear;await app.everyMinute(voiceGuild as never,new Date(new Date('2026-11-06T04:00:00Z').getTime()+index*60000));}
    const rows=await db.select().from(voiceUsage);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({minutes:8,sanpaishaMinutes:8,evaluationRecordedMinutes:8,evaluationEligibleMinutes:1});
  });

  it('1人のVCも数えて7時間で慶事へ通知し、AFKとBOTは数えない', async () => {
    const { voiceUsage } = await import('../src/db/schema.js');
    const { recordJoin } = await import('../src/services/members.js');
    const m = add('700000000000000088', ROLE.sanpaisha);
    await recordJoin(db, { id: m.id, username: 'sakura', displayName: 'さくら', avatarUrl: null, roleIds: [ROLE.sanpaisha], isBot: false, joinedAt: new Date() });
    await db.insert(voiceUsage).values({ memberId: m.id, date: '2026-10-09', channelId: 'room', minutes: 419 });
    const afk = add('700000000000000089');
    const bot = fakeMember('700000000000000090', [], true);
    const room = { id: 'room', name: '通話', parentId: null, parent: null, isVoiceBased: () => true, members: new Map([[m.id, { ...m, voice: { deaf: false } }], [bot.id, { ...bot, voice: { deaf: false } }]]) };
    const afkRoom = { ...room, id: 'afk', members: new Map([[afk.id, { ...afk, voice: { deaf: false } }]]) };
    await app.everyMinute({ ...guild, afkChannelId: 'afk', channels: { cache: new Map([['room', room], ['afk', afkRoom]]) } } as never, new Date('2026-10-09T03:00:00Z'));
    expect((await walletOf(db, m.id)).balance).toBe(300);
    expect(sent).toContainEqual(expect.objectContaining({ channelId: cfg.channels.keiji, content: expect.stringContaining('7時間の浮上ボーナス'), allowedMentions: { parse: [], users: [m.id] } }));
    expect((await db.select().from(voiceUsage)).map(r => r.memberId)).toEqual([m.id]);
  });
});

describe('ShuinApp：絵馬を贈る（新制度②）', () => {
  const GU = '400000000000000011'; // 氏子（贈る人）
  const SA = '400000000000000019'; // 参拝者（相手）
  const emaGiveId = (id: string) => `ema:give:${id}`;
  const emaModalId = (id: string) => `ema:modal:${id}`;

  async function seedMembers() {
    const { recordJoin } = await import('../src/services/members.js');
    await recordJoin(db, { id: GU, username: 'ujiko', displayName: '氏子さん', avatarUrl: null, roleIds: [ROLE.ujiko], isBot: false, joinedAt: new Date() });
    await recordJoin(db, { id: SA, username: 'sanpai', displayName: '参拝者さん', avatarUrl: null, roleIds: [ROLE.sanpaisha], isBot: false, joinedAt: new Date() });
    add(GU, ROLE.ujiko);
    add(SA, ROLE.sanpaisha);
  }
  async function seedTogether(days: number, minutesEach = 60) {
    const { engawaPairs } = await import('../src/db/schema.js');
    const [a, b] = GU < SA ? [GU, SA] : [SA, GU];
    for (let d = 0; d < days; d++) await db.insert(engawaPairs).values({ memberA: a, memberB: b, date: `2026-11-0${d + 1}`, minutes: minutesEach });
  }

  it('氏子は条件を満たした参拝者に絵馬を贈れる（ボタン→モーダル→贈る）', async () => {
    await (await import('../src/services/emaPromotion.js')).setEmaPromotion(db, true, 'guji'); // 絵馬は③が ON のときだけ
    await seedMembers();
    await seedTogether(3); // 3日・各60分＝合計180分
    const giver = members.get(GU)!;
    const press = interaction('button', giver, { customId: emaGiveId(SA) });
    await app.onInteraction(press.i as never);
    expect(press.shownModals.map((m) => m.customId)).toEqual([emaModalId(SA)]);

    const submit = interaction('modal', giver, { customId: emaModalId(SA), fields: { getTextInputValue: () => 'いっしょに過ごせてうれしかったです' } });
    await app.onInteraction(submit.i as never);
    expect(submit.replies[0]?.content).toContain('絵馬を贈りました'); expect(submit.replies[0]?.content).toContain('氏子の票');
    const { validEmaCountOf, emaMessagesOf } = await import('../src/services/ema.js');
    expect(await validEmaCountOf(db, SA)).toBe(1);
    expect((await emaMessagesOf(db, SA))[0]?.message).toBe('いっしょに過ごせてうれしかったです');
  });

  it('/絵馬 で、贈れる相手を確かめられる（自分＝いま贈れる人・あと少しの人と選ぶメニュー／ほかの人＝あなたとの縁側 ○/3日）', async () => {
    await (await import('../src/services/emaPromotion.js')).setEmaPromotion(db, true, 'guji');
    await seedMembers();
    await seedTogether(2, 30); // まだ2日
    const viewer = members.get(GU)!;
    const ema = async (target: string) => {
      const show = interaction('slash', viewer, { commandName: 'ema', options: { getUser: () => members.get(target)!.user, getBoolean: () => null } });
      await app.onInteraction(show.i as never);
      return JSON.stringify(show.replies.at(-1));
    };
    let mine = await ema(GU);
    expect(mine).toContain('いま絵馬を贈れる人（0人）');
    expect(mine).toContain('あと少し');
    expect(mine).toContain('参拝者さん（2日）');
    let theirs = await ema(SA);
    expect(theirs).toContain('あなたとの縁側');
    expect(theirs).toContain('2 / 3 日');
    // 3日目（30分以上）→ 贈れる
    const { engawaPairs } = await import('../src/db/schema.js');
    const [a, b] = GU < SA ? [GU, SA] : [SA, GU];
    await db.insert(engawaPairs).values({ memberA: a, memberB: b, date: '2026-11-09', minutes: 45 });
    mine = await ema(GU);
    expect(mine).toContain('いま絵馬を贈れる人（1人）');
    expect(mine).toContain(`ema:to:${GU}`);
    theirs = await ema(SA);
    expect(theirs).toContain('3 / 3 日');
    expect(theirs).toContain('絵馬を贈れます');
    // メニューから選ぶと、ひとことを入れる画面（氏子なのでモーダル）
    const pick = interaction('stringSelect', viewer, { customId: `ema:to:${GU}`, values: [SA] });
    await app.onInteraction(pick.i as never);
    expect(pick.shownModals[0]?.customId).toBe(`ema:modal:${SA}`);
  });

  it('参拝者は氏子へ定型文で贈れる（参拝者の票）。もう贈った相手には「書き直す・取り消す」が出て、本人が取り消せる', async () => {
    await (await import('../src/services/emaPromotion.js')).setEmaPromotion(db, true, 'guji');
    const { recordJoin } = await import('../src/services/members.js');
    // GU を参拝者（贈る人）・SA を氏子（相手）にする
    await recordJoin(db, { id: GU, username: 'p', displayName: '参拝者さん', avatarUrl: null, roleIds: [ROLE.sanpaisha], isBot: false, joinedAt: new Date() });
    await recordJoin(db, { id: SA, username: 'u', displayName: '氏子さん', avatarUrl: null, roleIds: [ROLE.ujiko], isBot: false, joinedAt: new Date() });
    add(GU, ROLE.sanpaisha);
    add(SA, ROLE.ujiko);
    await seedTogether(3, 30);
    const giver = members.get(GU)!;
    const press = interaction('button', giver, { customId: emaGiveId(SA) });
    await app.onInteraction(press.i as never);
    expect(press.shownModals).toHaveLength(0);
    expect(JSON.stringify(press.replies[0])).toContain(`ema:pick:${SA}`);
    expect(JSON.stringify(press.replies[0])).toContain('ムードメーカー');
    const pick = interaction('stringSelect', giver, { customId: `ema:pick:${SA}`, values: ['聞き手'], deferUpdate: async () => undefined });
    await app.onInteraction(pick.i as never);
    expect(pick.replies.at(-1)?.content).toContain('絵馬を贈りました');
    expect(pick.replies.at(-1)?.content).toContain('参拝者の票');
    const { ema } = await import('../src/db/schema.js');
    expect((await db.select().from(ema))[0]).toMatchObject({ giverId: GU, receiverId: SA, tier: 'sanpai', message: '聞き手' });
    // もう一度押す → 今のひとことと「書き直す・取り消す」
    const again = interaction('button', giver, { customId: emaGiveId(SA) });
    await app.onInteraction(again.i as never);
    expect(again.replies[0]?.content).toContain('聞き手');
    expect(JSON.stringify(again.replies[0])).toContain(`ema:undo:${SA}`);
    // 書き直す → また定型文のメニュー
    const edit = interaction('button', giver, { customId: `ema:edit:${SA}` });
    await app.onInteraction(edit.i as never);
    expect(JSON.stringify(edit.replies[0])).toContain(`ema:pick:${SA}`);
    // 取り消す
    const undo = interaction('button', giver, { customId: `ema:undo:${SA}`, deferUpdate: async () => undefined });
    await app.onInteraction(undo.i as never);
    expect(undo.replies.at(-1)?.content).toContain('取り消しました');
    expect((await db.select().from(ema))[0]?.revokedAt).not.toBeNull();
  });

  it('参拝者どうしでは絵馬を贈れない（モーダルを出さずに理由を出す）', async () => {
    await (await import('../src/services/emaPromotion.js')).setEmaPromotion(db, true, 'guji'); // 絵馬は③が ON のときだけ
    await seedMembers();
    await seedTogether(3);
    // 贈る人を参拝者にする
    const { recordJoin } = await import('../src/services/members.js');
    await recordJoin(db, { id: GU, username: 'ujiko', displayName: '氏子さん', avatarUrl: null, roleIds: [ROLE.sanpaisha], isBot: false, joinedAt: new Date() });
    const giver = members.get(GU)!;
    const press = interaction('button', giver, { customId: emaGiveId(SA) });
    await app.onInteraction(press.i as never);
    expect(press.shownModals).toHaveLength(0);
    expect(press.replies[0]?.content).toContain('参拝者どうし');
  });

  it('いっしょの時間が足りないと贈れない（モーダルを出さずに理由を出す）', async () => {
    await (await import('../src/services/emaPromotion.js')).setEmaPromotion(db, true, 'guji'); // 絵馬は③が ON のときだけ
    await seedMembers();
    await seedTogether(2); // 2日しかない＝条件未満
    const giver = members.get(GU)!;
    const press = interaction('button', giver, { customId: emaGiveId(SA) });
    await app.onInteraction(press.i as never);
    expect(press.shownModals).toHaveLength(0);
    expect(press.replies[0]?.content).toContain('まだ贈れません');
  });

  it('絵馬は③の前は見せない（ボタン・欄・押しても始まっていない）。③のあとは /絵馬 に「頂いた絵馬」が出る', async () => {
    await seedMembers();
    await seedTogether(3);
    const { giveEma } = await import('../src/services/ema.js');
    await giveEma(db, cfg, GU, SA, 'すてきな時間でした');
    const viewer = members.get(GU)!;
    const open = async (commandName: string) => {
      const show = interaction('slash', viewer, { commandName, options: { getUser: () => members.get(SA)!.user, getBoolean: () => null } });
      await app.onInteraction(show.i as never);
      return JSON.stringify(show.replies.at(-1));
    };
    // ③の前：プロフィールに絵馬の欄もボタンも出ない。押しても始まっていない
    const before = await open('goshuin');
    expect(before).not.toContain('頂いた絵馬');
    expect(before).not.toContain(emaGiveId(SA));
    const press = interaction('button', viewer, { customId: emaGiveId(SA) });
    await app.onInteraction(press.i as never);
    expect(press.shownModals).toHaveLength(0);
    expect(press.replies[0]?.content).toContain('新制度が始まってから');
    expect(await open('ema')).toContain('新制度が始まってから');
    // ③のあと：/絵馬 に頂いた絵馬と一言
    await (await import('../src/services/emaPromotion.js')).setEmaPromotion(db, true, 'guji');
    const after = await open('ema');
    expect(after).toContain('頂いた絵馬');
    expect(after).toContain('すてきな時間でした');
  });

  async function seedExistingEma(receiverId: string, n: number) {
    const { ema } = await import('../src/db/schema.js');
    await db.insert(ema).values(Array.from({ length: n }, (_, i) => ({ giverId: String(4760000000000000000n + BigInt(i)), receiverId, tier: 'ujiko' as const, message: '', createdAt: new Date(), revokedAt: null })));
  }

  it('絵馬での昇格がONなら、5枚に届いた参拝者がその場で氏子になる', async () => {
    await seedMembers();
    await seedTogether(3);
    const { setEmaPromotion } = await import('../src/services/emaPromotion.js');
    await setEmaPromotion(db, true, 'guji');
    await seedExistingEma(SA, 4); // すでに4枚。GUの1枚で5枚になる
    const giver = members.get(GU)!;
    await app.onInteraction(interaction('button', giver, { customId: emaGiveId(SA) }).i as never);
    await app.onInteraction(interaction('modal', giver, { customId: emaModalId(SA), fields: { getTextInputValue: () => 'よろしく' } }).i as never);
    expect([...members.get(SA)!.roles.cache.keys()]).toContain(ROLE.ujiko);
    const announce = sent.find((s) => s.channelId === cfg.channels.keiji);
    expect(JSON.stringify(announce?.embeds ?? [])).toContain('絵馬');
  });

  it('絵馬での昇格がOFFなら、5枚になっても昇格しない（従来のまま）', async () => {
    await seedMembers();
    await seedTogether(3);
    await seedExistingEma(SA, 4);
    const giver = members.get(GU)!;
    await app.onInteraction(interaction('button', giver, { customId: emaGiveId(SA) }).i as never);
    await app.onInteraction(interaction('modal', giver, { customId: emaModalId(SA), fields: { getTextInputValue: () => 'よろしく' } }).i as never);
    expect([...members.get(SA)!.roles.cache.keys()]).not.toContain(ROLE.ujiko);
  });

  it('🗳 世話役の選挙：条件を満たすと金土日の選挙が決まり、#世話役選挙 の投稿のボタンで投票・取り消し、月曜に6割を超えたら世話役にして発表する', async () => {
    const { setEmaPromotion } = await import('../src/services/emaPromotion.js');
    const { resetAllShuin } = await import('../src/services/shuin.js');
    const { recordJoin } = await import('../src/services/members.js');
    const { sewayakuElections, sewayakuVotes, voiceChannels, voiceUsage } = await import('../src/db/schema.js');
    const { jstDate } = await import('../src/services/activity.js');
    const { eq } = await import('drizzle-orm');
    await seedMembers();
    const C = '400000000000000091'; // 候補の氏子
    await recordJoin(db, { id: C, username: 'cand', displayName: '候補さん', avatarUrl: null, roleIds: [ROLE.ujiko], isBot: false, joinedAt: new Date() });
    add(C, ROLE.ujiko);
    const real = new Date();
    await resetAllShuin(db, 'guji', new Date(real.getTime() - 120 * 86_400_000)); // 新制度は4か月前から
    await db.insert(voiceChannels).values({ channelId: '400000000000000099', name: '縁側１' });
    await db.insert(voiceUsage).values([
      { memberId: C, date: jstDate(new Date(real.getTime() - 60 * 86_400_000)), channelId: '400000000000000099', minutes: 7200 },
      { memberId: GU, date: jstDate(new Date(real.getTime() - 3 * 86_400_000)), channelId: '400000000000000099', minutes: 1500 },
    ]);
    const vote = (who: string) => interaction('button', members.get(who)!, { customId: `ema:vote:${C}` });
    const profileOfC = async () => {
      const show = interaction('button', members.get(GU)!, { customId: `shuin:card:${C}` });
      await app.onInteraction(show.i as never);
      return JSON.stringify(show.replies.at(-1));
    };
    // ③の前は選挙がない
    const before = vote(GU);
    await app.onInteraction(before.i as never);
    expect(before.replies.at(-1)?.content).toContain('新制度が始まってから');
    await setEmaPromotion(db, true, 'guji');
    // 見回りで選挙が決まる。プロフィールの「⬆️ 次の役職」に選挙の日
    await app.checkSewayakuElection(guild as never, real);
    const [e] = await db.select().from(sewayakuElections);
    expect(e).toMatchObject({ candidateId: C, status: 'scheduled' });
    const prof = await profileOfC();
    expect(prof).toContain('⬆️ 次の役職');
    expect(prof).toContain('選挙の日：');
    expect(prof).not.toContain('お世話役になってほしい'); // 投票はプロフィールではなく #世話役選挙 で
    // 金曜0時をすぎたことにして、選挙をはじめる → #世話役選挙（ないので #慶事）に投稿と投票ボタン
    await db.update(sewayakuElections).set({ startsAt: new Date(real.getTime() - 3_600_000), endsAt: new Date(real.getTime() + 3_600_000) }).where(eq(sewayakuElections.id, e!.id));
    await app.checkSewayakuElection(guild as never, real);
    const post = sent.find((x) => x.channelId === cfg.channels.keiji && JSON.stringify(x).includes('世話役の選挙'));
    expect(JSON.stringify(post)).toContain(`ema:vote:${C}`);
    expect((await db.select().from(sewayakuElections))[0]).toMatchObject({ status: 'open', channelId: cfg.channels.keiji, voterIds: [GU] });
    const p1 = vote(GU);
    await app.onInteraction(p1.i as never);
    expect(p1.replies.at(-1)?.content).toContain('投票しました');
    const p2 = vote(GU);
    await app.onInteraction(p2.i as never);
    expect(p2.replies.at(-1)?.content).toContain('取り消しました');
    // 固めた人に入っていない人は投票できない
    const p3 = vote(SA);
    await app.onInteraction(p3.i as never);
    expect(p3.replies.at(-1)?.content).toContain('この選挙では投票できません');
    // 締め：投票できる人5人のうち4票（80%）
    const voters = ['400000000000000081', '400000000000000082', '400000000000000083', '400000000000000084', '400000000000000085'];
    await db.update(sewayakuElections).set({ voterIds: voters, endsAt: new Date(real.getTime() - 60_000) }).where(eq(sewayakuElections.id, e!.id));
    await db.insert(sewayakuVotes).values(voters.slice(0, 4).map((v) => ({ electionId: e!.id, voterId: v })));
    await app.checkSewayakuElection(guild as never, real);
    expect([...members.get(C)!.roles.cache.keys()]).toContain(ROLE.sewayaku);
    expect([...members.get(C)!.roles.cache.keys()]).not.toContain(ROLE.ujiko);
    const announce = sent.find((x) => x.channelId === cfg.channels.keiji && JSON.stringify(x.embeds ?? []).includes('ご昇格'));
    expect(JSON.stringify(announce?.embeds ?? [])).toContain('5 人中 4 票');
    const log = sent.filter((x) => x.channelId === cfg.channels.log).map((x) => x.content ?? '').join('\n');
    expect(log).toContain('世話役の選挙を締めました');
    expect(log).toContain('4 票／投票できる人 5 人');
    for (const v of voters) expect(log).not.toContain(v); // だれが投票したかは出さない
    expect((await db.select().from(sewayakuElections))[0]?.status).toBe('passed');
    // 2回目は締めない
    const n = sent.length;
    await app.checkSewayakuElection(guild as never, real);
    expect(sent.length).toBe(n);
  });

  it('③ON のとき：プロフィール＝まとめ、/ご縁帳＝ご縁だけ、/絵馬＝絵馬だけ', async () => {
    const { setEmaPromotion } = await import('../src/services/emaPromotion.js');
    await seedMembers();
    await seedTogether(3);
    const { giveEma } = await import('../src/services/ema.js');
    await giveEma(db, cfg, GU, SA, 'すてきな時間でした');
    // お参り期間は絵馬のあとから（期間中の票には数えない＝その場で氏子に上がらない）
    const { startOmairi } = await import('../src/services/applications.js');
    await startOmairi(db, SA, 14, new Date(Date.now() + 1000));
    await setEmaPromotion(db, true, 'guji');
    const open = async (kind: 'profile' | 'goen' | 'ema') => {
      const viewer = members.get(GU)!;
      const x = kind === 'profile'
        ? interaction('button', viewer, { customId: `shuin:card:${SA}` })
        : interaction('slash', viewer, { commandName: kind === 'goen' ? 'goshuin' : 'ema', options: { getUser: () => members.get(SA)!.user, getBoolean: () => null } });
      await app.onInteraction(x.i as never);
      return JSON.stringify(x.replies.at(-1));
    };
    const profile = await open('profile');
    expect(profile).toContain('さまのプロフィール');
    expect(profile).toContain('絵馬 **1** 枚');
    expect(profile).toContain('⬆️ 次の役職');
    expect(profile).toContain('もらった絵馬 0 枚');
    expect(profile).toContain(`shuin:goen:${SA}`);
    expect(profile).toContain(`ema:card:${SA}`);
    expect(profile).not.toContain('頂いた絵馬');
    const goen = await open('goen');
    expect(goen).toContain('役職には使いません');
    expect(goen).not.toContain('⬆️ 次の役職');
    expect(goen).not.toContain('頂いた絵馬');
    const ema = await open('ema');
    expect(ema).toContain('さまの絵馬');
    expect(ema).toContain('頂いた絵馬 **');
    expect(ema).toContain('（氏子の票）');
    expect(ema).toContain('すてきな時間でした');
    expect(ema).toContain('⬆️ 絵馬で次の役職へ');
    expect(ema).not.toContain('結んでくれた人');
  });

  it('🌸 いっぺんに4人以上が上がるときは、1人ずつのカードに通知を付けず、まとめて1回だけ通知する', async () => {
    const { setEmaPromotion } = await import('../src/services/emaPromotion.js');
    const { recordJoin } = await import('../src/services/members.js');
    const { ema } = await import('../src/db/schema.js');
    await setEmaPromotion(db, true, 'guji');
    const ids = ['400000000000000071', '400000000000000072', '400000000000000073', '400000000000000074'];
    for (const [k, id] of ids.entries()) {
      await recordJoin(db, { id, username: `b${k}`, displayName: `b${k}`, avatarUrl: null, roleIds: [ROLE.sanpaisha], isBot: false, joinedAt: new Date() });
      add(id, ROLE.sanpaisha);
      await db.insert(ema).values(Array.from({ length: 5 }, (_, i) => ({ giverId: String(4770000000000000000n + BigInt(k * 10 + i)), receiverId: id, tier: 'ujiko' as const, message: '', createdAt: new Date(), revokedAt: null })));
    }
    await app.checkEvaluationPromotions(guild as never, new Date());
    for (const id of ids) expect([...members.get(id)!.roles.cache.keys()]).toContain(ROLE.ujiko);
    const keiji = sent.filter((s) => s.channelId === cfg.channels.keiji) as { content?: string; embeds?: unknown[] }[];
    const cards = keiji.filter((s) => s.embeds?.length);
    expect(cards).toHaveLength(4);
    for (const c of cards) expect(c.content ?? '').not.toContain('<@&'); // 1人ずつのカードは通知なし
    const summary = keiji.filter((s) => !s.embeds?.length);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.content).toContain('4 名');
    expect(summary[0]!.content).toContain('<@&'); // まとめて1回だけ通知
  });

  it('🎁 ご縁の節目特典：ON＋④リセット後の新しいご縁でだけもらえる（旧ご縁では払わない）・OFFなら渡さない', async () => {
    const { setEmaPromotion } = await import('../src/services/emaPromotion.js');
    const { resetAllShuin } = await import('../src/services/shuin.js');
    const { shuin } = await import('../src/db/schema.js');
    const { recordJoin } = await import('../src/services/members.js');
    const RCV = '400000000000000055';
    await recordJoin(db, { id: RCV, username: 'r', displayName: 'r', avatarUrl: null, roleIds: [], isBot: false, joinedAt: new Date() });
    add(RCV);
    // 旧制度のご縁（ローンチ前からあった分）
    await db.insert(shuin).values({ giverId: '401000000000000001', receiverId: RCV, weight: 30, giverRank: 'sanpaisha' });
    // OFF：渡さない
    await app.checkGoenPerks(guild as never, new Date());
    expect((await walletOf(db, RCV)).balance).toBe(0);
    // ③ON したが ④リセット前：旧ご縁で払わない（当日の手順のすき間で一斉に払われる事故を防ぐ）
    await setEmaPromotion(db, true, 'guji');
    await app.checkGoenPerks(guild as never, new Date());
    expect((await walletOf(db, RCV)).balance).toBe(0);
    // ④リセット（旧ご縁は消える）→ 新制度で結んだご縁30 → 25の節目で 500
    await resetAllShuin(db, 'guji', new Date());
    await db.insert(shuin).values({ giverId: '401000000000000002', receiverId: RCV, weight: 30, giverRank: 'sanpaisha' });
    await app.checkGoenPerks(guild as never, new Date());
    expect((await walletOf(db, RCV)).balance).toBe(500);
    // 冪等：もう一度動かしても増えない
    await app.checkGoenPerks(guild as never, new Date());
    expect((await walletOf(db, RCV)).balance).toBe(500);
  });

  it('🧵 結びのコレクションは④の前は出さない。④のあとは、通話でいっしょになったのにまだ結んでいない人を結べる', async () => {
    await seedMembers();
    const viewer = members.get(GU)!;
    const showOwn = async () => {
      const show = interaction('slash', viewer, { commandName: 'goshuin', options: { getUser: () => viewer.user, getBoolean: () => null } });
      await app.onInteraction(show.i as never);
      return show.replies.at(-1);
    };
    // ④の前：欄もボタンも出ない。前のボタンを押しても始まっていない
    expect(JSON.stringify(await showOwn())).not.toContain('結びのコレクション');
    expect(JSON.stringify(await showOwn())).not.toContain(`shuin:unmet:${GU}`);
    const early = interaction('button', viewer, { customId: `shuin:unmet:${GU}` });
    await app.onInteraction(early.i as never);
    expect(JSON.stringify(early.replies)).toContain('新制度が始まってから');
    // ④のあと（結びの言葉）：通話でいっしょになったSAが出る
    const { setMusubiMode } = await import('../src/domain/terms.js');
    const { setEmaPromotion } = await import('../src/services/emaPromotion.js');
    await setEmaPromotion(db, true, 'guji');
    setMusubiMode(true);
    await seedTogether(1);
    const embed = (await showOwn())?.embeds?.[0];
    const fields = (embed as { fields?: { name: string; value: string }[] } | undefined)?.fields ?? [];
    expect(fields.some((f) => f.name.includes('結びのコレクション'))).toBe(true);
    // 「まだ結んでいない人」ボタン → 選ぶ欄に参拝者SAが出る
    const press = interaction('button', viewer, { customId: `shuin:unmet:${GU}` });
    await app.onInteraction(press.i as never);
    expect(JSON.stringify(press.replies)).toContain(SA);
    setMusubiMode(false);
  });

  it('絵馬での昇格がONでも、必要数（ここでは5枚）に届かない4枚では昇格しない', async () => {
    await seedMembers();
    await seedTogether(3);
    const { setEmaPromotion } = await import('../src/services/emaPromotion.js');
    await setEmaPromotion(db, true, 'guji');
    await seedExistingEma(SA, 3); // GUの1枚で4枚どまり
    // 必要数は毎週きまる（縁側にいた氏子以上の6割）。ここでは最低を5枚にして確かめる
    const strict = new ShuinApp((app as unknown as { client: never }).client, db, { ...cfg, emaThresholds: { ...cfg.emaThresholds, ujikoMin: 5 } });
    const giver = members.get(GU)!;
    await strict.onInteraction(interaction('button', giver, { customId: emaGiveId(SA) }).i as never);
    await strict.onInteraction(interaction('modal', giver, { customId: emaModalId(SA), fields: { getTextInputValue: () => 'よろしく' } }).i as never);
    expect([...members.get(SA)!.roles.cache.keys()]).not.toContain(ROLE.ujiko);
  });
});

describe('🌸 新制度ローンチの通し稽古（③→④→⑤→元に戻す）', () => {
  it('当日の手順どおりに切り替えて、昇格・通知・特典・結び・呼び名・掲示・用語集・コマンド名・特典のゲート・元に戻すまで確かめる', async () => {
    const { setEmaPromotion } = await import('../src/services/emaPromotion.js');
    const { resetAllShuin, undoAllShuinReset, goenOf } = await import('../src/services/shuin.js');
    const { createMusubiSync } = await import('../src/services/musubiSwitch.js');
    const { commandDefinitions } = await import('../src/discord/commands.js');
    const { isMusubiMode, setMusubiMode } = await import('../src/domain/terms.js');
    const { createNotice, getNotice, publishNotice } = await import('../src/services/notices.js');
    const { DEFAULT_NOTICES, DEFAULT_GUIDES } = await import('../src/services/noticeDefaults.js');
    const { seedDefaultTerms, listTerms } = await import('../src/services/glossary.js');
    const { giveFlow } = await import('../src/services/flows.js');
    const { setPerkUjiko, perkUjikoEnabled, meetsUjiko } = await import('../src/services/perkGate.js');
    const { ema } = await import('../src/db/schema.js');
    try {
      // ── 準備（ローンチ前の本番に近い状態） ──
      const SA = ['400000000000000081', '400000000000000082', '400000000000000083', '400000000000000084']; // 参拝者・氏子の票5枚
      const UJ = '400000000000000085'; // 世話役・総代の票200枚（氏子→世話役は毎月の投票なので、絵馬では世話役→総代を確かめる）
      const SB = '400000000000000086'; // 参拝者・絵馬なし（まだ上がらない。必要数は縁側にいた氏子以上がいない週なので最低の1枚）
      const K = '400000000000000087'; // 氏子・旧制度のご縁300（特典の一斉払いの事故が起きやすい人）
      const join = async (id: string, role: string) => {
        await recordJoin(db, { id, username: id.slice(-3), displayName: `u${id.slice(-2)}`, avatarUrl: null, roleIds: [role], isBot: false, joinedAt: new Date() });
        return add(id, role);
      };
      const votes = (receiverId: string, n: number, tier: 'ujiko' | 'sodai', base: bigint) =>
        db.insert(ema).values(Array.from({ length: n }, (_, i) => ({ giverId: String(base + BigInt(i)), receiverId, tier, message: '', createdAt: new Date(), revokedAt: null })));
      for (const [k, id] of SA.entries()) { await join(id, ROLE.sanpaisha); await votes(id, 5, 'ujiko', 4780000000000000000n + BigInt(k * 10)); }
      await join(UJ, ROLE.sewayaku); await votes(UJ, 200, 'sodai', 4790000000000000000n);
      await join(SB, ROLE.sanpaisha);
      await join(K, ROLE.ujiko);
      await db.insert(shuin).values({ giverId: '401000000000000099', receiverId: K, weight: 300, giverRank: 'guji' });

      // 掲示（標準のまま投稿ずみ・#絵馬 のボタン付き・運営が手を入れたもの）と用語集
      const CHS = [
        { id: '960000000000000001', name: 'しきたり', type: 0, parent_id: null, position: 0 },
        { id: '960000000000000002', name: '絵馬-男性', type: 0, parent_id: null, position: 1 },
      ];
      const posted: { channelId: string; body: { content?: string; components?: unknown[] } }[] = [];
      let seq = 0;
      const discord = {
        sendMessage: async (channelId: string, body: { content?: string; components?: unknown[] }) => { posted.push({ channelId, body }); return { id: `n${++seq}` }; },
        editMessage: async (channelId: string, _m: string, body: { content?: string; components?: unknown[] }) => { posted.push({ channelId, body }); },
        deleteMessage: async () => undefined,
        pinMessage: async () => undefined,
        guildChannels: async () => CHS,
      } as never;
      const noticeCtx = { db, cfg, discord };
      const tSys = DEFAULT_NOTICES.find((t) => t.title === '朱印とご縁')!;
      const tBan = DEFAULT_NOTICES.find((t) => t.title === '厄と BAN')!;
      const tGuide = DEFAULT_GUIDES.find((t) => t.channelName === '絵馬-男性' && t.title === '使い方')!;
      const nSys = await createNotice(db, { channelId: CHS[0]!.id, title: tSys.title, body: tSys.body, by: G });
      const nBan = await createNotice(db, { channelId: CHS[0]!.id, title: tBan.title, body: `${tBan.body}\n（運営が書き足した行）`, by: G });
      const nPanel = await createNotice(db, { channelId: CHS[1]!.id, title: tGuide.title, body: tGuide.body, shuinButton: true, by: G });
      await publishNotice(noticeCtx, nSys.id, G);
      await publishNotice(noticeCtx, nPanel.id, G);
      await seedDefaultTerms(db, G);

      // BOT の毎分の仕事（index.ts と同じつなぎ方）
      const registered: (string | undefined)[] = [];
      const syncMusubi = createMusubiSync({
        db, cfg: () => cfg, discord,
        registerCommands: async () => { const defs = commandDefinitions(cfg); registered.push(`${(defs.find((c) => c.name === 'goshuin') as { name_localizations?: Record<string, string> }).name_localizations?.ja}${defs.some((c) => c.name === 'ema') ? '+絵馬' : ''}`); },
        registered: isMusubiMode(),
      });
      const tick = async () => {
        await app.checkEvaluationPromotions(guild as never);
        await app.checkGoenPerks(guild as never);
        await app.checkEmaKeep(guild as never);
        await app.checkSewayakuElection(guild as never); // 前の月の世話役の投票（投票なし＝だれも上がらない）
        await syncMusubi();
      };
      await tick(); // ローンチ前：何も変わらない
      expect(sent.filter((s) => s.channelId === cfg.channels.keiji)).toHaveLength(0);
      expect(isMusubiMode()).toBe(false);
      expect(registered).toEqual([]);
      expect(commandDefinitions(cfg).some((c) => c.name === 'ema' || c.name === 'sewayaku')).toBe(false); // ③の前は新制度のコマンドを出さない

      // ── ③ 絵馬での昇格を ON ──
      await setEmaPromotion(db, true, G);
      await tick();
      for (const id of SA) expect([...members.get(id)!.roles.cache.keys()]).toContain(ROLE.ujiko); // 氏子の票5枚 → 氏子
      expect([...members.get(UJ)!.roles.cache.keys()]).toContain(ROLE.sodai); // 総代の票200枚 → 総代
      expect([...members.get(SB)!.roles.cache.keys()]).not.toContain(ROLE.ujiko); // 絵馬なしはまだ
      const keiji = sent.filter((s) => s.channelId === cfg.channels.keiji);
      expect(keiji.filter((s) => s.embeds?.length)).toHaveLength(5); // 1人ずつのカード
      expect(keiji.filter((s) => s.embeds?.length).every((s) => !(s.content ?? '').includes('<@&'))).toBe(true); // 通知なし
      expect(keiji.filter((s) => !s.embeds?.length).map((s) => s.content)).toEqual([expect.stringContaining('5 名')]); // まとめて1回
      expect((await walletOf(db, K)).balance).toBe(0); // ④の前：旧ご縁300で特典を払わない
      expect(isMusubiMode()).toBe(false); // ③だけでは呼び名は変わらない
      expect(registered).toEqual(['御朱印帳+絵馬']); // ③で /絵馬・/世話役の投票 を出すためにコマンドを登録し直した

      // ── ④ ご縁のリセット ──
      await resetAllShuin(db, G);
      await tick();
      expect(await goenOf(db, K)).toBe(0);
      expect(isMusubiMode()).toBe(true);
      expect(registered).toEqual(['御朱印帳+絵馬', 'ご縁帳+絵馬']); // コマンドの日本語名を登録し直した
      expect((await getNotice(db, nSys.id))!.body).toContain('# 🧵 結び・ご縁・絵馬');
      expect((await getNotice(db, nPanel.id))!.body).toContain('「結ぶ」');
      expect((await getNotice(db, nBan.id))!.body).toContain('朱印'); // 手を入れた掲示は変えない
      expect(JSON.stringify(posted.slice(-3))).toContain('"label":"結ぶ"'); // #絵馬 のボタンも出し直した
      expect(posted.some((p) => p.channelId === cfg.channels.log && (p.body.content ?? '').includes('厄と BAN'))).toBe(true); // 手で直す掲示を #記録 に
      expect((await listTerms(db)).map((t) => t.term)).toEqual(expect.arrayContaining(['結び', 'ご縁帳', '絵馬']));
      // 結び：氏子は重み1・同じ相手には1回きり
      const info = (id: string, role: string) => ({ id, isBot: false, roleIds: [role] });
      // 結べるのは、通話でいっしょになったことのある人だけ
      const { engawaPairs } = await import('../src/db/schema.js');
      await db.insert(engawaPairs).values({ memberA: SA[0]! < SB ? SA[0]! : SB, memberB: SA[0]! < SB ? SB : SA[0]!, date: '2099-01-01', minutes: 10 }); // 新制度が始まったあとの日
      expect(await giveFlow(db, cfg, info(SA[0]!, ROLE.ujiko), info(SB, ROLE.sanpaisha))).toMatchObject({ kind: 'given', weight: 1 });
      expect(await giveFlow(db, cfg, info(SA[0]!, ROLE.sewayaku), info(SB, ROLE.sanpaisha))).toMatchObject({ kind: 'already' });
      // 新しく結んでたまったご縁で、節目特典が出る（ご縁25 → 500銭）
      await db.insert(shuin).values({ giverId: '401000000000000098', receiverId: K, weight: 25, giverRank: 'sanpaisha' });
      await tick();
      expect((await walletOf(db, K)).balance).toBe(500);
      // プロフィールの言葉も結び
      const show = interaction('slash', members.get(SA[0]!)!, { commandName: 'goshuin', options: { getUser: () => members.get(SB)!.user, getBoolean: () => null } });
      await app.onInteraction(show.i as never);
      expect(JSON.stringify(show.replies.at(-1))).toContain('結んでくれた人');
      expect(JSON.stringify(show.replies.at(-1))).not.toContain('朱印');

      // ── ⑤ 特典のゲート（カジノ・宿を氏子から） ──
      await setPerkUjiko(db, true, G);
      expect(await perkUjikoEnabled(db)).toBe(true);
      expect(meetsUjiko(cfg, [ROLE.sanpaisha])).toBe(false);
      expect(meetsUjiko(cfg, [ROLE.ujiko])).toBe(true);

      // ── うまくいかないとき：④を元に戻す ──
      expect((await undoAllShuinReset(db, G)).status).toBe('ok');
      await tick();
      expect(isMusubiMode()).toBe(false);
      expect(registered).toEqual(['御朱印帳+絵馬', 'ご縁帳+絵馬', '御朱印帳+絵馬']); // 日本語名も戻した
      expect((await getNotice(db, nSys.id))!.body).toBe(tSys.body);
      expect((await getNotice(db, nPanel.id))!.body).toBe(tGuide.body);
      expect((await listTerms(db)).map((t) => t.term)).toEqual(expect.arrayContaining(['朱印', '御朱印帳']));
      expect(await goenOf(db, K)).toBe(300 + 25); // 旧ご縁が戻る（新しく結んだ分はそのまま）
    } finally {
      setMusubiMode(false);
    }
  });
});

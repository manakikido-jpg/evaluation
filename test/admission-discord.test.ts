import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { AdmissionApp } from '../src/discord/admission.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { getApplication, getOmairi, startOmairi } from '../src/services/applications.js';
import { recordJoin } from '../src/services/members.js';
import { getSoudan, soudanMessagesOf } from '../src/services/soudan.js';
import { cfg as baseCfg, makeDb, ROLE } from './helpers.js';

const APPS = '900000000000000011';
const SOUDAN = '900000000000000012';
const OMAIRI = '900000000000000013';
const cfg: GuildConfig = { ...baseCfg, channels: { ...baseCfg.channels, applications: APPS, soudan: SOUDAN, omairi: OMAIRI } };

const STAFF = '850000000000000001';
const USER = '850000000000000002';

let db: Db;
let close: () => Promise<void>;
let calls: string[];
let sent: { channelId: string; payload: { embeds?: { title?: string; description?: string }[]; components?: { components: { data: { custom_id?: string } }[] }[] } }[];
let app: AdmissionApp;
let discord: DiscordActions;
let client: unknown;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  calls = [];
  sent = [];
  discord = {
    addRole: async (_g, u, r) => void calls.push(`addRole ${u} ${r}`),
    removeRole: async (_g, u, r) => void calls.push(`removeRole ${u} ${r}`),
    sendDm: async (u, c) => (calls.push(`dm ${u} ${c}`), true),
    ban: async (_g, u) => void calls.push(`ban ${u}`),
    unban: async () => undefined,
    kick: async (_g, u) => void calls.push(`kick ${u}`),
    editMessage: async (c, m, b) => void calls.push(`edit ${c} ${m} ${b.content}`),
    sendMessage: async () => ({ id: '0' }),
    deleteMessage: async () => undefined,
    guildChannels: async () => [],
    guildRoles: async () => [],
    editRole: async () => undefined,
    editChannel: async () => undefined,
    setChannelOverwrite: async () => undefined,
    pinMessage: async () => undefined,
  };
  let n = 0;
  client = {
    channels: {
      fetch: async (channelId: string) => ({
        id: channelId,
        isSendable: () => true,
        send: async (payload: (typeof sent)[number]['payload']) => {
          sent.push({ channelId, payload });
          return { id: `msg${++n}` };
        },
      }),
    },
  };
  app = new AdmissionApp(client as never, db, () => cfg, discord);
  await recordJoin(db, { id: STAFF, username: 's', displayName: '神職さん', avatarUrl: null, roleIds: [ROLE.shinshoku], isBot: false, joinedAt: null });
  await recordJoin(db, { id: USER, username: 'u', displayName: '新人さん', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
});
afterEach(async () => {
  await close();
});

type Reply = { content?: string; components?: { components: { data: { custom_id?: string; label?: string } }[] }[] };

function base(userId: string, roleIds: string[]) {
  const replies: Reply[] = [];
  const modals: { data: { custom_id: string } }[] = [];
  const i = {
    guildId: cfg.guildId,
    user: { id: userId, createdAt: new Date('2026-09-01T00:00:00Z') },
    member: { roles: { cache: new Map(roleIds.map((r) => [r, {}])) }, joinedAt: new Date('2026-09-20T00:00:00Z') },
    deferred: false,
    replied: false,
    inCachedGuild: () => true,
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    async reply(p: Reply) {
      i.replied = true;
      replies.push(p);
    },
    async deferReply() {
      i.deferred = true;
    },
    async deferUpdate() {
      i.deferred = true;
    },
    async editReply(p: Reply | string) {
      replies.push(typeof p === 'string' ? { content: p } : p);
    },
    async followUp(p: Reply) {
      replies.push(p);
    },
    async update(p: Reply) {
      replies.push(p);
    },
    async showModal(m: { toJSON: () => { custom_id: string } }) {
      modals.push({ data: m.toJSON() });
    },
  };
  return { i, replies, modals };
}

const button = (userId: string, roleIds: string[], customId: string) => {
  const b = base(userId, roleIds);
  Object.assign(b.i, { isButton: () => true, customId });
  return b;
};
const modal = (userId: string, roleIds: string[], customId: string, fields: Record<string, string>) => {
  const b = base(userId, roleIds);
  Object.assign(b.i, { isModalSubmit: () => true, customId, fields: { getTextInputValue: (k: string) => fields[k] ?? '' } });
  return b;
};
const command = (userId: string, roleIds: string[], name: string, opts: { sub?: string; int?: number } = {}) => {
  const b = base(userId, roleIds);
  Object.assign(b.i, {
    isChatInputCommand: () => true,
    commandName: name,
    channel: { isSendable: () => true, send: async (p: unknown) => void sent.push({ channelId: 'here', payload: p as never }) },
    options: { getSubcommand: () => opts.sub, getInteger: () => opts.int ?? null },
  });
  return b;
};

describe('入鯖申請（Discord）', () => {
  it('パネルは神職だけが置ける', async () => {
    const denied = command(USER, [], 'panel', { sub: 'apply' });
    await app.onInteraction(denied.i as never);
    expect(denied.replies[0]?.content).toBe('神職・宮司のみ使えます。');
    const ok = command(STAFF, [ROLE.shinshoku], 'panel', { sub: 'apply' });
    await app.onInteraction(ok.i as never);
    expect((sent[0]?.payload as unknown as { components: { components: { custom_id: string }[] }[] }).components[0]?.components[0]?.custom_id).toBe('apply:start');
  });

  it('ボタン → 年齢区分 → フォーム → #申請受付 にカード → 承認', async () => {
    const start = button(USER, [], 'apply:start');
    await app.onInteraction(start.i as never);
    expect(start.replies[0]?.components?.[0]?.components.map((c) => c.data.custom_id)).toEqual(['apply:age:minor', 'apply:age:adult']);

    const age = button(USER, [], 'apply:age:adult');
    await app.onInteraction(age.i as never);
    expect(age.replies[0]?.components?.[0]?.components.map((c) => c.data.custom_id)).toEqual(['apply:gender:adult.male', 'apply:gender:adult.female']);

    const gender = button(USER, [], 'apply:gender:adult.female');
    await app.onInteraction(gender.i as never);
    expect(gender.modals[0]?.data.custom_id).toBe('apply:modal:adult.female');

    const submit = modal(USER, [], 'apply:modal:adult.female', { name: 'さくら', purpose: 'ゲーム', message: 'よろしく' });
    await app.onInteraction(submit.i as never);
    expect(submit.replies.at(-1)?.content).toContain('申請を受け付けました');
    const card = sent.find((s) => s.channelId === APPS)!;
    expect(card.payload.embeds?.[0]?.description).toContain('呼び名: さくら');
    expect(card.payload.embeds?.[0]?.description).toContain('年齢区分: 18 歳以上');
    expect(card.payload.embeds?.[0]?.description).toContain('性別: 女性');
    const approveId = card.payload.components?.[0]?.components[0]?.data.custom_id!;
    expect(approveId).toMatch(/^app:approve:\d+$/);
    const appId = Number(approveId.split(':')[2]);
    expect((await getApplication(db, appId))?.messageId).toBe('msg1');

    // 一般メンバーは承認できない
    const bad = button(USER, [], approveId);
    await app.onInteraction(bad.i as never);
    expect(bad.replies[0]?.content).toBe('神職・宮司のみ使えます。');

    const ok = button(STAFF, [ROLE.shinshoku], approveId);
    await app.onInteraction(ok.i as never);
    expect(ok.replies.at(-1)?.content).toContain('承認しました');
    expect(calls).toContain(`addRole ${USER} ${ROLE.sanpaisha}`);
    expect(calls.some((c) => c.startsWith(`edit ${APPS} msg1 ✅ 承認しました（<@${STAFF}>）`))).toBe(true);
    expect((await getOmairi(db, USER))?.status).toBe('ongoing');
  });
});

describe('自己紹介を書くまでは 絵馬待ち', () => {
  const MALE = '100000000000000071';
  const FEMALE = '100000000000000072';
  const PENDING = '100000000000000073';
  const EMA_M = '900000000000000031';
  const EMA_F = '900000000000000032';
  const cfg2: GuildConfig = {
    ...cfg,
    roles: { ...cfg.roles, male: MALE, female: FEMALE, emaPending: PENDING },
    channels: { ...cfg.channels, ema: EMA_M, emaFemale: EMA_F },
  };
  const msg = (channelId: string, content: string, roleIds: string[]) => {
    const deleted: boolean[] = [];
    const reacted: string[] = [];
    const flashes: string[] = [];
    return {
      deleted,
      reacted,
      flashes,
      m: {
        guildId: cfg.guildId,
        channelId,
        content,
        inGuild: () => true,
        author: { id: USER, bot: false },
        member: { roles: { cache: new Map(roleIds.map((r) => [r, {}])) } },
        delete: async () => void deleted.push(true),
        react: async (e: string) => void reacted.push(e),
        channel: { send: async (p: { content: string }) => (flashes.push(p.content), { delete: async () => undefined }) },
      },
    };
  };

  it('承認すると 性別のロールと 絵馬待ち（参拝者はまだ）。DM で自分の絵馬のリンク', async () => {
    const app2 = new AdmissionApp(client as never, db, () => cfg2, discord);
    const submit = modal(USER, [], 'apply:modal:adult.female', { name: 'さくら', purpose: 'ゲーム' });
    await app2.onInteraction(submit.i as never);
    const card = sent.find((s) => s.channelId === APPS)!;
    const ok = button(STAFF, [ROLE.shinshoku], card.payload.components?.[0]?.components[0]?.data.custom_id!);
    await app2.onInteraction(ok.i as never);
    expect(calls).toContain(`addRole ${USER} ${FEMALE}`);
    expect(calls).toContain(`addRole ${USER} ${PENDING}`);
    expect(calls).not.toContain(`addRole ${USER} ${ROLE.sanpaisha}`);
    expect(calls.find((c) => c.startsWith(`dm ${USER}`))).toContain(`<#${EMA_F}>`);
    expect(await getOmairi(db, USER)).toBeUndefined();

    // もう一度申請しようとしても「自己紹介を書いて」
    const again = modal(USER, [PENDING, FEMALE], 'apply:modal:adult.female', { name: 'さくら', purpose: 'ゲーム' });
    await app2.onInteraction(again.i as never);
    expect(again.replies.at(-1)?.content).toContain(`<#${EMA_F}>`);
  });

  it('ちがうチャンネルに書いたら消して案内。短すぎたら案内。自分のチャンネルに書いたら 参拝者 に', async () => {
    const app2 = new AdmissionApp(client as never, db, () => cfg2, discord);
    const roles = [PENDING, FEMALE];
    const wrong = msg(EMA_M, '【名前】さくら【一言】よろしくお願いします', roles);
    await app2.onMessage(wrong.m as never);
    expect(wrong.deleted).toEqual([true]);
    expect(calls.find((c) => c.startsWith(`dm ${USER}`))).toContain(`<#${EMA_F}>`);

    const short = msg(EMA_F, 'よろしく', roles);
    await app2.onMessage(short.m as never);
    expect(short.flashes[0]).toContain('もう少し詳しく');
    expect(calls).not.toContain(`removeRole ${USER} ${PENDING}`);

    const good = msg(EMA_F, '【名前】さくら【一言】よろしくお願いします', roles);
    await app2.onMessage(good.m as never);
    expect(good.reacted).toEqual(['🌸']);
    expect(calls).toContain(`removeRole ${USER} ${PENDING}`);
    expect(calls).toContain(`addRole ${USER} ${ROLE.sanpaisha}`);
    expect((await getOmairi(db, USER))?.status).toBe('ongoing');
    // 続けて書いても、もう一度は仕上げない
    const n = calls.length;
    await app2.onMessage(msg(EMA_F, '追記です、よろしくお願いします！', roles).m as never);
    expect(calls.length).toBe(n);
  });

  it('前からいる人は、パネルで性別を選べる（1 回だけ）', async () => {
    const app2 = new AdmissionApp(client as never, db, () => cfg2, discord);
    const added: string[] = [];
    const pick = button(USER, [ROLE.ujiko], 'gender:male');
    Object.assign(pick.i.member.roles, { add: async (r: string) => void added.push(r) });
    await app2.onInteraction(pick.i as never);
    expect(added).toEqual([MALE]);
    expect(pick.replies[0]?.content).toContain(`<#${EMA_M}>`);
    const again = button(USER, [ROLE.ujiko, MALE], 'gender:female');
    await app2.onInteraction(again.i as never);
    expect(again.replies[0]?.content).toContain('もう「男性」');
  });
});

describe('相談（Discord）', () => {
  it('/soudan → フォーム → #相談窓口 に匿名のカード → 神職が返信 → 本人に DM', async () => {
    const cmd = command(USER, [ROLE.ujiko], 'soudan');
    await app.onInteraction(cmd.i as never);
    expect(cmd.modals[0]?.data.custom_id).toBe('soudan:modal:new');

    const submit = modal(USER, [ROLE.ujiko], 'soudan:modal:new', { body: '通話で困っています' });
    await app.onInteraction(submit.i as never);
    expect(submit.replies.at(-1)?.content).toContain('相談 #1 を受け付けました');
    const card = sent.find((s) => s.channelId === SOUDAN)!;
    expect(card.payload.embeds?.[0]?.title).toBe('📮 相談 #1（匿名）');
    expect(JSON.stringify(card.payload)).not.toContain(USER);

    const replyBtn = button(STAFF, [ROLE.shinshoku], 'soudan:reply:1');
    await app.onInteraction(replyBtn.i as never);
    expect(replyBtn.modals[0]?.data.custom_id).toBe('soudan:replymodal:1');

    const reply = modal(STAFF, [ROLE.shinshoku], 'soudan:replymodal:1', { body: 'お話を聞かせてください' });
    await app.onInteraction(reply.i as never);
    expect(reply.replies.at(-1)?.content).toBe('返信を送りました。');
    const dm = calls.find((c) => c.startsWith(`dm ${USER}`))!;
    expect(dm).toContain('お話を聞かせてください');
    expect(dm).not.toContain(STAFF);

    // 続き（本人だけ）
    const cont = modal(USER, [ROLE.ujiko], 'soudan:modal:1', { body: 'ありがとうございます' });
    await app.onInteraction(cont.i as never);
    expect((await soudanMessagesOf(db, 1)).map((m) => m.fromRole)).toEqual(['sender', 'staff', 'sender']);
    const other = modal(STAFF, [ROLE.shinshoku], 'soudan:modal:1', { body: 'なりすまし' });
    await app.onInteraction(other.i as never);
    expect(other.replies.at(-1)?.content).toContain('見つかりません');

    const done = button(STAFF, [ROLE.shinshoku], 'soudan:done:1');
    await app.onInteraction(done.i as never);
    expect((await getSoudan(db, 1))?.status).toBe('done');
  });
});

describe('お参り期間（Discord）', () => {
  it('判定待ちになった人を #お参り判定 に出し、ボタンで判定', async () => {
    const past = new Date('2026-08-01T00:00:00Z');
    await startOmairi(db, USER, 14, past);
    // 自動延長を使い切った状態にする
    await app.checkOmairi(new Date('2026-08-20T00:00:00Z'));
    await app.checkOmairi(new Date('2026-09-20T00:00:00Z'));
    const card = sent.find((s) => s.channelId === OMAIRI)!;
    expect(card.payload.embeds?.[0]?.title).toBe('お参り期間の判定');
    const ids = card.payload.components?.[0]?.components.map((c) => c.data.custom_id);
    expect(ids).toEqual([`omairi:extend:${USER}`, `omairi:promote:${USER}`, `omairi:remove:${USER}`]);

    // 退出は確認ボタンを挟む
    const ask = button(STAFF, [ROLE.shinshoku], `omairi:remove:${USER}`);
    await app.onInteraction(ask.i as never);
    expect(ask.replies[0]?.components?.[0]?.components[0]?.data.custom_id).toBe(`omairi:removeok:${USER}`);
    expect(calls.some((c) => c.startsWith('kick'))).toBe(false);

    const b = button(STAFF, [ROLE.shinshoku], `omairi:promote:${USER}`);
    await app.onInteraction(b.i as never);
    expect(b.replies.at(-1)?.content).toContain('昇格させました');
    expect(calls).toContain(`addRole ${USER} ${ROLE.ujiko}`);

    // 判定済みのあとで確認ボタンを押しても何もしない
    const late = button(STAFF, [ROLE.shinshoku], `omairi:removeok:${USER}`);
    await app.onInteraction(late.i as never);
    expect(late.replies.at(-1)?.content).toBe('すでに判定済みです。');
    expect(calls.some((c) => c.startsWith('kick'))).toBe(false);
  });
});

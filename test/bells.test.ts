import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { BellApp } from '../src/discord/bell.js';
import { panelMessage } from '../src/discord/panels.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { bellCardText, doneBell, ringBell, takeBell } from '../src/services/bells.js';
import { cfg as baseCfg, makeDb, ROLE } from './helpers.js';

const U = '870000000000000011';
const S = '870000000000000012';
const BELL_CH = '900000000000000077';
const T0 = new Date('2026-09-27T12:00:00Z');
const cfg: GuildConfig = { ...baseCfg, bell: { channelId: BELL_CH, cooldownMinutes: 5, mentionStaff: true, roleIds: [], channelIds: [] } };

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

describe('呼び鈴', () => {
  it('鳴らすと記録。待っている間・続けては鳴らせない。対応する → 対応済み', async () => {
    const r = await ringBell(db, cfg, { memberId: U, channelId: 'c', voiceChannelId: 'v', reason: '荒らしがいます' }, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(bellCardText(r.bell)).toContain('荒らしがいます');
    expect(bellCardText(r.bell)).toContain('<#v>');
    expect((await ringBell(db, cfg, { memberId: U }, T0)).status).toBe('waiting');
    expect((await takeBell(db, r.bell.id, S, T0))?.status).toBe('taken');
    expect(await takeBell(db, r.bell.id, S, T0)).toBeUndefined();
    expect(bellCardText((await doneBell(db, r.bell.id, S, T0))!)).toContain('対応済み');
    expect(await doneBell(db, r.bell.id, S, T0)).toBeUndefined();
    expect(await ringBell(db, cfg, { memberId: U }, new Date(T0.getTime() + 60_000))).toEqual({ status: 'cooldown', minutes: 4 });
    expect((await ringBell(db, cfg, { memberId: U }, new Date(T0.getTime() + 5 * 60_000))).status).toBe('ok');
  });

  it('呼べるロール: 設定になければ運営の役職。1 つだけならすぐフォーム', async () => {
    const { bellRoles } = await import('../src/services/bells.js');
    expect(bellRoles(cfg)).toEqual(cfg.ranks.filter((r) => !r.auto).map((r) => r.roleId));
    expect(bellRoles({ ...cfg, bell: { ...cfg.bell, roleIds: [ROLE.sewayaku] } })).toEqual([ROLE.sewayaku]);
  });

  it('パネル: 「運営を呼ぶ」ボタン', () => {
    const p = panelMessage('bell');
    expect(p.components[0]!.components[0]).toMatchObject({ custom_id: 'bell:ring', label: '運営を呼ぶ' });
  });

  it('Discord: 呼ぶロールを選ぶ → 内容を書く → 運営のチャンネルにカード（そのロールに通知）→ 対応すると本人に DM', async () => {
    const sent: { channelId: string; payload: { content: string; allowedMentions: { roles: string[] }; components: { toJSON(): { components: { custom_id: string }[] } }[] } }[] = [];
    const dms: string[] = [];
    const client = {
      channels: {
        fetch: async (id: string) => ({
          id,
          isSendable: () => true,
          send: async (payload: never) => (sent.push({ channelId: id, payload }), { id: 'card1' }),
        }),
      },
    };
    const discord = { sendDm: async (u: string, t: string) => (dms.push(`${u} ${t}`), true) } as unknown as DiscordActions;
    const app = new BellApp(client as never, db, () => cfg, discord);
    const replies: string[] = [];
    const selects: string[] = [];
    const modals: string[] = [];
    const base = (userId: string, roleIds: string[]) => ({
      guildId: cfg.guildId,
      guild: { roles: { cache: new Map([[ROLE.shinshoku, { name: '🎐 神職' }], [ROLE.guji, { name: '⛩ 宮司' }]]) } },
      isStringSelectMenu: () => false,
      showModal: async (m: { toJSON(): { custom_id: string } }) => void modals.push(m.toJSON().custom_id),
      channelId: '900000000000000001',
      user: { id: userId },
      member: { roles: { cache: new Map(roleIds.map((r) => [r, {}])) }, voice: { channelId: null } },
      inCachedGuild: () => true,
      isChatInputCommand: () => false,
      isButton: () => false,
      isModalSubmit: () => false,
      isRepliable: () => true,
      deferred: false,
      replied: false,
      deferReply: async () => undefined,
      editReply: async (t: string) => void replies.push(t),
      reply: async (p: { content: string; components?: { toJSON(): { components: { custom_id: string; options: { value: string }[] }[] } }[] }) => {
        replies.push(p.content);
        const c = p.components?.[0]?.toJSON().components[0];
        if (c) selects.push(`${c.custom_id} ${c.options.map((o) => o.value).join(',')}`);
      },
      update: async () => void replies.push('updated'),
    });
    // ボタン → だれを呼ぶか（運営の役職が 2 つあるので選ぶ）
    await app.onInteraction({ ...base(U, []), isButton: () => true, customId: 'bell:ring' } as never);
    expect(selects[0]).toBe(`bell:pick ${ROLE.shinshoku},${ROLE.guji}`);
    await app.onInteraction({ ...base(U, []), isStringSelectMenu: () => true, customId: 'bell:pick', values: [ROLE.shinshoku] } as never);
    expect(modals[0]).toBe(`bell:modal:${ROLE.shinshoku}`);
    const modal = { ...base(U, []), isModalSubmit: () => true, customId: `bell:modal:${ROLE.shinshoku}`, fields: { getTextInputValue: () => '使い方が分かりません' } };
    await app.onInteraction(modal as never);
    expect(replies.at(-1)).toContain('呼びました');
    expect(sent[0]!.channelId).toBe(BELL_CH);
    expect(sent[0]!.payload.allowedMentions.roles).toEqual([ROLE.shinshoku]);
    expect(sent[0]!.payload.content).toBe(`<@&${ROLE.shinshoku}>`);
    const takeId = sent[0]!.payload.components[0]!.toJSON().components[0]!.custom_id;
    expect(takeId).toMatch(/^bell:take:\d+$/);

    // 一般の人は対応できない
    await app.onInteraction({ ...base(U, []), isButton: () => true, customId: takeId } as never);
    expect(replies.at(-1)).toBe('呼ばれたロールの人と、神職・宮司だけが使えます。');
    await app.onInteraction({ ...base(S, [ROLE.shinshoku]), isButton: () => true, customId: takeId } as never);
    expect(replies.at(-1)).toBe('updated');
    expect(dms[0]).toContain(`${U} 🔔 呼び鈴 #1 を受け付けました`);
  });
});

describe('呼び鈴のボタンをいちばん下に', () => {
  it('決めたチャンネルに置き、話が落ち着いたら置き直す（前のは消す）', async () => {
    const { BellStickyApp } = await import('../src/discord/bell.js');
    const CH = '900000000000000088';
    const BOT = '999000000000000001';
    let seq = 0;
    type M = { id: string; author: { id: string }; components: { components: { customId: string }[] }[]; delete: () => Promise<void> };
    const messages: M[] = [];
    const channel = {
      id: CH,
      client: { user: { id: BOT } },
      isTextBased: () => true,
      isSendable: () => true,
      messages: {
        fetch: async () => {
          const list = [...messages].reverse();
          return { first: () => list[0], values: () => list.values() };
        },
      },
      send: async (body: { components: { toJSON(): { components: { custom_id: string }[] } }[] }) => {
        const m: M = {
          id: `b${++seq}`,
          author: { id: BOT },
          components: body.components.map((r) => ({ components: r.toJSON().components.map((c) => ({ customId: c.custom_id })) })),
          delete: async () => void messages.splice(messages.indexOf(m), 1),
        };
        messages.push(m);
      },
    };
    const guild = { channels: { cache: new Map([[CH, channel]]) } };
    const c2: GuildConfig = { ...cfg, bell: { ...cfg.bell, channelIds: [CH] } };
    const app = new BellStickyApp(() => c2, 10);
    app.attach(guild as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(messages.map((m) => m.id)).toEqual(['b1']);
    messages.push({ id: `u${++seq}`, author: { id: U }, components: [], delete: async () => undefined });
    app.onMessage({ inGuild: () => true, guildId: cfg.guildId, channelId: CH, author: { id: U }, client: { user: { id: BOT } }, components: [] } as never);
    await new Promise((r) => setTimeout(r, 40));
    expect(messages.map((m) => m.id)).toEqual(['u2', 'b3']);
  });
});

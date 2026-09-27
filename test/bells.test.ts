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
const cfg: GuildConfig = { ...baseCfg, bell: { channelId: BELL_CH, cooldownMinutes: 5, mentionStaff: true } };

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

  it('パネル: 「運営を呼ぶ」ボタン', () => {
    const p = panelMessage('bell');
    expect(p.components[0]!.components[0]).toMatchObject({ custom_id: 'bell:ring', label: '運営を呼ぶ' });
  });

  it('Discord: 呼ぶと運営のチャンネルにカード（神職に通知）→ 神職が対応すると本人に DM', async () => {
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
    const base = (userId: string, roleIds: string[]) => ({
      guildId: cfg.guildId,
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
      reply: async (p: { content: string }) => void replies.push(p.content),
      update: async () => void replies.push('updated'),
    });
    const modal = { ...base(U, []), isModalSubmit: () => true, customId: 'bell:modal', fields: { getTextInputValue: () => '使い方が分かりません' } };
    await app.onInteraction(modal as never);
    expect(replies.at(-1)).toContain('運営を呼びました');
    expect(sent[0]!.channelId).toBe(BELL_CH);
    const staffRoles = cfg.ranks.filter((r) => !r.auto).map((r) => r.roleId);
    expect(sent[0]!.payload.allowedMentions.roles).toEqual(staffRoles);
    const takeId = sent[0]!.payload.components[0]!.toJSON().components[0]!.custom_id;
    expect(takeId).toMatch(/^bell:take:\d+$/);

    // 一般の人は対応できない
    await app.onInteraction({ ...base(U, []), isButton: () => true, customId: takeId } as never);
    expect(replies.at(-1)).toBe('神職・宮司のみ使えます。');
    await app.onInteraction({ ...base(S, [ROLE.shinshoku]), isButton: () => true, customId: takeId } as never);
    expect(replies.at(-1)).toBe('updated');
    expect(dms[0]).toContain(`${U} 🔔 呼び鈴 #1 を受け付けました`);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { parseShuinId, shuinId } from '../src/discord/ids.js';
import { vcList, vcPanel, VC_LIST_MAX } from '../src/discord/views.js';
import { VoicePanelApp } from '../src/discord/voicePanel.js';
import { giveShuin, revokeShuin, stampedBy } from '../src/services/shuin.js';
import { cfg, makeDb } from './helpers.js';

const VC = '950000000000000001';
const A = '810000000000000001';
const B = '810000000000000002';
const C = '810000000000000003';

describe('通話のチャットのカード', () => {
  it('ボタンの ID は通話のチャンネル', () => {
    const json = JSON.stringify(vcPanel(VC).components![0]!.toJSON());
    expect(json).toContain(shuinId('vc', VC));
    expect(parseShuinId(shuinId('vc', VC))).toEqual({ action: 'vc', userId: VC });
  });

  it('通話にいる人をボタンで並べる。押した人は ✅（押せない代わりに御朱印帳）', () => {
    const r = vcList(
      [
        { id: A, name: 'さくら', stamped: false },
        { id: B, name: 'もみじ', stamped: true },
      ],
      2,
    );
    const buttons = r.components!.flatMap((row) => row.toJSON().components) as { custom_id: string; label: string }[];
    expect(buttons.map((b) => [b.custom_id, b.label])).toEqual([
      [shuinId('give', A), 'さくら'],
      [shuinId('card', B), 'もみじ（押した）'],
    ]);
  });

  it('たくさんいるときは 20 人まで（5 人ずつ 4 行）。ほかの人への押し方を書く。誰もいなければそう言う', () => {
    const many = Array.from({ length: 23 }, (_, i) => ({ id: `81000000000000${1000 + i}`, name: `人${i}`, stamped: false }));
    const r = vcList(many, many.length);
    expect(r.components).toHaveLength(4);
    expect(r.components!.flatMap((row) => row.toJSON().components)).toHaveLength(VC_LIST_MAX);
    expect(r.content).toContain('右クリック');
    expect(vcList([], 0).content).toContain('ほかの方がいません');
  });
});

describe('押した相手', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => {
    await close();
  });

  it('今押している相手だけ（取り消したものは除く）', async () => {
    await giveShuin(db, { giverId: A, receiverId: B, weight: 1, giverRank: 'ujiko' });
    await giveShuin(db, { giverId: A, receiverId: C, weight: 1, giverRank: 'ujiko' });
    await revokeShuin(db, { giverId: A, receiverId: C });
    expect([...(await stampedBy(db, A, [B, C]))]).toEqual([B]);
    expect((await stampedBy(db, A, [])).size).toBe(0);
  });
});

describe('通話に入ったとき', () => {
  /** 偽の通話チャンネル（チャットのメッセージを持つ） */
  function fakeVoice(id = VC) {
    const BOT = '999000000000000001';
    let seq = 0;
    const messages: { id: string; author: { id: string }; components: { components: { customId: string }[] }[]; delete: () => Promise<void> }[] = [];
    const channel = {
      id,
      client: { user: { id: BOT } },
      isTextBased: () => true,
      isSendable: () => true,
      messages: {
        // 新しい順
        fetch: async () => {
          const list = [...messages].reverse();
          return { first: () => list[0], values: () => list.values() };
        },
      },
      send: async (body: { components?: { toJSON(): { components: { custom_id: string }[] } }[] }) => {
        const m = {
          id: `m${++seq}`,
          author: { id: BOT },
          components: (body.components ?? []).map((r) => ({ components: r.toJSON().components.map((c) => ({ customId: c.custom_id })) })),
          delete: async () => void messages.splice(messages.indexOf(m), 1),
        };
        messages.push(m);
      },
    };
    const say = (author: string) =>
      messages.push({ id: `u${++seq}`, author: { id: author }, components: [], delete: async () => undefined });
    return { channel, messages, say };
  }
  const state = (channel: unknown, channelId: string | null, bot = false) =>
    ({ channel, channelId, guild: { id: cfg.guildId, afkChannelId: null }, member: { user: { bot } } }) as never;
  const settle = () => new Promise((r) => setTimeout(r, 10));

  it('入ったらカードを出す。いちばん下にあれば出さない。話が流れたら出し直して前のは消す', async () => {
    const app = new VoicePanelApp(() => cfg);
    const v = fakeVoice();
    app.onVoiceStateUpdate(state(null, null), state(v.channel, VC));
    await settle();
    expect(v.messages).toHaveLength(1);
    app.onVoiceStateUpdate(state(null, null), state(v.channel, VC));
    await settle();
    expect(v.messages).toHaveLength(1);
    v.say(A);
    app.onVoiceStateUpdate(state(null, null), state(v.channel, VC));
    await settle();
    expect(v.messages.map((m) => m.id)).toEqual(['u2', 'm3']);
  });

  it('BOT・同じ通話の中での変化（ミュートなど）・「➕ ○○をひらく」では出さない', async () => {
    const hub = '950000000000000009';
    const app = new VoicePanelApp(() => ({ ...cfg, tempVoice: { hubs: [{ channelId: hub, name: '{name}の部屋' }] } }));
    const v = fakeVoice();
    const h = fakeVoice(hub);
    app.onVoiceStateUpdate(state(null, null), state(v.channel, VC, true));
    app.onVoiceStateUpdate(state(v.channel, VC), state(v.channel, VC));
    app.onVoiceStateUpdate(state(null, null), state(h.channel, hub));
    await settle();
    expect(v.messages).toHaveLength(0);
    expect(h.messages).toHaveLength(0);
  });
});

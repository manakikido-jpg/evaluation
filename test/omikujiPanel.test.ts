import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { commandDefinitions } from '../src/discord/commands.js';
import { OmikujiApp, omikujiPanelBody } from '../src/discord/omikuji.js';
import { listAudit } from '../src/services/audit.js';
import { loadOmikujiPanel, restickPanel, saveOmikujiPanel, type OmikujiPanelPlace } from '../src/services/omikujiPanel.js';
import { cfg, makeDb } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => close());

const CH = '970000000000000001';
const M1 = '970000000000000011';
const M2 = '970000000000000012';

/** チャンネルのまね（書き込みの ID を順に並べる） */
function fakeChannel(ids: string[]) {
  const log: string[] = [];
  return {
    ids,
    log,
    ops: {
      lastMessageId: async () => ids.at(-1),
      send: async () => {
        const id = String(970000000000000100n + BigInt(ids.length));
        ids.push(id);
        log.push(`send ${id}`);
        return id;
      },
      remove: async (id: string) => {
        ids.splice(ids.indexOf(id), 1);
        log.push(`remove ${id}`);
      },
    },
  };
}

describe('⛩ 御神籤を引くボタン', () => {
  it('ボタンだけ（通話だけのときは、そう書く）', () => {
    const b = omikujiPanelBody({ omikujiVoiceOnly: true });
    expect(b.components[0]!.components.map((c) => [c.custom_id, c.label])).toEqual([['omikuji:draw', '御神籤を引く']]);
    expect(b.content).toContain('通話に入っているときだけ');
    expect(omikujiPanelBody({ omikujiVoiceOnly: false }).content).not.toContain('通話');
  });

  it('/パネル おみくじ がある', () => {
    const panel = commandDefinitions(cfg).find((d) => d.name === 'panel') as { options?: { name: string; name_localizations?: Record<string, string> }[] };
    expect(panel.options?.find((o) => o.name === 'omikuji')?.name_localizations?.ja).toBe('おみくじ');
  });

  it('置き場所を覚える', async () => {
    expect(await loadOmikujiPanel(db)).toEqual({ channelId: undefined, messageId: undefined });
    await saveOmikujiPanel(db, { channelId: CH, messageId: M1 }, 'u');
    expect(await loadOmikujiPanel(db)).toEqual({ channelId: CH, messageId: M1 });
    await saveOmikujiPanel(db, {}, 'u');
    expect(await loadOmikujiPanel(db)).toEqual({ channelId: undefined, messageId: undefined });
  });

  it('いちばん下にあれば何もしない・流れたら下に出し直して前のを消す', async () => {
    const saved: OmikujiPanelPlace[] = [];
    const save = async (p: OmikujiPanelPlace) => void saved.push(p);
    // まだ置いていない（チャンネルだけ決まった）→ 出す
    const ch = fakeChannel(['970000000000000001']);
    expect(await restickPanel({ channelId: CH }, ch.ops, save)).toBe('moved');
    const first = ch.ids.at(-1)!;
    expect(saved.at(-1)).toEqual({ channelId: CH, messageId: first });
    // いちばん下にある → そのまま
    expect(await restickPanel({ channelId: CH, messageId: first }, ch.ops, save)).toBe('ok');
    // だれかが引いて上に流れた → 新しいのを出して覚えてから、前のを消す
    ch.ids.push('970000000000000050');
    expect(await restickPanel({ channelId: CH, messageId: first }, ch.ops, save)).toBe('moved');
    const second = saved.at(-1)!.messageId!;
    expect(second).not.toBe(first);
    expect(ch.log.slice(-2)).toEqual([`send ${second}`, `remove ${first}`]);
    expect(ch.ids.filter((id) => id === first)).toEqual([]);
    expect(ch.ids.at(-1)).toBe(second);
    // チャンネルを決めていなければ何もしない
    expect(await restickPanel({}, ch.ops, save)).toBe('ok');
  });

  it('ボタンの書き込みを消したら、置くのをやめる（ほかの書き込みを消しても変わらない）', async () => {
    await saveOmikujiPanel(db, { channelId: CH, messageId: M1 }, 'u');
    const app = new OmikujiApp(db, () => cfg);
    await app.attach({ channels: { cache: { get: () => undefined } } } as never);
    await app.onMessageDelete({ id: M2, guildId: cfg.guildId });
    expect(await loadOmikujiPanel(db)).toEqual({ channelId: CH, messageId: M1 });
    await app.onMessageDelete({ id: M1, guildId: cfg.guildId });
    expect(await loadOmikujiPanel(db)).toEqual({ channelId: undefined, messageId: undefined });
    expect((await listAudit(db, { action: 'omikuji.panel_off' })).length).toBe(1);
  });
});

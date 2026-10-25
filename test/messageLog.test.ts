import { describe, expect, it, vi } from 'vitest';
import { deletedLogText, MessageLogApp } from '../src/discord/messageLog.js';
import { cfg } from './helpers.js';

const LOG = '990000000000000901';
const CH = '990000000000000902';
const U = '990000000000000903';
const files = (list: { name: string; url: string }[]) => ({ values: () => list.values() });

describe('🗑 消されたメッセージの記録', () => {
  it('中身・書いた人・消した人・添付の名前を出す。中身が取れないときは理由を書く', () => {
    const m = { id: '1', channelId: CH, guildId: cfg.guildId, createdTimestamp: 1_790_000_000_000, author: { id: U, bot: false }, content: 'こんにちは\n2 行目', attachments: files([{ name: 'a.png', url: 'x' }]) };
    const t = deletedLogText(m, { content: true, by: '990000000000000904' });
    expect(t).toContain(`<#${CH}>`);
    expect(t).toContain(`<@${U}>`);
    expect(t).toContain('<@990000000000000904>');
    expect(t).toContain('> こんにちは\n> 2 行目');
    expect(t).toContain('📎 a.png');
    expect(deletedLogText({ ...m, content: '' }, { content: false })).toContain('MESSAGE CONTENT INTENT');
    expect(deletedLogText({ ...m, content: null, author: null }, { content: true })).toContain('書いた人: 分かりません');
  });

  it('全チャンネルの単件・一括削除をDiscordへ通知しない。監査ログも取得しない', async () => {
    const sendMessage = vi.fn(async () => ({ id: 'm' }));
    const app = new MessageLogApp(() => ({ ...cfg, channels: { ...cfg.channels, log: LOG } }), { sendMessage }, true);
    const base = { id: '1', channelId: CH, guildId: cfg.guildId, createdTimestamp: Date.now(), author: { id: U, bot: false }, content: 'けした' };
    const fetchAuditLogs=vi.fn();
    await app.onDelete({...base,guild:{fetchAuditLogs} as never});
    expect(fetchAuditLogs).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    sendMessage.mockClear();
    await app.onDelete({ ...base, author: { id: U, bot: true } });
    await app.onDelete({ ...base, channelId: LOG });
    await app.onDelete({ ...base, guildId: '990000000000000999' });
    expect(sendMessage).not.toHaveBeenCalled();
    await app.onBulkDelete([base, { ...base, id: '2', content: 'ふたつめ' }]);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

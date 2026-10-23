import { describe, expect, it } from 'vitest';
import { postableUpdateChannels, updatePostMention, updatePostMessage } from '../src/services/updatePosts.js';

const ch = (id: string, name: string, type = 0) => ({ id, name, type });
const base = { id: 1, title: '題', body: '本文', imageType: null, imageData: null, imagePosition: 'bottom' as const };

describe('📝 投稿文', () => {
  it('はじめの投稿先は名前で探す（「院のしきたり」は本殿・宿坊に当たらない）。決めたあとは決めたものだけ', () => {
    const list = [ch('1', '📜｜お触書'), ch('2', '境内-雑談'), ch('3', '本殿のしきたり'), ch('4', '院のしきたり'), ch('5', '宿坊のしきたり'), ch('6', 'イベント告知', 5), ch('7', 'ふつうの部屋'), ch('8', 'お触書', 2)];
    expect(postableUpdateChannels({}, list).map((c) => c.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(postableUpdateChannels({ channelIds: ['7', '8'] }, list).map((c) => c.id)).toEqual(['7']);
  });

  it('メンションはカードの外、普通のメッセージは 1 行目。選んだ相手にだけ鳴らす', () => {
    const card = updatePostMessage({ ...base, style: 'embed', mention: '700000000000000001,700000000000000002' });
    expect(card.content).toBe('<@&700000000000000001> <@&700000000000000002>');
    expect(card.embeds?.[0]?.description).toBe('**題**\n\n本文');
    expect(card.allowed_mentions).toEqual({ parse: [], roles: ['700000000000000001', '700000000000000002'] });
    const text = updatePostMessage({ ...base, style: 'text', mention: 'everyone' });
    expect(text.content).toBe('@everyone\n**題**\n\n本文');
    expect(text.allowed_mentions).toEqual({ parse: ['everyone'] });
    expect(updatePostMessage({ ...base, style: 'embed', mention: 'ranks' }, ['700000000000000009']).content).toBe('<@&700000000000000009>');
    expect(updatePostMessage({ ...base, style: 'embed', mention: '' }).allowed_mentions).toEqual({ parse: [] });
  });

  it('「🔔 通知あり」は通知OK のロールに通知する（用意していなければ通知なし）', () => {
    const OK = '700000000000000050';
    expect(updatePostMention({ mentionKind: 'notify' }, { roleIds: new Set(), notifyRoleId: OK })).toBe(OK);
    expect(updatePostMention({ mentionKind: 'notify' }, { roleIds: new Set() })).toBe('');
    expect(updatePostMention({ mentionKind: 'roles', mentionRoles: ['700000000000000001', '700000000000000099'] }, { roleIds: new Set(['700000000000000001']) })).toBe('700000000000000001');
    expect(updatePostMessage({ ...base, style: 'embed', mention: OK }).allowed_mentions).toEqual({ parse: [], roles: [OK] });
  });
});

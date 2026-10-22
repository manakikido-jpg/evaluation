import { describe, expect, it } from 'vitest';
import { PlacePicker } from '../src/web/views/boostTime.js';

const channels = [
  { id: 'cat', name: '運営', type: 4, position: 0, parent_id: null },
  { id: 'vc', name: '会議室', type: 2, position: 1, parent_id: 'cat' },
];

describe('数える場所の折りたたみ', () => {
  it('閉じた状態でも、保存済みのチェックを有効なフォーム項目として残す', () => {
    const html = PlacePicker({ channels, categoryIds: ['cat'], channelIds: ['vc'] }).toString();
    expect(html).toContain('<details class="place-picker">');
    expect(html).toContain('<summary>通話・カテゴリを確認／変更</summary>');
    expect(html).toMatch(/name="categoryIds" value="cat" checked/);
    expect(html).toMatch(/name="channelIds" value="vc" checked/);
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('open=');
  });
  it('新規作成は未選択で、全部の通話を数えることを説明する', () => {
    const html = PlacePicker({ channels }).toString();
    expect(html).not.toContain('checked');
    expect(html).toContain('何も選ばなければ、AFK などを除いた全部の通話');
    expect(html).toContain('あとで足した通話も含みます');
    expect(PlacePicker({ channels: [] }).toString()).toContain('通話チャンネルを読みこめませんでした');
  });
});

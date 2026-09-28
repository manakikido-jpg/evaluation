import { describe, expect, it } from 'vitest';
import { commandList, memberCommandsText } from '../src/services/commandList.js';
import { renderNotice } from '../src/services/notices.js';
import { cfg } from './helpers.js';

describe('⌨ コマンドのまとめ', () => {
  it('登録しているコマンドから作る。日本語の名前・説明、だれでも／運営、項目とサブコマンド', () => {
    const list = commandList();
    const byName = new Map(list.map((c) => [c.name, c]));
    expect(byName.get('残高')).toMatchObject({ staff: false, kind: 'slash' });
    expect(byName.get('御朱印帳')?.options.map((o) => o.name)).toEqual(['相手', '公開']);
    const panel = byName.get('パネル')!;
    expect(panel.staff).toBe(true);
    expect(panel.subcommands.map((s) => s.name)).toContain('朱印');
    const yaku = byName.get('厄')!;
    expect(yaku.subcommands.find((s) => s.name === '付ける')?.options).toContainEqual({ name: '相手', description: '', required: true });
    // 【神職】の印は外す
    expect(byName.get('メモ')?.description).not.toContain('【');
    expect(list.some((c) => c.kind === 'menu')).toBe(true);
  });

  it('掲示の {コマンド一覧} は、だれでも使えるコマンドだけ', () => {
    const text = memberCommandsText();
    expect(text).toContain('`/残高`');
    expect(text).toContain('`/用語`');
    expect(text).not.toContain('`/厄`');
    expect(text).not.toContain('`/パネル`');
    expect(renderNotice('{コマンド一覧}', cfg, []).text).toBe(text);
  });
});

import { describe, expect, it } from 'vitest';
import { commandList, helpEmbeds, memberCommandsText } from '../src/services/commandList.js';
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

  it('/コマンド: その人のロールに合うものだけ（承認前・承認後・厄年・運営）', () => {
    const list = commandList();
    const text = (v: Parameters<typeof helpEmbeds>[1]) => helpEmbeds(list, v).map((e) => e.description).join('\n');
    // 承認前: 入ったばかりの人向けだけ
    const newbie = text({ member: false, yakudoshi: false, staff: false, rankLabel: '（まだ承認されていません）' });
    expect(newbie).toContain('`/はじめて`');
    expect(newbie).toContain('`/相談`');
    expect(newbie).toContain('プロフィール');
    expect(newbie).not.toContain('`/残高`');
    expect(newbie).toContain('入鯖が承認されると、使えるコマンドが増えます');
    // 承認後: 残高・物御籤など。免罪符は厄年だけ
    const member = helpEmbeds(list, { member: true, yakudoshi: false, staff: false, rankLabel: '🍃 氏子' });
    expect(member.length).toBe(1);
    expect(member[0]!.description).toContain('あなた: 🍃 氏子');
    expect(member[0]!.description).toContain('`/残高`');
    expect(member[0]!.description).not.toContain('`/免罪符`');
    expect(member[0]!.description).not.toContain('`/議事録`');
    expect(text({ member: true, yakudoshi: true, staff: false })).toContain('`/免罪符`');
    // 運営: 運営のコマンドも
    const staff = helpEmbeds(list, { member: false, yakudoshi: false, staff: true });
    expect(staff.length).toBe(2);
    expect(staff[0]!.description).toContain('`/残高`');
    expect(staff[1]!.description).toContain('`/議事録`');
    expect(staff[1]!.description).toContain('始める・メモ・決定・やること・終わる・今の');
    expect(staff[1]!.description.length).toBeLessThanOrEqual(4000);
  });

});

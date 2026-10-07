import { describe, expect, it } from 'vitest';
import { commandDefinitions } from '../src/discord/commands.js';
import { parseAmount, sokinBlocker, sokinDone, sokinDm, sokinPanel, sokinResultText } from '../src/discord/sokin.js';
import { cfg } from './helpers.js';

const e = cfg.economy;

describe('💸 /送金', () => {
  it('コマンド: 相手・枚数・ひとこと（どれも入れなくてよい。パネルで選ぶ）', () => {
    const def = commandDefinitions(cfg).find((d) => d.name === 'sokin') as { name_localizations?: Record<string, string>; options?: { name: string; required?: boolean }[] };
    expect(def.name_localizations?.ja).toBe('送金');
    expect(def.options?.map((o) => [o.name, Boolean(o.required)])).toEqual([
      ['user', false],
      ['amount', false],
      ['message', false],
    ]);
  });

  const ids = (v: ReturnType<typeof sokinPanel>) => v.components.flatMap((r) => r.components as { custom_id: string; disabled?: boolean; style?: number; label?: string }[]);
  const g = { ...e, giftMin: 10, giftMax: 1000, giftDailyLimit: 1000 };

  it('パネル: はじめは何も選んでいない（送るは押せない）', () => {
    const v = sokinPanel(g, { note: '' }, { balance: 300, left: 1000 }, 'n1');
    const d = v.embeds[0]!.description;
    expect(d).toContain('相手: （下で選ぶ）');
    expect(d).toContain('枚数: （下で選ぶ）');
    expect(d).toContain('いま 300 枚・今日あと 1,000 枚送れます（1 回 10〜1,000 枚）');
    const b = ids(v);
    expect(b.map((c) => c.custom_id)).toEqual(['sokin:to:n1', 'sokin:amt:n1:10', 'sokin:amt:n1:50', 'sokin:amt:n1:100', 'sokin:amt:n1:500', 'sokin:amt:n1:1000', 'sokin:amtm:n1', 'sokin:notem:n1', 'sokin:send:n1', 'sokin:cancel:n1']);
    // 持っている量より多い枚数は押せない
    expect(b.filter((c) => c.disabled).map((c) => c.custom_id)).toEqual(['sokin:amt:n1:500', 'sokin:amt:n1:1000', 'sokin:send:n1']);
  });

  it('パネル: 相手と枚数を選ぶと、送るが押せる（選んだ枚数は色が変わる）', () => {
    const v = sokinPanel(g, { toId: '9', toName: 'さくら', amount: 100, note: 'いつも\nありがとう' }, { balance: 300, left: 1000 }, 'n1');
    const d = v.embeds[0]!.description;
    expect(d).toContain('相手: **さくら** さん');
    expect(d).toContain(`枚数: ${e.currencyEmoji}${e.currencyName} **100 枚**`);
    expect(d).toContain('ひとこと: いつも ありがとう');
    const b = ids(v);
    expect(b.find((c) => c.custom_id === 'sokin:amt:n1:100')!.style).toBe(1);
    const send = b.find((c) => c.custom_id === 'sokin:send:n1')!;
    expect(send.disabled).toBe(false);
    expect(send.label).toBe('💸 さくら さんに 100 枚送る');
    expect((v.components[0]!.components[0] as { default_values?: unknown }).default_values).toEqual([{ id: '9', type: 'user' }]);
  });

  it('送れないわけ: 相手・枚数・範囲・今日の残り・持っている量', () => {
    const info = { balance: 300, left: 200 };
    expect(sokinBlocker(g, { note: '' }, info)).toBe('相手を選んでください');
    expect(sokinBlocker(g, { toId: '1', note: '' }, info)).toBe('枚数を選んでください');
    expect(sokinBlocker(g, { toId: '1', amount: 5, note: '' }, info)).toBe('10〜1,000 枚の間で選んでください');
    expect(sokinBlocker(g, { toId: '1', amount: 250, note: '' }, info)).toBe('今日送れるのは、あと 200 枚までです');
    expect(sokinBlocker(g, { toId: '1', amount: 150, note: '' }, { balance: 100, left: 1000 })).toBe(`${e.currencyName}が足りません（いま 100 枚）`);
    expect(sokinBlocker(g, { toId: '1', amount: 150, note: '' }, info)).toBeUndefined();
    // 選んだのに送れないときは、パネルにわけを出す
    expect(sokinPanel(g, { toId: '1', toName: 'a', amount: 250, note: '' }, info, 'n').embeds[0]!.description).toContain('⚠ 今日送れるのは、あと 200 枚までです');
  });

  it('枚数の入力: 全角・カンマ・「枚」も読む', () => {
    expect(parseAmount('１，０００枚')).toBe(1000);
    expect(parseAmount(' 300 ')).toBe(300);
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmount('-5')).toBeNaN();
  });

  it('送ったあと: 結果と「続けて送る」', () => {
    const v = sokinDone('送りました');
    expect(v.content).toBe('送りました');
    expect((v.components[0]!.components[0] as { custom_id: string }).custom_id).toBe('sokin:new');
  });

  it('結果の文: 送れた・送れなかったわけ', () => {
    expect(sokinResultText(e, { status: 'ok', balance: 2500 }, '123', 500)).toBe(`💸 <@123> さんに ${e.currencyEmoji}${e.currencyName} 500 枚を送りました。残り 2,500 枚。`);
    expect(sokinResultText(e, { status: 'self' }, '1', 10)).toBe('自分には送れません。');
    expect(sokinResultText(e, { status: 'rank_too_low', rankName: '参拝者' }, '1', 10)).toContain('「参拝者」以上');
    expect(sokinResultText(e, { status: 'bad_amount', min: 10, max: 1000 }, '1', 5)).toBe('10〜1,000 枚の間で送ってください。');
    expect(sokinResultText(e, { status: 'daily_limit', left: 300 }, '1', 500)).toContain('あと 300 枚まで');
    expect(sokinResultText(e, { status: 'insufficient', balance: 40 }, '1', 500)).toBe(`${e.currencyName}が足りません（いま 40 枚）。`);
  });

  it('相手への DM', () => {
    expect(sokinDm(e, 'もみじ', 100, 'お礼')).toBe(`💸 **もみじ** さんから ${e.currencyEmoji}${e.currencyName} **100 枚**が届きました（咲楽ノ宮）。\n> お礼\n-# 残りは \`/残高\` で見られます`);
    expect(sokinDm(e, 'もみじ', 100, '')).not.toContain('>');
  });
});

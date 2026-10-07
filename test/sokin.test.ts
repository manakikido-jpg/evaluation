import { describe, expect, it } from 'vitest';
import { commandDefinitions } from '../src/discord/commands.js';
import { sokinConfirm, sokinDm, sokinResultText } from '../src/discord/sokin.js';
import { cfg } from './helpers.js';

const e = cfg.economy;

describe('💸 /送金', () => {
  it('コマンド: 相手・枚数（必須）・ひとこと', () => {
    const def = commandDefinitions(cfg).find((d) => d.name === 'sokin') as { name_localizations?: Record<string, string>; options?: { name: string; required?: boolean }[] };
    expect(def.name_localizations?.ja).toBe('送金');
    expect(def.options?.map((o) => [o.name, Boolean(o.required)])).toEqual([
      ['user', true],
      ['amount', true],
      ['message', false],
    ]);
  });

  it('確かめる: 相手・枚数・ひとこと・ボタン（nonce つき）', () => {
    const v = sokinConfirm(e, { name: 'さくら' }, 1500, 'いつも\nありがとう', 'abc');
    expect(v.content).toContain(`**さくら** さんに ${e.currencyEmoji}${e.currencyName} **1,500 枚**を送りますか？`);
    expect(v.content).toContain('> いつも ありがとう');
    expect(v.content).toContain('取り消せません');
    expect(v.components[0]!.components.map((b) => b.custom_id)).toEqual(['sokin:ok:abc', 'sokin:cancel:abc']);
    expect(sokinConfirm(e, { name: 'さくら' }, 10, '', 'x').content).not.toContain('>');
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

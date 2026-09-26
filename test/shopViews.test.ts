import { describe, expect, it } from 'vitest';
import type { ShopItem } from '../src/db/schema.js';
import { hanafubukiMessage, priceText, shopConfirm, shopList, shopPickTarget } from '../src/discord/shopViews.js';
import { cfg } from './helpers.js';

const base: ShopItem = {
  id: 1,
  kind: 'role',
  name: '色守り（桜）',
  emoji: '🌸',
  description: '30 日間、名前がこの色になる',
  price: 1500,
  roleId: '960000000000000001',
  roleGroup: 'color',
  durationDays: 30,
  enabled: true,
  position: 1,
  updatedAt: new Date(),
};

describe('ショップの見た目', () => {
  it('一覧: 残高と値段。選ぶメニュー', () => {
    const m = shopList([base, { ...base, id: 2, kind: 'gift', name: '贈り物', emoji: '🎁', price: 0 }, { ...base, id: 3, kind: 'menzaifu', name: '免罪符', emoji: '🧾', price: 0 }], cfg.economy, 3000);
    expect(m.embeds[0]!.description).toContain('いまの🌸花びら: **3,000 枚**');
    expect(m.embeds[0]!.description).toContain('🌸 色守り（桜） … **1,500 枚**');
    expect(m.embeds[0]!.description).toContain('🎁 贈り物 … **好きな量**');
    expect(m.embeds[0]!.description).toContain(`🧾 免罪符 … **${cfg.economy.menzaifuPrice} 枚**`);
    expect(m.components[0]!.components[0]!.options.map((o) => o.value)).toEqual(['1', '2', '3']);
  });

  it('確認: 足りなければ「受ける」を押せない', () => {
    expect(shopConfirm(base, cfg.economy, 3000).components[0]!.components[0]).toMatchObject({ custom_id: 'shop:buy:1', disabled: false });
    expect(shopConfirm(base, cfg.economy, 100).components[0]!.components[0]!.disabled).toBe(true);
    expect(priceText(base, cfg.economy)).toBe('1,500 枚');
  });

  it('相手を選ぶ（ユーザーのメニュー）', () => {
    expect(shopPickTarget({ ...base, kind: 'gift' }, cfg.economy, 100).components[0]!.components[0]).toMatchObject({ type: 5, custom_id: 'shop:target:1' });
  });

  it('花吹雪: 贈られた人にだけ通知。改行はまとめる', () => {
    const m = hanafubukiMessage('A', 'B', 'おめでとう\n@everyone');
    expect(m.allowedMentions).toEqual({ users: ['B'], roles: [] });
    expect(m.embeds[0]!.description).toContain('> おめでとう @everyone');
  });
});

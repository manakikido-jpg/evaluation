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
  boosterOnly: false,
  updatedAt: new Date(),
};

describe('ショップの見た目', () => {
  it('一覧: 残高と値段。選ぶメニュー', () => {
    const m = shopList([base, { ...base, id: 2, kind: 'gift', name: '贈り物', emoji: '🎁', price: 0 }, { ...base, id: 3, kind: 'menzaifu', name: '免罪符', emoji: '🧾', price: 0 }], cfg.economy, 3000);
    expect(m.embeds[0]!.description).toContain('いまの🪙銭: **3,000 枚**');
    expect(m.embeds[0]!.description).toContain('🌸 色守り（桜） … **1,500 枚**');
    expect(m.embeds[0]!.description).toContain('🎁 贈り物 … **好きな量**');
    expect(m.embeds[0]!.description).toContain(`🧾 免罪符 … **${cfg.economy.menzaifuPrice} 枚**`);
    expect(m.components[0]!.components[0]!.options.map((o) => o.value)).toEqual(['1', '2', '3']);
  });

  it('確認: 足りなければ「受ける」を押せない', () => {
    expect(shopConfirm(base, cfg.economy, 3000).components[0]!.components[0]).toMatchObject({ custom_id: 'shop:buy:1', disabled: false });
    expect(shopConfirm(base, cfg.economy, 100).components[0]!.components[0]!.disabled).toBe(true);
    // 割引券を持っていれば、使うボタン（持っていない券は出さない）
    const withTickets = shopConfirm(base, cfg.economy, 1000, undefined, false, [
      { ticket: 'shop_10', count: 0 },
      { ticket: 'shop_50', count: 2 },
    ]).components[0]!.components;
    expect(withTickets.map((c) => c.custom_id)).toEqual(['shop:buy:1', 'shop:buy:1:shop_50', 'shop:cancel']);
    expect(withTickets[1]).toMatchObject({ label: '🏷 50%引きで 750 枚（券 2 枚）', disabled: false });
    // 免罪符には使えない
    const menzaifu = shopConfirm({ ...base, kind: 'menzaifu' }, cfg.economy, 1000, undefined, false, [{ ticket: 'shop_50', count: 2 }]).components[0]!.components;
    expect(menzaifu.map((c) => c.custom_id)).toEqual(['shop:buy:1', 'shop:cancel']);
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

describe('奉納（ブースト）の特典', () => {
  it('奉納限定の品物: ほかの人には「奉納している方だけ」で受けられない。奉納している人は受けられる', () => {
    const kin = { ...base, name: '色守り（金色）', price: 0, durationDays: null, boosterOnly: true };
    expect(priceText(kin, cfg.economy)).toBe('🏮 奉納している方だけ');
    const json = (b: boolean) => JSON.stringify(shopConfirm(kin, cfg.economy, 100, undefined, b));
    expect(json(false)).toContain('"disabled":true');
    expect(json(false)).toContain('奉納（サーバーブースト）している方だけ');
    expect(json(true)).toContain('"disabled":false');
    expect(json(true)).toContain('期間: 奉納している間');
  });

  it('絵馬の奉納（自己紹介のピン留め）は、奉納している人は無料', () => {
    const pin = { ...base, kind: 'ema_pin' as const, price: 800, durationDays: 7 };
    expect(priceText(pin, cfg.economy, true)).toContain('無料');
    expect(priceText(pin, cfg.economy, false)).toBe('800 枚');
  });
});


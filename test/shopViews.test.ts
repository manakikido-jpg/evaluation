import { describe, expect, it } from 'vitest';
import type { ShopItem } from '../src/db/schema.js';
import { categoryOf, hanafubukiMessage, myColorConfirm, myColorPicker, otoshidamaPickChannel, priceText, shopConfirm, shopList, shopPickTarget } from '../src/discord/shopViews.js';
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
  it('一覧: 残高・受けているもの・種類ごとのカードと選ぶメニュー。足りない分も出す', () => {
    const title = { ...base, id: 4, name: '称号「常連」', emoji: '🎋', roleGroup: 'title', price: 5000, durationDays: null };
    const m = shopList(
      [base, title, { ...base, id: 2, kind: 'gift', name: '贈り物', emoji: '🎁', price: 0, roleGroup: null }, { ...base, id: 3, kind: 'menzaifu', name: '免罪符', emoji: '🧾', price: 0, roleGroup: null }],
      cfg.economy,
      3000,
      false,
      new Map([[1, new Date('2026-10-05T03:00:00Z')]]),
    );
    expect(m.embeds[0]!.description).toContain('👛 いまの🪙銭: **3,000 枚**');
    expect(m.embeds[0]!.description).toContain('🌸 色守り（桜） … 10/5 まで');
    expect(m.embeds.map((e) => e.title)).toEqual(['🛍 授与所', '🎨 色守り', '🏷 称号', '🎁 贈る', '🧾 厄払い']);
    const color = m.embeds[1]!.fields![0]!;
    expect(color).toMatchObject({ name: '🌸 色守り（桜）', inline: true });
    expect(color.value).toContain('**1,500 枚**・30 日');
    expect(color.value).toContain('✅ 受けている（10/5 まで）');
    expect(m.embeds[2]!.fields![0]!.value).toContain('あと 2,000 枚');
    expect(m.embeds[3]!.fields![0]!.value).toContain('**好きな量**');
    expect(m.embeds[4]!.fields![0]!.value).toContain(`**${cfg.economy.menzaifuPrice} 枚**`);
    // 種類ごとの選ぶメニュー
    expect(m.components.map((r) => r.components[0]!.custom_id)).toEqual(['shop:pick:color', 'shop:pick:title', 'shop:pick:gift', 'shop:pick:menzaifu']);
    expect(m.components[0]!.components[0]!.options[0]!.description).toContain('✅ 受けている');
  });

  it('一覧: 品物が多くても、カードは合わせて 6000 文字まで', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...base, id: i + 1, name: `色守り（色 ${i}）`, description: '30 日間、名前がこの色になる。とても長い説明がここに入ります。'.repeat(2) }));
    const m = shopList(many, cfg.economy, 3000);
    const total = m.embeds.reduce((n, e) => n + e.title.length + (e.description?.length ?? 0) + (e.fields ?? []).reduce((k, f) => k + f.name.length + f.value.length, 0), 0);
    expect(total).toBeLessThanOrEqual(6000);
    expect(m.embeds[1]!.fields!.length).toBeGreaterThan(0);
  });

  it('確認: 足りなければ「受ける」を押せない', () => {
    expect(shopConfirm(base, cfg.economy, 3000).components[0]!.components[0]).toMatchObject({ custom_id: 'shop:buy:1', disabled: false });
    // ロールの品は「🎁 プレゼントにする」も出る
    expect(JSON.stringify(shopConfirm(base, cfg.economy, 3000).components)).toContain(base.kind === 'role' ? 'shop:present:1' : 'shop:buy:1');
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
    // 値段・期間・いま・受けたあと
    const fields = shopConfirm(base, cfg.economy, 3000).embeds[0]!.fields.map((f) => `${f.name}=${f.value}`);
    expect(fields).toEqual(['値段=**1,500 枚**', '期間=30 日', 'いまの銭=3,000 枚', '受けたあと=1,500 枚']);
    expect(shopConfirm(base, cfg.economy, 1000).embeds[0]!.fields.at(-1)!.value).toBe('⚠ あと 500 枚 足りません');
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
    expect(json(true)).toContain('"name":"期間","value":"奉納している間"');
  });

  it('絵馬の奉納（自己紹介のピン留め）は、奉納している人は無料', () => {
    const pin = { ...base, kind: 'ema_pin' as const, price: 800, durationDays: 7 };
    expect(priceText(pin, cfg.economy, true)).toContain('無料');
    expect(priceText(pin, cfg.economy, false)).toBe('800 枚');
  });
});

describe('新しい授与品の見た目', () => {
  const mycolor: ShopItem = { ...base, id: 20, kind: 'mycolor', name: '自分だけの色', emoji: '🎨', price: 5000, roleId: null, roleGroup: null };
  const bag: ShopItem = { ...base, id: 21, kind: 'otoshidama', name: 'お年玉袋', emoji: '🧧', price: 50, roleId: null, roleGroup: null, durationDays: null };

  it('種類と値段: 自分だけの色は色守りの仲間・お年玉袋は贈るの仲間（手数料つき）', () => {
    expect(categoryOf(mycolor)).toBe('color');
    expect(categoryOf(bag)).toBe('gift');
    expect(priceText(bag, cfg.economy)).toBe('好きな量（手数料 50 枚）');
    expect(priceText({ ...bag, price: 0 }, cfg.economy)).toBe('好きな量');
    // お年玉袋は足りない分を出さない（量はあとで決める）
    expect(JSON.stringify(shopList([bag], cfg.economy, 0).embeds)).not.toContain('あと');
  });

  it('色を選ぶ: 見本のメニューと色コードのボタン。確認はカードの線がその色で、買うボタンに色が入る', () => {
    const pick = JSON.stringify(myColorPicker(mycolor, cfg.economy, 6000, false, { color: 0x00ff00, expiresAt: new Date('2026-10-30T00:00:00Z') }));
    for (const t of ['shop:mycolor:pick:20', 'shop:mycolor:hex:20', '#00ff00', '色を変えて期間が延びます']) expect(pick).toContain(t);
    const c = myColorConfirm(mycolor, cfg.economy, 6000, 0xf4a7b9, false, true);
    expect(c.embeds[0]!.color).toBe(0xf4a7b9);
    expect(c.embeds[0]!.title).toContain('桜色（#f4a7b9）');
    expect(JSON.stringify(c.components)).toContain(`shop:mycolor:buy:20:${0xf4a7b9}`);
    expect((c.components[0]!.components[0] as { disabled: boolean }).disabled).toBe(false);
    expect((myColorConfirm(mycolor, cfg.economy, 100, 0xf4a7b9).components[0]!.components[0] as { disabled: boolean }).disabled).toBe(true);
  });

  it('お年玉袋: 置くチャンネルを選ぶ（いつもの場所のボタンも）', () => {
    const v = JSON.stringify(otoshidamaPickChannel(bag, cfg.economy, 1000, '910000000000000001', '境内'));
    for (const t of ['shop:otoshi:ch:21', '"type":8', 'shop:otoshi:here:21:910000000000000001', '#境内 に置く', '手数料 50 枚']) expect(v).toContain(t);
    expect(JSON.stringify(otoshidamaPickChannel(bag, cfg.economy, 1000))).not.toContain('shop:otoshi:here');
  });
});

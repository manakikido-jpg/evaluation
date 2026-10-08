import { giftCost, giftFee } from '../services/shop.js';
import type { EconomyConfig } from '../config.js';
import type { ShopItem } from '../db/schema.js';
import { OTOSHIDAMA } from '../services/otoshidama.js';
import { discountable, discountedPrice, DISCOUNT_PERCENT, hexOf, MY_COLORS, presentable, priceOf, type DiscountTicket } from '../services/shop.js';

/** ショップの見た目（Discord API の形のまま。テストしやすいように discord.js に依らない） */

const SHU = 0xd7003a;
const coin = (e: EconomyConfig) => `${e.currencyEmoji}${e.currencyName}`;
const label = (i: ShopItem) => `${i.emoji ? `${i.emoji} ` : ''}${i.name}`;

/** 奉納割引が効いているか */
const discounted = (item: ShopItem, e: EconomyConfig, booster: boolean) => booster && discountable(item) && e.boostDiscountPercent > 0;

export function priceText(item: ShopItem, e: EconomyConfig, booster = false): string {
  if (item.boosterOnly && !booster) return '🏮 奉納している方だけ';
  if (item.kind === 'gift') return '好きな量';
  if (item.kind === 'otoshidama') return item.price > 0 ? `好きな量（手数料 ${item.price.toLocaleString('ja-JP')} 枚）` : '好きな量';
  if (booster && item.kind === 'ema_pin' && item.price > 0) return `0 枚（奉納の特典で無料）`;
  const now = `${priceOf(item, e, booster).toLocaleString('ja-JP')} 枚`;
  const base = item.kind === 'menzaifu' ? e.menzaifuPrice : item.price;
  const sale = item.kind !== 'menzaifu' && e.shopSalePercent > 0;
  const why = [sale ? `セール ${e.shopSalePercent}% 引き` : '', discounted(item, e, booster) ? '奉納割引' : ''].filter(Boolean).join('・');
  return why && priceOf(item, e, booster) < base ? `${now}（${base.toLocaleString('ja-JP')} 枚から${why}）` : now;
}

// ───────── 分け方 ─────────

/** カード（Discord の embed の形） */
export type ShopEmbed = { title: string; description?: string; color: number; fields?: { name: string; value: string; inline?: boolean }[] };

export type ShopCategory = 'color' | 'title' | 'vip' | 'gift' | 'fun' | 'menzaifu' | 'other';

export const SHOP_CATEGORIES: Record<ShopCategory, { title: string; note: string; color: number; pick: string }> = {
  color: { title: '🎨 色守り', note: '名前の色が変わります（1 人 1 色。買い替えると前の色は外れます）', color: 0xe86a92, pick: '🎨 色守りを選ぶ' },
  title: { title: '🏷 称号', note: 'プロフィール（御朱印帳）に称号が付きます', color: 0xd4a017, pick: '🏷 称号を選ぶ' },
  vip: { title: '💎 極（遊郭の VIP）', note: '宵参りの方だけ。遊郭の「💎 極の部屋」をひらける・入れる', color: 0xe6b422, pick: '💎 極の VIP を選ぶ' },
  gift: { title: '🎁 贈る', note: 'ほかの人に贈ります', color: 0xf4a7b9, pick: '🎁 贈るものを選ぶ' },
  fun: { title: '🎐 おみくじ・絵馬', note: 'おみくじをもう 1 回・自己紹介のピン留め', color: 0x5b8def, pick: '🎐 おみくじ・絵馬を選ぶ' },
  menzaifu: { title: '🧾 厄払い', note: '厄を 1 つ祓います', color: 0x7a6d71, pick: '🧾 免罪符を選ぶ' },
  other: { title: '✨ そのほか', note: '', color: SHU, pick: '✨ そのほかを選ぶ' },
};
const ORDER: ShopCategory[] = ['color', 'title', 'vip', 'gift', 'fun', 'menzaifu', 'other'];

export function categoryOf(i: Pick<ShopItem, 'kind' | 'roleGroup'>): ShopCategory {
  if (i.kind === 'role') return i.roleGroup === 'color' ? 'color' : i.roleGroup === 'title' ? 'title' : i.roleGroup === 'vip' ? 'vip' : 'other';
  if (i.kind === 'mycolor') return 'color';
  if (i.kind === 'gift' || i.kind === 'hanafubuki' || i.kind === 'otoshidama') return 'gift';
  if (i.kind === 'omikuji_extra' || i.kind === 'ema_pin' || i.kind === 'casino_boost' || i.kind === 'casino_style') return 'fun';
  if (i.kind === 'menzaifu') return 'menzaifu';
  return 'other';
}

const fmtDay = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(d);
const durationText = (i: ShopItem) =>
  i.durationDays ? `${i.durationDays} 日` : i.kind === 'role' || i.kind === 'mycolor' ? (i.boosterOnly ? '奉納している間' : 'ずっと') : '';

/** 一覧（本人にだけ）。種類ごとのカードと、種類ごとの選ぶメニュー */
export function shopList(
  items: ShopItem[],
  e: EconomyConfig,
  balance: number,
  booster = false,
  /** 受けている（ロールの）授与品: 品物の ID → 期限（ずっとなら null） */
  owned: Map<number, Date | null> = new Map(),
) {
  const thanks = booster && e.boostDiscountPercent > 0 ? [`🏮 奉納ありがとうございます。授与品が **${e.boostDiscountPercent}% 引き** です（免罪符・贈り物をのぞく）`] : [];
  const sale = e.shopSalePercent > 0 ? [`🎉 **期間限定セール中！** 授与品が **${e.shopSalePercent}% 引き** です（免罪符・贈り物をのぞく）`] : [];
  const mine = items
    .filter((i) => owned.has(i.id))
    .map((i) => {
      const until = owned.get(i.id);
      return `- ${label(i)} … ${until ? `${fmtDay(until)} まで` : 'ずっと'}`;
    });
  const groups = ORDER.map((c) => ({ c, items: items.filter((i) => categoryOf(i) === c) })).filter((g) => g.items.length);
  const tile = (i: ShopItem, withNote = true) => {
    const price = priceOf(i, e, booster);
    const lack = i.kind !== 'gift' && i.kind !== 'otoshidama' && !(i.boosterOnly && !booster) && price > balance ? price - balance : 0;
    const until = owned.get(i.id);
    return {
      name: label(i).slice(0, 256),
      value: [
        `**${priceText(i, e, booster)}**${durationText(i) && !(i.boosterOnly && !booster) ? `・${durationText(i)}` : ''}`,
        owned.has(i.id) ? `✅ 受けている${until ? `（${fmtDay(until)} まで）` : ''}` : lack ? `あと ${lack.toLocaleString('ja-JP')} 枚` : '',
        i.kind === 'otoshidama' ? '置けるのは氏子以上（運営も使えます）' : '',
        withNote ? (i.kind === 'gift' ? i.description.replace('手数料なし', '手数料20%を追加で払う') : i.description) : '',
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 1024),
      inline: true,
    };
  };
  const embeds: ShopEmbed[] = [
    {
      title: '🛍 授与所',
      description: [
        ...sale,
        ...thanks,
        `👛 いまの${coin(e)}: **${balance.toLocaleString('ja-JP')} 枚**`,
        ...(mine.length ? ['', '**受けているもの**', ...mine] : []),
        ...(items.length ? [] : ['', 'いまは授与品がありません。']),
      ].join('\n'),
      color: SHU,
    },
  ];
  // Discord の決まり: 1 通のカードは合わせて 6000 文字まで。多ければ説明を省き、それでも多ければ数を減らす
  const cards = (withNote: boolean, max: number): ShopEmbed[] =>
    groups.slice(0, 9).map((g) => ({
      title: SHOP_CATEGORIES[g.c].title,
      ...(SHOP_CATEGORIES[g.c].note && withNote ? { description: `-# ${SHOP_CATEGORIES[g.c].note}` } : {}),
      fields: g.items.slice(0, max).map((i) => tile(i, withNote)),
      color: SHOP_CATEGORIES[g.c].color,
    }));
  const size = (list: ShopEmbed[]) => list.reduce((n, x) => n + x.title.length + (x.description?.length ?? 0) + (x.fields ?? []).reduce((m, f) => m + f.name.length + f.value.length, 0), 0);
  let body = cards(true, 25);
  if (size([...embeds, ...body]) > 5800) body = cards(false, 25);
  for (let max = 20; size([...embeds, ...body]) > 5800 && max > 0; max -= 5) body = cards(false, max);
  embeds.push(...body);
  const option = (i: ShopItem) => ({
    label: i.name.slice(0, 100),
    value: String(i.id),
    description: `${owned.has(i.id) ? '✅ 受けている・' : ''}${priceText(i, e, booster)}${durationText(i) ? `・${durationText(i)}` : ''}`.slice(0, 100),
    ...(i.emoji ? { emoji: { name: i.emoji } } : {}),
  });
  // 種類ごとに選ぶメニュー（Discord の決まりで 5 つまで。多ければ 1 つにまとめる）
  const menus =
    groups.length <= 5
      ? groups.map((g) => ({ custom_id: `shop:pick:${g.c}`, placeholder: SHOP_CATEGORIES[g.c].pick, options: g.items.slice(0, 25).map(option) }))
      : [{ custom_id: 'shop:pick', placeholder: '授与品を選ぶ', options: groups.flatMap((g) => g.items).slice(0, 25).map(option) }];
  return {
    embeds,
    components: menus.map((m) => ({ type: 1, components: [{ type: 3, ...m }] })),
  };
}

/** 選んだ品物の確認（買う・やめる） */
/** 割引券が使える品（ロール・おみくじもう 1 回・絵馬の奉納。免罪符・贈り物・花吹雪はのぞく） */
export const discountableKinds = ['role', 'omikuji_extra', 'ema_pin', 'casino_boost'];

export function shopConfirm(
  item: ShopItem,
  e: EconomyConfig,
  balance: number,
  note?: string,
  booster = false,
  /** 持っている割引券（使える品のときだけボタンを出す） */
  discounts: { ticket: DiscountTicket; count: number }[] = [],
) {
  const price = priceOf(item, e, booster);
  const c = SHOP_CATEGORIES[categoryOf(item)];
  const after = balance - price;
  const blocked = item.boosterOnly && !booster;
  return {
    embeds: [
      {
        title: label(item),
        description: [item.description, note ?? '', blocked ? '-# 🏮 奉納（サーバーブースト）している方だけが受けられます' : ''].filter(Boolean).join('\n') || undefined,
        fields: [
          { name: '値段', value: `**${priceText(item, e, booster)}**`, inline: true },
          ...(durationText(item) ? [{ name: '期間', value: durationText(item), inline: true }] : []),
          { name: `いまの${e.currencyName}`, value: `${balance.toLocaleString('ja-JP')} 枚`, inline: true },
          ...(!blocked && price > 0
            ? [{ name: '受けたあと', value: after >= 0 ? `${after.toLocaleString('ja-JP')} 枚` : `⚠ あと ${(-after).toLocaleString('ja-JP')} 枚 足りません`, inline: true }]
            : []),
        ],
        color: c.color,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: `${price.toLocaleString('ja-JP')} 枚で受ける`, custom_id: `shop:buy:${item.id}`, disabled: balance < price || (item.boosterOnly && !booster) },
          ...(price > 0 && discountable(item) && discountableKinds.includes(item.kind)
            ? discounts
                .filter((d) => d.count > 0)
                .map((d) => {
                  const p = discountedPrice(price, d.ticket);
                  return {
                    type: 2 as const,
                    style: 1 as const,
                    label: `🏷 ${DISCOUNT_PERCENT[d.ticket]}%引きで ${p.toLocaleString('ja-JP')} 枚（券 ${d.count} 枚）`.slice(0, 80),
                    custom_id: `shop:buy:${item.id}:${d.ticket}`,
                    disabled: balance < p || (item.boosterOnly && !booster),
                  };
                })
            : []),
          { type: 2, style: 2, label: 'やめる', custom_id: 'shop:cancel' },
        ],
      },
      // 🎁 ほかの人へのプレゼントとして買う（色守り・称号など）
      ...(presentable(item)
        ? [{ type: 1, components: [{ type: 2, style: 1, label: `🎁 プレゼントにする（${price.toLocaleString('ja-JP')} 枚）`, custom_id: `shop:present:${item.id}`, disabled: balance < price }] }]
        : []),
    ],
  };
}

/** 🎁 プレゼント: 贈る相手を選ぶ */
export function presentPickTarget(item: ShopItem, e: EconomyConfig, balance: number, booster = false) {
  return {
    embeds: [
      {
        title: `🎁 ${label(item)}をプレゼント`,
        description: [
          `${priceText(item, e, booster)}をあなたが払い、相手が受けます（${durationText(item) || 'ずっと'}）。いま ${balance.toLocaleString('ja-JP')} 枚`,
          '',
          '贈る相手を選んでください。',
        ].join('\n'),
        color: SHU,
      },
    ],
    components: [
      { type: 1, components: [{ type: 5, custom_id: `shop:presentto:${item.id}`, placeholder: '贈る相手を選ぶ' }] },
      { type: 1, components: [{ type: 2, style: 2, label: 'やめる', custom_id: 'shop:cancel' }] },
    ],
  };
}

/** 🎁 プレゼント: 相手と値段を確かめる */
export function presentConfirm(item: ShopItem, e: EconomyConfig, balance: number, target: { id: string; name: string }, booster = false, note?: string) {
  const price = priceOf(item, e, booster);
  const total = giftCost(price);
  return {
    embeds: [
      {
        title: `🎁 ${target.name} さんに ${label(item)}`,
        description: [
          `**${price.toLocaleString('ja-JP')} 枚**で、<@${target.id}> さんへのプレゼントにします（${durationText(item) || 'ずっと'}）。相手には DM で知らせます。`,
          `手数料（20%）: ${giftFee(price).toLocaleString('ja-JP')} 枚・合計支払い: **${total.toLocaleString('ja-JP')} 枚**`,
          ...(note ? [note] : []),
          `-# いま ${balance.toLocaleString('ja-JP')} 枚 → 贈ったあと ${(balance - total).toLocaleString('ja-JP')} 枚`,
        ].join('\n'),
        color: SHU,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: `🎁 ${total.toLocaleString('ja-JP')} 枚で贈る`, custom_id: `shop:presentok:${item.id}:${target.id}`, disabled: balance < total },
          { type: 2, style: 2, label: 'やめる', custom_id: 'shop:cancel' },
        ],
      },
    ],
  };
}

/** 花吹雪・贈り物: 相手を選ぶ */
export function shopPickTarget(item: ShopItem, e: EconomyConfig, balance: number, booster = false) {
  const what = item.kind === 'gift' ? `${coin(e)}を贈る相手（手数料20%を追加で払います）` : `花吹雪（${priceText(item, e, booster)}）を贈る相手`;
  return {
    embeds: [{ title: label(item), description: [item.kind === 'gift' ? item.description.replace('手数料なし', '手数料20%を追加で払う') : item.description, `いま ${balance.toLocaleString('ja-JP')} 枚`, '', `${what}を選んでください。`].join('\n'), color: SHU }],
    components: [
      { type: 1, components: [{ type: 5, custom_id: `shop:target:${item.id}`, placeholder: '相手を選ぶ' }] },
      { type: 1, components: [{ type: 2, style: 2, label: 'やめる', custom_id: 'shop:cancel' }] },
    ],
  };
}

/** #境内 に出す花吹雪 */
export function hanafubukiMessage(fromId: string, toId: string, message: string) {
  const m = message.replace(/\s+/g, ' ').trim();
  return {
    content: `<@${toId}>`,
    embeds: [
      {
        title: '🌸 花吹雪',
        description: [`<@${fromId}> さんから <@${toId}> さんへ、花吹雪が舞いました。`, ...(m ? [`> ${m}`] : [])].join('\n'),
        color: 0xf4a7b9,
      },
    ],
    // 通知は贈られた人にだけ
    allowedMentions: { users: [toId], roles: [] as string[] },
  };
}

// ───────── 🎨 自分だけの色 ─────────

/** 色を選ぶ（見本から・色コードで）。持っていれば今の色と期限も出す */
export function myColorPicker(item: ShopItem, e: EconomyConfig, balance: number, booster = false, current?: { color: number; expiresAt: Date | null }) {
  const price = priceOf(item, e, booster);
  return {
    embeds: [
      {
        title: label(item),
        description: [
          item.description,
          `値段 **${priceText(item, e, booster)}**${durationText(item) ? `・${durationText(item)}` : ''}　いま ${balance.toLocaleString('ja-JP')} 枚`,
          ...(current
            ? [`🎨 いまの色: **${hexOf(current.color)}**${current.expiresAt ? `（${fmtDay(current.expiresAt)} まで）` : ''}`, '-# もう一度受けると、色を変えて期間が延びます']
            : ['-# BOT があなた専用の色ロールを作って付けます。色守りより上に出るので、名前がこの色になります']),
          '',
          '下の見本から選ぶか、「色コードで決める」を押してください（例: #ff88aa）。',
        ].join('\n'),
        color: current?.color ?? SHU,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `shop:mycolor:pick:${item.id}`,
            placeholder: '🎨 色の見本から選ぶ',
            options: MY_COLORS.map((c) => ({ label: `${c.name}（${hexOf(c.color)}）`, value: String(c.color), emoji: { name: c.emoji } })),
          },
        ],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 1, label: '色コードで決める', emoji: { name: '🖌' }, custom_id: `shop:mycolor:hex:${item.id}`, disabled: balance < price },
          { type: 2, style: 2, label: 'やめる', custom_id: 'shop:cancel' },
        ],
      },
    ],
  };
}

/** 選んだ色の確認（カードの左の線がその色になる） */
export function myColorConfirm(item: ShopItem, e: EconomyConfig, balance: number, color: number, booster = false, extend = false) {
  const price = priceOf(item, e, booster);
  const after = balance - price;
  const name = MY_COLORS.find((c) => c.color === color)?.name;
  return {
    embeds: [
      {
        title: `${label(item)}: ${name ? `${name}（${hexOf(color)}）` : hexOf(color)}`,
        description: [
          '← このカードの左の線が、名前の色の見本です（画面の明るさで少し違って見えます）',
          extend ? '-# 今の色をこの色に変えて、期間を延ばします' : '',
        ]
          .filter(Boolean)
          .join('\n'),
        fields: [
          { name: '値段', value: `**${priceText(item, e, booster)}**`, inline: true },
          ...(durationText(item) ? [{ name: '期間', value: durationText(item), inline: true }] : []),
          { name: '受けたあと', value: after >= 0 ? `${after.toLocaleString('ja-JP')} 枚` : `⚠ あと ${(-after).toLocaleString('ja-JP')} 枚 足りません`, inline: true },
        ],
        color,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: `${price.toLocaleString('ja-JP')} 枚で受ける`, custom_id: `shop:mycolor:buy:${item.id}:${color}`, disabled: balance < price || (item.boosterOnly && !booster) },
          { type: 2, style: 2, label: '色を選び直す', custom_id: `shop:mycolor:again:${item.id}` },
          { type: 2, style: 2, label: 'やめる', custom_id: 'shop:cancel' },
        ],
      },
    ],
  };
}

// ───────── 🧧 お年玉袋 ─────────

/** 置くチャンネルを選ぶ */
export function otoshidamaPickChannel(item: ShopItem, e: EconomyConfig, balance: number, defaultChannelId?: string, defaultName?: string) {
  const o = OTOSHIDAMA;
  return {
    embeds: [
      {
        title: label(item),
        description: [
          item.description,
          `入れられるのは ${coin(e)} ${o.minTotal.toLocaleString('ja-JP')}〜${o.maxTotal.toLocaleString('ja-JP')} 枚、${o.minCount}〜${o.maxCount} 人分${item.price > 0 ? `（ほかに手数料 ${item.price.toLocaleString('ja-JP')} 枚）` : ''}`,
          `いま ${balance.toLocaleString('ja-JP')} 枚`,
          `-# 受け取れるのは 1 人 1 回・入鯖が承認された人だけ。${o.hours} 時間で締め切り、残りはあなたに戻ります`,
          '',
          '氏子以上の人が袋を置けます。袋を置くチャンネルを選んでください。',
        ].join('\n'),
        color: 0xd7003a,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 8,
            custom_id: `shop:otoshi:ch:${item.id}`,
            placeholder: '袋を置くチャンネル',
            channel_types: [0],
          },
        ],
      },
      {
        type: 1,
        components: [
          ...(defaultChannelId ? [{ type: 2, style: 1, label: `${defaultName ? `#${defaultName}` : 'いつもの場所'} に置く`.slice(0, 80), emoji: { name: '📍' }, custom_id: `shop:otoshi:here:${item.id}:${defaultChannelId}` }] : []),
          { type: 2, style: 2, label: 'やめる', custom_id: 'shop:cancel' },
        ],
      },
    ],
  };
}

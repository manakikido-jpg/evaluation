import type { EconomyConfig } from '../config.js';
import type { ShopItem } from '../db/schema.js';
import { priceOf } from '../services/shop.js';

/** ショップの見た目（Discord API の形のまま。テストしやすいように discord.js に依らない） */

const SHU = 0xd7003a;
const coin = (e: EconomyConfig) => `${e.currencyEmoji}${e.currencyName}`;
const label = (i: ShopItem) => `${i.emoji ? `${i.emoji} ` : ''}${i.name}`;

export function priceText(item: ShopItem, e: EconomyConfig): string {
  if (item.kind === 'gift') return '好きな量';
  return `${priceOf(item, e).toLocaleString('ja-JP')} 枚`;
}

/** 一覧（本人にだけ） */
export function shopList(items: ShopItem[], e: EconomyConfig, balance: number) {
  const lines = items.map((i) => `${label(i)} … **${priceText(i, e)}**${i.description ? `\n-# ${i.description}` : ''}`);
  return {
    embeds: [
      {
        title: '🛍 授与品',
        description: [`いまの${coin(e)}: **${balance.toLocaleString('ja-JP')} 枚**`, '', ...(lines.length ? lines : ['いまは授与品がありません。'])].join('\n'),
        color: SHU,
      },
    ],
    components: items.length
      ? [
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: 'shop:pick',
                placeholder: '授与品を選ぶ',
                options: items.slice(0, 25).map((i) => ({
                  label: i.name.slice(0, 100),
                  value: String(i.id),
                  description: `${priceText(i, e)}${i.description ? `・${i.description}` : ''}`.slice(0, 100),
                  ...(i.emoji ? { emoji: { name: i.emoji } } : {}),
                })),
              },
            ],
          },
        ]
      : [],
  };
}

/** 選んだ品物の確認（買う・やめる） */
export function shopConfirm(item: ShopItem, e: EconomyConfig, balance: number, note?: string) {
  const price = priceOf(item, e);
  const lines = [
    item.description,
    item.durationDays ? `期間: ${item.durationDays} 日` : item.kind === 'role' ? '期間: ずっと' : '',
    `値段: **${price.toLocaleString('ja-JP')} 枚**（いま ${balance.toLocaleString('ja-JP')} 枚）`,
    note ?? '',
  ].filter(Boolean);
  return {
    embeds: [{ title: label(item), description: lines.join('\n'), color: SHU }],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: `${price.toLocaleString('ja-JP')} 枚で受ける`, custom_id: `shop:buy:${item.id}`, disabled: balance < price },
          { type: 2, style: 2, label: 'やめる', custom_id: 'shop:cancel' },
        ],
      },
    ],
  };
}

/** 花吹雪・贈り物: 相手を選ぶ */
export function shopPickTarget(item: ShopItem, e: EconomyConfig, balance: number) {
  const what = item.kind === 'gift' ? `${coin(e)}を贈る相手` : '花吹雪を贈る相手';
  return {
    embeds: [{ title: label(item), description: [item.description, `いま ${balance.toLocaleString('ja-JP')} 枚`, '', `${what}を選んでください。`].join('\n'), color: SHU }],
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

import { randomUUID } from 'node:crypto';
import { MessageFlags, type Interaction } from 'discord.js';
import type { Db } from '../db/client.js';
import type { GuildConfig } from '../config.js';
import type { ShopItem } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { kobanValue, kobanPrice, KOBAN_VALUES } from '../domain/koban.js';
import { buyKoban, heldKoban, KobanError, ownedKoban, sendKoban } from '../services/koban.js';
import { getItem, listItems } from '../services/shop.js';
import { walletOf } from '../services/economy.js';
import { logger } from '../lib/logger.js';
const fmt = (n: number) => n.toLocaleString('ja-JP');
const row = (...components: unknown[]) => ({ type: 1, components });
const button = (custom_id: string, label: string, style = 2, disabled = false) => ({ type: 2, custom_id, label, style, disabled });
const done = (content: string) => ({ content, embeds: [], components: [row(button('koban:inventory', '🪙 持っている小判'))] });
export function kobanBuyConfirm(item: ShopItem, balance: number) {
  const value = kobanValue(item.kind)!;
  const price = kobanPrice(value);
  return { content: '', embeds: [{ title: `🪙 ${fmt(value)}銭小判`, color: 0xe6b422,
    description: [`販売価格：**${fmt(price)}銭**`, `相手に入る額：**${fmt(value)}銭**`, `手数料：**${fmt(price - value)}銭**（販売価格に含む）`, '', '購入後は `/持ち物` の「小判」から相手を選んで贈れます。', '贈ると相手に自動で換金されます。送付時の追加料金はありません。', 'セール・割引券・奉納割引は対象外です。', `いま ${fmt(balance)}銭`].join('\n') }],
    components: [row(button(`koban:buy:${item.id}:${randomUUID()}`, `${fmt(price)}銭で1枚買う`, 3, balance < price), button('shop:cancel', 'やめる'))] };
}
export class KobanApp {
  constructor(private readonly db: Db, private readonly cfg: () => GuildConfig, private readonly discord: DiscordActions) {}
  async onInteraction(i: Interaction) {
    if (!i.inCachedGuild() || i.guildId !== this.cfg().guildId || !('customId' in i) || !i.customId.startsWith('koban:')) return;
    if (!i.isButton() && !i.isStringSelectMenu() && !i.isUserSelectMenu()) return;
    try {
      const [, step, id, extra] = i.customId.split(':');
      if (step === 'shop' && i.isButton()) {
        await i.deferUpdate();
        const items = (await listItems(this.db, { enabledOnly: true })).filter(item => kobanValue(item.kind) !== undefined);
        return void await i.editReply({ content: '🪙 小判売り場：贈る相手に入る額面を選んでください。販売価格は額面の150％です。', embeds: [], components: items.length ? [row({ type: 3, custom_id: 'koban:shop-pick', placeholder: '買う小判', options: items.slice(0, 25).map(item => ({ label: `${fmt(kobanValue(item.kind)!)}銭小判 ／ ${fmt(kobanPrice(kobanValue(item.kind)!))}銭`, value: String(item.id) })) })] as never : [] });
      }
      if (step === 'shop-pick' && i.isStringSelectMenu()) {
        await i.deferUpdate();
        const item = await getItem(this.db, Number(i.values[0]));
        if (!item?.enabled || kobanValue(item.kind) === undefined) throw new KobanError('この小判は販売していません。');
        return void await i.editReply(kobanBuyConfirm(item, (await walletOf(this.db, i.user.id)).balance) as never);
      }
      if (step === 'inventory' && i.isButton()) {
        await i.deferUpdate();
        const held = await heldKoban(this.db, i.user.id);
        const choices = KOBAN_VALUES.flatMap(value => {
          const matches = held.filter(k => k.faceValue === value); const first = matches[0];
          return first ? [{ label: `${fmt(value)}銭小判（${matches.length}枚）`, value: first.id }] : [];
        });
        return void await i.editReply({ content: '', embeds: [{ title: '🪙 持っている小判', description: choices.length ? choices.map(c => c.label).join('\n') + '\n\n贈る小判を選んでください（1回に1枚）。相手に額面分の銭が入ります。' : '持っている小判はありません。SHOPの「贈る」から購入できます。', color: 0xe6b422 }], components: [...(choices.length ? [row({ type: 3, custom_id: 'koban:pick', placeholder: '贈る小判を選ぶ', options: choices })] : []), row(button('koban:shop', '🪙 小判を買う'))] as never });
      }
      if (step === 'buy' && i.isButton()) {
        await i.deferUpdate();
        const r = await buyKoban(this.db, i.user.id, Number(id), extra ?? '');
        return void await i.editReply(done(`${r.repeated ? 'この確認で購入した' : '購入しました：'}${fmt(r.receipt.faceValue)}銭小判1枚。支払い${fmt(r.receipt.price)}銭（手数料${fmt(r.receipt.fee)}銭込み）。残り${fmt(r.balance)}銭。${r.repeated ? '\n同じ購入確認では追加購入していません。' : ''}`) as never);
      }
      if (step === 'pick' && i.isStringSelectMenu()) {
        await i.deferUpdate();
        const receipt = await ownedKoban(this.db, i.user.id, i.values[0] ?? '');
        if (!receipt) throw new KobanError('この小判は送付済みか、持っていません。');
        return void await i.editReply({ content: `🪙 ${fmt(receipt.faceValue)}銭小判を贈る相手を選んでください。`, embeds: [], components: [row({ type: 5, custom_id: `koban:to:${receipt.id}`, placeholder: '贈る相手', min_values: 1, max_values: 1 })] as never });
      }
      if (step === 'to' && i.isUserSelectMenu()) {
        await i.deferUpdate();
        const receipt = await ownedKoban(this.db, i.user.id, id ?? '');
        if (!receipt) throw new KobanError('この小判は送付済みか、持っていません。');
        const targetId = i.values[0] ?? '';
        const target = await i.guild.members.fetch({ user: targetId, force: true }).catch(() => undefined);
        if (!target || target.user.bot || target.id === i.user.id) throw new KobanError('自分以外の在籍中のメンバーを選んでください。');
        return void await i.editReply({ content: '', embeds: [{ title: '🪙 小判を贈る確認', color: 0xe6b422, description: `相手：${target.displayName}\n受取額：**${fmt(receipt.faceValue)}銭**\n小判を1枚使います。追加の支払いはありません。\n贈るとすぐに換金され、取り消せません。` }], components: [row(button(`koban:send:${receipt.id}:${target.id}`, 'この相手に1枚贈る', 3), button('koban:inventory', '選び直す'))] as never });
      }
      if (step === 'send' && i.isButton()) {
        await i.deferUpdate();
        const target = await i.guild.members.fetch({ user: extra ?? '', force: true }).catch(() => undefined);
        if (!target || target.user.bot) throw new KobanError('相手の在籍を確認できません。小判は送っていません。');
        const r = await sendKoban(this.db, i.user.id, id ?? '', target.id);
        const dm = await this.discord.sendDm(target.id, `🪙 ${i.member.displayName}さんから${fmt(r.value)}銭小判が届き、${fmt(r.value)}銭が入りました（咲楽ノ宮）。`).catch(() => false);
        return void await i.editReply(done(`${target.displayName}さんに小判1枚を贈り、${fmt(r.value)}銭が入りました。${dm ? '' : '\nDMのお知らせは届いていませんが、換金は完了しています。'}`) as never);
      }
    } catch (err) {
      if (!(err instanceof KobanError)) logger.warn({ err }, 'koban operation failed');
      const content = err instanceof KobanError ? err.message : '処理を確認できませんでした。同じ購入・送付ボタンから確認し直せます。';
      if (i.deferred || i.replied) await i.editReply(done(content) as never).catch(() => undefined);
      else await i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }
}

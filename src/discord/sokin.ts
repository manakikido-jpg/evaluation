import { randomUUID } from 'node:crypto';
import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import type { EconomyConfig, GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { giveGift, type GiftResult } from '../services/shop.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
/** 確かめるボタンを押せる時間 */
const PENDING_MS = 10 * 60_000;
const fmt = (n: number) => n.toLocaleString('ja-JP');

type Pending = { toId: string; toName: string; amount: number; note: string; by: string; at: number };

/** 送る前に確かめる（本人にだけ） */
export function sokinConfirm(e: EconomyConfig, to: { name: string }, amount: number, note: string, nonce: string) {
  return {
    content: [
      `💸 **${to.name}** さんに ${e.currencyEmoji}${e.currencyName} **${fmt(amount)} 枚**を送りますか？`,
      ...(note ? [`> ${note.replace(/\n/g, ' ')}`] : []),
      `-# 送ったら取り消せません。相手には DM で知らせます（1 日に送れるのは合計 ${fmt(e.giftDailyLimit)} 枚まで）`,
    ].join('\n'),
    components: [
      {
        type: 1 as const,
        components: [
          { type: 2 as const, style: 3 as const, custom_id: `sokin:ok:${nonce}`, label: `💸 ${fmt(amount)} 枚送る` },
          { type: 2 as const, style: 2 as const, custom_id: `sokin:cancel:${nonce}`, label: 'やめる' },
        ],
      },
    ],
  };
}

/** 送ったあとの文（本人にだけ） */
export function sokinResultText(e: EconomyConfig, r: GiftResult, toId: string, amount: number): string {
  switch (r.status) {
    case 'ok':
      return `💸 <@${toId}> さんに ${e.currencyEmoji}${e.currencyName} ${fmt(amount)} 枚を送りました。残り ${fmt(r.balance)} 枚。`;
    case 'self':
      return '自分には送れません。';
    case 'rank_too_low':
      return `送金は「${r.rankName}」以上になるとできます。`;
    case 'bad_amount':
      return `${fmt(r.min)}〜${fmt(r.max)} 枚の間で送ってください。`;
    case 'daily_limit':
      return `今日送れるのは、あと ${fmt(r.left)} 枚までです（日本時間の 0 時に戻ります。授与所の「🎁 贈り物」と合わせて数えます）。`;
    case 'insufficient':
      return `${e.currencyName}が足りません（いま ${fmt(r.balance)} 枚）。`;
  }
}

/** 相手に届く DM */
export function sokinDm(e: EconomyConfig, fromName: string, amount: number, note: string): string {
  return [`💸 **${fromName}** さんから ${e.currencyEmoji}${e.currencyName} **${fmt(amount)} 枚**が届きました（咲楽ノ宮）。`, ...(note ? [`> ${note.replace(/\n/g, ' ')}`] : []), '-# 残りは `/残高` で見られます'].join('\n');
}

/**
 * 💸 /送金: 銭をほかの人に送る。決まりは授与所の「🎁 贈り物」と同じ（giveGift。役職・1 回の枚数・1 日の合計の上限）。
 * 押す前に本人にだけ確かめ、ボタンは 1 回しか効かない（同時に押しても 1 回だけ送る）。相手には DM で知らせる
 */
export class SokinApp {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'sokin') return await this.ask(interaction);
      if (interaction.isButton() && interaction.customId.startsWith('sokin:')) return await this.decide(interaction);
    } catch (err) {
      logger.error({ err }, 'sokin failed');
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'うまくいきませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL }).catch(() => undefined);
      }
    }
  }

  private async ask(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const e = this.cfg().economy;
    const to = i.options.getMember('user');
    const toUser = i.options.getUser('user', true);
    if (!to || toUser.bot) return void (await i.reply({ content: '送れるのは、この鯖にいる人だけです（BOT には送れません）。', ...EPHEMERAL }));
    if (toUser.id === i.user.id) return void (await i.reply({ content: '自分には送れません。', ...EPHEMERAL }));
    const amount = i.options.getInteger('amount', true);
    if (amount < e.giftMin || amount > e.giftMax) return void (await i.reply({ content: `${fmt(e.giftMin)}〜${fmt(e.giftMax)} 枚の間で送ってください。`, ...EPHEMERAL }));
    const note = (i.options.getString('message') ?? '').trim().slice(0, 200);
    const nonce = randomUUID();
    for (const [k, p] of this.pending) if (Date.now() - p.at > PENDING_MS) this.pending.delete(k);
    this.pending.set(nonce, { toId: toUser.id, toName: to.displayName, amount, note, by: i.user.id, at: Date.now() });
    await i.reply({ ...sokinConfirm(e, { name: to.displayName }, amount, note, nonce), allowedMentions: { parse: [] }, ...EPHEMERAL });
  }

  private async decide(i: ButtonInteraction<'cached'>): Promise<void> {
    const [, action, nonce] = i.customId.split(':');
    const p = nonce ? this.pending.get(nonce) : undefined;
    if (action === 'cancel') {
      if (nonce && p?.by === i.user.id) this.pending.delete(nonce);
      return void (await i.update({ content: 'やめました。', components: [] }));
    }
    if (!p || Date.now() - p.at > PENDING_MS || p.by !== i.user.id) {
      return void (await i.update({ content: '時間が経ったので、もう一度 `/送金` からやり直してください。', components: [] }));
    }
    // 先に消す（二度押し・同時押しでも 1 回だけ送る）
    this.pending.delete(nonce!);
    const cfg = this.cfg();
    const r = await giveGift(this.db, cfg, { id: i.user.id, roleIds: [...i.member.roles.cache.keys()] }, p.toId, p.amount);
    let text = sokinResultText(cfg.economy, r, p.toId, p.amount);
    if (r.status === 'ok') {
      await audit(this.db, { actorId: i.user.id, targetId: p.toId, action: 'coins.send', detail: { amount: p.amount, note: p.note || undefined }, via: 'discord' });
      const dm = await i.client.users
        .send(p.toId, sokinDm(cfg.economy, i.member.displayName, p.amount, p.note))
        .then(() => true)
        .catch(() => false);
      if (!dm) text += '\n-# 相手が DM を受け取らない設定のため、知らせは届いていません';
    }
    await i.update({ content: text, embeds: [], components: [], allowedMentions: { parse: [] } });
  }
}

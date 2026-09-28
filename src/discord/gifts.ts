import { randomUUID } from 'node:crypto';
import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { adminLevelOf, TICKET_KINDS, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { customName, listCustomTickets } from '../services/customTickets.js';
import {
  applyGiftRoles,
  giftAnnouncement,
  giftItemLabel,
  giftTargets,
  giftToAll,
  giftUnit,
  parseGiftItem,
  validGiftCount,
  type GiftItem,
} from '../services/gifts.js';
import { giftableShopItem } from '../services/gacha.js';
import { listItems } from '../services/shop.js';
import { TICKET_LABEL } from '../services/tickets.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
/** 確かめるボタンを押せる時間 */
const PENDING_MS = 10 * 60_000;

type Pending = { item: GiftItem; label: string; count: number; note: string; roleId?: string; roleName?: string; announce?: string; by: string; at: number };

/** 🎁 /配る（宮司）: 今いる人みんなに、銭・券・自由な券・授与品を贈る。社務所Web の「🎁 全員にプレゼント」と同じ */
export class GiftApp {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (interaction.isAutocomplete() && interaction.commandName === 'gift') return await this.suggest(interaction);
      if (interaction.isChatInputCommand() && interaction.commandName === 'gift') return await this.ask(interaction);
      if (interaction.isButton() && interaction.customId.startsWith('gift:')) return await this.decide(interaction);
    } catch (err) {
      logger.error({ err }, 'gift command failed');
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'うまくいきませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL }).catch(() => undefined);
      }
    }
  }

  /** 贈れるもの（銭・券・自由な券・授与品） */
  private async choices(): Promise<{ name: string; value: string }[]> {
    const e = this.cfg().economy;
    const [customs, items] = await Promise.all([listCustomTickets(this.db), listItems(this.db)]);
    return [
      { name: `${e.currencyEmoji} ${e.currencyName}`, value: 'coins' },
      ...TICKET_KINDS.map((k) => ({ name: `🎟 ${TICKET_LABEL[k].emoji} ${TICKET_LABEL[k].name}`, value: k })),
      ...customs.map((t) => ({ name: `🎟 ${customName(t)}（自由な券）`, value: `custom:${t.id}` })),
      ...items.filter(giftableShopItem).map((i) => ({ name: `🛍 ${i.emoji}${i.name}${i.durationDays ? `（${i.durationDays} 日）` : ''}`, value: `shop:${i.id}` })),
    ];
  }

  private async suggest(i: AutocompleteInteraction<'cached'>): Promise<void> {
    const q = i.options.getFocused().trim().toLowerCase();
    const list = (await this.choices()).filter((c) => !q || c.name.toLowerCase().includes(q));
    await i.respond(list.slice(0, 25).map((c) => ({ name: c.name.slice(0, 100), value: c.value })));
  }

  private isGuji(i: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>): boolean {
    return adminLevelOf(this.cfg(), [...i.member.roles.cache.keys()]) === 'guji';
  }

  /** まず、だれに何を贈るかを本人にだけ見せて、ボタンで確かめる */
  private async ask(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    if (!this.isGuji(i)) return void (await i.reply({ content: 'みんなに配れるのは宮司だけです。', ...EPHEMERAL }));
    const cfg = this.cfg();
    const item = await parseGiftItem(this.db, i.options.getString('item', true));
    if (!item) return void (await i.reply({ content: '贈るものは、出てくる候補から選んでください。', ...EPHEMERAL }));
    const count = i.options.getInteger('count') ?? 1;
    if (!validGiftCount(item, count)) {
      const max = item.kind === 'coins' ? '100,000' : item.kind === 'shop' ? '1' : '100';
      return void (await i.reply({ content: `数は 1〜${max} にしてください${item.kind === 'shop' ? '（授与品は 1 人 1 つ）' : ''}。`, ...EPHEMERAL }));
    }
    const role = i.options.getRole('role');
    const targets = await giftTargets(this.db, cfg.ranks.map((r) => r.roleId), role?.id);
    if (!targets.length) return void (await i.reply({ content: '贈る相手がいません（役職のある今いる人が対象です）。', ...EPHEMERAL }));
    const label = giftItemLabel(item, { name: cfg.economy.currencyName, emoji: cfg.economy.currencyEmoji });
    const note = i.options.getString('reason', true).trim().slice(0, 200);
    const announce = (i.options.getBoolean('announce') ?? true) && i.channel?.isTextBased() ? i.channelId : undefined;
    const nonce = randomUUID();
    this.pending.set(nonce, { item, label, count, note, roleId: role?.id, roleName: role?.name, announce, by: i.user.id, at: Date.now() });
    for (const [k, p] of this.pending) if (Date.now() - p.at > PENDING_MS) this.pending.delete(k);
    await i.reply({
      content: [
        `🎁 **${label} を ${count.toLocaleString('ja-JP')} ${giftUnit(item)}ずつ、${targets.length} 人に贈ります。**`,
        `- 相手: ${role ? `${role} を持っている人（役職のある今いる人）` : '役職のある今いる人みんな（BOT・抜けた人を除く）'}`,
        `- 理由: ${note}`,
        announce ? '- このチャンネルでお知らせします（通知は飛ばしません）' : '- お知らせはしません',
        item.kind === 'shop' ? '-# もう持っている人には、期間のある品はその分のばし、ないものは贈りません' : '',
        '-# 取り消しはメンバーごとに社務所Web で「減らす」になります。よければ「配る」を押してください（10 分以内）',
      ]
        .filter(Boolean)
        .join('\n'),
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            { type: ComponentType.Button, style: ButtonStyle.Success, custom_id: `gift:ok:${nonce}`, label: '🎁 配る' },
            { type: ComponentType.Button, style: ButtonStyle.Secondary, custom_id: `gift:cancel:${nonce}`, label: 'やめる' },
          ],
        },
      ],
      allowedMentions: { parse: [] },
      ...EPHEMERAL,
    });
  }

  private async decide(i: ButtonInteraction<'cached'>): Promise<void> {
    const [, action, nonce] = i.customId.split(':');
    const p = nonce ? this.pending.get(nonce) : undefined;
    if (action === 'cancel') {
      if (nonce) this.pending.delete(nonce);
      return void (await i.update({ content: 'やめました。', components: [] }));
    }
    if (!p || Date.now() - p.at > PENDING_MS || p.by !== i.user.id) {
      return void (await i.update({ content: '時間が経ったので、もう一度 `/配る` からやり直してください。', components: [] }));
    }
    if (!this.isGuji(i)) return void (await i.update({ content: 'みんなに配れるのは宮司だけです。', components: [] }));
    await i.update({ content: '🎁 配っています…', components: [] });
    const cfg = this.cfg();
    const targets = await giftTargets(this.db, cfg.ranks.map((r) => r.roleId), p.roleId);
    const r = await giftToAll(this.db, { item: p.item, label: p.label, count: p.count, note: p.note, memberIds: targets, roleId: p.roleId, by: p.by, nonce: nonce! });
    this.pending.delete(nonce!);
    if (r.status === 'duplicate') return void (await i.editReply('もう配ってあります。'));
    if (r.status !== 'ok') return void (await i.editReply('配れませんでした（数や贈るものを確かめてください）。'));
    await audit(this.db, {
      actorId: p.by,
      action: 'gift.all',
      detail: { gift: r.batch.id, item: r.batch.item, label: p.label, count: p.count, note: p.note, roleId: p.roleId, recipients: targets.length },
      via: 'discord',
    });
    const done = [`🎁 ${p.label} を ${targets.length} 人に贈りました。`];
    if (p.announce) {
      const howToUse =
        p.item.kind === 'coins'
          ? ''
          : p.item.kind === 'shop'
            ? '\n-# ロールは少しずつ付きます'
            : '\n-# `/物御籤` の「🎟 券を使う」から使えます（持っている券は `/残高` で見られます）';
      const ok = await this.discord
        .sendMessage(p.announce, { content: `${giftAnnouncement(p.label, p.count, p.note, giftUnit(p.item), p.roleName)}${howToUse}`, allowed_mentions: { parse: [] } })
        .then(() => true)
        .catch((err: unknown) => (logger.warn({ err }, 'gift announce failed'), false));
      done.push(ok ? 'このチャンネルでお知らせしました。' : 'お知らせは出せませんでした（BOT がこのチャンネルに書き込めるか確かめてください）。');
    }
    if (r.roles.length) {
      await i.editReply([...done, `ロールを付けています（${r.roles.length} 人）…`].join('\n'));
      const n = await applyGiftRoles(this.discord, cfg.guildId, r.roles);
      done.push(`ロールを ${n} 人に付けました${n < r.roles.length ? `（${r.roles.length - n} 人は付けられませんでした。BOT のロールの位置を確かめてください）` : ''}。`);
    }
    await i.editReply(done.join('\n'));
  }
}

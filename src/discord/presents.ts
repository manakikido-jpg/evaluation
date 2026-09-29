import { randomUUID } from 'node:crypto';
import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { parsePresentItem, PRESENT_MAX, PRESENT_MESSAGES, presentChoices, sendPresent, type Holding, type PresentItem } from '../services/presents.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
/** 確かめるボタンを押せる時間 */
const PENDING_MS = 10 * 60_000;

type Pending = { item: PresentItem; label: string; count: number; toId: string; note: string; by: string; at: number };

// ───────── 🎒 /持ち物 の見た目（Discord API の形のまま） ─────────

const COLOR = 0xd7003a;
const btn = (custom_id: string, label: string, style: 1 | 2 | 3 = 2, disabled = false) => ({ type: 2 as const, style, label, custom_id, disabled });
const row = (...components: unknown[]) => ({ type: 1 as const, components });

/** 持ち物の一覧。選ぶと、使う・贈るを選べる */
export function itemsView(list: Holding[], note?: string) {
  if (!list.length) {
    return {
      content: note ?? '',
      embeds: [{ title: '🎒 持ち物', description: '持っている券はありません。\n-# 券は物御籤・授与所・運営からのプレゼントでもらえます', color: COLOR }],
      components: [],
    };
  }
  const lines = list.map((h) => `${h.label} ×**${h.count}**${h.manual ? '' : '（使う場面で自動）'}`);
  return {
    content: note ?? '',
    embeds: [{ title: '🎒 持ち物', description: [...lines, '', '-# 下から選ぶと、「使う」「贈る」を選べます'].join('\n').slice(0, 4000), color: COLOR }],
    components: [
      row({
        type: 3,
        custom_id: 'items:pick',
        placeholder: '使う・贈るものを選ぶ',
        options: list.slice(0, 25).map((h) => ({ label: `${h.label}（${h.count} 枚）`.slice(0, 100), value: h.value, description: h.note.slice(0, 100) || undefined })),
      }),
    ],
  };
}

/** 選んだもの: 説明と「使う」「贈る」 */
export function itemDetail(h: Holding) {
  return {
    content: '',
    embeds: [
      {
        title: h.label,
        description: [h.note, '', `持っている: **${h.count} 枚**`, h.manual ? '' : '-# この券は、使う場面（部屋代・授与所など）で自動で使われます'].filter(Boolean).join('\n'),
        color: COLOR,
      },
    ],
    components: [row(...(h.manual ? [btn(`gacha:use1:${h.value}`, '✨ 使う', 3)] : []), btn(`items:give:${h.value}`, '💝 贈る', 1), btn('items:back', '← 一覧へ'))],
  };
}

/** 贈る相手を選ぶ */
export function itemGiveTarget(h: Holding) {
  return {
    content: '',
    embeds: [{ title: `💝 ${h.label}を贈る`, description: `贈る相手を選んでください（持っている: ${h.count} 枚）。`, color: COLOR }],
    components: [row({ type: 5, custom_id: `items:to:${h.value}`, placeholder: '贈る相手を選ぶ' }), row(btn('items:back', '← 一覧へ'))],
  };
}

/** 何枚贈るか（1 枚しかなければ出さない） */
export function itemGiveCount(h: Holding, to: { id: string; name: string }) {
  const counts = [...new Set([1, 2, 3, 5, 10, h.count].filter((n) => n >= 1 && n <= Math.min(h.count, PRESENT_MAX)))].sort((a, b) => a - b);
  return {
    content: '',
    embeds: [{ title: `💝 ${to.name} さんに ${h.label}`, description: `何枚贈りますか？（持っている: ${h.count} 枚）`, color: COLOR }],
    components: [
      row({
        type: 3,
        custom_id: `items:count:${h.value}:${to.id}`,
        placeholder: '枚数を選ぶ',
        options: counts.map((n) => ({ label: n === h.count && n > 1 ? `全部（${n} 枚）` : `${n} 枚`, value: String(n) })),
      }),
      row(btn('items:back', '← 一覧へ')),
    ],
  };
}

/** 贈る前に確かめる */
export function itemGiveConfirm(h: Holding, to: { id: string; name: string }, count: number) {
  return {
    content: '',
    embeds: [{ title: `💝 ${to.name} さんに ${h.label} ×${count}`, description: '贈ったら取り消せません。相手には DM で知らせます。', color: COLOR }],
    components: [row(btn(`items:ok:${h.value}:${to.id}:${count}`, `💝 ${count} 枚贈る`, 3), btn('items:back', 'やめる'))],
  };
}

/**
 * 💝 /贈る: 持っている券・自由な券を、ほかの人に贈る（押す前に本人にだけ確かめる。相手には DM で知らせる）。
 * 🎒 /持ち物: 持っている券を見て、選んで「使う」（中身は物御籤の「券を使う」）か「贈る」（相手・枚数も選ぶだけ）
 */
export class PresentApp {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (interaction.isAutocomplete() && interaction.commandName === 'present') return await this.suggest(interaction);
      if (interaction.isChatInputCommand() && interaction.commandName === 'present') return await this.ask(interaction);
      if (interaction.isButton() && interaction.customId.startsWith('present:')) return await this.decide(interaction);
      if (interaction.isChatInputCommand() && interaction.commandName === 'items') return await this.items(interaction);
      const id = 'customId' in interaction ? interaction.customId : '';
      if (!id.startsWith('items:')) return;
      if (interaction.isButton() && id === 'items:back') return await this.items(interaction);
      if (interaction.isStringSelectMenu() && id === 'items:pick') return await this.itemPick(interaction, interaction.values[0] ?? '');
      if (interaction.isButton() && id.startsWith('items:give:')) return await this.itemGive(interaction, id.slice('items:give:'.length));
      if (interaction.isUserSelectMenu() && id.startsWith('items:to:')) return await this.itemTo(interaction, id.slice('items:to:'.length));
      if (interaction.isStringSelectMenu() && id.startsWith('items:count:')) {
        const [, , value, toId] = id.split(':');
        return await this.itemCount(interaction, value ?? '', toId ?? '', Number(interaction.values[0]));
      }
      if (interaction.isButton() && id.startsWith('items:ok:')) {
        const parts = id.split(':');
        // value は custom:ID のときに「:」を含む
        const count = Number(parts.at(-1));
        const toId = parts.at(-2) ?? '';
        return await this.itemSend(interaction, parts.slice(2, -2).join(':'), toId, count);
      }
    } catch (err) {
      logger.error({ err }, 'present failed');
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'うまくいきませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL }).catch(() => undefined);
      }
    }
  }

  /** 候補: 自分が持っている券・自由な券（持っている数つき） */
  private async suggest(i: AutocompleteInteraction<'cached'>): Promise<void> {
    const q = i.options.getFocused().trim().toLowerCase();
    const list = (await presentChoices(this.db, i.user.id)).filter((c) => !q || c.label.toLowerCase().includes(q));
    await i.respond(list.slice(0, 25).map((c) => ({ name: `${c.label}（${c.count} 枚）`.slice(0, 100), value: c.value })));
  }

  private async ask(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const to = i.options.getMember('user');
    const toUser = i.options.getUser('user', true);
    if (!to || toUser.bot) return void (await i.reply({ content: PRESENT_MESSAGES.not_member, ...EPHEMERAL }));
    if (toUser.id === i.user.id) return void (await i.reply({ content: PRESENT_MESSAGES.self, ...EPHEMERAL }));
    const item = parsePresentItem(i.options.getString('item', true));
    const choice = (await presentChoices(this.db, i.user.id)).find((c) => item && c.value === i.options.getString('item', true));
    if (!item || !choice) return void (await i.reply({ content: '贈るものは、出てくる候補（自分が持っている券）から選んでください。持っている券は `/持ち物` で見られます。', ...EPHEMERAL }));
    const count = i.options.getInteger('count') ?? 1;
    if (count < 1 || count > PRESENT_MAX) return void (await i.reply({ content: PRESENT_MESSAGES.invalid, ...EPHEMERAL }));
    if (count > choice.count) return void (await i.reply({ content: `${choice.label} は ${choice.count} 枚しか持っていません。`, ...EPHEMERAL }));
    const note = (i.options.getString('message') ?? '').trim().slice(0, 200);
    const nonce = randomUUID();
    for (const [k, p] of this.pending) if (Date.now() - p.at > PENDING_MS) this.pending.delete(k);
    this.pending.set(nonce, { item, label: choice.label, count, toId: toUser.id, note, by: i.user.id, at: Date.now() });
    await i.reply({
      content: [
        `💝 **${to.displayName}** さんに **${choice.label} ×${count}** を贈りますか？`,
        ...(note ? [`> ${note.replace(/\n/g, ' ')}`] : []),
        '-# 贈ったら取り消せません。相手には DM で知らせます',
      ].join('\n'),
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            { type: ComponentType.Button, style: ButtonStyle.Success, custom_id: `present:ok:${nonce}`, label: '💝 贈る' },
            { type: ComponentType.Button, style: ButtonStyle.Secondary, custom_id: `present:cancel:${nonce}`, label: 'やめる' },
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
      return void (await i.update({ content: '時間が経ったので、もう一度 `/贈る` からやり直してください。', components: [] }));
    }
    this.pending.delete(nonce!);
    await i.update({ content: await this.deliver(i, p.toId, p.item, p.count, p.note), embeds: [], components: [], allowedMentions: { parse: [] } });
  }

  /** 贈る（確かめたあと）。結果の文を返す */
  private async deliver(i: ButtonInteraction<'cached'>, toId: string, item: PresentItem, count: number, note = ''): Promise<string> {
    const to = await i.guild.members.fetch(toId).catch(() => undefined);
    const r = await sendPresent(
      this.db,
      this.cfg(),
      { id: i.user.id, roleIds: [...i.member.roles.cache.keys()] },
      { id: toId, roleIds: to ? [...to.roles.cache.keys()] : [], bot: to?.user.bot },
      item,
      count,
    );
    if (r.status === 'rank_too_low') return `贈れるのは「${r.rankName}」になってからです（作ったばかりのアカウントから集められないようにしています）。`;
    if (r.status === 'not_enough') return `${r.label} が足りません（いま ${r.have} 枚）。`;
    if (r.status !== 'ok') return PRESENT_MESSAGES[r.status];
    await audit(this.db, { actorId: i.user.id, targetId: toId, action: 'present.send', detail: { item, label: r.label, count: r.count, note: note || undefined }, via: 'discord' });
    const dm = await i.client.users
      .send(toId, [`💝 **${i.member.displayName}** さんから **${r.label} ×${r.count}** が届きました（咲楽ノ宮）。`, ...(note ? [`> ${note.replace(/\n/g, ' ')}`] : []), '-# 持っている券は `/持ち物` で見て、使う・贈るができます'].join('\n'))
      .then(() => true)
      .catch(() => false);
    return `💝 <@${toId}> さんに **${r.label} ×${r.count}** を贈りました（残り ${r.left} 枚）。${dm ? '' : '\n-# 相手が DM を受け取らない設定のため、知らせは届いていません'}`;
  }

  // ───────── 🎒 /持ち物 ─────────

  private async holding(userId: string, value: string): Promise<Holding | undefined> {
    return (await presentChoices(this.db, userId)).find((h) => h.value === value);
  }

  private async items(i: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>): Promise<void> {
    const view = itemsView(await presentChoices(this.db, i.user.id));
    if (i.isButton()) return void (await i.update(view as never));
    await i.reply({ ...view, ...EPHEMERAL } as never);
  }

  private async itemPick(i: StringSelectMenuInteraction<'cached'>, value: string): Promise<void> {
    const h = await this.holding(i.user.id, value);
    if (!h) return void (await i.update(itemsView(await presentChoices(this.db, i.user.id), 'その券はもう持っていません。') as never));
    await i.update(itemDetail(h) as never);
  }

  private async itemGive(i: ButtonInteraction<'cached'>, value: string): Promise<void> {
    const h = await this.holding(i.user.id, value);
    if (!h) return void (await i.update(itemsView(await presentChoices(this.db, i.user.id), 'その券はもう持っていません。') as never));
    await i.update(itemGiveTarget(h) as never);
  }

  private async itemTo(i: UserSelectMenuInteraction<'cached'>, value: string): Promise<void> {
    const toId = i.values[0] ?? '';
    const h = await this.holding(i.user.id, value);
    if (!h) return void (await i.update(itemsView(await presentChoices(this.db, i.user.id), 'その券はもう持っていません。') as never));
    const to = i.members.get(toId);
    if (toId === i.user.id) return void (await i.update({ ...(itemGiveTarget(h) as object), content: PRESENT_MESSAGES.self } as never));
    if (!to || i.users.get(toId)?.bot) return void (await i.update({ ...(itemGiveTarget(h) as object), content: PRESENT_MESSAGES.not_member } as never));
    const target = { id: toId, name: to.displayName };
    await i.update((h.count > 1 ? itemGiveCount(h, target) : itemGiveConfirm(h, target, 1)) as never);
  }

  private async itemCount(i: StringSelectMenuInteraction<'cached'>, value: string, toId: string, count: number): Promise<void> {
    const h = await this.holding(i.user.id, value);
    const to = await i.guild.members.fetch(toId).catch(() => undefined);
    if (!h || !to || !Number.isInteger(count) || count < 1 || count > h.count) {
      return void (await i.update(itemsView(await presentChoices(this.db, i.user.id), '枚数を選び直してください。') as never));
    }
    await i.update(itemGiveConfirm(h, { id: toId, name: to.displayName }, count) as never);
  }

  private async itemSend(i: ButtonInteraction<'cached'>, value: string, toId: string, count: number): Promise<void> {
    const item = parsePresentItem(value);
    if (!item || !/^\d{17,20}$/.test(toId) || !Number.isInteger(count)) return void (await i.update(itemsView(await presentChoices(this.db, i.user.id)) as never));
    const text = await this.deliver(i, toId, item, count);
    await i.update({ ...(itemsView(await presentChoices(this.db, i.user.id), text) as object), allowedMentions: { parse: [] } } as never);
  }
}

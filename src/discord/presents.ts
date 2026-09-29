import { randomUUID } from 'node:crypto';
import { ButtonStyle, ComponentType, MessageFlags, type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { parsePresentItem, PRESENT_MAX, PRESENT_MESSAGES, presentChoices, sendPresent, type PresentItem } from '../services/presents.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
/** 確かめるボタンを押せる時間 */
const PENDING_MS = 10 * 60_000;

type Pending = { item: PresentItem; label: string; count: number; toId: string; note: string; by: string; at: number };

/** 💝 /贈る: 持っている券・自由な券を、ほかの人に贈る（押す前に本人にだけ確かめる。相手には DM で知らせる） */
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
    if (!item || !choice) return void (await i.reply({ content: '贈るものは、出てくる候補（自分が持っている券）から選んでください。持っている券は `/残高` で見られます。', ...EPHEMERAL }));
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
    const to = await i.guild.members.fetch(p.toId).catch(() => undefined);
    const r = await sendPresent(
      this.db,
      this.cfg(),
      { id: i.user.id, roleIds: [...i.member.roles.cache.keys()] },
      { id: p.toId, roleIds: to ? [...to.roles.cache.keys()] : [], bot: to?.user.bot },
      p.item,
      p.count,
    );
    if (r.status === 'rank_too_low') return void (await i.update({ content: `贈れるのは「${r.rankName}」になってからです（作ったばかりのアカウントから集められないようにしています）。`, components: [] }));
    if (r.status === 'not_enough') return void (await i.update({ content: `${r.label} が足りません（いま ${r.have} 枚）。`, components: [] }));
    if (r.status !== 'ok') return void (await i.update({ content: PRESENT_MESSAGES[r.status], components: [] }));
    await audit(this.db, { actorId: i.user.id, targetId: p.toId, action: 'present.send', detail: { item: p.item, label: r.label, count: r.count, note: p.note || undefined }, via: 'discord' });
    const dm = await i.client.users
      .send(p.toId, [`💝 **${i.member.displayName}** さんから **${r.label} ×${r.count}** が届きました（咲楽ノ宮）。`, ...(p.note ? [`> ${p.note.replace(/\n/g, ' ')}`] : []), '-# 持っている券は `/残高`、使うときは `/物御籤` の「🎟 券を使う」から'].join('\n'))
      .then(() => true)
      .catch(() => false);
    await i.update({
      content: `💝 <@${p.toId}> さんに **${r.label} ×${r.count}** を贈りました（残り ${r.left} 枚）。${dm ? '' : '\n-# 相手が DM を受け取らない設定のため、知らせは届いていません'}`,
      components: [],
      allowedMentions: { parse: [] },
    });
  }
}

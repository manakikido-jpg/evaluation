import { ActionRowBuilder, ChannelType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type Guild, type Interaction, type ModalSubmitInteraction } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { BoardEntry, BoardPost } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import {
  applyPost,
  BOARD,
  BOARD_CATEGORIES,
  boardFee,
  boardTick,
  closePost,
  completeEntry,
  createPost,
  disputeEntry,
  entriesOf,
  getEntry,
  getPost,
  hire,
  hiredCount,
  isBoardCategory,
  loadBoardPlace,
  saveBoardPlace,
  setEntryThread,
  setPostMessage,
  type BoardCategory,
} from '../services/board.js';
import { parseCount } from '../services/otoshidama.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const COLOR = 0x2f7d6d;
const fmt = (n: number) => n.toLocaleString('ja-JP');
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
type Btn = { type: 2; style: 1 | 2 | 3 | 4; label: string; custom_id: string; emoji?: { name: string }; disabled?: boolean };
const button = (custom_id: string, label: string, style: Btn['style'] = 2, emoji?: string): Btn => ({ type: 2, style, label, custom_id, ...(emoji ? { emoji: { name: emoji } } : {}) });
const row = (...b: Btn[]) => ({ type: 1 as const, components: b });

/** 掲示板のいちばん下に置く「募集を書く」 */
export function boardPanel(cfg: GuildConfig) {
  const e = cfg.economy;
  return {
    embeds: [
      {
        title: '📌 掲示板',
        description: [
          '仕事・依頼・手伝い・仲間・イベントなどの募集を書けます（入鯖が承認された方ならだれでも）。',
          `報酬（${e.currencyEmoji}${e.currencyName}）を付けると、人数分を社務所が預かり、採用した人に「完了」で渡します（手数料 ${cfg.market.feePercent}%）。`,
          '-# 気になる募集には「🙋 応募する」。応募した人と採用は、募集した人にだけ見えます（採用されたら 2 人だけのスレッドでやり取り）。質問は募集のスレッドへ',
          '-# 本物のお金のやり取り・性的なもの・個人情報の募集は禁止です（しきたり）',
        ].join('\n'),
        color: COLOR,
      },
    ],
    components: [row(button('board:new', '募集を書く', 1, '📝'))],
  };
}

/** 募集のカード */
export function postCard(post: BoardPost, entries: BoardEntry[], cfg: GuildConfig) {
  const c = BOARD_CATEGORIES[post.category as BoardCategory] ?? BOARD_CATEGORIES.other;
  const e = cfg.economy;
  const open = post.status === 'open';
  const hired = hiredCount(entries);
  const applied = entries.length;
  const state = open ? '' : post.status === 'removed' ? '（取り下げ）' : hired >= post.slots ? '（満員）' : '（締め切り）';
  return {
    embeds: [
      {
        title: `${c.emoji} ${post.title}${state}`.slice(0, 256),
        description: [
          `募集: <@${post.authorId}> ・ ${c.label}`,
          `人数: **${hired} / ${post.slots} 人**（応募 ${applied} 人）`,
          post.reward > 0
            ? `報酬: **${e.currencyEmoji} 1 人 ${fmt(post.reward)} 枚**（手数料を引いて ${fmt(post.reward - boardFee(cfg, post.reward))} 枚を渡す・社務所が預かり中）`
            : '報酬: なし',
          open ? `締め切り: <t:${unix(post.deadlineAt)}:R>（<t:${unix(post.deadlineAt)}:f>）` : '',
          '',
          post.body,
        ]
          .filter((l, i) => l || i === 4)
          .join('\n')
          .slice(0, 4000),
        color: open ? COLOR : 0x888888,
        footer: { text: `募集 #${post.id}` },
      },
    ],
    components: open ? [row(button(`board:apply:${post.id}`, '応募する', 1, '🙋'), button(`board:close:${post.id}`, '締め切る'))] : [],
  };
}

/** スレッドに出す、1 人の応募（採用・完了・問題あり） */
/**
 * 応募・採用のメッセージ。応募の受付（募集した人だけのスレッド）では、採用したあとは
 * やり取りのスレッドへの案内だけにする（完了・問題ありのボタンは、やり取りのスレッドに出す）
 */
export function entryMessage(entry: BoardEntry, post: BoardPost, cfg: GuildConfig, opts: { workThreadId?: string } = {}) {
  const e = cfg.economy;
  const status = {
    applied: '🙋 応募',
    hired: post.reward > 0 ? '✅ 採用（報酬は社務所が預かり中）' : '✅ 採用',
    done: post.reward > 0 ? `🎉 完了（${e.currencyEmoji} ${fmt(entry.paid)} 枚を渡しました）` : '🎉 完了',
    disputed: '⚠️ 問題あり（運営が確認します）',
    refunded: '↩️ 報酬は募集した人に戻しました',
  }[entry.status];
  const lines = [`<@${entry.memberId}> さん … **${status}**`];
  if (entry.status === 'applied') lines.push(`-# <@${post.authorId}> さん: お願いするなら「採用する」を押してください`);
  const summary = Boolean(opts.workThreadId) && entry.status !== 'applied';
  if (summary) lines.push(`-# やり取りは <#${opts.workThreadId}> で`);
  if (!summary && entry.status === 'hired' && post.reward > 0 && entry.releaseAt)
    lines.push(`-# 終わったら <@${post.authorId}> さんが「完了（報酬を渡す）」を。<t:${unix(entry.releaseAt)}:R> までに押されなければ報酬を渡します。困ったら「問題あり」`);
  const buttons: Btn[] = summary
    ? []
    : entry.status === 'applied'
      ? post.status === 'removed'
        ? []
        : [button(`board:hire:${entry.id}`, '採用する', 3, '✅')]
      : entry.status === 'hired'
        ? [button(`board:done:${entry.id}`, post.reward > 0 ? '完了（報酬を渡す）' : '完了', 3, '🎉'), ...(post.reward > 0 ? [button(`board:problem:${entry.id}`, '問題あり', 4)] : [])]
        : [];
  return { embeds: [{ description: lines.join('\n'), color: entry.status === 'disputed' ? 0xd7003a : COLOR }], components: buttons.length ? [row(...buttons)] : [] };
}

/** 「募集を書く」をいちばん下に出し直す（前のものは消す）。社務所Web からも使う */
export async function postBoardPanel(db: Db, cfg: GuildConfig, discord: Pick<DiscordActions, 'sendMessage' | 'deleteMessage'>, by = 'system'): Promise<boolean> {
  const place = await loadBoardPlace(db);
  if (!place.channelId) return false;
  if (place.panelMessageId) await discord.deleteMessage(place.channelId, place.panelMessageId).catch(() => undefined);
  const { id } = await discord.sendMessage(place.channelId, boardPanel(cfg));
  await saveBoardPlace(db, { ...place, panelMessageId: id }, by);
  return true;
}

export class BoardApp {
  private guild?: Guild;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  attach(guild: Guild): void {
    this.guild = guild;
  }

  private isStaff(i: { member: { roles: { cache: Map<string, unknown> } } }): boolean {
    return Boolean(adminLevelOf(this.cfg(), [...i.member.roles.cache.keys()]));
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId.startsWith('board:')) return;
    const [, action, arg] = interaction.customId.split(':');
    try {
      if (interaction.isModalSubmit()) {
        if (action === 'modal' && isBoardCategory(arg)) return await this.submit(interaction, arg);
        return;
      }
      if (action === 'new') return await this.pickCategory(interaction);
      if (action === 'cat' && isBoardCategory(arg)) return await this.postModal(interaction, arg);
      const id = Number(arg);
      if (!Number.isSafeInteger(id)) return;
      if (action === 'apply') return await this.apply(interaction, id);
      if (action === 'close') return await this.close(interaction, id);
      if (action === 'hire') return await this.hire(interaction, id);
      if (action === 'done') return await this.done(interaction, id);
      if (action === 'problem') return await this.problem(interaction, id);
    } catch (err) {
      logger.warn({ err }, 'board failed');
      const content = 'うまくいきませんでした。時間をおいてもう一度お試しください。';
      await (interaction.deferred || interaction.replied ? interaction.followUp({ content, ...EPHEMERAL }) : interaction.reply({ content, ...EPHEMERAL })).catch(() => undefined);
    }
  }

  // ───────── 書く ─────────

  private async pickCategory(i: ButtonInteraction<'cached'>): Promise<void> {
    if (!this.cfg().ranks.some((r) => i.member.roles.cache.has(r.roleId))) return void (await i.reply({ content: '募集を書けるのは、入鯖が承認された方だけです。', ...EPHEMERAL }));
    const cats = Object.entries(BOARD_CATEGORIES) as [BoardCategory, (typeof BOARD_CATEGORIES)[BoardCategory]][];
    await i.reply({
      content: 'どんな募集ですか？（本物のお金のやり取り・性的なもの・個人情報の募集はできません）',
      components: [row(...cats.map(([k, c]) => button(`board:cat:${k}`, c.label, 2, c.emoji)))],
      ...EPHEMERAL,
    });
  }

  private async postModal(i: ButtonInteraction<'cached'>, cat: BoardCategory): Promise<void> {
    const e = this.cfg().economy;
    const input = (id: string, label: string, style: TextInputStyle, max: number, required: boolean, placeholder = '', value = '') => {
      const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(required);
      if (placeholder) t.setPlaceholder(placeholder);
      if (value) t.setValue(value);
      return new ActionRowBuilder<TextInputBuilder>().addComponents(t);
    };
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`board:modal:${cat}`)
        .setTitle(`募集を書く（${BOARD_CATEGORIES[cat].label}）`.slice(0, 45))
        .addComponents(
          input('title', '題名', TextInputStyle.Short, 60, true, '例: 配信のサムネを作ってくれる人'),
          input('body', '内容（やること・期限・条件など）', TextInputStyle.Paragraph, 1000, false),
          input('slots', `人数（1〜${BOARD.maxSlots}）`, TextInputStyle.Short, 2, true, '1', '1'),
          input('reward', `報酬（1 人あたりの${e.currencyName}。なければ空）`, TextInputStyle.Short, 7, false, '例: 1000'),
          input('days', `締め切り（何日後。1〜${BOARD.maxDays}）`, TextInputStyle.Short, 2, true, '7', '7'),
        ),
    );
  }

  private async submit(i: ModalSubmitInteraction<'cached'>, cat: BoardCategory): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const cfg = this.cfg();
    const place = await loadBoardPlace(this.db);
    const channel = place.channelId ? this.guild?.channels.cache.get(place.channelId) : undefined;
    if (!channel || channel.type !== ChannelType.GuildText) return void (await i.editReply('掲示板のチャンネルが決まっていません。神職に知らせてください。'));
    const rewardRaw = i.fields.getTextInputValue('reward').trim();
    const r = await createPost(this.db, cfg, { id: i.user.id, roleIds: [...i.member.roles.cache.keys()] }, {
      category: cat,
      title: i.fields.getTextInputValue('title'),
      body: i.fields.getTextInputValue('body'),
      slots: parseCount(i.fields.getTextInputValue('slots')),
      reward: rewardRaw ? parseCount(rewardRaw) : 0,
      days: parseCount(i.fields.getTextInputValue('days')),
    });
    if (r.status !== 'ok') {
      const text =
        r.status === 'insufficient'
          ? `${cfg.economy.currencyName}が足りません（報酬 × 人数で ${fmt(r.need)} 枚を預かります・いま ${fmt(r.balance)} 枚）。`
          : r.status === 'reward_rank'
            ? `報酬を付けられるのは ${r.rankName} 以上になってからです（報酬なしなら書けます）。`
            : r.status === 'no_rank'
              ? '募集を書けるのは、入鯖が承認された方だけです。'
              : `入力を確かめてください（題名は 60 文字まで、人数は 1〜${BOARD.maxSlots}、締め切りは 1〜${BOARD.maxDays} 日、報酬は数だけ）。`;
      return void (await i.editReply(text));
    }
    try {
      const msg = await channel.send({ ...postCard(r.post, [], cfg), allowedMentions: { parse: [] } } as Parameters<typeof channel.send>[0]);
      // みんなの質問のスレッド（公開）と、応募が届く募集した人だけのスレッド（非公開。運営は見られる）
      const thread = await msg.startThread({ name: `📌 ${r.post.title}`.slice(0, 90), autoArchiveDuration: 10080, reason: '掲示板の募集' }).catch(() => undefined);
      await thread?.members.add(i.user.id).catch(() => undefined);
      await thread?.send({ content: '-# 質問はここへどうぞ。応募は募集のカードの「🙋 応募する」から（応募した人・採用は、募集した人にだけ見えます）', allowedMentions: { parse: [] } }).catch(() => undefined);
      const applyThread = await channel.threads
        .create({ name: `📋 応募 #${r.post.id} ${r.post.title}`.slice(0, 90), type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 10080, reason: '掲示板の応募の受付' })
        .catch((err: unknown) => (logger.warn({ err }, 'board apply thread failed'), undefined));
      if (applyThread) {
        await applyThread.members.add(i.user.id).catch(() => undefined);
        await applyThread
          .send({ content: `<@${i.user.id}> さん、ここは あなた（と運営）だけに見える応募の受付です。応募が届いたら、ここで「採用する」を押してください。`, allowedMentions: { users: [i.user.id] } })
          .catch(() => undefined);
      }
      await setPostMessage(this.db, r.post.id, { channelId: channel.id, messageId: msg.id, ...(thread ? { threadId: thread.id } : {}), ...(applyThread ? { applyThreadId: applyThread.id } : {}) });
      await this.panelToBottom();
      await audit(this.db, { actorId: i.user.id, action: 'board.post', detail: { postId: r.post.id, title: r.post.title, reward: r.post.reward, slots: r.post.slots }, via: 'discord' });
      await i.editReply(
        `募集を出しました（募集 #${r.post.id}）: ${msg.url}${r.post.reward > 0 ? `\n報酬として ${fmt(r.post.escrow)} 枚を預かりました（残り ${fmt(r.balance)} 枚）。締め切ると、採用しなかった分は戻ります。` : ''}`,
      );
    } catch (err) {
      logger.warn({ err }, 'board post failed');
      await closePost(this.db, r.post.id, i.user.id);
      await i.editReply('募集を出せませんでした（預かった分は戻しました）。BOT が掲示板に書き込めるか、神職に確かめてもらってください。');
    }
  }

  /** 「募集を書く」をいちばん下に出し直す */
  async panelToBottom(): Promise<void> {
    await postBoardPanel(this.db, this.cfg(), this.discord).catch((err: unknown) => logger.warn({ err }, 'board panel failed'));
  }

  /** カードを今の状態に書き換える */
  private async refreshCard(post: BoardPost): Promise<void> {
    if (!post.channelId || !post.messageId) return;
    await this.discord.editMessage(post.channelId, post.messageId, postCard(post, await entriesOf(this.db, post.id), this.cfg())).catch((err: unknown) => logger.warn({ err }, 'board card edit failed'));
  }

  private async threadById(id: string | null | undefined) {
    const ch = id ? (this.guild?.channels.cache.get(id) ?? (await this.guild?.channels.fetch(id).catch(() => null))) : undefined;
    return ch?.isThread() ? ch : undefined;
  }

  /** みんなの質問のスレッド */
  private thread(post: BoardPost) {
    return this.threadById(post.threadId);
  }

  /** 応募の受付（募集した人だけ）。前に作った募集で無ければ、質問のスレッド */
  private async applyThread(post: BoardPost) {
    return (await this.threadById(post.applyThreadId)) ?? (post.applyThreadId ? undefined : await this.thread(post));
  }

  // ───────── 応募・締め切る ─────────

  private async apply(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const r = await applyPost(this.db, this.cfg(), id, { id: i.user.id, roleIds: [...i.member.roles.cache.keys()] });
    if (r.status !== 'ok') {
      const text = { closed: 'この募集は締め切りました。', self: '自分の募集には応募できません。', already: 'もう応募しています。採用されると知らせが届きます。', no_rank: '応募できるのは、入鯖が承認された方だけです。', gone: 'この募集は見つかりませんでした。' }[r.status];
      return void (await i.reply({ content: text, ...EPHEMERAL }));
    }
    await i.update({ ...postCard(r.post, await entriesOf(this.db, id), this.cfg()), allowedMentions: { parse: [] } } as Parameters<typeof i.update>[0]);
    // 応募は、募集した人（と運営）だけに見えるスレッドに届ける
    const inbox = await this.applyThread(r.post);
    await inbox
      ?.send({ content: `<@${r.post.authorId}>`, ...entryMessage(r.entry, r.post, this.cfg()), allowedMentions: { users: [r.post.authorId] } } as Parameters<typeof inbox.send>[0])
      .catch(() => undefined);
    await this.discord.sendDm(r.post.authorId, `📌 募集「${r.post.title}」に ${i.member.displayName} さんが応募しました。${inbox ? `<#${inbox.id}> で採用できます（あなたにだけ見えます）。` : ''}`).catch(() => false);
    await i.followUp({ content: `🙋 応募しました。採用されると知らせが届きます。${r.post.threadId ? `質問は <#${r.post.threadId}> で。` : ''}`, ...EPHEMERAL });
  }

  private async close(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const post = await getPost(this.db, id);
    if (!post) return;
    const staff = this.isStaff(i) && post.authorId !== i.user.id;
    if (post.authorId !== i.user.id && !staff) return void (await i.reply({ content: '締め切れるのは、募集した人と運営だけです。', ...EPHEMERAL }));
    const r = await closePost(this.db, id, i.user.id, { staff });
    if (!r) return void (await i.reply({ content: 'もう締め切っています。', ...EPHEMERAL }));
    await i.update({ ...postCard(r.post, await entriesOf(this.db, id), this.cfg()), allowedMentions: { parse: [] } } as Parameters<typeof i.update>[0]);
    await audit(this.db, { actorId: i.user.id, targetId: post.authorId, action: staff ? 'board.remove' : 'board.close', detail: { postId: id, refunded: r.refunded }, via: 'discord' });
    await this.wrapUp(r.post, staff ? 'removed' : 'closed');
    if (r.refunded) await i.followUp({ content: `締め切りました。採用しなかった分の ${fmt(r.refunded)} 枚を戻しました。`, ...EPHEMERAL });
  }

  // ───────── 採用・完了・問題あり ─────────

  private async hire(i: ButtonInteraction<'cached'>, entryId: number): Promise<void> {
    const r = await hire(this.db, this.cfg(), entryId, i.user.id);
    if (r.status !== 'ok') {
      const text = { not_author: '採用できるのは、募集した人だけです。', full: 'もう人数がいっぱいです。', not_applied: 'もう採用しています。', gone: 'この募集は見つかりませんでした。' }[r.status];
      return void (await i.reply({ content: text, ...EPHEMERAL }));
    }
    // やり取りの場所: 募集した人と採用された人（と運営）だけのスレッド
    const work = await this.openWorkThread(r.post, r.entry);
    await i.update(entryMessage(r.entry, r.post, this.cfg(), work ? { workThreadId: work } : {}));
    await this.refreshCard(r.post);
    await audit(this.db, { actorId: i.user.id, targetId: r.entry.memberId, action: 'board.hire', detail: { postId: r.post.id, entryId }, via: 'discord' });
    await this.discord.sendDm(r.entry.memberId, `✅ 募集「${r.post.title}」で採用されました。${work ? `<#${work}> でやり取りしてください。` : ''}`).catch(() => false);
    if (r.full) {
      await i.followUp({ content: `人数がいっぱいになったので、募集を締め切りました。${work ? `<#${work}> でやり取りしてください（応募の受付のスレッドは消します）。` : ''}`, ...EPHEMERAL });
      await this.wrapUp(r.post, 'full');
    }
  }

  /**
   * 募集が終わったとき（満員・締め切り・取り下げ）: 応募の受付のスレッドを消し、採用しなかった人に知らせ、
   * みんなの質問のスレッドは閉じる（採用した人とのスレッドはそのまま）
   */
  private async wrapUp(post: BoardPost, why: 'full' | 'closed' | 'removed'): Promise<void> {
    const entries = await entriesOf(this.db, post.id);
    const inbox = post.applyThreadId ? await this.threadById(post.applyThreadId) : undefined;
    await inbox?.delete('掲示板の募集が終わった').catch((err: unknown) => logger.warn({ err }, 'board apply thread delete failed'));
    const text = why === 'removed' ? 'は運営が取り下げました' : why === 'full' ? 'は人数がいっぱいになりました' : 'は締め切りました';
    for (const e of entries.filter((x) => x.status === 'applied')) {
      await this.discord.sendDm(e.memberId, `📌 募集「${post.title}」${text}。今回は見送りとなりました。応募ありがとうございました。`).catch(() => false);
    }
    const pub = await this.thread(post);
    if (pub && !pub.archived) {
      await pub.send({ content: `📌 この募集${text}。`, allowedMentions: { parse: [] } }).catch(() => undefined);
      await pub.edit({ archived: true, locked: true, reason: '掲示板の募集が終わった' }).catch(() => undefined);
    }
  }

  /** 採用したら、2 人（と運営）だけのスレッドを作って、完了・問題ありのボタンを出す */
  private async openWorkThread(post: BoardPost, entry: BoardEntry): Promise<string | undefined> {
    const channel = post.channelId ? this.guild?.channels.cache.get(post.channelId) : undefined;
    if (channel?.type !== ChannelType.GuildText) return undefined;
    try {
      const name = this.guild?.members.cache.get(entry.memberId)?.displayName ?? '採用';
      const t = await channel.threads.create({ name: `🤝 ${post.title}（${name}）`.slice(0, 90), type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 10080, reason: '掲示板の採用' });
      await t.members.add(post.authorId).catch(() => undefined);
      await t.members.add(entry.memberId).catch(() => undefined);
      await t.send({ content: `<@${post.authorId}> <@${entry.memberId}>`, ...entryMessage(entry, post, this.cfg()), allowedMentions: { users: [post.authorId, entry.memberId] } } as Parameters<typeof t.send>[0]);
      await setEntryThread(this.db, entry.id, t.id);
      return t.id;
    } catch (err) {
      logger.warn({ err }, 'board work thread failed');
      return undefined;
    }
  }

  private async done(i: ButtonInteraction<'cached'>, entryId: number): Promise<void> {
    const r = await completeEntry(this.db, this.cfg(), entryId, i.user.id);
    if (r.status !== 'ok') {
      const text = { not_allowed: '「完了」は、募集した人だけが押せます。', not_hired: 'もう終わっています。', gone: 'この募集は見つかりませんでした。' }[r.status];
      return void (await i.reply({ content: text, ...EPHEMERAL }));
    }
    await i.update(entryMessage(r.entry, r.post, this.cfg()));
    await audit(this.db, { actorId: i.user.id, targetId: r.entry.memberId, action: 'board.complete', detail: { postId: r.post.id, entryId, paid: r.paid }, via: 'discord' });
    if (r.paid > 0) await this.discord.sendDm(r.entry.memberId, `🎉 募集「${r.post.title}」が完了しました。${this.cfg().economy.currencyEmoji} ${fmt(r.paid)} 枚の報酬をお渡ししました。`).catch(() => false);
  }

  private async problem(i: ButtonInteraction<'cached'>, entryId: number): Promise<void> {
    const d = await disputeEntry(this.db, entryId, i.user.id);
    if (!d) return void (await i.reply({ content: '「問題あり」は、募集した人と採用された人が、報酬つきの採用中に押せます。', ...EPHEMERAL }));
    await i.update(entryMessage(d.entry, d.post, this.cfg()));
    await audit(this.db, { actorId: i.user.id, targetId: d.entry.memberId, action: 'board.dispute', detail: { postId: d.post.id, entryId }, via: 'discord' });
    const log = this.cfg().channels.log;
    if (log) await this.discord.sendMessage(log, { content: `⚠️ 掲示板の募集 #${d.post.id}「${d.post.title}」に「問題あり」が出ました。社務所Web の「掲示板」で確かめてください。` }).catch(() => undefined);
  }

  /** 10 分ごと: 期限が来た募集を締め切り、期限が来た採用に報酬を渡す */
  async tick(): Promise<void> {
    const r = await boardTick(this.db, this.cfg());
    for (const p of r.closed) {
      await this.refreshCard(p);
      await this.wrapUp(p, 'closed');
    }
    for (const x of r.paid) {
      if (x.paid > 0) await this.discord.sendDm(x.entry.memberId, `🎉 募集「${x.post.title}」は期限が来たので完了にしました。${this.cfg().economy.currencyEmoji} ${fmt(x.paid)} 枚の報酬をお渡ししました。`).catch(() => false);
    }
  }

  /** 社務所Web から: 採用のメッセージを書き換える（運営が渡した・戻したとき） */
  async entryChanged(entryId: number): Promise<void> {
    const e = await getEntry(this.db, entryId);
    const post = e ? await getPost(this.db, e.postId) : undefined;
    if (!e || !post) return;
    const thread = (await this.threadById(e.threadId)) ?? (await this.applyThread(post));
    await thread?.send({ ...entryMessage(e, post, this.cfg()), allowedMentions: { parse: [] } } as Parameters<typeof thread.send>[0]).catch(() => undefined);
  }
}

import sharp from 'sharp';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type VoiceChannel,
} from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { Cast, CastSession } from '../db/schema.js';
import type { DiscordActions, MessageBody } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import {
  acceptSession,
  cancelSession,
  castFee,
  castStates,
  castStats,
  castTick,
  disputeSession,
  extendSession,
  finishSession,
  getCast,
  getSession,
  isAdult,
  listCasts,
  loadCastConfig,
  loadCastReception,
  loadCastPhoto,
  loadMenuImage,
  MINOR,
  monthStart,
  parsePrice,
  parseTags,
  MENU_MINUTES,
  menuLabel,
  menuPriceText,
  validQuote,
  menuOf,
  menuText,
  minorMenuOk,
  sessionLabel,
  rateSession,
  requestSession,
  roomDeleted,
  saveCastConfig,
  setBlocked,
  setSessionPlace,
  setWaiting,
  updateProfile,
  type CastConfig,
  type CastReception,
  type ProfileInput,
} from '../services/cast.js';
import { staffRoleIds } from '../services/meetings.js';
import { namesOf } from '../services/members.js';
import { loadReceptionAvatar, renderCastReception } from '../services/castReceptionImage.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const PINK = 0xe86a92;
const fmt = (n: number) => n.toLocaleString('ja-JP');
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const jstTime = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
type Btn = { type: 2; style: 1 | 2 | 3 | 4; label: string; custom_id: string; emoji?: { name: string }; disabled?: boolean };
const button = (custom_id: string, label: string, style: Btn['style'] = 2, emoji?: string, disabled = false): Btn => ({
  type: 2,
  style,
  label,
  custom_id,
  ...(emoji ? { emoji: { name: emoji } } : {}),
  ...(disabled ? { disabled } : {}),
});
type LinkBtn = { type: 2; style: 5; label: string; url: string };
export const castRoomName = (name: string) => `🌸 ${name.slice(0, 90)}の間`;
export const roomEntry = (guildId: string, channelId: string): LinkBtn => ({ type: 2, style: 5, label: '部屋へ入る', url: `https://discord.com/channels/${guildId}/${channelId}` });
const row = (...b: (Btn | LinkBtn)[]) => ({ type: 1 as const, components: b });
const STATE = { busy: { emoji: '📞', label: '通話中' }, waiting: { emoji: '🟢', label: '待機中' }, off: { emoji: '💤', label: 'お休み' } } as const;
const pricesText = (c: Pick<Cast, 'menu' | 'price30' | 'price60' | 'priceNight'>) => menuText(c) || 'メニューなし';
/** メニューを選ぶ欄（内容・時間・値段） */
const menuSelect = (custom_id: string, placeholder: string, items: ReturnType<typeof menuOf>) => ({
  type: 1 as const,
  components: [
    {
      type: 3 as const,
      custom_id,
      placeholder,
      options: items.slice(0, 25).map((m) => ({ label: `${menuLabel(m)} ${m.consult ? '' : menuPriceText(m)}`.trim().slice(0, 100), value: m.id, ...(m.note ? { description: m.note.slice(0, 100) } : {}) })),
    },
  ],
});
const RULES = '-# 本物のお金のやり取り・性的な内容・連絡先の交換・録音は禁止です（しきたり）。困ったら部屋の「🚨 通報」を';

// ───────── メニュー（画像の下に、指名するメニュー） ─────────

/** #キャスト一覧 のメニュー: 上げた画像と、キャストを選ぶメニュー・ボタン */
export function castPanel(list: { cast: Cast; name: string; state: 'busy' | 'waiting' | 'off' }[], image?: { data: Uint8Array; contentType: string }): MessageBody {
  const ext = image?.contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  const order = { waiting: 0, busy: 1, off: 2 } as const;
  const sorted = [...list].sort((a, b) => order[a.state] - order[b.state]);
  const waiting = sorted.filter((x) => x.state === 'waiting').length;
  return {
    embeds: [
      {
        title: '🎀 キャスト',
        description: [
          '寝落ち・雑談・ゲームなどの通話を、銭で指名できます。下のメニューからキャストを選んでください。',
          `🟢 いま待機中 **${waiting}** 人 ・ 在籍 ${list.length} 人`,
          '-# 銭は社務所が預かり、終わったらキャストに渡します（受けてもらえなければ全額戻ります）',
          '-# 2 人だけの部屋・寝落ちは 18 歳以上どうしだけ。18 歳未満の方は、公開の部屋での雑談（1 時間まで・22 時まで）だけ指名できます',
        ].join('\n'),
        color: PINK,
        ...(image ? { image: { url: `attachment://cast-menu.${ext}` } } : {}),
      },
    ],
    ...(image ? { files: [{ name: `cast-menu.${ext}`, contentType: image.contentType, data: image.data }], attachments: [] } : {}),
    components: [
      ...(sorted.length
        ? [
            {
              type: 1,
              components: [
                {
                  type: 3,
                  custom_id: 'cast:pick',
                  placeholder: '🎀 指名するキャストを選ぶ',
                  options: sorted.slice(0, 25).map((x) => ({
                    label: x.name.slice(0, 100),
                    value: x.cast.memberId,
                    description: `${STATE[x.state].label}・${pricesText(x.cast)}`.slice(0, 100),
                    emoji: { name: STATE[x.state].emoji },
                  })),
                },
              ],
            },
          ]
        : []),
      row(button('cast:now', '今すぐ話せる人', 3, '🟢'), button('cast:rank', '今月のランキング', 2, '🏆'), button('cast:me', 'キャストの方', 2, '⚙')),
    ],
  };
}

/** メニューを出す・書き換える（社務所Web・BOT の両方から）。出せたら true */
export async function refreshCastPanel(db: Db, discord: Pick<DiscordActions, 'sendMessage' | 'editMessage'>, opts: { repost?: boolean; by?: string } = {}): Promise<boolean> {
  const c = await loadCastConfig(db);
  if (!c.channelId) return false;
  const [list, states, image] = await Promise.all([listCasts(db), castStates(db), loadMenuImage(db)]);
  const names = await namesOf(db, list.map((x) => x.memberId));
  const body = castPanel(
    list.map((cast) => ({ cast, name: names.get(cast.memberId) ?? cast.memberId, state: states.get(cast.memberId) ?? 'off' })),
    image,
  );
  if (c.panelMessageId && !opts.repost) {
    try {
      await discord.editMessage(c.channelId, c.panelMessageId, body);
      return true;
    } catch (err) {
      logger.warn({ err }, 'cast panel edit failed, posting again');
    }
  }
  const { id } = await discord.sendMessage(c.channelId, body);
  await saveCastConfig(db, { ...c, panelMessageId: id }, opts.by ?? 'system');
  return true;
}

/** 部屋のチャットに出す、指名の知らせ・通話中の操作・終わり */
export function sessionMessage(s: CastSession, c: CastConfig, coin: string) {
  const who = `<@${s.customerId}> さん → <@${s.castId}> さん`;
  const plan = `${sessionLabel(s)}${s.extensions ? `＋延長 ${s.extensions * 30} 分` : ''}`;
  const lines: string[] = [`${who} ・ ${plan} ・ ${coin} ${fmt(s.price)} 枚（社務所が預かり中）`];
  let buttons: Btn[] = [];
  let title = '🎀 指名';
  if (s.status === 'requested') {
    title = '🎀 指名が入りました';
    lines.push(`<@${s.castId}> さん、受けますか？ ${s.acceptBy ? `<t:${unix(s.acceptBy)}:R> までに返事がなければ、取り消して銭を戻します。` : ''}`);
    buttons = [button(`cast:accept:${s.id}`, '受ける', 3, '✅'), button(`cast:decline:${s.id}`, '断る', 4), button(`cast:cancel:${s.id}`, '取り消す（お客）')];
  } else if (s.status === 'active') {
    title = '📞 通話中';
    lines.push(s.endsAt ? `⏰ <t:${unix(s.endsAt)}:t> まで（<t:${unix(s.endsAt)}:R>）。時間が来たら終わって、キャストに ${fmt(s.price - castFee(c, s.price))} 枚を渡します。` : '');
    if (s.isPublic) lines.push(`-# 公開の部屋です（18 歳未満の方との雑談。${MINOR.maxMinutes} 分・${MINOR.endHour} 時まで）`);
    buttons = [button(`cast:ext:${s.id}:${s.extensions}`, '30 分のばす（お客）', 1, '⏰'), button(`cast:end:${s.id}`, '終える'), button(`cast:report:${s.id}`, '通報', 4, '🚨')];
  } else if (s.status === 'done') {
    title = '🎉 おつかれさまでした';
    lines.push(`キャストに ${coin} ${fmt(s.paid)} 枚を渡しました。<@${s.customerId}> さん、よければ評価をお願いします（この部屋は少しあとに消えます）。`);
    buttons = [1, 2, 3, 4, 5].map((n) => button(`cast:rate:${s.id}:${n}`, '⭐'.repeat(n), n === 5 ? 1 : 2));
  } else if (s.status === 'declined') {
    title = '🙇 今回は受けられませんでした';
    lines.push('預かっていた銭は全部戻しました。');
  } else if (s.status === 'canceled') {
    title = '取り消しました';
    lines.push('預かっていた銭は全部戻しました。');
  } else if (s.status === 'disputed') {
    title = '🚨 通報がありました';
    lines.push('運営が確認します。銭は、運営が決めるまで預かったままにします。');
  }
  lines.push(RULES);
  const rows = buttons.length > 5 ? [row(...buttons.slice(0, 5))] : buttons.length ? [row(...buttons)] : [];
  return { embeds: [{ title, description: lines.filter(Boolean).join('\n'), color: s.status === 'disputed' ? 0xd7003a : PINK }], components: rows };
}

/** キャスト本人だけに表示する画像と受付ボタン */
export function castReceptionBody(d: CastReception, name: string, names: ReadonlyMap<string, string>, currency: string, guildId: string, avatar?: Uint8Array) {
  const png = renderCastReception({ reception: d, name, names, currency, avatar });
  const off = d.cast.status !== 'active';
  const state = { waiting: '待機中', busy: '対応中', off: '受付停止', pending: '運営の確認待ち', paused: '運営による休止' }[d.state];
  const summary = name + 'さんの受付。' + state + '。今日の予約' + d.today.length + '件。現在の指名' + d.current.length + '件。今月の受取額' + fmt(d.stat.earned) + currency + '、指名' + d.stat.count + '回。';
  return {
    content: '',
    embeds: [{ title: 'キャスト受付', image: { url: 'attachment://cast-reception.png' }, color: PINK }],
    files: [new AttachmentBuilder(png, { name: 'cast-reception.png', description: summary.slice(0, 1000) })],
    attachments: [],
    allowedMentions: { parse: [] as never[] },
    components: [
      row(button('cast:wait:2', '2時間待機', 3, '🟢', off), button('cast:wait:4', '4時間待機', 3, undefined, off), button('cast:wait:0', '受付停止', 2, undefined, off), button('cast:refresh', '更新', 1, '🔄')),
      row(...d.current.filter((s) => s.channelId).slice(0, 2).map((s, k) => ({ ...roomEntry(guildId, s.channelId!), label: k ? '部屋へ入る（2）' : '部屋へ入る' })), button('cast:schedule:0', '予約一覧', 2, '📅')),
      row(button('cast:edit', '紹介を変える', 1, '✏️'), button('cast:minor', d.cast.minorOk ? '18歳未満の雑談を受けない' : '18歳未満の雑談を受ける'), button('cast:blockui', 'ブロック', 4), button('cast:unblockui', 'ブロックを外す')),
    ],
  };
}

export class CastApp {
  private guild?: Guild;
  private ticking = false;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  attach(guild: Guild): void {
    this.guild = guild;
  }

  private coin(): string {
    const e = this.cfg().economy;
    return `${e.currencyEmoji}${e.currencyName}`;
  }

  private roles(i: { member: GuildMember }): string[] {
    return [...i.member.roles.cache.keys()];
  }

  private refresh(): void {
    void refreshCastPanel(this.db, this.discord).catch((err: unknown) => logger.warn({ err }, 'cast panel refresh failed'));
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    if (!('customId' in interaction) || !interaction.customId.startsWith('cast:')) return;
    const [, action, a, b, ...rest] = interaction.customId.split(':');
    try {
      if (interaction.isStringSelectMenu()) {
        if (action === 'pick') return await this.pick(interaction, interaction.values[0] ?? '');
        if (action === 'plansel') return await this.confirm(interaction, a ?? '', interaction.values[0] ?? '');
        if (action === 'rplansel') return await this.reserveModal(interaction, a ?? '', interaction.values[0] ?? '');
        return;
      }
      if (interaction.isUserSelectMenu()) {
        if (action === 'block' || action === 'unblock') return await this.block(interaction, action === 'block');
        return;
      }
      if (interaction.isModalSubmit()) {
        if (action === 'applymodal') return void (await interaction.reply({ content: '🎀 キャストは、運営が登録します。キャストになりたい方は、運営に声をかけてください。', ...EPHEMERAL }));
        if (action === 'editmodal') return await this.profileSubmit(interaction);
        if (action === 'rmodal') return await this.reserveSubmit(interaction, a ?? '', b ?? '');
        if (action === 'cmodal') return await this.consultSubmit(interaction, a ?? '', b ?? '');
        if (action === 'qmodal') return await this.quoteSubmit(interaction, a ?? '', b ?? '', rest[0] ?? '');
        return;
      }
      if (!interaction.isButton()) return;
      if (action === 'now') return await this.waitingList(interaction);
      if (action === 'rank') return await this.ranking(interaction);
      if (action === 'apply') return await this.applyModal(interaction);
      if (action === 'me') return await this.mine(interaction);
      if (action === 'refresh') return await this.mine(interaction, true);
      if (action === 'schedule') return await this.schedule(interaction, Number(a ?? 0));
      if (action === 'edit') return await this.editModal(interaction);
      if (action === 'wait') return await this.wait(interaction, Number(a));
      if (action === 'minor') return await this.toggleMinor(interaction);
      if (action === 'blockui' || action === 'unblockui') return await this.blockPicker(interaction, action === 'blockui');
      if (action === 'plan') return await this.confirm(interaction, a ?? '', b ?? '');
      if (action === 'go') return await this.go(interaction, a ?? '', b ?? '');
      if (action === 'quote') return await this.quoteModal(interaction, a ?? '', b ?? '', rest[0] ?? '');
      if (action === 'qgo') return await this.quoteGo(interaction, a ?? '', b ?? '', rest);
      if (action === 'rsv') return await this.reservePlans(interaction, a ?? '');
      if (action === 'rplan') return await this.reserveModal(interaction, a ?? '', b ?? '');
      const id = Number(a);
      if (!Number.isSafeInteger(id)) return;
      if (action === 'accept') return await this.accept(interaction, id);
      if (action === 'decline' || action === 'cancel') return await this.cancel(interaction, id, action === 'decline' ? 'declined' : 'canceled');
      if (action === 'ext') return await this.extend(interaction, id, b === undefined ? 0 : Number(b));
      if (action === 'end') return await this.end(interaction, id);
      if (action === 'report') return await this.report(interaction, id);
      if (action === 'rate') return await this.rate(interaction, id, Number(b));
    } catch (err) {
      logger.warn({ err, id: interaction.customId }, 'cast failed');
      if (interaction.isRepliable()) {
        const content = 'うまくいきませんでした。時間をおいてもう一度お試しください。';
        await (interaction.deferred || interaction.replied ? interaction.followUp({ content, ...EPHEMERAL }) : interaction.reply({ content, ...EPHEMERAL })).catch(() => undefined);
      }
    }
  }

  // ───────── 見る ─────────

  private async castCard(cast: Cast, adult: boolean) {
    const [states, stats] = await Promise.all([castStates(this.db), castStats(this.db, monthStart())]);
    const name = (await namesOf(this.db, [cast.memberId])).get(cast.memberId) ?? cast.memberId;
    const photo = await loadCastPhoto(this.db, cast.memberId);
    const state = STATE[states.get(cast.memberId) ?? 'off'];
    const st = stats.find((x) => x.castId === cast.memberId);
    const plans = menuOf(cast).filter((m) => (m.price > 0 || m.consult) && (adult || (minorMenuOk(m) && cast.minorOk)));
    // カードにせず、文と写真（切りぬかない全体）をそのまま出す
    return {
      content: [
            `## 🎀 ${name}`,
            `${state.emoji} ${state.label}${cast.tags.length ? ` ・ ${cast.tags.map((t) => `#${t}`).join(' ')}` : ''}`,
            cast.bio,
            '',
            `💰 **メニュー**（${this.coin()}）`,
            ...(menuOf(cast).length ? menuOf(cast).map((m) => `- ${menuLabel(m)} ${menuPriceText(m)}${m.note ? ` ・ ${m.note}` : ''}`) : ['- メニューなし']),
            st ? `🏆 今月 ${st.count} 回${st.ratingAvg !== null ? ` ・ ⭐ ${st.ratingAvg}（${st.ratings} 件）` : ''}` : '',
            adult ? '' : !cast.minorOk ? '-# このキャストは、18 歳未満の方の指名を受けていません' : `-# 18 歳未満の方は、公開の部屋での雑談（30 分・1 時間・${MINOR.endHour} 時まで）だけです`,
          ]
            .filter((l, i) => l || i === 3)
            .join('\n'),
      embeds: [],
      allowedMentions: { parse: [] as never[] },
      ...(photo ? { files: [new AttachmentBuilder(Buffer.from(photo.data), { name: 'cast-profile.png' })] } : {}),
      components: plans.length
        ? [menuSelect(`cast:plansel:${cast.memberId}`, '🎀 メニューを選んで指名する', plans), ...(adult ? [row(button(`cast:rsv:${cast.memberId}`, '予約する', 2, '📅'))] : [])]
        : [],
    };
  }

  private async pick(i: StringSelectMenuInteraction<'cached'>, castId: string): Promise<void> {
    const cast = await getCast(this.db, castId);
    if (!cast || cast.status !== 'active') return void (await i.reply({ content: 'このキャストは、いまは指名できません。', ...EPHEMERAL }));
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    await i.deferReply(EPHEMERAL);
    await i.editReply({ ...(await this.castCard(cast, adult)), allowedMentions: { parse: [] } });
  }

  private async waitingList(i: ButtonInteraction<'cached'>): Promise<void> {
    const [list, states] = await Promise.all([listCasts(this.db), castStates(this.db)]);
    const waiting = list.filter((x) => states.get(x.memberId) === 'waiting');
    const names = await namesOf(this.db, waiting.map((x) => x.memberId));
    await i.reply({
      content: waiting.length
        ? ['🟢 **いま話せるキャスト**', ...waiting.map((x) => `- ${names.get(x.memberId) ?? x.memberId} … ${pricesText(x)}${x.tags.length ? `（${x.tags.join('・')}）` : ''}`), '-# 上のメニューから選んで指名できます'].join('\n')
        : 'いま待機中のキャストはいません。予約もできます（上のメニューからキャストを選んでください）。',
      ...EPHEMERAL,
    });
  }

  private async ranking(i: ButtonInteraction<'cached'>): Promise<void> {
    const stats = (await castStats(this.db, monthStart())).slice(0, 10);
    const names = await namesOf(this.db, stats.map((x) => x.castId));
    const medal = ['🥇', '🥈', '🥉'];
    await i.reply({
      content: stats.length
        ? ['🏆 **今月のキャスト**（指名の多い順）', ...stats.map((x, n) => `${medal[n] ?? `${n + 1}.`} ${names.get(x.castId) ?? x.castId} … ${x.count} 回${x.ratingAvg !== null ? ` ・ ⭐ ${x.ratingAvg}` : ''}`)].join('\n')
        : '今月はまだ指名がありません。',
      ...EPHEMERAL,
    });
  }

  // ───────── キャストになる・設定 ─────────

  private profileModal(id: string, title: string, cur?: Cast) {
    const input = (key: string, label: string, style: TextInputStyle, max: number, required: boolean, value = '', placeholder = '') => {
      const t = new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(style).setMaxLength(max).setRequired(required);
      if (value) t.setValue(value);
      if (placeholder) t.setPlaceholder(placeholder);
      return new ActionRowBuilder<TextInputBuilder>().addComponents(t);
    };
    return new ModalBuilder()
      .setCustomId(id)
      .setTitle(title)
      .addComponents(
        input('bio', 'ひとこと紹介（どんな通話ができるか）', TextInputStyle.Paragraph, 300, true, cur?.bio ?? ''),
        input('tags', '得意なこと（、で区切る）', TextInputStyle.Short, 80, false, cur?.tags.join('、') ?? '', '寝落ち、雑談、ゲーム'),
      );
  }

  private async applyModal(i: ButtonInteraction<'cached'>): Promise<void> {
    // 前のメニューに残っているボタン。キャストは運営が社務所Web で登録する
    await i.reply({ content: '🎀 キャストは、運営が登録します。キャストになりたい方は、運営に声をかけてください。', ...EPHEMERAL });
  }

  private async editModal(i: ButtonInteraction<'cached'>): Promise<void> {
    const cur = await getCast(this.db, i.user.id);
    if (!cur || cur.status === 'removed') return void (await i.reply({ content: 'キャストの方だけが使えます。', ...EPHEMERAL }));
    await i.showModal(this.profileModal('cast:editmodal', '🎀 紹介を変える', cur));
  }

  private async profileSubmit(i: ModalSubmitInteraction<'cached'>): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const c = await loadCastConfig(this.db);
    const cur = await getCast(this.db, i.user.id);
    const p: ProfileInput = {
      bio: i.fields.getTextInputValue('bio').trim(),
      tags: parseTags(i.fields.getTextInputValue('tags')),
      // 値段はメニュー（運営が社務所Web で決める）。前の値段はそのまま
      price30: cur?.price30 ?? 0,
      price60: cur?.price60 ?? 0,
      priceNight: cur?.priceNight ?? 0,
      minorOk: cur?.minorOk ?? true,
    };
    const bad = '紹介は 300 文字までで入れてください。';
    const r = await updateProfile(this.db, c, i.user.id, p);
    if (!r) return void (await i.editReply(bad));
    this.refresh();
    await i.editReply('紹介を変えました（メニューと値段は運営が決めます）。');
  }

  private async receptionView(member: GuildMember) {
    const d = await loadCastReception(this.db, member.id);
    if (!d) return { content: 'キャストの方だけが使えます。キャストは運営が登録します。', embeds: [], components: [], attachments: [], allowedMentions: { parse: [] as never[] } };
    const [names, avatar] = await Promise.all([
      namesOf(this.db, [...d.current, ...d.today].map((s) => s.customerId)),
      // 受付の画像のアイコンは、写真のまん中を正方形に切りぬいて使う
      loadCastPhoto(this.db, member.id).then(async (photo) => (photo ? new Uint8Array(await sharp(photo.data).resize(264, 264, { fit: 'cover' }).png().toBuffer()) : loadReceptionAvatar(member.displayAvatarURL({ extension: 'png', size: 128 })))),
    ]);
    return castReceptionBody(d, member.displayName, names, this.cfg().economy.currencyName, this.cfg().guildId, avatar);
  }

  private async mine(i: ButtonInteraction<'cached'>, refresh = false): Promise<void> {
    if (refresh) await i.deferUpdate();
    else await i.deferReply(EPHEMERAL);
    await i.editReply(await this.receptionView(i.member));
  }

  private async wait(i: ButtonInteraction<'cached'>, hours: number): Promise<void> {
    await i.deferUpdate();
    const r = await setWaiting(this.db, i.user.id, [0, 2, 4].includes(hours) ? hours : 0);
    if (!r) return void (await i.followUp({ content: '承認されたキャストの方だけが待機できます。', ...EPHEMERAL }));
    await i.editReply(await this.receptionView(i.member));
    this.refresh();
  }

  private async toggleMinor(i: ButtonInteraction<'cached'>): Promise<void> {
    await i.deferUpdate();
    const cur = await getCast(this.db, i.user.id);
    if (!cur || cur.status === 'removed') return void (await i.followUp({ content: 'キャストの方だけが使えます。', ...EPHEMERAL }));
    const c = await loadCastConfig(this.db);
    const r = await updateProfile(this.db, c, i.user.id, { bio: cur.bio, tags: cur.tags, price30: cur.price30, price60: cur.price60, priceNight: cur.priceNight, minorOk: !cur.minorOk });
    if (r) await i.editReply(await this.receptionView(i.member));
  }

  private async schedule(i: ButtonInteraction<'cached'>, page: number): Promise<void> {
    await i.deferUpdate();
    const d = await loadCastReception(this.db, i.user.id);
    if (!d) return void (await i.editReply({ content: 'キャストの方だけが使えます。', embeds: [], components: [], attachments: [] }));
    const pages = Math.max(1, Math.ceil(d.today.length / 10));
    const selected = Number.isSafeInteger(page) ? Math.max(0, Math.min(page, pages - 1)) : 0;
    const bookings = d.today.slice(selected * 10, (selected + 1) * 10);
    const names = await namesOf(this.db, bookings.map((s) => s.customerId));
    const description = bookings.map((s) => (s.startAt ? jstTime(s.startAt) : '') + ' ｜ ' + (names.get(s.customerId) ?? '利用者').replace(/[@*_~`<>|\r\n]/g, '').slice(0, 28) + ' さん ｜ ' + sessionLabel(s) + ' ｜ ' + ({ reserved: '返事待ち', accepted: '確定', active: '通話中', done: '終了', disputed: '運営確認中' } as Record<string, string>)[s.status]).join('\n');
    await i.editReply({
      content: '', attachments: [],
      embeds: [{ title: '今日の予約（日本時間） ' + (selected + 1) + '/' + pages, description: description || '今日の予約はありません。', color: PINK }],
      components: [row(button('cast:schedule:' + (selected - 1), '前へ', 2, undefined, selected === 0), button('cast:schedule:' + (selected + 1), '次へ', 2, undefined, selected === pages - 1), button('cast:refresh', '受付に戻る', 1))],
      allowedMentions: { parse: [] },
    });
  }

  private async blockPicker(i: ButtonInteraction<'cached'>, on: boolean): Promise<void> {
    await i.reply({
      content: on ? 'ブロックする人を選んでください（その人からは指名されなくなります）。' : 'ブロックを外す人を選んでください。',
      components: [{ type: 1, components: [{ type: 5, custom_id: on ? 'cast:block' : 'cast:unblock', placeholder: '人を選ぶ', max_values: 5 }] }],
      ...EPHEMERAL,
    });
  }

  private async block(i: UserSelectMenuInteraction<'cached'>, on: boolean): Promise<void> {
    let r: Cast | undefined;
    for (const id of i.values) if (id !== i.user.id) r = await setBlocked(this.db, i.user.id, id, on);
    await i.update({ content: r ? (on ? `🚫 ${i.values.length} 人をブロックしました。` : `ブロックを外しました。`) : 'キャストの方だけが使えます。', components: [] });
  }

  // ───────── 指名 ─────────

  private async confirm(i: ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>, castId: string, plan: string): Promise<void> {
    const cast = await getCast(this.db, castId);
    const item = cast && menuOf(cast).find((m) => m.id === plan);
    if (!cast || cast.status !== 'active' || !item) return void (await i.update({ content: 'このキャストは、いまは指名できません（メニューが変わったかもしれません）。', embeds: [], components: [], attachments: [] }));
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    if (item.consult) {
      if (!adult) return void (await i.update({ content: '相談のメニューは 18 歳以上の方だけです。', embeds: [], components: [], attachments: [] }));
      return void (await i.showModal(
        new ModalBuilder()
          .setCustomId(`cast:cmodal:${castId}:${item.id}`)
          .setTitle(`💬 ${item.name}（内容により相談）`.slice(0, 45))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId('wish').setLabel('お願いしたいこと（キャストが時間と値段を出します）').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500),
            ),
          ),
      ));
    }
    const price = item.price;
    await i.update({
      content: [
        `🎀 <@${castId}> さんを **${menuLabel(item)}** ・ ${this.coin()} **${fmt(price)} 枚** で指名しますか？`,
        adult ? '-# 2 人だけの部屋ができます（運営は見守りのために見られます）' : `-# 公開の部屋での雑談になります（${MINOR.maxMinutes} 分・${MINOR.endHour} 時まで）`,
        '-# 銭は社務所が預かり、受けてもらえなければ全額戻ります。途中でのばすこともできます',
        RULES,
      ].join('\n'),
      embeds: [],
      components: [row(button(`cast:go:${castId}:${plan}`, `${fmt(price)} 枚で指名する`, 3, '🎀'))],
      attachments: [],
      allowedMentions: { parse: [] },
    });
  }

  // ───────── 💬 相談のメニュー: お客がお願いを書く → キャストが時間と値段を出す → お客がその値段で指名する ─────────

  private async consultSubmit(i: ModalSubmitInteraction<'cached'>, castId: string, itemId: string): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const cast = await getCast(this.db, castId);
    const item = cast && menuOf(cast).find((m) => m.id === itemId && m.consult);
    if (!cast || cast.status !== 'active' || !item) return void (await i.editReply('このメニューは、いまは選べません。'));
    if (cast.blocked.includes(i.user.id) || castId === i.user.id) return void (await i.editReply('このキャストには相談できません。'));
    if (!(await isAdult(this.db, this.cfg(), i.user.id, this.roles(i)))) return void (await i.editReply('相談のメニューは 18 歳以上の方だけです。'));
    const wish = i.fields.getTextInputValue('wish').trim().slice(0, 500);
    const c = await loadCastConfig(this.db);
    const panel = c.channelId ? this.guild?.channels.cache.get(c.channelId) : undefined;
    if (panel?.type !== ChannelType.GuildText) return void (await i.editReply('相談の場所を作れませんでした。神職に知らせてください。'));
    const thread = await panel.threads.create({ name: `💬 相談 ${item.name}`.slice(0, 90), type: ChannelType.PrivateThread, invitable: false, reason: 'キャストの相談' }).catch(() => undefined);
    if (!thread) return void (await i.editReply('相談の場所を作れませんでした。神職に知らせてください。'));
    await thread.members.add(castId).catch(() => undefined);
    await thread.members.add(i.user.id).catch(() => undefined);
    await thread.send({
      content: [`<@${castId}> さん、<@${i.user.id}> さんから **${item.name}** の相談です。`, `> ${wish.replace(/\n/g, '\n> ')}`, '時間と値段を決めたら「値段を出す」を押してください（お客がその値段で指名すると、いつもの指名と同じように始まります）。', RULES].join('\n'),
      components: [row(button(`cast:quote:${castId}:${item.id}:${i.user.id}`, '値段を出す（キャスト）', 1, '💬'))],
      allowedMentions: { users: [castId] },
    });
    await this.discord.sendDm(castId, `💬 ${item.name} の相談が届きました。<#${thread.id}> で値段を出してください。`).catch(() => false);
    await i.editReply(`💬 相談をお願いしました。キャストの返事は <#${thread.id}> に届きます（まだ銭は払っていません）。`);
  }

  private async quoteModal(i: ButtonInteraction<'cached'>, castId: string, itemId: string, customerId: string): Promise<void> {
    if (i.user.id !== castId) return void (await i.reply({ content: '値段を出せるのはキャストだけです。', ...EPHEMERAL }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`cast:qmodal:${castId}:${itemId}:${customerId}`)
        .setTitle('💬 時間と値段を出す')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('minutes').setLabel('時間（分）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setPlaceholder('30')),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('price').setLabel('値段（銭）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(9).setPlaceholder('500')),
        ),
    );
  }

  private async quoteSubmit(i: ModalSubmitInteraction<'cached'>, castId: string, itemId: string, customerId: string): Promise<void> {
    if (i.user.id !== castId) return void (await i.reply({ content: '値段を出せるのはキャストだけです。', ...EPHEMERAL }));
    const c = await loadCastConfig(this.db);
    const minutes = parsePrice(i.fields.getTextInputValue('minutes'));
    const price = parsePrice(i.fields.getTextInputValue('price'));
    if (!validQuote(c, minutes, price)) return void (await i.reply({ content: `時間は ${MENU_MINUTES.min}〜${MENU_MINUTES.max} 分、値段は ${fmt(c.priceMin)}〜${fmt(c.priceMax)} 枚で入れてください。`, ...EPHEMERAL }));
    await i.reply({
      content: `💬 <@${customerId}> さん、<@${castId}> さんから **${minutes} 分 ・ ${this.coin()} ${fmt(price)} 枚** の提案です。よければ「この値段で指名する」を押してください。`,
      components: [row(button(`cast:qgo:${castId}:${itemId}:${customerId}:${minutes}:${price}`, `${fmt(price)} 枚で指名する（お客）`, 3, '🎀'))],
      allowedMentions: { users: [customerId] },
    });
  }

  private async quoteGo(i: ButtonInteraction<'cached'>, castId: string, itemId: string, rest: string[]): Promise<void> {
    const [customerId, minutes, price] = rest;
    if (i.user.id !== customerId) return void (await i.reply({ content: 'この提案で指名できるのは、相談した人だけです。', ...EPHEMERAL }));
    await this.go(i, castId, itemId, { minutes: Number(minutes), price: Number(price) });
  }

  private async go(i: ButtonInteraction<'cached'>, castId: string, plan: string, quote?: { minutes: number; price: number }): Promise<void> {
    await i.deferUpdate();
    const c = await loadCastConfig(this.db);
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    const r = await requestSession(this.db, c, { castId, customerId: i.user.id, customerAdult: adult, plan, ...(quote ? { quote } : {}) });
    if (r.status !== 'ok') return void (await i.editReply({ content: this.requestError(r), components: [] }));
    const room = await this.openRoom(r.session).then(async (room) => {
      if (room) await room.send({ content: `<@${castId}>`, ...sessionMessage(r.session, c, this.coin()), allowedMentions: { users: [castId] } } as Parameters<typeof room.send>[0]);
      return room;
    }).catch((err: unknown) => (logger.warn({ err }, 'cast room failed'), undefined));
    if (!room) {
      await cancelSession(this.db, r.session.id, 'system', 'declined');
      return void (await i.editReply({ content: '部屋を作れなかったので、取り消して銭を戻しました。神職に知らせてください。', components: [] }));
    }
    await this.discord.sendDm(castId, `🎀 指名が入りました（${sessionLabel(r.session)}）。<#${room.id}> で「受ける」を押してください。`).catch(() => false);
    this.refresh();
    await i.editReply({ content: `🎀 指名しました。<#${room.id}> に入って、キャストの返事を待ってください（残り ${fmt(r.balance)} 枚）。`, components: [row(roomEntry(i.guildId, room.id))] });
  }

  private requestError(r: Exclude<Awaited<ReturnType<typeof requestSession>>, { status: 'ok' }>): string {
    const map: Record<string, string> = {
      not_cast: 'このキャストは、いまは指名できません。',
      self: '自分は指名できません。',
      blocked: 'このキャストは指名できません。',
      busy: 'このキャストは、いま通話中か返事待ちです。少しあとか、予約でどうぞ。',
      no_plan: 'このキャストは、その時間では受けていません。',
      minor_plan: '寝落ちは 18 歳以上の方だけです。',
      minor_reserve: '予約は 18 歳以上の方だけです。',
      minor_off: 'このキャストは、18 歳未満の方の指名を受けていません。',
      minor_hours: `18 歳未満の方の雑談は ${MINOR.startHour} 時〜${MINOR.endHour} 時に終わる時間だけです。`,
      has_open: 'もうほかの指名（返事待ち・通話中・予約）があります。終わってからどうぞ。',
      overlap: 'その時間は、ほかの指名か予約と重なっています。時間を変えてください。',
      bad_time: '予約は 10 分後〜7 日後の時刻にしてください。',
    };
    return r.status === 'insufficient' ? `${this.cfg().economy.currencyName}が足りません（${fmt(r.price)} 枚必要・いま ${fmt(r.balance)} 枚）。` : (map[r.status] ?? 'いまは指名できません。');
  }

  /** 通話の部屋を作る（2 人だけ: 運営も見られる / 公開: カテゴリのまま・2 人まで） */
  private async openRoom(s: CastSession): Promise<VoiceChannel | undefined> {
    const g = this.guild;
    if (!g) return undefined;
    if (s.channelId) return this.voice(s.channelId);
    const c = await loadCastConfig(this.db);
    const panel = c.channelId ? g.channels.cache.get(c.channelId) : undefined;
    const fallback = panel && 'parentId' in panel ? panel.parentId : null;
    const parentId = (s.isPublic ? c.publicCategoryId : c.privateCategoryId) ?? fallback ?? null;
    const parent = parentId ? g.channels.cache.get(parentId) : undefined;
    const name = (await namesOf(this.db, [s.castId])).get(s.castId) ?? 'キャスト';
    const IN = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.Speak;
    const me = g.members.me;
    const people = [
      { id: s.castId, type: OverwriteType.Member, allow: IN | PermissionFlagsBits.SendMessages },
      { id: s.customerId, type: OverwriteType.Member, allow: IN | PermissionFlagsBits.SendMessages },
      ...(me ? [{ id: me.id, type: OverwriteType.Member, allow: IN | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.MoveMembers | PermissionFlagsBits.SendMessages }] : []),
    ];
    const overwrites = s.isPublic
      ? [...(parent && 'permissionOverwrites' in parent ? parent.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })) : []), ...people]
      : [
          { id: g.id, type: OverwriteType.Role, deny: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect },
          ...[...staffRoleIds(this.cfg())].map((id) => ({ id, type: OverwriteType.Role, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect })),
          ...people,
        ];
    const room = await g.channels.create({
      name: castRoomName(name),
      type: ChannelType.GuildVoice,
      parent: parent?.id ?? null,
      userLimit: 2,
      permissionOverwrites: overwrites,
      reason: `キャストの指名 #${s.id}`,
    });
    try {
      await setSessionPlace(this.db, s.id, { channelId: room.id });
    } catch (err) {
      await room.delete('指名の部屋を保存できませんでした').catch(() => undefined);
      throw err;
    }
    return room;
  }

  private voice(id: string | null): VoiceChannel | undefined {
    const ch = id ? this.guild?.channels.cache.get(id) : undefined;
    return ch?.type === ChannelType.GuildVoice ? ch : undefined;
  }

  private async accept(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const c = await loadCastConfig(this.db);
    const s = await acceptSession(this.db, id, i.user.id);
    if (!s) return void (await i.reply({ content: '受けられるのは、指名されたキャストだけです（もう終わっているかもしれません）。', ...EPHEMERAL }));
    if (s.status === 'accepted') {
      await i.update({ ...this.reserveMessage(s), allowedMentions: { parse: [] } });
      await this.discord.sendDm(s.customerId, `📅 予約を受けてもらえました（<t:${unix(s.startAt!)}:f>）。時刻になったら部屋ができます。`).catch(() => false);
      return;
    }
    await i.update({ ...sessionMessage(s, c, this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof i.update>[0]);
    const room = this.voice(s.channelId);
    await room?.send({ content: `<@${s.customerId}> さん、始まります 🎀`, allowedMentions: { users: [s.customerId] } }).catch(() => undefined);
    this.refresh();
  }

  private async cancel(i: ButtonInteraction<'cached'>, id: number, reason: 'declined' | 'canceled'): Promise<void> {
    const s = await cancelSession(this.db, id, i.user.id, reason);
    if (!s) return void (await i.reply({ content: reason === 'declined' ? '断れるのは、指名されたキャストだけです。' : '取り消せるのは、指名した人だけです（始まる前まで）。', ...EPHEMERAL }));
    const c = await loadCastConfig(this.db);
    await i.update({ ...(s.threadId ? this.reserveMessage(s) : sessionMessage(s, c, this.coin())), allowedMentions: { parse: [] } } as Parameters<typeof i.update>[0]);
    await this.discord.sendDm(reason === 'declined' ? s.customerId : s.castId, reason === 'declined' ? `🙇 今回の指名は受けられませんでした。${fmt(s.price)} 枚を戻しました。` : '🎀 指名が取り消されました。').catch(() => false);
    this.refresh();
  }

  private async extend(i: ButtonInteraction<'cached'>, id: number, expected: number): Promise<void> {
    await i.deferUpdate();
    const r = await extendSession(this.db, id, i.user.id, new Date(), expected);
    if (r.status !== 'ok') {
      if (r.status === 'already_extended') {
        const current = await getSession(this.db, id);
        if (current) await i.editReply({ ...sessionMessage(current, await loadCastConfig(this.db), this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof i.editReply>[0]);
      }
      const text = r.status === 'insufficient'
        ? `${this.cfg().economy.currencyName}が足りません（${fmt(r.price)} 枚必要・いま ${fmt(r.balance)} 枚）。`
        : ({
            already_extended: 'このボタンの延長は、もう済んでいます。新しいボタンを使ってください。',
            overlap: '次の予約と重なるので、のばせません。銭は使っていません。',
            minor_limit: `18 歳未満の方は ${MINOR.maxMinutes} 分・${MINOR.endHour} 時までです。`,
            not_customer: 'のばせるのは、指名した人だけです。',
            not_active: 'もう終わっています。',
          })[r.status];
      return void (await i.followUp({ content: text, ...EPHEMERAL }));
    }
    await i.editReply({ ...sessionMessage(r.session, await loadCastConfig(this.db), this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof i.editReply>[0]);
    await i.followUp({ content: `⏰ 30 分のばしました（残り ${fmt(r.balance)} 枚）。`, ...EPHEMERAL });
  }

  private async end(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const c = await loadCastConfig(this.db);
    const s = await finishSession(this.db, c, id, i.user.id);
    if (!s) return void (await i.reply({ content: '終えられるのは、キャストと指名した人だけです（もう終わっているかもしれません）。', ...EPHEMERAL }));
    await i.update({ ...sessionMessage(s, c, this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof i.update>[0]);
    await audit(this.db, { actorId: i.user.id, action: 'cast.end', detail: { sessionId: id, paid: s.paid }, via: 'discord' });
    this.refresh();
  }

  private async report(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const s = await disputeSession(this.db, id, i.user.id);
    if (!s) return void (await i.reply({ content: '通報できるのは、キャストと指名した人だけです（通話中・予約中）。', ...EPHEMERAL }));
    await i.update({ ...sessionMessage(s, await loadCastConfig(this.db), this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof i.update>[0]);
    await audit(this.db, { actorId: i.user.id, action: 'cast.report', detail: { sessionId: id }, via: 'discord' });
    const log = this.cfg().channels.log;
    if (log) {
      await this.discord
        .sendMessage(log, { content: `🚨 キャストの指名 #${id} に通報がありました（<@${i.user.id}> さんから）。${s.channelId ? `部屋: <#${s.channelId}>。` : ''}社務所Web の「🎀 キャスト」で決めてください。` })
        .catch(() => undefined);
    }
    await i.followUp({ content: '🚨 運営に知らせました。つらいときは、部屋から抜けて大丈夫です。', ...EPHEMERAL });
  }

  private async rate(i: ButtonInteraction<'cached'>, id: number, stars: number): Promise<void> {
    const s = await rateSession(this.db, id, i.user.id, stars);
    if (!s) return void (await i.reply({ content: '評価できるのは、指名した人が 1 回だけです。', ...EPHEMERAL }));
    await i.reply({ content: `⭐ ${'⭐'.repeat(stars - 1)} ありがとうございました。`, ...EPHEMERAL });
  }

  // ───────── 予約 ─────────

  private async reservePlans(i: ButtonInteraction<'cached'>, castId: string): Promise<void> {
    const cast = await getCast(this.db, castId);
    if (!cast || cast.status !== 'active') return void (await i.update({ content: 'このキャストは、いまは指名できません。', embeds: [], components: [] }));
    if (!(await isAdult(this.db, this.cfg(), i.user.id, this.roles(i)))) return void (await i.update({ content: '予約は 18 歳以上の方だけです。', embeds: [], components: [] }));
    const plans = menuOf(cast).filter((m) => m.price > 0 && !m.consult);
    if (!plans.length) return void (await i.update({ content: 'このキャストは、いま予約できるメニューがありません。', embeds: [], components: [], attachments: [] }));
    await i.update({ content: '📅 予約するメニューを選んでください。', embeds: [], components: [menuSelect(`cast:rplansel:${castId}`, '📅 予約するメニュー', plans)], attachments: [] });
  }

  private async reserveModal(i: ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>, castId: string, plan: string): Promise<void> {
    const cast = await getCast(this.db, castId);
    const item = cast && menuOf(cast).find((m) => m.id === plan);
    if (!item) return void (await i.update({ content: 'そのメニューは、いまはありません。', embeds: [], components: [], attachments: [] }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`cast:rmodal:${castId}:${plan}`)
        .setTitle(`📅 予約（${menuLabel(item)}）`.slice(0, 45))
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId('when').setLabel('日時（例: 21:00 ／ 10/5 21:00）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20),
          ),
        ),
    );
  }

  private reserveMessage(s: CastSession) {
    const when = s.startAt ? `<t:${unix(s.startAt)}:f>（<t:${unix(s.startAt)}:R>）` : '';
    const map: Partial<Record<CastSession['status'], { title: string; line: string; buttons: Btn[] }>> = {
      reserved: {
        title: '📅 予約のお願い',
        line: `<@${s.castId}> さん、${when} から ${sessionLabel(s)} の予約です。受けますか？（始まる時刻までに返事がなければ取り消します）`,
        buttons: [button(`cast:accept:${s.id}`, '受ける', 3, '✅'), button(`cast:decline:${s.id}`, '断る', 4), button(`cast:cancel:${s.id}`, '取り消す（お客）')],
      },
      accepted: { title: '📅 予約を受けました', line: `${when} から ${sessionLabel(s)}。時刻になったら部屋ができて、ここで知らせます。`, buttons: [button(`cast:cancel:${s.id}`, '取り消す（お客）'), button(`cast:report:${s.id}`, '通報', 4, '🚨')] },
      declined: { title: '🙇 予約は受けられませんでした', line: '預かっていた銭は全部戻しました。', buttons: [] },
      canceled: { title: '予約を取り消しました', line: '預かっていた銭は全部戻しました。', buttons: [] },
    };
    const m = map[s.status] ?? { title: '📅 予約', line: when, buttons: [] };
    return { embeds: [{ title: m.title, description: [`<@${s.customerId}> さん → <@${s.castId}> さん ・ ${this.coin()} ${fmt(s.price)} 枚（社務所が預かり中）`, m.line, RULES].join('\n'), color: PINK }], components: m.buttons.length ? [row(...m.buttons)] : [] };
  }

  /** 「21:00」「10/5 21:00」を、日本時間の次のその時刻に */
  private parseWhen(raw: string, now = new Date()): Date | undefined {
    const t = raw.replace(/[０-９：／]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).trim();
    const m = /^(?:(\d{1,2})\/(\d{1,2})\s+)?(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return undefined;
    const [, mo, d, h, mi] = m;
    const j = new Date(now.getTime() + 9 * 3_600_000);
    let at = new Date(Date.UTC(j.getUTCFullYear(), mo ? Number(mo) - 1 : j.getUTCMonth(), d ? Number(d) : j.getUTCDate(), Number(h), Number(mi)) - 9 * 3_600_000);
    if (Number(h) > 23 || Number(mi) > 59) return undefined;
    if (!mo && at <= now) at = new Date(at.getTime() + 24 * 3_600_000);
    if (mo && at <= now) at = new Date(Date.UTC(j.getUTCFullYear() + 1, Number(mo) - 1, Number(d), Number(h), Number(mi)) - 9 * 3_600_000);
    return at;
  }

  private async reserveSubmit(i: ModalSubmitInteraction<'cached'>, castId: string, plan: string): Promise<void> {
    if (i.isFromMessage()) await i.deferUpdate();
    else await i.deferReply(EPHEMERAL);
    const at = this.parseWhen(i.fields.getTextInputValue('when'));
    if (!at) return void (await i.editReply({ content: '日時が読めませんでした（例: 21:00 ／ 10/5 21:00）。', components: [] }));
    const c = await loadCastConfig(this.db);
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    const r = await requestSession(this.db, c, { castId, customerId: i.user.id, customerAdult: adult, plan, startAt: at });
    if (r.status !== 'ok') return void (await i.editReply({ content: this.requestError(r), components: [] }));
    // やり取りは #キャスト一覧 の中の、2 人だけのスレッドで
    const panel = c.channelId ? this.guild?.channels.cache.get(c.channelId) : undefined;
    let threadId: string | undefined;
    if (panel?.type === ChannelType.GuildText) {
      const thread = await panel.threads
        .create({ name: `📅 予約 #${r.session.id}`, type: ChannelType.PrivateThread, invitable: false, reason: 'キャストの予約' })
        .catch(() => undefined);
      if (thread) {
        await thread.members.add(castId).catch(() => undefined);
        await thread.members.add(i.user.id).catch(() => undefined);
        await thread.send({ content: `<@${castId}>`, ...this.reserveMessage(r.session), allowedMentions: { users: [castId] } } as Parameters<typeof thread.send>[0]);
        threadId = thread.id;
        await setSessionPlace(this.db, r.session.id, { threadId });
      }
    }
    if (!threadId) {
      await cancelSession(this.db, r.session.id, 'system', 'declined');
      return void (await i.editReply({ content: '予約のやり取りの場所を作れなかったので、取り消して銭を戻しました。神職に知らせてください。', components: [] }));
    }
    await this.discord.sendDm(castId, `📅 予約のお願いが届きました（<t:${unix(at)}:f>・${sessionLabel(r.session)}）。<#${threadId}> で返事をしてください。`).catch(() => false);
    await i.editReply({ content: `📅 予約をお願いしました（<t:${unix(at)}:f>）。返事は <#${threadId}> に届きます（残り ${fmt(r.balance)} 枚）。`, components: [] });
  }

  // ───────── 1 分ごと ─────────

  async tick(now = new Date()): Promise<void> {
    if (!this.guild || this.ticking) return;
    this.ticking = true;
    try { await this.runTick(now); } finally { this.ticking = false; }
  }

  private async runTick(now: Date): Promise<void> {
    const c = await loadCastConfig(this.db);
    const r = await castTick(this.db, c, now, async (s) => Boolean(await this.openRoom(s).catch((err: unknown) => { logger.warn({ err }, 'cast reserved room failed'); return undefined; })));
    let changed = r.waitingOff > 0;
    for (const s of r.expired) {
      changed = true;
      await this.discord.sendDm(s.customerId, `🙇 指名を始められなかったので、取り消して ${fmt(s.price)} 枚を戻しました。`).catch(() => false);
      if (s.threadId) await this.discord.sendMessage(s.threadId, { ...this.reserveMessage(s) } as MessageBody).catch(() => undefined);
    }
    for (const s of r.started) {
      changed = true;
      const room = this.voice(s.channelId);
      if (!room) continue;
      await this.discord.sendDm(s.customerId, `📅 予約の部屋ができました。${roomEntry(this.guild!.id, room.id).url}`).catch(() => false);
      await room.send({ content: `<@${s.castId}> <@${s.customerId}>`, ...sessionMessage(s, c, this.coin()), allowedMentions: { users: [s.castId, s.customerId] } } as Parameters<typeof room.send>[0]).catch(() => undefined);
      if (s.threadId) await this.discord.sendMessage(s.threadId, { content: `📅 予約の時間です。<#${room.id}> へどうぞ。`, components: [row(roomEntry(this.guild!.id, room.id))], allowed_mentions: { parse: [] } }).catch(() => undefined);
    }
    for (const s of r.warn) {
      const room = this.voice(s.channelId);
      await room?.send({ content: `⏰ あと 5 分です。${s.isPublic ? '' : 'のばすときは「30 分のばす」を。'}`, allowedMentions: { parse: [] } }).catch(() => undefined);
    }
    for (const s of r.finished) {
      changed = true;
      const room = this.voice(s.channelId);
      await room?.send({ ...sessionMessage(s, c, this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof room.send>[0]).catch(() => undefined);
      if (s.paid > 0) await this.discord.sendDm(s.castId, `🎀 指名 #${s.id} が終わりました。${this.coin()} ${fmt(s.paid)} 枚をお渡ししました。`).catch(() => false);
    }
    for (const s of r.cleanup) {
      const room = s.channelId ? this.guild?.channels.cache.get(s.channelId) : undefined;
      if (room) {
        try { await room.delete('キャストの指名が終わった'); }
        catch (err) { logger.warn({ err }, 'cast room delete failed'); continue; }
      }
      await roomDeleted(this.db, s.id);
    }
    if (changed) this.refresh();
  }

}

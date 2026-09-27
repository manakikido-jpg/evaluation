import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type Message,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction,
  UserSelectMenuBuilder,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { setApplicationCard } from '../services/applications.js';
import {
  checkOmairi,
  closeSoudan,
  decide,
  decideOmairi,
  replySoudan,
  genderOfRoles,
  genderRoleOf,
  GENDER_LABEL,
  introChannelOf,
  isGender,
  INTRO_MIN_CHARS,
  onIntroPosted,
  submitJoin,
  submitYoimairi,
  type AgeGroup,
  type Gender,
  type OmairiAction,
} from '../services/admission.js';
import { getMember } from '../services/members.js';
import {
  CONTACT_KIND_LABEL,
  CONTACT_KINDS,
  CONTACT_LEVEL_EMOJI,
  CONTACT_LEVEL_LABEL,
  CONTACT_LEVELS,
  contactEnabled,
  contactSummary,
  isContactKind,
  isContactLevel,
  setContact,
  type ContactKind,
  type ContactLevel,
} from '../services/contact.js';
import type { Actor, ModCtx } from '../services/moderation.js';
import { appendFromSender, createSoudan, setSoudanCard } from '../services/soudan.js';
import { goshuinchoOf } from '../services/shuin.js';
import { coreName } from '../lib/names.js';
import { inviteOf } from '../services/invites.js';
import { recordIntro } from '../services/intros.js';
import { panelMessage } from './panels.js';
import { SHU } from './views.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const NO_MENTIONS = { parse: [] as const };
const mention = (id: string) => `<@${id}>`;
const ts = (d: Date, style = 'R') => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
const AGE_LABEL: Record<AgeGroup, string> = { minor: '13〜17 歳', adult: '18 歳以上' };

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const row = (...b: ButtonBuilder[]): Row => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(b);
const btn = (id: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

function textInput(id: string, label: string, style: TextInputStyle, opts: { required?: boolean; max?: number; placeholder?: string } = {}) {
  const t = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(opts.required ?? true)
    .setMaxLength(opts.max ?? 200);
  if (opts.placeholder) t.setPlaceholder(opts.placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(t);
}

/** 申請の状態の「招待」: - まだ ／ 0 いない ／ ID */
const invOf = (v: string | undefined): string | undefined => (v === '0' || (v && /^\d{17,20}$/.test(v)) ? v : undefined);

/**
 * 入鯖申請・宵参り申請・匿名相談・お参り期間の判定（Discord 側）。
 * 判定の中身は services/admission.ts（管理画面と共通）。
 */
export class AdmissionApp {
  /** 自己紹介を仕上げている人・仕上げた人（Discord のロールが届くまでの間、二重に仕上げない） */
  private readonly introBusy = new Set<string>();
  private readonly introDone = new Set<string>();

  constructor(
    private readonly client: Client,
    private readonly db: Db,
    private readonly getCfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  private get cfg(): GuildConfig {
    return this.getCfg();
  }

  private get ctx(): ModCtx {
    return { db: this.db, cfg: this.cfg, discord: this.discord };
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg.guildId) return;
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'panel') return await this.panel(interaction);
        if (interaction.commandName === 'soudan') return await this.soudanStart(interaction);
      } else if (interaction.isButton()) {
        const [ns, action, arg] = interaction.customId.split(':');
        if (ns === 'apply' && action === 'start') return await this.applyStart(interaction);
        if (ns === 'apply' && action === 'age' && (arg === 'minor' || arg === 'adult')) return await this.applyGender(interaction, arg);
        if (ns === 'apply' && (action === 'gender' || action === 'c')) {
          // apply:gender:<年齢>.<性別> → apply:c:<年齢>.<性別>.<DM>.<フレンド>.<招待>（まだなら -。招待なしは 0）
          const [age, gender, dm, fr, inv] = (arg ?? '').split('.');
          if ((age === 'minor' || age === 'adult') && isGender(gender)) {
            return await this.applyNext(interaction, age, gender, isContactLevel(dm) ? dm : undefined, isContactLevel(fr) ? fr : undefined, invOf(inv));
          }
        }
        if (ns === 'gender' && isGender(action)) return await this.chooseGender(interaction, action);
        if (ns === 'contact' && isContactKind(action) && isContactLevel(arg)) return await this.chooseContact(interaction, action, arg);
        if (ns === 'yoimairi' && action === 'start') return await this.yoimairiStart(interaction);
        if (ns === 'app' && (action === 'approve' || action === 'reject') && arg) return await this.decideApp(interaction, Number(arg), action === 'approve');
        if (ns === 'soudan' && action === 'reply' && arg) return await this.soudanReplyModal(interaction, Number(arg));
        if (ns === 'soudan' && action === 'done' && arg) return await this.soudanDone(interaction, Number(arg));
        if (ns === 'omairi' && action === 'remove' && arg) return await this.omairiConfirmRemove(interaction, arg);
        if (ns === 'omairi' && (action === 'extend' || action === 'promote') && arg) return await this.omairiDecide(interaction, arg, action);
        if (ns === 'omairi' && action === 'removeok' && arg) return await this.omairiDecide(interaction, arg, 'remove');
      } else if (interaction.isUserSelectMenu()) {
        // 招待してくれた人を選んだ
        const [ns, action, arg] = interaction.customId.split(':');
        if (ns === 'apply' && action === 'inv') {
          const [age, gender, dm, fr] = (arg ?? '').split('.');
          if ((age === 'minor' || age === 'adult') && isGender(gender)) {
            return await this.applyInviter(interaction, age, gender, isContactLevel(dm) ? dm : undefined, isContactLevel(fr) ? fr : undefined);
          }
        }
      } else if (interaction.isModalSubmit()) {
        const [ns, action, arg] = interaction.customId.split(':');
        if (ns === 'apply' && action === 'modal') {
          const [age, gender, dm, fr, inv] = (arg ?? '').split('.');
          if ((age === 'minor' || age === 'adult') && (gender === undefined || isGender(gender))) {
            const inviter = invOf(inv);
            return await this.applySubmit(interaction, age, gender, {
              dm: isContactLevel(dm) ? dm : undefined,
              friend: isContactLevel(fr) ? fr : undefined,
              inviter: inviter && inviter !== '0' ? inviter : undefined,
            });
          }
        }
        if (ns === 'soudan' && action === 'modal') return await this.soudanSubmit(interaction, arg === 'new' ? undefined : Number(arg));
        if (ns === 'soudan' && action === 'replymodal' && arg) return await this.soudanReply(interaction, Number(arg));
      }
    } catch (err) {
      logger.error({ err }, 'admission interaction failed');
      if (interaction.isRepliable()) {
        const msg = { content: '申し訳ありません、うまく処理できませんでした。', ...EPHEMERAL };
        await (interaction.deferred || interaction.replied ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => undefined);
      }
    }
  }

  /** #絵馬-男性・#絵馬-女性 への書き込み: 絵馬待ちの人なら、入鯖を仕上げる */
  async onMessage(msg: Message): Promise<void> {
    if (!msg.inGuild() || msg.guildId !== this.cfg.guildId || msg.author.bot || !msg.member) return;
    // 自己紹介はプロフィールに出すので覚えておく（だれでも）
    if ([this.cfg.channels.ema, this.cfg.channels.emaFemale].includes(msg.channelId)) {
      await recordIntro(this.db, { memberId: msg.author.id, channelId: msg.channelId, messageId: msg.id, content: msg.content, postedAt: msg.createdAt }).catch(
        (err: unknown) => logger.warn({ err }, 'record intro failed'),
      );
    }
    const pending = this.cfg.roles.emaPending;
    if (!pending || !msg.member.roles.cache.has(pending) || this.introDone.has(msg.author.id)) return;
    if (![this.cfg.channels.ema, this.cfg.channels.emaFemale].includes(msg.channelId)) return;
    // 続けて書き込んでも 1 回だけ仕上げる
    if (this.introBusy.has(msg.author.id)) return;
    this.introBusy.add(msg.author.id);
    let r: Awaited<ReturnType<typeof onIntroPosted>>;
    try {
      // 本文が空 = BOT が本文を読めない（Message Content がオフ）か、画像だけ。長さは確かめない
      r = await onIntroPosted(this.ctx, { id: msg.author.id, roleIds: [...msg.member.roles.cache.keys()] }, msg.channelId, msg.content || undefined, new Date(), msg.id);
      if (r.status === 'completed') this.introDone.add(msg.author.id);
    } finally {
      this.introBusy.delete(msg.author.id);
    }
    if (r.status === 'wrong_channel') {
      await msg.delete().catch(() => undefined);
      const quote = msg.content ? `\n> ${msg.content.slice(0, 1500).replace(/\n/g, '\n> ')}` : '';
      const sent = await this.discord.sendDm(msg.author.id, `⛩ 自己紹介は <#${r.expected}> に書いてください（書いたものは消しました。コピーしてあれば貼り直せます）。${quote}`);
      if (!sent) await this.flash(msg, `<@${msg.author.id}> さん、自己紹介は <#${r.expected}> に書いてください。`);
    } else if (r.status === 'too_short') {
      await this.flash(msg, `<@${msg.author.id}> さん、自己紹介はもう少し詳しく書いてください（${INTRO_MIN_CHARS} 文字以上。いちばん下のひな形をどうぞ）。`);
    } else if (r.status === 'completed') {
      await msg.react('🌸').catch(() => undefined);
    }
  }

  /**
   * 起動したとき: BOT が止まっていた間（や、本文を読めずに仕上げられなかった間）に書かれた自己紹介を拾う。
   * 絵馬のチャンネルの最近 100 件から、絵馬待ちの人が自分のチャンネルに書いたものを探す（ちがうチャンネルのものは消さない）。
   */
  async catchUpIntros(guild: Guild): Promise<string[]> {
    const pending = this.cfg.roles.emaPending ?? '';
    const done: string[] = [];
    for (const channelId of [this.cfg.channels.ema, this.cfg.channels.emaFemale]) {
      if (!channelId) continue;
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;
      const messages = await channel.messages.fetch({ limit: 100 }).catch(() => undefined);
      if (!messages) continue;
      for (const msg of messages.values()) {
        if (msg.author.bot) continue;
        // プロフィール用に、前からいる人の自己紹介も覚える（新しいものが残る）
        await recordIntro(this.db, { memberId: msg.author.id, channelId, messageId: msg.id, content: msg.content, postedAt: msg.createdAt }).catch(() => undefined);
        if (!pending || done.includes(msg.author.id) || this.introDone.has(msg.author.id)) continue;
        const member = guild.members.cache.get(msg.author.id) ?? (await guild.members.fetch(msg.author.id).catch(() => undefined));
        if (!member?.roles.cache.has(pending)) continue;
        const r = await onIntroPosted(this.ctx, { id: member.id, roleIds: [...member.roles.cache.keys()] }, channelId, msg.content || undefined, new Date(), msg.id);
        if (r.status !== 'completed') continue;
        this.introDone.add(member.id);
        done.push(member.id);
        await msg.react('🌸').catch(() => undefined);
      }
    }
    if (done.length) logger.info({ count: done.length }, 'intro catch-up');
    return done;
  }

  /** 入った人に、はじめの流れを DM で案内（BOT・もう参拝者以上の人にはしない） */
  async onMemberAdd(m: GuildMember): Promise<boolean> {
    if (m.guild.id !== this.cfg.guildId || m.user.bot) return false;
    if (this.cfg.ranks.some((r) => m.roles.cache.has(r.roleId))) return false;
    const find = (name: string) => m.guild.channels.cache.find((c) => c.isTextBased() && coreName(c.name) === name)?.id;
    const ch = (name: string) => {
      const id = find(name);
      return id ? `<#${id}>` : `#${name}`;
    };
    const intro = this.cfg.channels.ema || this.cfg.channels.emaFemale ? `${ch('絵馬-男性')}・${ch('絵馬-女性')}` : '#絵馬';
    return this.discord.sendDm(
      m.id,
      [
        '# ⛩ 咲楽ノ宮へようこそ！',
        'はじめての方は、この順に進んでください（5 分ほどで終わります）。',
        '',
        `**① ルールを読む** … ${ch('しきたり')}`,
        `**② 入鯖を申請する** … ${ch('社務所')} の「入鯖を申請する」ボタン（年齢・性別などを選んで、フォームに書く）`,
        '**③ 承認を待つ** … 神職が確認すると、この DM でお知らせします',
        `**④ 自己紹介を書く** … 自分の絵馬（${intro}）に書くと、全部のチャンネルが見えるようになります`,
        '',
        '-# このあとも BOT から DM が届きます。届かないときは、サーバー名を右クリック（スマホは長押し）→「プライバシー設定」→「ダイレクトメッセージ」を ON にしてください',
      ].join('\n'),
    );
  }

  /** そのチャンネルに少しだけ出して消す（DM が届かない人向け） */
  private async flash(msg: Message<true>, content: string): Promise<void> {
    const m = await msg.channel.send({ content, allowedMentions: { users: [msg.author.id] } }).catch(() => undefined);
    if (m) setTimeout(() => void m.delete().catch(() => undefined), 20_000);
  }

  private staffOf(i: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>): Actor | undefined {
    const level = adminLevelOf(this.cfg, [...i.member.roles.cache.keys()]);
    return level ? { id: i.user.id, level, via: 'discord' } : undefined;
  }

  // ───────── パネル（神職が #社務所 などに置く） ─────────

  private async panel(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    if (!this.staffOf(i)) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    const kind = i.options.getSubcommand();
    const channel = i.channel;
    if (!channel?.isSendable()) return void (await i.reply({ content: 'このチャンネルには置けません。', ...EPHEMERAL }));
    if (kind === 'omamori' && !this.cfg.roles.omamori.length) {
      return void (await i.reply({ content: 'お守りのロールがまだありません。セットアップを実行してください。', ...EPHEMERAL }));
    }
    if (kind === 'contact' && !CONTACT_KINDS.some((k) => contactEnabled(this.cfg, k))) {
      return void (await i.reply({ content: 'DM・フレンドのロールがまだありません。セットアップを実行してください。', ...EPHEMERAL }));
    }
    const kinds = ['apply', 'omamori', 'shop', 'gender', 'market', 'contact', 'bell', 'gacha'] as const;
    await channel.send(panelMessage(kinds.find((k) => k === kind) ?? 'yoimairi', { omamori: this.cfg.roles.omamori }));
    await i.reply({ content: '置きました。', ...EPHEMERAL });
  }

  // ───────── 入鯖申請 ─────────

  /** 申請のステップの数（年齢・性別・DM・フレンド・招待・フォーム。ロールがなければ DM・フレンドは聞かない） */
  private get applySteps(): number {
    return 4 + CONTACT_KINDS.filter((k) => contactEnabled(this.cfg, k)).length;
  }

  private step(n: number, label: string): string {
    return `**入鯖申請 ― ステップ ${n}/${this.applySteps}：${label}**`;
  }

  private async applyStart(i: ButtonInteraction<'cached'>): Promise<void> {
    await i.reply({
      content: `${this.step(1, '年齢')}\nまず年齢区分を選んでください（生年月日は聞きません）。\n13 歳未満の方は Discord の規約により参加できません。`,
      components: [row(btn('apply:age:minor', '13〜17 歳'), btn('apply:age:adult', '18 歳以上'))],
      ...EPHEMERAL,
    });
  }

  /** 年齢のあとに性別（自己紹介を書くチャンネル・ロールが決まる） */
  private async applyGender(i: ButtonInteraction<'cached'>, age: AgeGroup): Promise<void> {
    await i.update({
      content: `${this.step(2, '性別')}\n性別を選んでください（自己紹介を書くチャンネルと、ロールが決まります）。`,
      components: [row(btn(`apply:gender:${age}.male`, '♂ 男性'), btn(`apply:gender:${age}.female`, '♀ 女性'))],
    });
  }

  /** パネルの「性別を選ぶ」（前からいる人向け。選んだあとは神職が変える） */
  private async chooseGender(i: ButtonInteraction<'cached'>, gender: Gender): Promise<void> {
    const role = genderRoleOf(this.cfg, gender);
    if (!role) return void (await i.reply({ content: '性別のロールがまだありません。神職に知らせてください。', ...EPHEMERAL }));
    const now = genderOfRoles(this.cfg, [...i.member.roles.cache.keys()]);
    if (now) return void (await i.reply({ content: `もう「${GENDER_LABEL[now]}」になっています。変えたいときは神職に知らせてください。`, ...EPHEMERAL }));
    await i.member.roles.add(role, '性別を選んだ');
    const intro = introChannelOf(this.cfg, gender);
    await i.reply({ content: `「${GENDER_LABEL[gender]}」にしました。${intro ? `自己紹介は <#${intro}> へどうぞ。` : ''}`, ...EPHEMERAL });
  }

  /** パネルの DM・フレンド追加（押し直すと変わる） */
  private async chooseContact(i: ButtonInteraction<'cached'>, kind: ContactKind, level: ContactLevel): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const r = await setContact(this.ctx, i.user.id, kind, level, [...i.member.roles.cache.keys()]);
    await i.editReply(r === 'ok' ? `${CONTACT_KIND_LABEL[kind]}を「${CONTACT_LEVEL_EMOJI[level]} ${CONTACT_LEVEL_LABEL[level]}」にしました。` : 'このロールはまだありません。神職に知らせてください。');
  }

  /** 性別のあと: DM → フレンド追加（ロールがあれば）→ 招待してくれた人 → フォーム */
  private async applyNext(i: ButtonInteraction<'cached'>, age: AgeGroup, gender: Gender, dm?: ContactLevel, fr?: ContactLevel, inv?: string): Promise<void> {
    const state = (d?: ContactLevel, f?: ContactLevel, v?: string) => `${age}.${gender}.${d ?? '-'}.${f ?? '-'}.${v ?? '-'}`;
    const ask = (kind: ContactKind, to: (l: ContactLevel) => string) =>
      i.update({
        content: [
          this.step(kind === 'dm' || !contactEnabled(this.cfg, 'dm') ? 3 : 4, kind === 'dm' ? 'DM' : 'フレンド追加'),
          kind === 'dm' ? 'ほかのメンバーからの **DM** は大丈夫ですか？' : 'ほかのメンバーからの **フレンド追加** は大丈夫ですか？',
          '-# ロールになってプロフィールに出ます。あとから #授与所 でいつでも変えられます',
          '-# ⭕ OK … 気軽にどうぞ ／ 💬 要相談 … 一声かけてから ／ ❌ NG … しないで',
        ].join('\n'),
        components: [row(...CONTACT_LEVELS.map((l) => btn(`apply:c:${to(l)}`, `${CONTACT_LEVEL_EMOJI[l]} ${CONTACT_LEVEL_LABEL[l]}`)))],
      });
    if (!dm && contactEnabled(this.cfg, 'dm')) return void (await ask('dm', (l) => state(l, fr)));
    if (!fr && contactEnabled(this.cfg, 'friend')) return void (await ask('friend', (l) => state(dm, l)));
    if (!inv) {
      // 招待リンクで入った人は、だれの招待か分かっているので聞かない
      const linked = await inviteOf(this.db, i.user.id);
      if (linked?.source === 'link') inv = linked.inviterId;
    }
    if (!inv) return void (await i.update(this.inviterStep(age, gender, dm, fr)));
    await this.applyModal(i, age, gender, state(dm, fr, inv));
  }

  /** 招待してくれた人を選ぶ（メンバーから 1 人。いなければボタン） */
  private inviterStep(age: AgeGroup, gender: Gender, dm?: ContactLevel, fr?: ContactLevel, warning?: string) {
    const base = `${age}.${gender}.${dm ?? '-'}.${fr ?? '-'}`;
    const e = this.cfg.economy;
    return {
      content: [
        this.step(this.applySteps - 1, '招待してくれた人'),
        ...(warning ? [`⚠️ ${warning}`] : []),
        'だれかに招待されて来ましたか？ 招待してくれた人を下から選んでください（名前で検索できます）。',
        e.inviteReward > 0 ? `-# 選ばれた人には、あなたが参拝者になったときに招待のお礼（${e.currencyEmoji}${e.inviteReward} 枚）が届きます` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>()
          .addComponents(new UserSelectMenuBuilder().setCustomId(`apply:inv:${base}`).setPlaceholder('招待してくれた人を選ぶ').setMinValues(1).setMaxValues(1))
          .toJSON(),
        row(btn(`apply:c:${base}.0`, '招待してくれた人はいない')),
      ],
    };
  }

  private async applyInviter(i: UserSelectMenuInteraction<'cached'>, age: AgeGroup, gender: Gender, dm?: ContactLevel, fr?: ContactLevel): Promise<void> {
    const user = i.users.first();
    const warning = !user ? '選べませんでした。もう一度選んでください。' : user.id === i.user.id ? '自分は選べません。' : user.bot ? 'BOT は選べません。' : undefined;
    if (warning || !user) return void (await i.update(this.inviterStep(age, gender, dm, fr, warning)));
    await this.applyModal(i, age, gender, `${age}.${gender}.${dm ?? '-'}.${fr ?? '-'}.${user.id}`);
  }

  private async applyModal(i: ButtonInteraction<'cached'> | UserSelectMenuInteraction<'cached'>, age: AgeGroup, gender: Gender, state: string): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(`apply:modal:${state}`)
      .setTitle(`入鯖申請 ${this.applySteps}/${this.applySteps}（${AGE_LABEL[age]}・${GENDER_LABEL[gender]}）`)
      .addComponents(
        textInput('name', '呼び名', TextInputStyle.Short, { max: 32 }),
        textInput('purpose', '主にやりたいこと', TextInputStyle.Short, { max: 100, placeholder: 'ゲーム・雑談・寝落ち など' }),
        textInput('message', 'ひとこと', TextInputStyle.Paragraph, { required: false, max: 500 }),
      );
    await i.showModal(modal);
  }

  private async applySubmit(
    i: ModalSubmitInteraction<'cached'>,
    age: AgeGroup,
    gender: Gender | undefined,
    contact: { dm?: ContactLevel; friend?: ContactLevel; inviter?: string },
  ): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const answers = {
      name: i.fields.getTextInputValue('name').trim(),
      age,
      ...(gender ? { gender } : {}),
      ...(contact.dm ? { dm: contact.dm } : {}),
      ...(contact.friend ? { friend: contact.friend } : {}),
      ...(contact.inviter ? { inviter: contact.inviter } : {}),
      purpose: i.fields.getTextInputValue('purpose').trim(),
      message: i.fields.getTextInputValue('message').trim(),
    };
    const r = await submitJoin(this.ctx, { id: i.user.id, roleIds: [...i.member.roles.cache.keys()], accountCreatedAt: i.user.createdAt }, answers);
    const linked = await inviteOf(this.db, i.user.id);
    if (r.status === 'already_member') return void (await i.editReply('すでに参拝者以上になっています。申請は不要です。'));
    if (r.status === 'duplicate') return void (await i.editReply('申請はすでに受け付けています。神職の確認をお待ちください。'));
    if (r.status === 'pending_intro') {
      return void (await i.editReply(`申請はもう承認されています。${r.channelId ? `<#${r.channelId}> に自己紹介を書くと、全部のチャンネルが見えるようになります。` : ''}`));
    }
    if (r.status === 'auto_approved') {
      const intro = introChannelOf(this.cfg, gender);
      return void (await i.editReply(
        this.cfg.roles.emaPending && intro
          ? `⛩ 申請を承認しました。最後に <#${intro}> に自己紹介を書いてください。書くと、全部のチャンネルが見えるようになります。`
          : '⛩ 申請を承認しました。ようこそ、咲楽ノ宮へ！',
      ));
    }

    await this.postApplicationCard(r.id, i.user.id, [
      `**入鯖申請 #${r.id}** ${mention(i.user.id)}`,
      `呼び名: ${answers.name}`,
      `年齢区分: ${AGE_LABEL[age]}`,
      gender ? `性別: ${GENDER_LABEL[gender]}` : '',
      contactSummary(answers),
      answers.inviter ? `招待してくれた人: <@${answers.inviter}>${linked?.source === 'link' && linked.inviterId === answers.inviter ? '（招待リンク）' : ''}` : '招待してくれた人: いない',
      `やりたいこと: ${answers.purpose}`,
      answers.message ? `ひとこと: ${answers.message}` : '',
      `Discord アカウント作成: ${ts(i.user.createdAt)} ・ 参加: ${i.member.joinedAt ? ts(i.member.joinedAt) : '—'}`,
    ]);
    await i.editReply(
      [
        '✅ 申請を受け付けました。',
        '**次は**: 神職が確認するまで少しお待ちください。結果は BOT から DM でお知らせします。',
        this.cfg.roles.emaPending ? '-# 承認されたら、最後に自分の絵馬に自己紹介を書くと、全部のチャンネルが見えるようになります' : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  private async postApplicationCard(id: number, memberId: string, lines: string[]): Promise<void> {
    const channelId = this.cfg.channels.applications;
    if (!channelId) return;
    try {
      const ch = await this.client.channels.fetch(channelId);
      if (!ch?.isSendable()) return;
      const embed = new EmbedBuilder().setColor(SHU).setDescription(lines.filter(Boolean).join('\n'));
      const msg = await ch.send({
        embeds: [embed.toJSON()],
        components: [row(btn(`app:approve:${id}`, '承認', ButtonStyle.Success), btn(`app:reject:${id}`, '却下', ButtonStyle.Danger))],
        allowedMentions: NO_MENTIONS,
      });
      await setApplicationCard(this.db, id, ch.id, msg.id);
    } catch (err) {
      logger.warn({ err, memberId }, 'application card failed');
    }
  }

  private async yoimairiStart(i: ButtonInteraction<'cached'>): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const r = await submitYoimairi(this.ctx, i.user.id, [...i.member.roles.cache.keys()]);
    const text = {
      disabled: '宵参りの申請は受け付けていません。',
      already: 'すでに宵参りになっています。',
      not_adult: '入鯖のときに「18 歳以上」と申告した方だけ申請できます。',
      duplicate: '申請はすでに受け付けています。',
      pending: '宵参りの申請を受け付けました。結果は BOT から DM でお知らせします。',
    }[r.status];
    if (r.status === 'pending') await this.postApplicationCard(r.id, i.user.id, [`**🔞 宵参り申請 #${r.id}** ${mention(i.user.id)}`, '年齢区分: 18 歳以上（入鯖時の申告）']);
    await i.editReply(text);
  }

  private async decideApp(i: ButtonInteraction<'cached'>, id: number, approve: boolean): Promise<void> {
    const actor = this.staffOf(i);
    if (!actor) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const r = await decide(this.ctx, actor, id, approve);
    const text =
      r.status === 'approved'
        ? `承認しました。${r.dmSent ? '' : '（DM は届きませんでした）'}`
        : r.status === 'rejected'
          ? `却下しました。${r.dmSent ? '' : '（DM は届きませんでした）'}`
          : r.status === 'not_adult'
            ? 'この方は 18 歳以上と申告していないため、宵参りを承認できません。'
            : 'この申請はすでに判定済みです。';
    await i.editReply(text);
  }

  // ───────── 匿名相談 ─────────

  private async soudanStart(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const num = i.options.getInteger('number');
    const modal = new ModalBuilder()
      .setCustomId(`soudan:modal:${num ?? 'new'}`)
      .setTitle(num ? `相談 #${num} の続き` : '神職への相談（匿名）')
      .addComponents(
        textInput('body', '相談したいこと', TextInputStyle.Paragraph, {
          max: 1500,
          placeholder: '神職にはあなたの名前は表示されません。返信は BOT から DM で届きます。',
        }),
      );
    await i.showModal(modal);
  }

  private async soudanSubmit(i: ModalSubmitInteraction<'cached'>, num: number | undefined): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const body = i.fields.getTextInputValue('body').trim();
    let id: number;
    if (num) {
      if ((await appendFromSender(this.db, num, i.user.id, body)) !== 'ok') {
        return void (await i.editReply(`相談 #${num} が見つかりません（ご自身の相談の番号だけ使えます）。`));
      }
      id = num;
    } else {
      id = await createSoudan(this.db, i.user.id, body);
    }
    await this.postSoudanCard(id, body, Boolean(num));
    await i.editReply(
      `📮 相談 #${id} を受け付けました。神職にはあなたの名前は表示されません。\n返信は BOT から DM で届きます（サーバーのメンバーからの DM を受け取る設定にしておいてください）。`,
    );
  }

  private async postSoudanCard(id: number, body: string, isFollowUp: boolean): Promise<void> {
    const channelId = this.cfg.channels.soudan;
    if (!channelId) return;
    try {
      const ch = await this.client.channels.fetch(channelId);
      if (!ch?.isSendable()) return;
      const embed = new EmbedBuilder()
        .setColor(SHU)
        .setTitle(isFollowUp ? `📮 相談 #${id} に続きが届きました（匿名）` : `📮 相談 #${id}（匿名）`)
        .setDescription(body.slice(0, 4000));
      const msg = await ch.send({
        embeds: [embed.toJSON()],
        components: [row(btn(`soudan:reply:${id}`, '返信する', ButtonStyle.Primary), btn(`soudan:done:${id}`, '完了にする'))],
      });
      await setSoudanCard(this.db, id, ch.id, msg.id);
    } catch (err) {
      logger.warn({ err }, 'soudan card failed');
    }
  }

  private async soudanReplyModal(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    if (!this.staffOf(i)) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`soudan:replymodal:${id}`)
        .setTitle(`相談 #${id} への返信`)
        .addComponents(textInput('body', '返信（BOT から DM で届く。あなたの名前は出ません）', TextInputStyle.Paragraph, { max: 1500 })),
    );
  }

  private async soudanReply(i: ModalSubmitInteraction<'cached'>, id: number): Promise<void> {
    const actor = this.staffOf(i);
    if (!actor) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const r = await replySoudan(this.ctx, actor, id, i.fields.getTextInputValue('body').trim());
    await i.editReply(r.status === 'not_found' ? '相談が見つかりません。' : r.dmSent ? '返信を送りました。' : '⚠️ 返信を記録しましたが、DM が届きませんでした（相手が DM を受け取らない設定の可能性）。');
  }

  private async soudanDone(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const actor = this.staffOf(i);
    if (!actor) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    await i.editReply((await closeSoudan(this.ctx, actor, id)) === 'ok' ? '完了にしました。' : '相談が見つかりません。');
  }

  // ───────── お参り期間 ─────────

  /** 定期的に呼ぶ: 期間が終わった人を判定し、神職の判定が必要な人を #お参り判定 に出す */
  async checkOmairi(now = new Date()): Promise<void> {
    const r = await checkOmairi(this.ctx, now);
    const channelId = this.cfg.channels.omairi;
    if (!r.review.length || !channelId) return;
    const ch = await this.client.channels.fetch(channelId).catch(() => null);
    if (!ch?.isSendable()) return;
    const first = this.cfg.ranks.filter((x) => x.auto).sort((a, b) => a.requiredGoen - b.requiredGoen)[1];
    for (const memberId of r.review) {
      const [m, card] = await Promise.all([getMember(this.db, memberId), goshuinchoOf(this.db, memberId)]);
      const embed = new EmbedBuilder()
        .setColor(SHU)
        .setTitle('お参り期間の判定')
        .setDescription(
          [
            `${mention(memberId)}（${m?.displayName ?? memberId}）`,
            `ご縁 ${card.goen}${first ? ` / ${first.requiredGoen}` : ''} ・ 朱印をくれた人 ${card.receivedCount} 人`,
            m?.lastActiveAt ? `最後の活動 ${ts(m.lastActiveAt)}` : '最後の活動 記録なし',
          ].join('\n'),
        );
      await ch
        .send({
          embeds: [embed.toJSON()],
          components: [
            row(
              btn(`omairi:extend:${memberId}`, '延長する'),
              btn(`omairi:promote:${memberId}`, `${first?.name ?? '次の役職'}にする`, ButtonStyle.Success),
              btn(`omairi:remove:${memberId}`, '退出にする', ButtonStyle.Danger),
            ),
          ],
          allowedMentions: NO_MENTIONS,
        })
        .catch((err) => logger.warn({ err }, 'omairi card failed'));
    }
  }

  /** 退出（キック）は確認してから */
  private async omairiConfirmRemove(i: ButtonInteraction<'cached'>, memberId: string): Promise<void> {
    if (!this.staffOf(i)) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.reply({
      content: `${mention(memberId)} さまを退出（キック）させますか？本人には DM で知らせます。`,
      components: [row(btn(`omairi:removeok:${memberId}`, '退出にする', ButtonStyle.Danger))],
      allowedMentions: NO_MENTIONS,
      ...EPHEMERAL,
    });
  }

  private async omairiDecide(i: ButtonInteraction<'cached'>, memberId: string, action: OmairiAction): Promise<void> {
    const actor = this.staffOf(i);
    if (!actor) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.deferUpdate();
    const r = await decideOmairi(this.ctx, actor, memberId, action);
    const label = { extend: '⏳ 延長しました', promote: '⬆️ 昇格させました', remove: '🚪 退出にしました' }[action];
    const text = r === 'ok' ? `${label}（${mention(actor.id)}）` : r === 'denied' ? 'この方には操作できません。' : 'すでに判定済みです。';
    await i.editReply({ content: text, components: [], allowedMentions: NO_MENTIONS });
  }
}

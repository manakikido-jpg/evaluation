import { escapeMarkdown, AttachmentBuilder, MessageFlags, type APIEmbed, type ButtonInteraction, type ChatInputCommandInteraction, type Guild, type GuildMember, type Interaction, type Message } from 'discord.js';
import { adminLevelOf, type EconomyConfig, type GuildConfig, type OmikujiStreakConfig, type StreakReward } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { toneOf } from '../omikujiTexts.js';
import { drawOmikuji, nextStreakReward, specialIndex, streakRewardText, type Fortune, type OmikujiResult } from '../services/omikuji.js';
import { loadOmikujiArt, loadSlipBg } from '../services/omikujiArt.js';
import { joinSideBySide } from '../services/imageJoin.js';
import { renderSlip } from '../services/omikujiSlip.js';
import { audit } from '../services/audit.js';
import { loadOmikujiPanel, restickPanel, saveOmikujiPanel, type OmikujiPanelPlace } from '../services/omikujiPanel.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** 連続日数の行（「🔥 連続 6 日目 ・ あと 1 日で 7 日のおまけ」） */
export function streakLines(streak: number, bonus: readonly StreakReward[], cfg: OmikujiStreakConfig | undefined, economy: EconomyConfig): string[] {
  if (!streak) return [];
  const next = cfg ? nextStreakReward(cfg, streak) : undefined;
  return [
    `🔥 連続 **${streak}** 日目${next ? ` ・ あと ${next.left} 日で ${next.reward.days} 日のおまけ` : ''}`,
    ...bonus.map((b) => `🎁 **${b.days} 日続いたおまけ**: ${streakRewardText(b, economy)}`),
  ];
}

/** 通話に入っていないと引けないとき、その案内（引けるなら undefined）。AFK・数えない通話は入っていないのと同じ */
export function omikujiVoiceBlock(economy: Pick<EconomyConfig, 'omikujiVoiceOnly' | 'excludedVoiceChannelIds'>, member: Pick<GuildMember, 'voice' | 'guild'>): string | undefined {
  if (!economy.omikujiVoiceOnly) return undefined;
  const ch = member.voice.channelId;
  if (ch && ch !== member.guild.afkChannelId && !economy.excludedVoiceChannelIds.includes(ch)) return undefined;
  return '🔊 おみくじは **通話に入っているときだけ** 引けます。どこかの通話に入ってから、もう一度どうぞ（AFK の通話はのぞく）。';
}

type Drawn = Extract<OmikujiResult, { status: 'drawn' }>;
type Payload = { content?: string; embeds: APIEmbed[]; files: AttachmentBuilder[] };
const NO_PINGS = { parse: [] } as const;
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** 結果の下に出す行（花びら・連続日数・案内） */
function footLines(r: Drawn, economy: EconomyConfig, streak?: OmikujiStreakConfig): string[] {
  const coin = `${economy.currencyEmoji}${economy.currencyName}`;
  return [
    ...(r.amount > 0 ? [`${coin} **+${r.amount}**（いま ${r.balance} 枚）`] : []),
    ...streakLines(r.streak, r.bonus, streak, economy),
    `-# おみくじは 1 日 1 回。日本時間の 0 時にまた引けます${streak?.rewards.length ? '（毎日続けるとおまけがあります。1 日空けると 1 日目から）' : ''}`,
  ];
}

const titleOf = (r: Drawn) => (specialIndex(r.fortune.key) !== undefined ? `🎴 御神籤 ― ${r.fortune.name}` : `⛩ おみくじ ― ${r.fortune.name}`);

/** 引いた結果のカード（文字だけ。紙の画像を出さないとき・作れなかったとき） */
export function omikujiEmbed(r: Drawn, name: string, economy: EconomyConfig, streak?: OmikujiStreakConfig): APIEmbed {
  const lines = [`**${name}** さんの運勢`, r.message, '', ...r.sayings.map((s) => `${s.emoji ? `${s.emoji} ` : ''}${s.label} … ${s.text}`), '', ...footLines(r, economy, streak)];
  return { title: titleOf(r), description: lines.join('\n'), color: r.fortune.color };
}

/** 紙のいちばん下に書く行（もらった銭・連続日数と次のおまけ。絵文字は字がないので使わない） */
export function slipFoot(r: Drawn, economy: Pick<EconomyConfig, 'currencyName'>, streak?: OmikujiStreakConfig): string[] {
  const next = streak && r.streak ? nextStreakReward(streak, r.streak) : undefined;
  return [
    ...(r.amount > 0 ? [`${economy.currencyName} +${r.amount.toLocaleString('ja-JP')}（いま ${r.balance.toLocaleString('ja-JP')} 枚）`] : []),
    ...(r.streak ? [`連続 ${r.streak} 日目${next ? `・あと ${next.left} 日でおまけ` : ''}`] : []),
  ];
}

/** おみくじの紙（画像）。紙を出さない設定・作れなかったときは undefined */
export async function omikujiSlip(db: Db, cfg: Pick<GuildConfig, 'omikujiTexts'>, r: Drawn, now = new Date(), foot: string[] = []): Promise<AttachmentBuilder | undefined> {
  if (!cfg.omikujiTexts.slip) return undefined;
  try {
    const special = specialIndex(r.fortune.key) !== undefined;
    const bg = await loadSlipBg(db, r.fortune.key).catch(() => undefined);
    const png = renderSlip({
      name: r.fortune.name,
      color: hex(r.fortune.color),
      message: r.message,
      items: r.sayings.map((s) => ({ label: s.label, text: s.text })),
      shrine: cfg.omikujiTexts.shrine,
      ...(r.number ? { number: r.number } : {}),
      date: now,
      special,
      tone: toneOf(special ? 'daikichi' : r.fortune.key),
      foot,
      ...(bg ? { bg } : {}),
    });
    return new AttachmentBuilder(png, { name: 'omikuji.png' });
  } catch (err) {
    logger.warn({ err, fortune: r.fortune.key }, 'omikuji slip failed');
    return undefined;
  }
}

/** 🎴 運営吉の絵（社務所Web で入れたもの。なければ undefined） */
async function uneiArt(db: Db, key: string): Promise<AttachmentBuilder | undefined> {
  const n = specialIndex(key);
  const art = n === undefined ? undefined : await loadOmikujiArt(db, n).catch(() => undefined);
  return art && new AttachmentBuilder(Buffer.from(art.data), { name: art.name });
}

/** 運営吉の絵を大きく出すカード */
const artEmbed = (r: Drawn, name: string, file: AttachmentBuilder): APIEmbed => ({
  title: `🎴✨ ${r.fortune.name} ✨`,
  description: `**${name}** さんに、運営の特別な御神籤「**${r.fortune.name}**」が出ました！`,
  color: r.fortune.color,
  image: { url: `attachment://${file.name}` },
});

/** IDで本人を表示する。名前しかない見本ではMarkdownを文字として扱う。 */
function drawerLine(name: string, opts: { memberId?: string; suffix?: string }): string {
  const who = opts.memberId && /^\d{17,20}$/.test(opts.memberId) ? `<@${opts.memberId}>` : `**${escapeMarkdown(name)}**`;
  return `-# ⛩ ${who} さんのおみくじ${opts.suffix ?? ''}`;
}

/**
 * 結果のメッセージ。おみくじの紙（画像）と本人表示を出す（もらった銭・連続日数は紙のいちばん下に書く）。
 * 結果の本文に引いた人を必ず残す（返信元が消えても分かるように）。続けたおまけの行も出す。
 * 🎴 運営吉なら、社務所Web で入れた絵を大きく出してから、紙を出す。紙を作れないときは前のように文字のカード
 */
export async function omikujiMessage(db: Db, cfg: GuildConfig, r: Drawn, name: string, opts: { memberId?: string; suffix?: string; streak?: boolean; now?: Date } = {}): Promise<Payload> {
  const drawer = drawerLine(name, opts);
  const streak = opts.streak ? cfg.omikujiStreak : undefined;
  const [slip, art] = await Promise.all([omikujiSlip(db, cfg, r, opts.now, slipFoot(r, cfg.economy, streak)), uneiArt(db, r.fortune.key)]);
  if (!slip) {
    const main = omikujiEmbed(r, name, cfg.economy, streak);
    main.title = `${main.title}${opts.suffix ?? ''}`;
    return { content: drawer, embeds: [...(art ? [artEmbed(r, name, art)] : []), main], files: art ? [art] : [] };
  }
  const content = [
    drawer,
    ...r.bonus.map((b) => `🎁 **${b.days} 日続いたおまけ**: ${streakRewardText(b, cfg.economy)}`),
  ].join('\n');
  const text = content ? { content } : {};
  // 写真だけ（カードにしない）。運営吉は絵（左）と紙（右）を 1 枚に並べる（2 枚のままだと Discord が上下を切る）
  if (!art) return { ...text, embeds: [], files: [slip] };
  const joined = await joinSideBySide([art.attachment as Buffer, slip.attachment as Buffer]).catch((err) => {
    logger.warn({ err }, 'omikuji join failed');
    return undefined;
  });
  return { ...text, embeds: [], files: joined ? [new AttachmentBuilder(joined, { name: 'omikuji.png' })] : [art, slip] };
}

/** 演出の待ち時間（ミリ秒。テストでは 0 にする） */
export const REVEAL_MS = { shake: 1400, glow: 1800, art: 2800 };
const sleep = (ms: number) => (ms > 0 ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve());

type Editable = { edit: (p: { content?: string; embeds: APIEmbed[]; files?: AttachmentBuilder[]; attachments?: []; allowedMentions?: typeof NO_PINGS }) => Promise<unknown> };

/**
 * 引いた結果を出す（演出つき）。「ガラガラ…」→ 結果。
 * 🎴 運営吉は「光りだした…！？」→ 絵を大きく → 絵と紙、と順に出す。send: 最初のメッセージを出す（返したものを書きかえていく）
 */
export async function revealOmikuji(db: Db, cfg: GuildConfig, r: Drawn, name: string, send: (p: Payload & { allowedMentions: typeof NO_PINGS }) => Promise<Editable>, opts: { memberId?: string; suffix?: string; streak?: boolean } = {}): Promise<void> {
  const final = omikujiMessage(db, cfg, r, name, opts);
  if (!cfg.omikujiTexts.shake) {
    await send({ ...(await final), allowedMentions: NO_PINGS });
    return;
  }
  const msg = await send({
    content: drawerLine(name, opts),
    embeds: [{ title: `⛩ おみくじ${opts.suffix ?? ''}`, description: `🎋 **${name}** さんが御神籤を振っています……\nガラガラ……`, color: 0x8b5a2b }],
    files: [],
    allowedMentions: NO_PINGS,
  });
  try {
    await sleep(REVEAL_MS.shake);
    if (specialIndex(r.fortune.key) !== undefined) {
      await msg.edit({ embeds: [{ title: `⛩ おみくじ${opts.suffix ?? ''}`, description: '⚡ ……！？\n**御神籤が金色に光りだした……！**', color: 0xffd700 }], allowedMentions: NO_PINGS });
      await sleep(REVEAL_MS.glow);
      const art = await uneiArt(db, r.fortune.key);
      if (art) {
        // 絵だけを大きく（写真だけ）
        await msg.edit({ content: drawerLine(name, opts), embeds: [], files: [art], attachments: [], allowedMentions: NO_PINGS });
        await sleep(REVEAL_MS.art);
      }
    }
    await msg.edit({ ...(await final), attachments: [], allowedMentions: NO_PINGS });
  } catch (err) {
    logger.warn({ err }, 'omikuji reveal failed');
  }
}

/** 🎴 運営吉を引いたら #慶事 でお知らせ（絵があれば添える。運勢がふつうなら何もしない） */
export async function announceSpecial(db: Db, guild: Guild, cfg: GuildConfig, memberId: string, fortune: Fortune): Promise<void> {
  if (specialIndex(fortune.key) === undefined) return;
  const ch = guild.channels.cache.get(cfg.channels.keiji);
  if (!ch?.isSendable()) return;
  const art = await uneiArt(db, fortune.key);
  await ch
    .send({
      content: `🎴 <@${memberId}> さまが、おみくじで **${fortune.name}** を引きました！ おめでとうございます🎉`,
      ...(art ? { files: [art] } : {}),
      allowedMentions: { users: [memberId] },
    })
    .catch((err) => logger.warn({ err }, 'omikuji special announce failed'));
}

/** ⛩ 「御神籤を引く」ボタン（ボタンだけ。/パネル おみくじ で置く） */
export function omikujiPanelBody(e: Pick<EconomyConfig, 'omikujiVoiceOnly'>) {
  return {
    content: `-# 1 日 1 回（日本時間の 0 時から）${e.omikujiVoiceOnly ? '・通話に入っているときだけ' : ''}`,
    components: [{ type: 1 as const, components: [{ type: 2 as const, style: 3 as const, label: '御神籤を引く', custom_id: 'omikuji:draw', emoji: { name: '⛩' } }] }],
  };
}

/** 書き込みが落ち着いてから、ボタンを下に出し直すまで */
const RESTICK_MS = 3_000;

/** /おみくじ・「⛩ 御神籤を引く」ボタン（1 日 1 回のログボ） */
export class OmikujiApp {
  private guild?: Guild;
  private place: OmikujiPanelPlace = {};
  private timer?: NodeJS.Timeout;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly restickMs = RESTICK_MS,
  ) {}

  /** 起動したとき: 置き場所を読んで、ボタンが下になければ出し直す */
  async attach(guild: Guild): Promise<void> {
    this.guild = guild;
    this.place = await loadOmikujiPanel(this.db);
    this.checkPanel();
  }

  /** 10 分ごと・書き込みが落ち着いたとき */
  checkPanel(): void {
    this.queue = this.queue.then(() => this.restick()).catch((err: unknown) => logger.warn({ err }, 'omikuji panel restick failed'));
  }

  onMessage(msg: Message): void {
    if (!this.place.channelId || msg.channelId !== this.place.channelId || msg.id === this.place.messageId) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.checkPanel(), this.restickMs);
  }

  /** ボタンが消されたら（BOT が出し直したときはのぞく）、置くのをやめる */
  async onMessageDelete(msg: { id: string; guildId: string | null }): Promise<void> {
    if (msg.guildId !== this.cfg().guildId || !this.place.messageId || msg.id !== this.place.messageId) return;
    const channelId = this.place.channelId;
    this.place = {};
    await saveOmikujiPanel(this.db, {}, 'system');
    await audit(this.db, { actorId: 'system', action: 'omikuji.panel_off', detail: { channelId }, via: 'system' });
  }

  private async restick(): Promise<void> {
    const ch = this.place.channelId ? this.guild?.channels.cache.get(this.place.channelId) : undefined;
    if (!ch?.isTextBased() || !ch.isSendable()) return;
    await restickPanel(
      this.place,
      {
        lastMessageId: async () => (await ch.messages.fetch({ limit: 1 })).first()?.id,
        send: async () => (await ch.send({ ...omikujiPanelBody(this.cfg().economy), allowedMentions: NO_PINGS })).id,
        remove: async (id) => void (await ch.messages.delete(id)),
      },
      async (p) => {
        this.place = p;
        await saveOmikujiPanel(this.db, p, 'system');
      },
    );
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    const isCommand = interaction.isChatInputCommand() && interaction.commandName === 'omikuji';
    const isButton = interaction.isButton() && interaction.customId === 'omikuji:draw';
    const isPanel = interaction.isChatInputCommand() && interaction.commandName === 'panel' && interaction.options.getSubcommand(false) === 'omikuji';
    if (!isCommand && !isButton && !isPanel) return;
    try {
      if (isPanel) return await this.placePanel(interaction as ChatInputCommandInteraction<'cached'>);
      await this.draw(interaction as ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>);
    } catch (err) {
      logger.error({ err }, 'omikuji failed');
      if (!interaction.isRepliable()) return;
      const msg = { content: 'おみくじを引けませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL };
      await (interaction.replied || interaction.deferred ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => undefined);
    }
  }

  /** /パネル おみくじ: このチャンネルのいちばん下に「⛩ 御神籤を引く」を置く（前に置いた所のボタンは消す） */
  private async placePanel(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    if (!adminLevelOf(this.cfg(), [...i.member.roles.cache.keys()])) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    if (!i.channel?.isSendable()) return void (await i.reply({ content: 'このチャンネルには置けません。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const old = this.place;
    // 前のボタンは先に忘れてから消す（消されたの知らせで止めないように）
    this.place = { channelId: i.channelId };
    await saveOmikujiPanel(this.db, this.place, i.user.id);
    if (old.channelId && old.messageId) {
      const oldCh = i.guild.channels.cache.get(old.channelId);
      if (oldCh?.isTextBased()) await oldCh.messages.delete(old.messageId).catch(() => undefined);
    }
    this.checkPanel();
    await this.queue;
    await audit(this.db, { actorId: i.user.id, action: 'omikuji.panel', detail: { channelId: i.channelId }, via: 'discord' });
    const home = this.homeOf(i.guild);
    await i.editReply(
      [
        '⛩ このチャンネルのいちばん下に「御神籤を引く」ボタンを置きました（書き込みがあると、下に出し直します）。',
        '-# やめるときは、ボタンの書き込みを消してください',
        ...(home && home !== i.channelId ? [`-# ⚠ おみくじは <#${home}> でしか引けません。ボタンは <#${home}> に置いてください`] : []),
      ].join('\n'),
    );
  }

  private homeOf(guild: Guild): string | undefined {
    return this.cfg().channels.omikuji ?? guild.channels.cache.find((c) => c.isTextBased() && c.name === 'おみくじ')?.id;
  }

  private async draw(i: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>): Promise<void> {
    const cfg = this.cfg();
    // #おみくじ があれば、そこで引いてもらう（ほかのチャンネルが流れないように）
    const home = this.homeOf(i.guild);
    if (home && i.channelId !== home) {
      await i.reply({ content: `おみくじは <#${home}> で引けます。`, ...EPHEMERAL });
      return;
    }
    const blocked = omikujiVoiceBlock(cfg.economy, i.member);
    if (blocked) {
      await i.reply({ content: blocked, ...EPHEMERAL });
      return;
    }
    const r = await drawOmikuji(this.db, cfg.economy, i.user.id, new Date(), Math.random, { streak: cfg.omikujiStreak, special: cfg.omikujiSpecial, texts: cfg.omikujiTexts });
    if (r.status === 'already') {
      const streak = r.streak ? `（🔥 連続 ${r.streak} 日目）` : '';
      await i.reply({ content: `今日はもう引きました（${r.fortune.name}）${streak}。日本時間の 0 時にまた引けます。`, ...EPHEMERAL });
      return;
    }
    await revealOmikuji(this.db, cfg, r, i.member.displayName, (p) => i.reply(p), { memberId: i.user.id, streak: true });
    await announceSpecial(this.db, i.guild, cfg, i.user.id, r.fortune);
    // おまけの称号ロール（もう持っていれば何もしない）
    for (const b of r.bonus) {
      if (!b.roleId || i.member.roles.cache.has(b.roleId)) continue;
      await i.member.roles.add(b.roleId, `おみくじ ${b.days} 日続いたおまけ`).catch((err) => logger.warn({ err, roleId: b.roleId }, 'omikuji streak role failed'));
    }
  }
}

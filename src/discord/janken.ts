import { randomBytes } from 'node:crypto';
import { ButtonStyle, MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * ✊✌✋ /じゃんけん: 同じ通話（VC）にいる人が手を選んで参加し、始めた人が「せーの！」を押すと、全員の手を一気に出す。
 * 銭は賭けない。手は押した本人にしか見えず、出るまで秘密。結果はチャンネルに出す。
 * 遊んでいる最中の回は BOT の中だけに覚える（BOT が再起動したら、その回は終わり）。
 */
export const HANDS = { rock: { emoji: '✊', name: 'グー' }, scissors: { emoji: '✌️', name: 'チョキ' }, paper: { emoji: '✋', name: 'パー' } } as const;
export type Hand = keyof typeof HANDS;
const BEATS: Record<Hand, Hand> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const isHand = (v: unknown): v is Hand => typeof v === 'string' && Object.hasOwn(HANDS, v);

/** 何分たったら、その回をやめるか */
const EXPIRE_MS = 15 * 60_000;
/** 1 回に参加できる人数 */
export const JANKEN_MAX = 25;

export type JankenGame = { id: string; hostId: string; voiceChannelId: string; hands: Map<string, Hand>; createdAt: number; done: boolean };

/** 勝ち負けを決める（全員同じ・3 種類ぜんぶ出たら、あいこ） */
export function judgeJanken(hands: ReadonlyMap<string, Hand>): { draw: true } | { draw: false; winners: string[]; winningHand: Hand } {
  const kinds = new Set(hands.values());
  if (kinds.size !== 2) return { draw: true };
  const [a, b] = [...kinds] as [Hand, Hand];
  const winningHand = BEATS[a] === b ? a : b;
  return { draw: false, winningHand, winners: [...hands].filter(([, h]) => h === winningHand).map(([id]) => id) };
}

const btn = (custom_id: string, label: string, style: ButtonStyle, disabled = false) => ({ type: 2, style, custom_id, label, disabled });

/** 受付中のメッセージ（参加した人の名前だけ。手はひみつ） */
export function jankenOpenBody(g: JankenGame) {
  const ids = [...g.hands.keys()];
  return {
    content: [
      `✊✌️✋ **じゃんけん**（<#${g.voiceChannelId}> にいる人が参加できます）`,
      '手を選ぶと参加します（何回でも選び直せます。出るまでひみつ）。',
      ids.length ? `参加 ${ids.length} 人: ${ids.map((id) => `<@${id}>`).join(' ')}` : 'まだだれも参加していません。',
      `-# <@${g.hostId}> さんが「せーの！」を押すと、全員の手が一気に出ます（2 人から）。`,
    ].join('\n'),
    components: [
      { type: 1, components: (Object.keys(HANDS) as Hand[]).map((h) => btn(`janken:pick:${g.id}:${h}`, `${HANDS[h].emoji} ${HANDS[h].name}`, ButtonStyle.Secondary)) },
      { type: 1, components: [btn(`janken:start:${g.id}`, '📣 せーの！', ButtonStyle.Primary, ids.length < 2), btn(`janken:cancel:${g.id}`, 'やめる', ButtonStyle.Danger)] },
    ],
    allowedMentions: { parse: [] as never[] },
  };
}

/** 結果のメッセージ（全員の手を一気に出す） */
export function jankenResultBody(g: JankenGame) {
  const r = judgeJanken(g.hands);
  const lines = [...g.hands].map(([id, h]) => `${HANDS[h].emoji} <@${id}>${!r.draw && r.winners.includes(id) ? ' 🏆' : ''}`);
  const head = r.draw ? '🤝 **あいこ！** もう一回どうぞ。' : `🎉 **${HANDS[r.winningHand].emoji} ${HANDS[r.winningHand].name}の勝ち！**　${r.winners.map((id) => `<@${id}>`).join(' ')}`;
  return {
    content: ['✊✌️✋ **じゃんけん ― せーの！**', '', ...lines, '', head].join('\n'),
    components: [{ type: 1, components: [btn(`janken:again:${g.id}`, '🔁 もう一回', ButtonStyle.Primary)] }],
    allowedMentions: { parse: [] as never[] },
  };
}

export class JankenApp {
  private readonly games = new Map<string, JankenGame>();
  constructor(private readonly cfg: () => GuildConfig, private readonly now: () => number = Date.now) {}

  private sweep() {
    for (const [id, g] of this.games) if (this.now() - g.createdAt > EXPIRE_MS) this.games.delete(id);
  }

  private newGame(hostId: string, voiceChannelId: string): JankenGame {
    this.sweep();
    const g: JankenGame = { id: randomBytes(6).toString('hex'), hostId, voiceChannelId, hands: new Map(), createdAt: this.now(), done: false };
    this.games.set(g.id, g);
    return g;
  }

  async onInteraction(i: Interaction): Promise<void> {
    if (!i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    try {
      if (typeof i.isChatInputCommand === 'function' && i.isChatInputCommand() && i.commandName === 'janken') return await this.start(i);
      if (typeof i.isButton === 'function' && i.isButton() && i.customId.startsWith('janken:')) return await this.button(i);
    } catch (err) {
      logger.warn({ err }, 'janken failed');
      if (i.isRepliable() && !i.replied && !i.deferred) await i.reply({ content: 'じゃんけんを進められませんでした。もう一度 /じゃんけん してください。', flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }

  /** /じゃんけん: 自分がいる通話の人で始める */
  private async start(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const vc = i.member.voice.channelId;
    if (!vc) return void (await i.reply({ content: '通話（VC）に入ってから /じゃんけん してください。その通話にいる人が参加できます。', flags: MessageFlags.Ephemeral }));
    if (!i.channel?.isSendable()) return void (await i.reply({ content: 'このチャンネルには出せません。通話のチャットで使ってください。', flags: MessageFlags.Ephemeral }));
    const g = this.newGame(i.user.id, vc);
    await i.reply(jankenOpenBody(g) as never);
  }

  private async button(i: ButtonInteraction<'cached'>): Promise<void> {
    const [, action, id, hand] = i.customId.split(':');
    const g = id ? this.games.get(id) : undefined;
    if (!g || g.done || this.now() - g.createdAt > EXPIRE_MS) {
      if (action === 'again' && g) return await this.again(i, g);
      return void (await i.reply({ content: 'このじゃんけんは終わりました。もう一度 /じゃんけん してください。', flags: MessageFlags.Ephemeral }));
    }
    if (action === 'pick') {
      if (!isHand(hand)) return;
      if (i.member.voice.channelId !== g.voiceChannelId) return void (await i.reply({ content: `<#${g.voiceChannelId}> にいる人だけが参加できます。`, flags: MessageFlags.Ephemeral }));
      if (!g.hands.has(i.user.id) && g.hands.size >= JANKEN_MAX) return void (await i.reply({ content: `参加できるのは ${JANKEN_MAX} 人までです。`, flags: MessageFlags.Ephemeral }));
      const first = !g.hands.has(i.user.id);
      g.hands.set(i.user.id, hand);
      // 手は本人にだけ。みんなに見えるメッセージは、参加した人の名前だけ書きかえる
      await i.update(jankenOpenBody(g) as never);
      await i.followUp({ content: `${HANDS[hand].emoji} ${HANDS[hand].name}${first ? 'を出しました' : 'に選び直しました'}（出るまでひみつ）。`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === 'start' || action === 'cancel') {
      if (i.user.id !== g.hostId) return void (await i.reply({ content: `始めた <@${g.hostId}> さんだけが押せます。`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }));
      if (action === 'cancel') {
        g.done = true;
        this.games.delete(g.id);
        return void (await i.update({ content: '✊✌️✋ じゃんけんをやめました。', components: [], allowedMentions: { parse: [] } }));
      }
      if (g.hands.size < 2) return void (await i.reply({ content: '2 人以上が手を選んでから押してください。', flags: MessageFlags.Ephemeral }));
      g.done = true;
      await i.update(jankenResultBody(g) as never);
      return;
    }
    if (action === 'again') return await this.again(i, g);
  }

  /** 🔁 もう一回: 押した人が、自分のいる通話で新しく始める */
  private async again(i: ButtonInteraction<'cached'>, _prev: JankenGame): Promise<void> {
    const vc = i.member.voice.channelId;
    if (!vc) return void (await i.reply({ content: '通話（VC）に入ってから押してください。', flags: MessageFlags.Ephemeral }));
    const g = this.newGame(i.user.id, vc);
    await i.reply(jankenOpenBody(g) as never);
  }
}

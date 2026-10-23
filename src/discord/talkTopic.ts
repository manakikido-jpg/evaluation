import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type Interaction } from 'discord.js';
import { logger } from '../lib/logger.js';

/** 答えたくない話題は飛ばしてよい、気軽なお題。 */
export const TALK_TOPICS = [
  '最近、ちょっとうれしかったことは？', '好きな食べ物をひとつ教えて！',
  '明日が丸一日お休みだったら何をする？', '最近よく聴いている曲は？',
  'おすすめの映画・アニメ・ドラマは？', '行ってみたい場所はどこ？',
  '子どものころ好きだった遊びは？', '好きな季節と、その理由は？',
  'コンビニでつい買ってしまうものは？', '一度やってみたい趣味は？',
  '最近笑ったことは？', '朝ごはんはパン派？ ごはん派？',
  '一日だけ動物になれるなら何になる？', '好きなゲームの楽しさを教えて！',
  '自分だけの小さなこだわりは？', '雨の日は何をして過ごしたい？',
  '旅行にひとつだけ持っていくなら何？', '今、食べたいおやつは？',
  '好きな香りや、落ち着く音は？', '最近「便利だな」と思ったものは？',
  'もし空を飛べたら、どこへ行く？', '理想の休日の過ごし方は？',
  'もう一度食べたい思い出の料理は？', '得意になってみたいことは？',
  '犬・猫・そのほか、好きな動物は？', '夏祭りで最初に寄る屋台は？',
  '好きな飲み物と、飲みたい場面は？', '部屋にひとつ増やすなら何？',
  '最近見つけたおすすめを教えて！', 'このサーバーでやってみたい遊びは？',
] as const;

export function drawTalkTopic(previous?: number, random = Math.random): number {
  const candidates = TALK_TOPICS.map((_, index) => index).filter((index) => index !== previous);
  return candidates[Math.floor(random() * candidates.length)]!;
}

export function talkTopicView(index: number) {
  return {
    embeds: [{ title: '🌸 トークテーマガチャ', description: TALK_TOPICS[index], color: 0xf1a7bd,
      footer: { text: '無料で何度でも • 答えにくいお題は飛ばしてOK' } }],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
      .setCustomId(`talktopic:draw:${index}`).setLabel('もう一回').setStyle(ButtonStyle.Primary))],
    allowedMentions: { parse: [] as never[] },
  };
}

/** 公開のお題は、その場のだれでも引き直せる。同じ投稿を更新する。 */
export async function onTalkTopicInteraction(i: Interaction, guildId: string): Promise<void> {
  if (!i.inCachedGuild() || i.guildId !== guildId) return;
  const command = i.isChatInputCommand() && i.commandName === 'talktopic';
  const match = i.isButton() ? /^talktopic:draw:(\d+)$/.exec(i.customId) : null;
  if (!command && !match) return;
  try {
    if (command && i.isChatInputCommand()) {
      await i.reply(talkTopicView(drawTalkTopic()));
    } else if (match && i.isButton()) {
      await i.update(talkTopicView(drawTalkTopic(Number(match[1]))));
    }
  } catch (err) {
    logger.warn({ err }, 'talk topic failed');
    if (i.isRepliable() && !i.replied && !i.deferred) {
      await i.reply({ content: 'お題を出せませんでした。少し待ってからもう一度お試しください。',
        flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => undefined);
    }
  }
}

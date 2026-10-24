import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder, type Interaction } from 'discord.js';
import { logger } from '../lib/logger.js';
import { TOPIC_CATEGORIES, isTopicCategory, type TopicCategory } from '../domain/talkTopics.js';
import { nextTopicDraw, startTopicDraw, topicIndex, type TopicDraw } from '../domain/talkTopicDraw.js';

const NO_PINGS = { parse: [] as never[] };
export function availableTopicCategories(adultAllowed: boolean): TopicCategory[] {
  return (Object.keys(TOPIC_CATEGORIES) as TopicCategory[]).filter(key => adultAllowed || !TOPIC_CATEGORIES[key].adult);
}
export function talkTopicView(adultAllowed: boolean, draw?: TopicDraw) {
  const category = draw ? TOPIC_CATEGORIES[draw.category] : undefined;
  const menu = new StringSelectMenuBuilder().setCustomId('talktopic:category')
    .setPlaceholder('話したいジャンルを選んでね').addOptions(availableTopicCategories(adultAllowed).map(key => ({
      label: TOPIC_CATEGORIES[key].label, value: key, emoji: TOPIC_CATEGORIES[key].emoji,
      description: `${TOPIC_CATEGORIES[key].topics.length}種類のお題・無料`, default: draw?.category === key,
    })));
  const components: (ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>)[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
  ];
  if (draw) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
    .setCustomId(`talktopic:draw:${draw.category}:${draw.seed.toString(36)}:${draw.step}`)
    .setLabel('もう一回').setStyle(ButtonStyle.Primary)));
  return {
    embeds: [{ title: category ? `${category.emoji} トークテーマガチャ｜${category.label}` : '🌸 トークテーマガチャ',
      description: draw ? TOPIC_CATEGORIES[draw.category].topics[topicIndex(draw)] : 'ジャンルを選ぶとお題が出ます。場の雰囲気に合わせて選んでね。',
      color: 0xf1a7bd, footer: { text: draw
        ? `無料で何度でも • この一巡 ${draw.step + 1}/${category!.topics.length} • 答えにくいお題は飛ばしてOK`
        : '無料で何度でも • ジャンルは途中でも変更できます' } }],
    components, allowedMentions: NO_PINGS,
  };
}

function parseDraw(id: string): TopicDraw | undefined {
  const match = /^talktopic:draw:([a-z]+):([0-9a-z]{1,7}):(\d{1,3})$/.exec(id);
  if (!match || !isTopicCategory(match[1]!)) return;
  const category = match[1]!;
  const seed = parseInt(match[2]!, 36), step = Number(match[3]);
  if (seed > 0xffffffff || step >= TOPIC_CATEGORIES[category].topics.length) return;
  return { category, seed, step };
}

/** チャンネル名・親の名前に「縁側」がある場所は対象外。変更も毎回取得する。 */
export const isEngawaName = (name: string): boolean => name.normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]/g, '').includes('縁側');
async function allowsAdult(i: Interaction<'cached'>): Promise<boolean> {
  let id: string | null = i.channelId;
  const visited = new Set<string>();
  while (id) {
    if (visited.has(id)) return false;
    visited.add(id);
    const channel = await i.guild.channels.fetch(id, { force: true });
    if (!channel || isEngawaName(channel.name)) return false;
    id = channel.parentId;
  }
  return true;
}

/** 公開のお題は、その場のだれでも選択・引き直しできる。同じ投稿を更新する。 */
export async function onTalkTopicInteraction(i: Interaction, guildId: string): Promise<void> {
  if (!i.inCachedGuild() || i.guildId !== guildId) return;
  const command = i.isChatInputCommand() && i.commandName === 'talktopic';
  const select = i.isStringSelectMenu() && i.customId === 'talktopic:category';
  const button = i.isButton() ? parseDraw(i.customId) : undefined;
  // 旧版の30題のボタンも、生活ジャンルへ移行できる。
  const legacy = i.isButton() && /^talktopic:draw:\d+$/.test(i.customId);
  if (!command && !select && !button && !legacy) return;
  if (!i.isChatInputCommand() && !i.isStringSelectMenu() && !i.isButton()) return;
  try {
    if (i.isChatInputCommand()) await i.deferReply();
    else await i.deferUpdate();
    const adultAllowed = await allowsAdult(i);
    let draw: TopicDraw | undefined;
    if (select && i.isStringSelectMenu()) {
      const category = i.values[0] ?? '';
      if (!isTopicCategory(category)) {
        await i.followUp({ content: 'ジャンルを選び直してください。', flags: MessageFlags.Ephemeral, allowedMentions: NO_PINGS });
        return;
      }
      // 同じジャンルを選び直して、今のお題をすぐに再抽選しない。
      let current: TopicDraw | undefined;
      for (const row of i.message.components) {
        if (!('components' in row)) continue;
        for (const component of row.components) {
          if ('customId' in component && typeof component.customId === 'string') {
            current = parseDraw(component.customId) ?? current;
          }
        }
      }
      draw = current?.category === category ? nextTopicDraw(current) : startTopicDraw(category);
    } else if (button) draw = nextTopicDraw(button);
    else if (legacy) draw = startTopicDraw('life');
    if (draw && TOPIC_CATEGORIES[draw.category].adult && !adultAllowed) {
      await i.followUp({ content: '縁側ではHなテーマは使えません。別のジャンルを選んでください。',
        flags: MessageFlags.Ephemeral, allowedMentions: NO_PINGS });
      return;
    }
    await i.editReply(talkTopicView(adultAllowed, draw));
  } catch (err) {
    logger.warn({ err }, 'talk topic failed');
    const content = 'お題を出せませんでした。少し待ってからもう一度お試しください。';
    if (i.deferred || i.replied) {
      if (command) await i.editReply({ content, embeds: [], components: [], allowedMentions: NO_PINGS }).catch(() => undefined);
      else await i.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: NO_PINGS }).catch(() => undefined);
    } else await i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: NO_PINGS }).catch(() => undefined);
  }
}

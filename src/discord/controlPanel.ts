import { ButtonBuilder, ButtonStyle, ContainerBuilder, SectionBuilder, SeparatorBuilder, TextDisplayBuilder, MessageFlags, type ButtonInteraction } from 'discord.js';
import { isMusubiMode, isNewSystemVisible } from '../domain/terms.js';
import { isEngawaName } from '../services/voiceUsage.js';

export type ControlAction = 'open' | 'profile' | 'send' | 'musubi' | 'ema' | 'help' | 'sleep' | 'call';
const actions: readonly string[] = ['open', 'profile', 'send', 'musubi', 'ema', 'help', 'sleep', 'call'];
export const controlId = (action: ControlAction, channelId: string, ownerId?: string) => `control:${action}:${channelId}${ownerId ? `:${ownerId}` : ''}`;
export function parseControlId(id: string) {
  const parts = id.split(':');
  const [prefix, action, channelId, ownerId] = parts;
  if (prefix !== 'control' || !actions.includes(action ?? '') || !/^\d{17,20}$/.test(channelId ?? '')) return undefined;
  if (action === 'open' ? parts.length !== 3 : parts.length !== 4 || !/^\d{17,20}$/.test(ownerId ?? '')) return undefined;
  return { action: action as ControlAction, channelId: channelId!, ownerId };
}

/** 共有の入口は通話だけを指す。個人パネルの操作は本人と現在の縁側を確認する。 */
export function controlAccess(i: ButtonInteraction<'cached'>, p: NonNullable<ReturnType<typeof parseControlId>>): string | undefined {
  if (p.ownerId && p.ownerId !== i.user.id) return 'この操作パネルは、開いた本人だけが使えます。';
  const channel = i.member.voice.channel;
  if (!channel || channel.id !== p.channelId || !isEngawaName(channel.name)) return 'この縁側に入ってから、「操作パネルを開く」を押してください。';
  return undefined;
}

export function controlPanel(channelId: string, ownerId: string) {
  const container = new ContainerBuilder().setAccentColor(0xf7a8b8)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## ⛩ 咲楽ノ宮\n下のボタンから操作できます。'));
  const line = (action: ControlAction, text: string, label: string, style = ButtonStyle.Secondary) => {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
      .setButtonAccessory(new ButtonBuilder().setCustomId(controlId(action, channelId, ownerId)).setLabel(label).setStyle(style)));
  };
  line('profile', '同じ通話の人を確認', 'プロフィール');
  line('send', '選んだ相手に送金', '送金', ButtonStyle.Primary);
  if (isNewSystemVisible() && isMusubiMode()) line('musubi', '初めましての人と結ぶ', 'ご縁を結ぶ');
  if (isNewSystemVisible()) line('ema', '相手に絵馬をおくる', '絵馬をおくる', ButtonStyle.Success);
  line('help', '使えるコマンドを見る', '一覧');
  line('sleep', '寝落ちしている人を報告', '寝落ち報告');
  line('call', '困ったときに運営へ連絡', '運営を呼ぶ');
  return { components: [container], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 };
}

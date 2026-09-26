import { MessageFlags, type ButtonInteraction, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export type OmamoriToggle =
  | { status: 'added' | 'removed'; label: string }
  | { status: 'adult_only' | 'unknown' };

/**
 * お守りを授かる・返す（ロールの付け外しは呼び出し側）。
 * 宵宮のお守りは宵参りの人だけ。返すのはいつでもできる。
 */
export function decideOmamori(cfg: GuildConfig, roleId: string, memberRoleIds: readonly string[]): OmamoriToggle {
  const o = cfg.roles.omamori.find((x) => x.roleId === roleId);
  if (!o) return { status: 'unknown' };
  if (memberRoleIds.includes(roleId)) return { status: 'removed', label: `${o.emoji} ${o.label}のお守り`.trim() };
  if (o.adultOnly && !(cfg.roles.yoimairi && memberRoleIds.includes(cfg.roles.yoimairi))) return { status: 'adult_only' };
  return { status: 'added', label: `${o.emoji} ${o.label}のお守り`.trim() };
}

/** #授与所 のお守りボタン */
export class OmamoriApp {
  constructor(private readonly cfg: () => GuildConfig) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.customId.startsWith('omamori:')) return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      await this.toggle(interaction);
    } catch (err) {
      logger.error({ err }, 'omamori failed');
      await interaction.reply({ content: 'お守りを授けられませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL }).catch(() => undefined);
    }
  }

  private async toggle(i: ButtonInteraction<'cached'>): Promise<void> {
    const roleId = i.customId.slice('omamori:'.length);
    const r = decideOmamori(this.cfg(), roleId, [...i.member.roles.cache.keys()]);
    switch (r.status) {
      case 'unknown':
        return void (await i.reply({ content: 'このお守りは今は授けていません。', ...EPHEMERAL }));
      case 'adult_only':
        return void (await i.reply({ content: 'このお守りは、宵参り（18 歳以上）の方だけが授かれます。', ...EPHEMERAL }));
      case 'added':
        await i.member.roles.add(roleId, 'お守りを授かった');
        return void (await i.reply({ content: `${r.label}を授かりました。この募集の通知が届きます（もう一度押すと返せます）。`, ...EPHEMERAL }));
      case 'removed':
        await i.member.roles.remove(roleId, 'お守りを返した');
        return void (await i.reply({ content: `${r.label}を返しました。`, ...EPHEMERAL }));
    }
  }
}

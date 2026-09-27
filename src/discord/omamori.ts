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

/** 本人にだけ見える「あなたのお守り」（授かっているものは ✅ の緑。押すと授かる・返す） */
export function myOmamoriPanel(cfg: GuildConfig, roleIds: readonly string[], note?: string) {
  const items = cfg.roles.omamori;
  const adult = Boolean(cfg.roles.yoimairi && roleIds.includes(cfg.roles.yoimairi));
  const has = (id: string) => roleIds.includes(id);
  const lines = items.map((o) => `${has(o.roleId) ? '✅' : '⬜'} ${o.emoji} **${o.label}のお守り** … ${o.description}${o.adultOnly && !adult ? '（宵参りの方だけ）' : ''}`);
  const rows: { type: 1; components: { type: 2; style: 2 | 3; label: string; custom_id: string; emoji?: { name: string }; disabled?: boolean }[] }[] = [];
  for (let i = 0; i < items.length; i += 5) {
    rows.push({
      type: 1,
      components: items.slice(i, i + 5).map((o) => ({
        type: 2 as const,
        style: has(o.roleId) ? (3 as const) : (2 as const),
        label: `${o.label}${has(o.roleId) ? '（授かっている）' : ''}`,
        custom_id: `omamori:me:${o.roleId}`,
        ...(o.emoji ? { emoji: { name: o.emoji } } : {}),
        ...(o.adultOnly && !adult && !has(o.roleId) ? { disabled: true } : {}),
      })),
    });
  }
  const count = items.filter((o) => has(o.roleId)).length;
  return {
    embeds: [
      {
        title: '🧧 あなたのお守り',
        description: [
          ...(note ? [note, ''] : []),
          ...lines,
          '',
          `-# 授かっているお守り: ${count} 個。緑のボタンが授かっているもの。押すと授かる・返すを切り替えます`,
        ].join('\n'),
        color: 0xd7003a,
      },
    ],
    components: rows,
  };
}

/** #授与所 のお守りボタン */
export class OmamoriApp {
  constructor(private readonly cfg: () => GuildConfig) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.customId.startsWith('omamori:')) return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      const id = interaction.customId;
      if (id === 'omamori:mine') return void (await interaction.reply({ ...myOmamoriPanel(this.cfg(), [...interaction.member.roles.cache.keys()]), ...EPHEMERAL }));
      // 「あなたのお守り」の中のボタン: その場で書き換える
      if (id.startsWith('omamori:me:')) return await this.toggle(interaction, id.slice('omamori:me:'.length), true);
      // #授与所 のボタン: 「あなたのお守り」を出す
      return await this.toggle(interaction, id.slice('omamori:'.length), false);
    } catch (err) {
      logger.error({ err }, 'omamori failed');
      const msg = 'お守りを授けられませんでした。時間をおいてもう一度お試しください。';
      await (interaction.deferred || interaction.replied ? interaction.followUp({ content: msg, ...EPHEMERAL }) : interaction.reply({ content: msg, ...EPHEMERAL })).catch(() => undefined);
    }
  }

  private async toggle(i: ButtonInteraction<'cached'>, roleId: string, inPanel: boolean): Promise<void> {
    const cfg = this.cfg();
    let roles = [...i.member.roles.cache.keys()];
    const r = decideOmamori(cfg, roleId, roles);
    let note: string;
    // ロールの付け外しが混んで 3 秒を超えても失敗にならないよう、先に受け付ける
    if (inPanel) await i.deferUpdate();
    else await i.deferReply(EPHEMERAL);
    switch (r.status) {
      case 'unknown':
        note = '⚠️ このお守りは今は授けていません。';
        break;
      case 'adult_only':
        note = '⚠️ このお守りは、宵参り（18 歳以上）の方だけが授かれます。';
        break;
      case 'added':
        await i.member.roles.add(roleId, 'お守りを授かった');
        roles = [...roles, roleId];
        note = `🧧 **${r.label}**を授かりました。この募集の通知が届きます。`;
        break;
      case 'removed':
        await i.member.roles.remove(roleId, 'お守りを返した');
        roles = roles.filter((x) => x !== roleId);
        note = `↩️ **${r.label}**を返しました。`;
        break;
    }
    await i.editReply(myOmamoriPanel(cfg, roles, note));
  }
}

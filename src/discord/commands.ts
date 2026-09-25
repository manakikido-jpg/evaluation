import {
  ApplicationCommandType,
  PermissionFlagsBits,
  ContextMenuCommandBuilder,
  InteractionContextType,
  SlashCommandBuilder,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import type { GuildConfig } from '../config.js';
import { COMMAND } from './ids.js';

const choices = (list: string[]) => list.slice(0, 25).map((r) => ({ name: r.slice(0, 100), value: r.slice(0, 100) }));

/** サーバーに登録するコマンド一覧 */
export function commandDefinitions(cfg?: GuildConfig): RESTPostAPIApplicationCommandsJSONBody[] {
  const yakuReasons = [...(cfg?.moderation.yakuReasons ?? []), 'その他'];
  const banReasons = cfg?.moderation.instantBanReasons ?? ['その他'];
  // 神職用: 「メンバーをタイムアウト」の権限がある人にだけ表示（使えるかどうかは BOT がロールで確認する）
  const staff = PermissionFlagsBits.ModerateMembers;
  return [
    // 右クリック（スマホは長押し）→ アプリ
    new ContextMenuCommandBuilder()
      .setName(COMMAND.giveMenu)
      .setType(ApplicationCommandType.User)
      .setContexts(InteractionContextType.Guild)
      .toJSON(),
    new ContextMenuCommandBuilder()
      .setName(COMMAND.cardMenu)
      .setType(ApplicationCommandType.User)
      .setContexts(InteractionContextType.Guild)
      .toJSON(),
    new SlashCommandBuilder()
      .setName(COMMAND.goshuin)
      .setNameLocalizations({ ja: '御朱印帳' })
      .setDescription('Show a goshuincho (shuin, goen and rank)')
      .setDescriptionLocalizations({ ja: '御朱印帳（ご縁・役職・頂いた朱印）を見る' })
      .setContexts(InteractionContextType.Guild)
      .addUserOption((o) =>
        o
          .setName('user')
          .setNameLocalizations({ ja: '相手' })
          .setDescription('Whose goshuincho (default: yourself)')
          .setDescriptionLocalizations({ ja: '誰の御朱印帳を見るか（省略すると自分）' }),
      )
      .addBooleanOption((o) =>
        o
          .setName('public')
          .setNameLocalizations({ ja: '公開' })
          .setDescription('Post it so everyone can see')
          .setDescriptionLocalizations({ ja: 'チャンネルのみんなに見せる（省略すると自分だけ）' }),
      )
      .toJSON(),

    // ───── 全員用 ─────
    new SlashCommandBuilder()
      .setName('menzaifu')
      .setNameLocalizations({ ja: '免罪符' })
      .setDescription('Buy a menzaifu to clear a yaku')
      .setDescriptionLocalizations({ ja: '免罪符を購入して厄を祓う（厄と花びらの確認もできる）' })
      .setContexts(InteractionContextType.Guild)
      .toJSON(),

    // ───── 神職用 ─────
    new SlashCommandBuilder()
      .setName('yaku')
      .setNameLocalizations({ ja: '厄' })
      .setDescription('Yaku (warnings)')
      .setDescriptionLocalizations({ ja: '厄（警告）を付ける・取り消す・一覧【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addSubcommand((s) =>
        s
          .setName('add')
          .setNameLocalizations({ ja: '付ける' })
          .setDescription('Give a yaku (2nd = ban)')
          .setDescriptionLocalizations({ ja: '厄を付ける（1 つ目は注意、2 つ目で BAN）' })
          .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
          .addStringOption((o) =>
            o.setName('reason').setNameLocalizations({ ja: '理由' }).setDescription('reason').setRequired(true).addChoices(...choices(yakuReasons)),
          )
          .addStringOption((o) => o.setName('note').setNameLocalizations({ ja: '補足' }).setDescription('note').setMaxLength(300)),
      )
      .addSubcommand((s) =>
        s
          .setName('clear')
          .setNameLocalizations({ ja: '取り消す' })
          .setDescription('Clear the latest yaku')
          .setDescriptionLocalizations({ ja: '間違えて付けた厄を取り消す' })
          .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
          .addStringOption((o) => o.setName('note').setNameLocalizations({ ja: '理由' }).setDescription('why').setRequired(true).setMaxLength(300)),
      )
      .addSubcommand((s) =>
        s.setName('list').setNameLocalizations({ ja: '一覧' }).setDescription('List members with yaku').setDescriptionLocalizations({ ja: '厄が付いている人の一覧' }),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ban')
      .setNameLocalizations({ ja: '一発ban' })
      .setDescription('Instant ban for serious violations')
      .setDescriptionLocalizations({ ja: '重大な違反で一発 BAN【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
      .addStringOption((o) =>
        o.setName('reason').setNameLocalizations({ ja: '理由' }).setDescription('reason').setRequired(true).addChoices(...choices(banReasons)),
      )
      .addStringOption((o) => o.setName('note').setNameLocalizations({ ja: '補足' }).setDescription('note').setMaxLength(300))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('kick')
      .setNameLocalizations({ ja: 'キック' })
      .setDescription('Kick a member')
      .setDescriptionLocalizations({ ja: 'キックする【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
      .addStringOption((o) => o.setName('reason').setNameLocalizations({ ja: '理由' }).setDescription('reason').setRequired(true).setMaxLength(300))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('memo')
      .setNameLocalizations({ ja: 'メモ' })
      .setDescription('Write a staff memo')
      .setDescriptionLocalizations({ ja: '申し送りメモを書く（本人には見えない）【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
      .addStringOption((o) => o.setName('body').setNameLocalizations({ ja: '内容' }).setDescription('memo').setRequired(true).setMaxLength(1000))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('member')
      .setNameLocalizations({ ja: 'メンバー' })
      .setDescription('Show member status')
      .setDescriptionLocalizations({ ja: 'メンバーの状況を見る【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
      .toJSON(),
  ];
}

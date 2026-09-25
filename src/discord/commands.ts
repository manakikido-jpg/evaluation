import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  SlashCommandBuilder,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import { COMMAND } from './ids.js';

/** サーバーに登録するコマンド一覧 */
export function commandDefinitions(): RESTPostAPIApplicationCommandsJSONBody[] {
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
  ];
}

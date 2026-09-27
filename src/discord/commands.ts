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
      .setName(COMMAND.profileMenu)
      .setType(ApplicationCommandType.User)
      .setContexts(InteractionContextType.Guild)
      .toJSON(),
    new SlashCommandBuilder()
      .setName(COMMAND.goshuin)
      .setNameLocalizations({ ja: '御朱印帳' })
      .setDescription('Show a goshuincho (shuin, goen and rank)')
      .setDescriptionLocalizations({ ja: 'プロフィール（御朱印帳・自己紹介・ご縁）を見る。ここから朱印を押せる' })
      .setContexts(InteractionContextType.Guild)
      .addUserOption((o) =>
        o
          .setName('user')
          .setNameLocalizations({ ja: '相手' })
          .setDescription('Whose goshuincho (default: yourself)')
          .setDescriptionLocalizations({ ja: '誰のプロフィールを見るか（省略すると自分）' }),
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
      .setName('zandaka')
      .setNameLocalizations({ ja: '残高' })
      .setDescription('Check your coins, tickets and recent history')
      .setDescriptionLocalizations({ ja: '自分の銭・券・最近の出入りを見る（自分にだけ表示）' })
      .setContexts(InteractionContextType.Guild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('menzaifu')
      .setNameLocalizations({ ja: '免罪符' })
      .setDescription('Buy a menzaifu to clear a yaku')
      .setDescriptionLocalizations({ ja: '免罪符を購入して厄を祓う（厄と銭の確認もできる）' })
      .setContexts(InteractionContextType.Guild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('omikuji')
      .setNameLocalizations({ ja: 'おみくじ' })
      .setDescription('Draw an omikuji (once a day, with a small reward)')
      .setDescriptionLocalizations({ ja: 'おみくじを引く（1 日 1 回。銭がもらえる）' })
      .setContexts(InteractionContextType.Guild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('gacha')
      .setNameLocalizations({ ja: '物御籤' })
      .setDescription('Draw the prize lottery with petals')
      .setDescriptionLocalizations({ ja: '物御籤を引く（銭で引くくじ。限定の色守り・称号や券が出る）' })
      .setContexts(InteractionContextType.Guild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('bell')
      .setNameLocalizations({ ja: '呼び鈴' })
      .setDescription('Call the staff')
      .setDescriptionLocalizations({ ja: '運営などを呼ぶ（呼ぶロールを選んで、内容を書く）' })
      .setContexts(InteractionContextType.Guild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('invite')
      .setNameLocalizations({ ja: '招待リンク' })
      .setDescription('Get your personal invite link')
      .setDescriptionLocalizations({ ja: '自分専用の招待リンクをもらう（このリンクで入った人は、あなたの招待になる）' })
      .setContexts(InteractionContextType.Guild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('hajimete')
      .setNameLocalizations({ ja: 'はじめて' })
      .setDescription('Getting started checklist')
      .setDescriptionLocalizations({ ja: 'はじめての参拝（やってみること）の進み具合を見る' })
      .setContexts(InteractionContextType.Guild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('soudan')
      .setNameLocalizations({ ja: '相談' })
      .setDescription('Anonymous consultation with staff')
      .setDescriptionLocalizations({ ja: '神職に匿名で相談する（返信は BOT から DM で届く）' })
      .setContexts(InteractionContextType.Guild)
      .addIntegerOption((o) =>
        o
          .setName('number')
          .setNameLocalizations({ ja: '番号' })
          .setDescription('Continue a previous consultation')
          .setDescriptionLocalizations({ ja: '前の相談の続きを送るときは、その番号' })
          .setMinValue(1),
      )
      .toJSON(),

    // ───── 神職用 ─────
    new SlashCommandBuilder()
      .setName('panel')
      .setNameLocalizations({ ja: 'パネル' })
      .setDescription('Post an application panel here')
      .setDescriptionLocalizations({ ja: '申請ボタンをこのチャンネルに置く【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addSubcommand((s) =>
        s.setName('apply').setNameLocalizations({ ja: '入鯖申請' }).setDescription('Join application').setDescriptionLocalizations({ ja: '入鯖申請のボタン（#社務所 用）' }),
      )
      .addSubcommand((s) =>
        s
          .setName('yoimairi')
          .setNameLocalizations({ ja: '宵参り申請' })
          .setDescription('Adult area application')
          .setDescriptionLocalizations({ ja: '宵参り（18 歳以上のエリア）申請のボタン' }),
      )
      .addSubcommand((s) =>
        s.setName('omamori').setNameLocalizations({ ja: 'お守り' }).setDescription('Notification roles').setDescriptionLocalizations({ ja: 'お守り（募集の通知）のボタン（#授与所 用）' }),
      )
      .addSubcommand((s) =>
        s.setName('shop').setNameLocalizations({ ja: '授与品' }).setDescription('Shop').setDescriptionLocalizations({ ja: '授与品（ショップ）のボタン（#授与所 用）' }),
      )
      .addSubcommand((s) =>
        s.setName('market').setNameLocalizations({ ja: '市場' }).setDescription('Market').setDescriptionLocalizations({ ja: '市場の「出品する」ボタン（#市場 用）' }),
      )
      .addSubcommand((s) =>
        s.setName('gender').setNameLocalizations({ ja: '性別' }).setDescription('Gender').setDescriptionLocalizations({ ja: '性別を選ぶボタン（前からいる方向け。#授与所 など）' }),
      )
      .addSubcommand((s) =>
        s.setName('gacha').setNameLocalizations({ ja: '物御籤' }).setDescription('Prize lottery').setDescriptionLocalizations({ ja: '物御籤を引くボタン（#おみくじ・#授与所 用）' }),
      )
      .addSubcommand((s) =>
        s.setName('bell').setNameLocalizations({ ja: '呼び鈴' }).setDescription('Call staff button').setDescriptionLocalizations({ ja: '運営を呼ぶ「🔔 呼び鈴」のボタン' }),
      )
      .addSubcommand((s) =>
        s.setName('contact').setNameLocalizations({ ja: 'dmとフレンド' }).setDescription('DM / friend requests').setDescriptionLocalizations({ ja: 'DM・フレンド追加の OK／要相談／NG を選ぶボタン（#授与所 用）' }),
      )
      .toJSON(),
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

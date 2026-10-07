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
import { DURATIONS, PERM_PRESETS } from '../services/tempGrantPresets.js';

const durationChoices = DURATIONS.map(([value, name]) => ({ name, value }));
const presetChoices = Object.entries(PERM_PRESETS).map(([value, p]) => ({ name: p.label, value }));
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
      .setName('sokin')
      .setNameLocalizations({ ja: '送金' })
      .setDescription('Send coins to someone')
      .setDescriptionLocalizations({ ja: '銭をほかの人に送る（自分にだけ出るパネルで相手・枚数を選ぶ）' })
      .setContexts(InteractionContextType.Guild)
      .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setDescriptionLocalizations({ ja: '送る相手（パネルでも選べる）' }))
      .addIntegerOption((o) => o.setName('amount').setNameLocalizations({ ja: '枚数' }).setDescription('amount').setDescriptionLocalizations({ ja: '何枚送るか（パネルでも選べる）' }).setMinValue(1))
      .addStringOption((o) =>
        o.setName('message').setNameLocalizations({ ja: 'ひとこと' }).setDescription('message').setDescriptionLocalizations({ ja: '相手への DM に添える（例: この前のお礼）' }).setMaxLength(200),
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName('casino')
      .setNameLocalizations({ ja: 'カジノ' })
      .setDescription('Open the casino on the web')
      .setDescriptionLocalizations({ ja: '社務所Web のカジノを開くリンク（自分にだけ表示）' })
      .setContexts(InteractionContextType.Guild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('items')
      .setNameLocalizations({ ja: '持ち物' })
      .setDescription('Your tickets: use or give')
      .setDescriptionLocalizations({ ja: '持っている券を見て、選んで使う・贈る（自分にだけ表示）' })
      .setContexts(InteractionContextType.Guild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('present')
      .setNameLocalizations({ ja: '贈る' })
      .setDescription('Give your tickets to someone')
      .setDescriptionLocalizations({ ja: '持っている券を、ほかの人に贈る（押す前に確かめる）' })
      .setContexts(InteractionContextType.Guild)
      .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setDescriptionLocalizations({ ja: '贈る相手' }).setRequired(true))
      .addStringOption((o) =>
        o.setName('item').setNameLocalizations({ ja: 'もの' }).setDescription('item').setDescriptionLocalizations({ ja: '贈るもの（自分が持っている券から選ぶ）' }).setRequired(true).setAutocomplete(true),
      )
      .addIntegerOption((o) => o.setName('count').setNameLocalizations({ ja: '数' }).setDescription('count').setDescriptionLocalizations({ ja: '何枚贈るか（省略すると 1）' }).setMinValue(1).setMaxValue(100))
      .addStringOption((o) =>
        o.setName('message').setNameLocalizations({ ja: 'ひとこと' }).setDescription('message').setDescriptionLocalizations({ ja: '相手への DM に添える（例: いつもありがとう）' }).setMaxLength(200),
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName('yougo')
      .setNameLocalizations({ ja: '用語' })
      .setDescription('Look up a word used in this server')
      .setDescriptionLocalizations({ ja: '用語集で言葉の意味を調べる（自分にだけ表示）' })
      .setContexts(InteractionContextType.Guild)
      .addStringOption((o) =>
        o
          .setName('word')
          .setNameLocalizations({ ja: '言葉' })
          .setDescription('word')
          .setDescriptionLocalizations({ ja: '調べたい言葉（なければ一覧）' })
          .setMaxLength(40)
          .setAutocomplete(true),
      )
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
      .setName('sharedinvite')
      .setNameLocalizations({ ja: '共通招待リンク' })
      .setDescription('Shared invite links for SNS etc.')
      .setDescriptionLocalizations({ ja: '期限なし・回数なしの共通の招待リンク（SNS・宣伝用。だれの招待にもならない）【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addSubcommand((s) =>
        s
          .setName('make')
          .setNameLocalizations({ ja: '作る' })
          .setDescription('Make')
          .setDescriptionLocalizations({ ja: '共通の招待リンクをもらう（同じ名前なら同じリンク）' })
          .addStringOption((o) =>
            o.setName('label').setNameLocalizations({ ja: '名前' }).setDescription('label').setDescriptionLocalizations({ ja: 'X 用・ポスター用 など（分けると、どこから何人来たか分かる）' }).setMaxLength(40),
          ),
      )
      .addSubcommand((s) => s.setName('list').setNameLocalizations({ ja: '一覧' }).setDescription('List').setDescriptionLocalizations({ ja: '共通の招待リンクと、使われた回数を見る' }))
      .addSubcommand((s) =>
        s
          .setName('delete')
          .setNameLocalizations({ ja: '消す' })
          .setDescription('Delete')
          .setDescriptionLocalizations({ ja: '共通の招待リンクを使えなくする' })
          .addStringOption((o) => o.setName('link').setNameLocalizations({ ja: 'リンク' }).setDescription('link').setDescriptionLocalizations({ ja: 'リンクか名前' }).setRequired(true).setMaxLength(200)),
      )
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

    new SlashCommandBuilder()
      .setName('help')
      .setNameLocalizations({ ja: 'コマンド' })
      .setDescription('List the commands you can use')
      .setDescriptionLocalizations({ ja: '使えるコマンドの一覧を見る（自分にだけ表示）' })
      .setContexts(InteractionContextType.Guild)
      .addBooleanOption((o) =>
        o.setName('public').setNameLocalizations({ ja: '公開' }).setDescription('Post it so everyone can see').setDescriptionLocalizations({ ja: 'チャンネルのみんなに見せる（だれでも使えるコマンドだけ出す）' }),
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
        s.setName('shop').setNameLocalizations({ ja: '授与品' }).setDescription('Shop').setDescriptionLocalizations({ ja: '授与品（ショップ）のボタン（#授与所 用）' }),
      )
      .addSubcommand((s) =>
        s.setName('market').setNameLocalizations({ ja: '市場' }).setDescription('Market').setDescriptionLocalizations({ ja: '市場の「出品する」ボタン（#市場 用）' }),
      )
      .addSubcommand((s) =>
        s.setName('gender').setNameLocalizations({ ja: '性別' }).setDescription('Gender').setDescriptionLocalizations({ ja: '性別を選ぶボタン（前からいる方向け。#授与所 など）' }),
      )
      .addSubcommand((s) =>
        s.setName('gacha').setNameLocalizations({ ja: '物御籤' }).setDescription('Prize lottery').setDescriptionLocalizations({ ja: '物御籤売り場へ入るボタン（#おみくじ・#授与所 用）' }),
      )
      .addSubcommand((s) =>
        s
          .setName('omikuji')
          .setNameLocalizations({ ja: 'おみくじ' })
          .setDescription('Omikuji button')
          .setDescriptionLocalizations({ ja: '「⛩ 御神籤を引く」ボタンだけを、このチャンネルのいちばん下に出し続ける（#おみくじ 用）' }),
      )
      .addSubcommand((s) =>
        s.setName('bell').setNameLocalizations({ ja: '呼び鈴' }).setDescription('Call staff button').setDescriptionLocalizations({ ja: '運営を呼ぶ「🔔 呼び鈴」のボタン' }),
      )
      .addSubcommand((s) =>
        s
          .setName('shuin')
          .setNameLocalizations({ ja: '朱印' })
          .setDescription('Give-shuin button')
          .setDescriptionLocalizations({ ja: '「🌸 朱印を押す」ボタンを、このチャンネルのいちばん下に出し続ける（#絵馬 など）' }),
      )
      .addSubcommand((s) =>
        s.setName('notify').setNameLocalizations({ ja: '通知' }).setDescription('Notification on/off').setDescriptionLocalizations({ ja: '募集・お知らせの 🔔通知OK／🔕通知NG を選ぶボタン（#授与所 用）' }),
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
      .setName('gift')
      .setNameLocalizations({ ja: '配る' })
      .setDescription('Give something to everyone')
      .setDescriptionLocalizations({ ja: 'みんなに銭・券・授与品を配る（押す前に確かめる）【宮司】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addStringOption((o) =>
        o.setName('item').setNameLocalizations({ ja: 'もの' }).setDescription('item').setDescriptionLocalizations({ ja: '配るもの（候補から選ぶ）' }).setRequired(true).setAutocomplete(true),
      )
      .addStringOption((o) =>
        o.setName('reason').setNameLocalizations({ ja: '理由' }).setDescription('reason').setDescriptionLocalizations({ ja: '記録とお知らせに載る（例: 1 周年のお祝い）' }).setRequired(true).setMaxLength(200),
      )
      .addIntegerOption((o) =>
        o.setName('count').setNameLocalizations({ ja: '数' }).setDescription('count').setDescriptionLocalizations({ ja: '1 人あたりの数（省略すると 1）' }).setMinValue(1).setMaxValue(100000),
      )
      .addRoleOption((o) => o.setName('role').setNameLocalizations({ ja: 'ロール' }).setDescription('role').setDescriptionLocalizations({ ja: 'このロールを持っている人だけに配る' }))
      .addBooleanOption((o) =>
        o.setName('announce').setNameLocalizations({ ja: 'お知らせ' }).setDescription('announce').setDescriptionLocalizations({ ja: 'このチャンネルでお知らせする（省略すると する）' }),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('roomadmin')
      .setNameLocalizations({ ja: '部屋の設定' })
      .setDescription('Open any room settings (staff)')
      .setDescriptionLocalizations({ ja: 'だれの部屋でも設定を開く（シークレット・ツーショットなど見えない部屋も）【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addStringOption((o) =>
        o.setName('room').setNameLocalizations({ ja: '部屋' }).setDescription('room').setDescriptionLocalizations({ ja: '部屋の名前か、部屋主の名前で探す' }).setRequired(true).setAutocomplete(true),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('role')
      .setNameLocalizations({ ja: 'ロール' })
      .setDescription('Give or remove a role')
      .setDescriptionLocalizations({ ja: 'ロールを期限なしで付ける・外す【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addSubcommand((s) =>
        s
          .setName('give')
          .setNameLocalizations({ ja: '付ける' })
          .setDescription('Give')
          .setDescriptionLocalizations({ ja: 'ロールを付ける（一時的に付いていたら、期限なしに変える）' })
          .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
          .addRoleOption((o) => o.setName('role').setNameLocalizations({ ja: 'ロール' }).setDescription('role').setRequired(true))
          .addStringOption((o) => o.setName('reason').setNameLocalizations({ ja: '理由' }).setDescription('reason').setMaxLength(200)),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setNameLocalizations({ ja: '外す' })
          .setDescription('Remove')
          .setDescriptionLocalizations({ ja: 'ロールを外す' })
          .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
          .addRoleOption((o) => o.setName('role').setNameLocalizations({ ja: 'ロール' }).setDescription('role').setRequired(true))
          .addStringOption((o) => o.setName('reason').setNameLocalizations({ ja: '理由' }).setDescription('reason').setMaxLength(200)),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('temprole')
      .setNameLocalizations({ ja: '一時ロール' })
      .setDescription('Give a role for a limited time')
      .setDescriptionLocalizations({ ja: 'ロールを期限つきで付ける（期限が来たら BOT が外す）【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addSubcommand((s) =>
        s
          .setName('give')
          .setNameLocalizations({ ja: '付ける' })
          .setDescription('Give')
          .setDescriptionLocalizations({ ja: 'ロールを期限つきで付ける（もう付いていれば期限を付け直す）' })
          .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
          .addRoleOption((o) => o.setName('role').setNameLocalizations({ ja: 'ロール' }).setDescription('role').setRequired(true))
          .addStringOption((o) => o.setName('for').setNameLocalizations({ ja: '期間' }).setDescription('how long').setRequired(true).addChoices(...durationChoices))
          .addStringOption((o) => o.setName('reason').setNameLocalizations({ ja: '理由' }).setDescription('reason').setMaxLength(200)),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setNameLocalizations({ ja: '外す' })
          .setDescription('Remove now')
          .setDescriptionLocalizations({ ja: '一時的に付けたロールを今すぐ外す' })
          .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
          .addRoleOption((o) => o.setName('role').setNameLocalizations({ ja: 'ロール' }).setDescription('role').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('list')
          .setNameLocalizations({ ja: '一覧' })
          .setDescription('List')
          .setDescriptionLocalizations({ ja: '一時的に付いているロール・権限の一覧' })
          .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user')),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('tempperm')
      .setNameLocalizations({ ja: '一時権限' })
      .setDescription('Give channel permission for a limited time')
      .setDescriptionLocalizations({ ja: 'チャンネルの権限を期限つきで付ける・止める（期限が来たら元に戻す）【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addSubcommand((s) =>
        s
          .setName('give')
          .setNameLocalizations({ ja: '付ける' })
          .setDescription('Give')
          .setDescriptionLocalizations({ ja: 'このチャンネル（か選んだチャンネル）の権限を期限つきで付ける・止める' })
          .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
          .addStringOption((o) => o.setName('perm').setNameLocalizations({ ja: '権限' }).setDescription('what').setRequired(true).addChoices(...presetChoices))
          .addStringOption((o) => o.setName('for').setNameLocalizations({ ja: '期間' }).setDescription('how long').setRequired(true).addChoices(...durationChoices))
          .addChannelOption((o) => o.setName('channel').setNameLocalizations({ ja: 'チャンネル' }).setDescription('channel (default: here)').setDescriptionLocalizations({ ja: '省略するとこのチャンネル' }))
          .addStringOption((o) => o.setName('reason').setNameLocalizations({ ja: '理由' }).setDescription('reason').setMaxLength(200)),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setNameLocalizations({ ja: '外す' })
          .setDescription('Remove now')
          .setDescriptionLocalizations({ ja: '一時的な権限を今すぐ元に戻す' })
          .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user').setRequired(true))
          .addChannelOption((o) => o.setName('channel').setNameLocalizations({ ja: 'チャンネル' }).setDescription('channel (default: here)').setDescriptionLocalizations({ ja: '省略するとこのチャンネル' })),
      )
      .addSubcommand((s) =>
        s
          .setName('list')
          .setNameLocalizations({ ja: '一覧' })
          .setDescription('List')
          .setDescriptionLocalizations({ ja: '一時的に付いているロール・権限の一覧' })
          .addUserOption((o) => o.setName('user').setNameLocalizations({ ja: '相手' }).setDescription('user')),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('minutes')
      .setNameLocalizations({ ja: '議事録' })
      .setDescription('Take meeting minutes')
      .setDescriptionLocalizations({ ja: '会議の議事録を書く（社務所Web の議事録に入る）【神職】' })
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(staff)
      .addSubcommand((s) =>
        s
          .setName('start')
          .setNameLocalizations({ ja: '始める' })
          .setDescription('Start')
          .setDescriptionLocalizations({ ja: '議事録を始める（いる通話を場所に、通話の人を参加した人に）' })
          .addStringOption((o) => o.setName('title').setNameLocalizations({ ja: '題' }).setDescription('title').setRequired(true).setMaxLength(100))
          .addChannelOption((o) => o.setName('voice').setNameLocalizations({ ja: '通話' }).setDescription('voice').setDescriptionLocalizations({ ja: '省略すると、いま入っている通話' })),
      )
      .addSubcommand((s) =>
        s
          .setName('note')
          .setNameLocalizations({ ja: 'メモ' })
          .setDescription('Note')
          .setDescriptionLocalizations({ ja: '「話したこと」に 1 行足す' })
          .addStringOption((o) => o.setName('text').setNameLocalizations({ ja: '内容' }).setDescription('text').setRequired(true).setMaxLength(1000)),
      )
      .addSubcommand((s) =>
        s
          .setName('decide')
          .setNameLocalizations({ ja: '決定' })
          .setDescription('Decision')
          .setDescriptionLocalizations({ ja: '「決まったこと」に 1 つ足す' })
          .addStringOption((o) => o.setName('text').setNameLocalizations({ ja: '内容' }).setDescription('text').setRequired(true).setMaxLength(300)),
      )
      .addSubcommand((s) =>
        s
          .setName('todo')
          .setNameLocalizations({ ja: 'やること' })
          .setDescription('To-do')
          .setDescriptionLocalizations({ ja: 'やることを 1 つ足す（担当・期限つき）' })
          .addStringOption((o) => o.setName('text').setNameLocalizations({ ja: '内容' }).setDescription('text').setRequired(true).setMaxLength(200))
          .addUserOption((o) => o.setName('who').setNameLocalizations({ ja: '担当' }).setDescription('who'))
          .addStringOption((o) =>
            o.setName('due').setNameLocalizations({ ja: '期限' }).setDescription('due').setDescriptionLocalizations({ ja: '10/5・明日・3日後 など' }).setMaxLength(20),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('end')
          .setNameLocalizations({ ja: '終わる' })
          .setDescription('End')
          .setDescriptionLocalizations({ ja: '議事録を閉じて、まとめをこのチャンネルに出す' })
          .addBooleanOption((o) =>
            o.setName('post').setNameLocalizations({ ja: 'まとめを出す' }).setDescription('post summary').setDescriptionLocalizations({ ja: '省略すると出す。出さないときは「いいえ」' }),
          ),
      )
      .addSubcommand((s) => s.setName('now').setNameLocalizations({ ja: '今の' }).setDescription('Show').setDescriptionLocalizations({ ja: 'いま開いている議事録を見る' }))
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

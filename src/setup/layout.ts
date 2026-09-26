/**
 * 咲楽ノ宮のロールとチャンネルの配置（design.md §3・concept.md）。
 * setup-guild スクリプトはこの配置どおりに作る。
 */

export type RoleKey =
  | 'guji'
  | 'shinshoku'
  | 'yakudoshi'
  | 'yoimairi'
  | 'sodai'
  | 'sewayaku'
  | 'ujiko'
  | 'sanpaisha'
  | 'omamori_neochi'
  | 'omamori_game'
  | 'omamori_zatsudan'
  | 'omamori_yoimiya'
  | 'color_sakura'
  | 'color_fuji'
  | 'color_wakakusa'
  | 'color_yamabuki'
  | 'color_sora'
  | 'color_beni'
  | 'title_shugo'
  | 'title_yofukashi'
  | 'title_shobushi'
  | 'title_utaite';

export type RoleSpec = { key: RoleKey; name: string; color: number; hoist: boolean; permissions: bigint; /** 誰でも @ で呼べる（お守り） */ mentionable?: boolean };

/** 誰が見られるか */
export type Visibility =
  | 'public' // 未承認の人も見られる（入口）
  | 'member' // 参拝者以上
  | 'staff' // 神職・宮司のみ
  | 'adult'; // 宵参り（18 歳以上）と神職・宮司のみ。年齢制限チャンネルにする

export type ChannelSpec = {
  name: string;
  kind: 'text' | 'voice';
  topic?: string;
  /** 一般の人は書き込めない（BOT と神職だけ書き込む） */
  readOnly?: boolean;
  /** config/guild.json のどこに ID を書くか */
  configKey?: 'keiji' | 'log' | 'ema' | 'applications' | 'omairi' | 'soudan' | 'banzuke' | 'omikuji' | 'keidai';
  /** 入鯖申請・宵参り申請・お守りのボタンを置く */
  panels?: ('apply' | 'yoimairi' | 'omamori' | 'shop')[];
  /** サーバーの AFK チャンネルにする */
  afk?: boolean;
  /** 自分の通話部屋の入口（ここに入ると、この名前の通話ができる。{name} は入った人の名前） */
  hub?: string;
  /** 「募集する」ボタンを置く（どのお守りの人に知らせるか） */
  recruit?: RoleKey;
};

export type CategorySpec = { name: string; visibility: Visibility; channels: ChannelSpec[] };

export type Layout = { roles: RoleSpec[]; categories: CategorySpec[] };

// Discord の権限（ビット）
export const P = {
  CreateInstantInvite: 1n << 0n,
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  AddReactions: 1n << 6n,
  ViewAuditLog: 1n << 7n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  ManageMessages: 1n << 13n,
  ReadMessageHistory: 1n << 16n,
  Connect: 1n << 20n,
  MuteMembers: 1n << 22n,
  MoveMembers: 1n << 24n,
  ManageRoles: 1n << 28n,
  SendMessagesInThreads: 1n << 38n,
  CreatePublicThreads: 1n << 35n,
  ModerateMembers: 1n << 40n,
} as const;

const STAFF_PERMS = P.ModerateMembers | P.ManageMessages | P.MuteMembers | P.MoveMembers | P.ViewAuditLog;

export const ROLES: RoleSpec[] = [
  // 上から順（上ほど強い）
  { key: 'guji', name: '⛩ 宮司', color: 0xc8102e, hoist: true, permissions: STAFF_PERMS | P.ManageChannels | P.ManageRoles | P.ManageGuild },
  { key: 'shinshoku', name: '🎐 神職', color: 0xe0607e, hoist: true, permissions: STAFF_PERMS },
  { key: 'yakudoshi', name: '👹 厄年', color: 0x5b0e14, hoist: false, permissions: 0n },
  // 色守り（ショップ）: 役職の色より上に置くので、買った色で名前が表示される
  ...SHOP_COLORS().map((c) => ({ key: c.key, name: c.name, color: c.color, hoist: false, permissions: 0n })),
  { key: 'yoimairi', name: '🔞 宵参り', color: 0x6a5acd, hoist: false, permissions: 0n },
  { key: 'sodai', name: '🏮 総代', color: 0xd4a017, hoist: true, permissions: 0n },
  { key: 'sewayaku', name: '🎋 世話役', color: 0x3cb371, hoist: true, permissions: 0n },
  { key: 'ujiko', name: '🍃 氏子', color: 0x8fbc8f, hoist: true, permissions: 0n },
  { key: 'sanpaisha', name: '🔰 参拝者', color: 0xb0b0b0, hoist: true, permissions: 0n },
  // お守り（募集の通知を受け取るロール）。色なし・一覧で分けない。誰でも @ で呼べる
  ...OMAMORI_SPECS().map((o) => ({ key: o.key, name: o.name, color: 0, hoist: false, permissions: 0n, mentionable: true })),
  // 称号（ショップ）。色なし
  ...SHOP_TITLES().map((t) => ({ key: t.key, name: t.name, color: 0, hoist: false, permissions: 0n })),
];

/** 色守り（ショップで買う名前の色） */
export function SHOP_COLORS(): { key: RoleKey; name: string; label: string; emoji: string; color: number }[] {
  return [
    { key: 'color_sakura', name: '🎨 桜色', label: '桜', emoji: '🌸', color: 0xf4a7b9 },
    { key: 'color_fuji', name: '🎨 藤色', label: '藤', emoji: '💜', color: 0xa99ad6 },
    { key: 'color_wakakusa', name: '🎨 若草色', label: '若草', emoji: '🌱', color: 0xa8d44a },
    { key: 'color_yamabuki', name: '🎨 山吹色', label: '山吹', emoji: '🌼', color: 0xf8b500 },
    { key: 'color_sora', name: '🎨 空色', label: '空', emoji: '🩵', color: 0x7cc7e8 },
    { key: 'color_beni', name: '🎨 紅色', label: '紅', emoji: '❤️', color: 0xd7003a },
  ];
}

/** 称号（ショップで買うロール） */
export function SHOP_TITLES(): { key: RoleKey; name: string; label: string; emoji: string }[] {
  return [
    { key: 'title_shugo', name: '🍶 酒豪', label: '酒豪', emoji: '🍶' },
    { key: 'title_yofukashi', name: '🌙 夜更かし', label: '夜更かし', emoji: '🌙' },
    { key: 'title_shobushi', name: '🎮 勝負師', label: '勝負師', emoji: '🎮' },
    { key: 'title_utaite', name: '🎤 歌い手', label: '歌い手', emoji: '🎤' },
  ];
}

/** お守り（#授与所 のボタンで付け外しする、募集の通知用ロール） */
export function OMAMORI_SPECS(): { key: RoleKey; name: string; label: string; emoji: string; description: string; adultOnly: boolean }[] {
  return [
    { key: 'omamori_neochi', name: '🌙 寝落ちのお守り', label: '寝落ち', emoji: '🌙', description: '寝落ち通話の募集', adultOnly: false },
    { key: 'omamori_game', name: '🎮 ゲームのお守り', label: 'ゲーム', emoji: '🎮', description: 'ゲームの募集', adultOnly: false },
    { key: 'omamori_zatsudan', name: '🍵 雑談のお守り', label: '雑談', emoji: '🍵', description: '雑談通話の募集', adultOnly: false },
    { key: 'omamori_yoimiya', name: '🔞 宵宮のお守り', label: '宵宮', emoji: '🔞', description: '宵宮の募集（宵参りの方だけ）', adultOnly: true },
  ];
}

/** 設計書どおりの全部の構成 */
export const FULL: Layout = {
  roles: ROLES,
  categories: [
    {
      name: '⛩ 鳥居',
      visibility: 'public',
      channels: [
        { name: '鳥居', kind: 'text', readOnly: true, topic: 'ようこそ、咲楽ノ宮へ' },
        { name: 'しきたり', kind: 'text', readOnly: true, topic: 'ルール・用語集・朱印の仕組み' },
        { name: '社務所', kind: 'text', readOnly: true, topic: '入鯖申請・宵参り申請はこちらのボタンから', panels: ['apply', 'yoimairi'] },
      ],
    },
    {
      name: '📜 掲示',
      visibility: 'member',
      channels: [
        { name: '御触書', kind: 'text', readOnly: true, topic: 'お知らせ' },
        { name: '授与所', kind: 'text', readOnly: true, topic: 'お守り（募集の通知）と授与品（ショップ）', panels: ['omamori', 'shop'] },
        { name: '絵馬', kind: 'text', configKey: 'ema', topic: '自己紹介（書くと御朱印帳ボタンが付きます）' },
        { name: '慶事', kind: 'text', readOnly: true, configKey: 'keiji', topic: '昇格・称号の発表' },
        { name: '番付', kind: 'text', readOnly: true, configKey: 'banzuke', topic: 'ご縁のランキング（BOT が 10 分ごとに更新）' },
      ],
    },
    {
      name: '🌳 境内',
      visibility: 'member',
      channels: [
        { name: '境内', kind: 'text', topic: '雑談', configKey: 'keidai' },
        { name: '手水舎', kind: 'text', topic: '浮上（来たら一言）・雑談の募集', recruit: 'omamori_zatsudan' },
        { name: '写真館', kind: 'text', topic: '画像・スクショ' },
        { name: 'おみくじ', kind: 'text', configKey: 'omikuji', topic: '/おみくじ を 1 日 1 回（花びらがもらえます）' },
        { name: '拝殿', kind: 'voice' },
        { name: '➕ 縁側をひらく', kind: 'voice', hub: '🍵 {name}の縁側' },
        { name: '奥の院', kind: 'voice', afk: true },
      ],
    },
    {
      name: '🎮 縁日',
      visibility: 'member',
      channels: [
        { name: '縁日', kind: 'text', topic: 'ゲームの募集', recruit: 'omamori_game' },
        { name: '屋台', kind: 'text', topic: 'ゲームの話題' },
        { name: '➕ 屋台をひらく', kind: 'voice', hub: '🎮 {name}の屋台' },
        { name: '神楽殿', kind: 'voice' },
      ],
    },
    {
      name: '🌙 宿坊',
      visibility: 'member',
      channels: [
        { name: '宿帳', kind: 'text', topic: '寝落ち通話の募集・おやすみの挨拶', recruit: 'omamori_neochi' },
        { name: '➕ 宿坊をひらく', kind: 'voice', hub: '🌙 {name}の宿坊' },
      ],
    },
    {
      name: '🔞 宵宮',
      visibility: 'adult',
      channels: [
        { name: '宵宮', kind: 'text', topic: '18 歳以上の雑談' },
        { name: '御神酒処', kind: 'text', topic: 'お酒の話・飲み通話の募集', recruit: 'omamori_yoimiya' },
        { name: '宵宮', kind: 'voice' },
        { name: '➕ 宵宮の部屋をひらく', kind: 'voice', hub: '🍶 {name}の部屋' },
      ],
    },
    {
      name: '🔒 社務所裏',
      visibility: 'staff',
      channels: [
        { name: '寄合', kind: 'text', topic: '運営会議' },
        { name: '申請受付', kind: 'text', configKey: 'applications', topic: '入鯖・宵参り申請のカード' },
        { name: 'お参り判定', kind: 'text', configKey: 'omairi', topic: 'お参り期間が終わった人の判定' },
        { name: '相談窓口', kind: 'text', configKey: 'soudan', topic: '匿名相談' },
        { name: '記録', kind: 'text', configKey: 'log', topic: 'BOT のログ' },
        { name: '寄合', kind: 'voice' },
      ],
    },
  ],
};

/** テスト用の最小構成 */
export const MINIMAL: Layout = {
  roles: ROLES,
  categories: [
    { name: '⛩ 鳥居', visibility: 'public', channels: [{ name: '社務所', kind: 'text', readOnly: true, panels: ['apply', 'yoimairi'] }] },
    {
      name: '🌳 境内',
      visibility: 'member',
      channels: [
        { name: '絵馬', kind: 'text', configKey: 'ema' },
        { name: '慶事', kind: 'text', readOnly: true, configKey: 'keiji' },
        { name: '境内', kind: 'text' },
        { name: '通話テスト', kind: 'voice' },
        { name: '➕ 通話をひらく', kind: 'voice', hub: '🌸 {name}の部屋' },
      ],
    },
    { name: '🔞 宵宮', visibility: 'adult', channels: [{ name: '宵宮', kind: 'text' }] },
    {
      name: '🔒 社務所裏',
      visibility: 'staff',
      channels: [
        { name: '申請受付', kind: 'text', configKey: 'applications' },
        { name: 'お参り判定', kind: 'text', configKey: 'omairi' },
        { name: '相談窓口', kind: 'text', configKey: 'soudan' },
        { name: '記録', kind: 'text', configKey: 'log' },
      ],
    },
  ],
};

/**
 * 前の版の配置にあって、今はなくしたもの（--tidy で消す）。
 * 固定の通話を減らし、「➕ ○○をひらく」で自分の通話部屋を作る形にした（2026-09）。
 */
export const RETIRED: { category: string; name: string; kind: 'text' | 'voice' }[] = [
  ...['縁側 一', '縁側 二', '茶屋 一', '茶屋 二'].map((name) => ({ category: '🌳 境内', name, kind: 'voice' as const })),
  ...['射的 一', '射的 二', '射的 三', '輪投げ 一', '輪投げ 二', '金魚すくい 一', '金魚すくい 二'].map((name) => ({
    category: '🎮 縁日',
    name,
    kind: 'voice' as const,
  })),
  ...['宿坊 一の間', '宿坊 二の間', '宿坊 三の間', '宿坊 四の間', '宿坊 五の間'].map((name) => ({ category: '🌙 宿坊', name, kind: 'voice' as const })),
  ...['御神酒処', '宵宮の宿坊 一', '宵宮の宿坊 二'].map((name) => ({ category: '🔞 宵宮', name, kind: 'voice' as const })),
];

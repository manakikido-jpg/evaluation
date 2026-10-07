import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_ITEMS, DEFAULT_MESSAGES, DEFAULT_PLACES, FORTUNE_KEYS, type FortuneKey } from './omikujiTexts.js';

const snowflake = z.string().regex(/^\d{17,20}$/, 'Discord の ID（17〜20 桁の数字）を入れてください');

/**
 * 社務所Web の、人ごとに見せるかを選べるページ（宮司だけのページ・更新履歴は入れない）。
 * prefixes: そのページの URL の 1 段目
 */
export const WEB_PAGES = [
  { key: 'home', label: 'ホーム', href: '/', prefixes: [''] },
  { key: 'stats', label: '推移', href: '/stats', prefixes: ['stats'] },
  { key: 'voice', label: '通話の記録', href: '/voice', prefixes: ['voice'] },
  { key: 'audit', label: '記録', href: '/audit', prefixes: ['audit'] },
  { key: 'commands', label: 'コマンド', href: '/commands', prefixes: ['commands'] },
  { key: 'members', label: 'メンバー', href: '/members', prefixes: ['members'] },
  { key: 'applications', label: '申請・お参り期間', href: '/applications', prefixes: ['applications', 'omairi'] },
  { key: 'yaku', label: '厄', href: '/yaku', prefixes: ['yaku'] },
  { key: 'soudan', label: '相談', href: '/soudan', prefixes: ['soudan'] },
  { key: 'temp', label: '一時的な権限', href: '/temp', prefixes: ['temp'] },
  { key: 'invites', label: '招待', href: '/invites', prefixes: ['invites'] },
  { key: 'interview', label: '面談告知', href: '/interview', prefixes: ['interview'] },
  { key: 'minutes', label: '議事録', href: '/minutes', prefixes: ['minutes'] },
  { key: 'ideas', label: 'アイデア・共有', href: '/ideas', prefixes: ['ideas'] },
  { key: 'economy', label: '経済', href: '/economy', prefixes: ['economy'] },
  { key: 'gacha', label: '物御籤', href: '/gacha', prefixes: ['gacha'] },
  { key: 'market', label: '市場', href: '/market', prefixes: ['market'] },
  { key: 'board', label: '掲示板', href: '/board', prefixes: ['board'] },
  { key: 'cast', label: 'キャスト', href: '/cast', prefixes: ['cast'] },
  { key: 'glossary', label: '用語集', href: '/glossary', prefixes: ['glossary'] },
] as const;

export type WebPage = (typeof WEB_PAGES)[number]['key'];
export const WEB_PAGE_KEYS = WEB_PAGES.map((p) => p.key) as [WebPage, ...WebPage[]];

export const webAccessEntrySchema = z.object({
  kind: z.enum(['role', 'member']),
  id: snowflake,
  pages: z.array(z.enum(['*', ...WEB_PAGE_KEYS])).max(WEB_PAGE_KEYS.length + 1),
});

export const rankSchema = z.object({
  /** プログラム内で使う名前（英小文字） */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /** 表示名（例: 世話役） */
  name: z.string().min(1),
  emoji: z.string().default(''),
  roleId: snowflake,
  /** 朱印の格（1 回で渡せるご縁） */
  weight: z.number().int().positive(),
  /** true: ご縁で自動昇格する役職 / false: 任命制（神職・宮司） */
  auto: z.boolean(),
  /** 自動昇格に必要なご縁（auto の役職のみ） */
  requiredGoen: z.number().int().min(0).default(0),
  /** 前の名前（社務所Web で名前を変えたとき。掲示の {前の名前のご縁} なども使えるように） */
  formerNames: z.array(z.string()).optional(),
  /** 通話でもらえる銭の倍率（%。100 = ふつう・150 で 1.5 倍・0 でなし）。10 分ごとの量と 1 日の上限の両方にかかる */
  voicePercent: z.number().int().min(0).max(1000).default(100),
  /** 通話でもらえる 1 日の上限の倍率（%）。なければ voicePercent と同じ */
  voiceCapPercent: z.number().int().min(0).max(1000).optional(),
});

export type Rank = z.infer<typeof rankSchema>;

export const economySchema = z.object({
  /**
   * 期間限定イベントで変わる値（設定では変えない。経済のページの「期間限定イベント」が、その間だけ入れる）
   * shopSalePercent: 授与品の %引き ／ gachaSalePercent: 物御籤の %引き ／ voiceEventPercent: 通話でもらえる量（100 = ふつう）
   */
  shopSalePercent: z.number().int().min(0).max(90).default(0),
  gachaSalePercent: z.number().int().min(0).max(90).default(0),
  voiceEventPercent: z.number().int().min(100).max(1000).default(100),
  /** 通貨の名前と絵文字 */
  currencyName: z.string().default('銭'),
  currencyEmoji: z.string().default('🪙'),
  /** 通話 10 分ごとにもらえる量（2 人以上いる通話のみ） */
  voicePer10Min: z.number().int().min(0).default(5),
  /** 通話でもらえる 1 日の上限 */
  voiceDailyCap: z.number().int().min(0).default(150),
  /** 数えない通話チャンネル（AFK など） */
  excludedVoiceChannelIds: z.array(snowflake).default([]),
  /** 朱印を押した人・押された人がもらえる量 */
  shuinGive: z.number().int().min(0).default(3),
  shuinReceive: z.number().int().min(0).default(5),
  /** 免罪符の値段（考え中のため仮の値） */
  menzaifuPrice: z.number().int().positive().default(300),
  /** 免罪符を買える回数（1 人あたり、ずっと） */
  menzaifuMaxUses: z.number().int().min(0).default(1),
  /** 贈り物（ショップ）: 1 回に贈れる量と、1 人が 1 日に贈れる合計 */
  giftMin: z.number().int().positive().default(10),
  giftMax: z.number().int().positive().default(1000),
  giftDailyLimit: z.number().int().min(0).default(1000),
  /** 初期配布: 入鯖が承認されたときに 1 回だけ配る量（入り直しても 2 回目はない。0 で配らない） */
  joinBonus: z.number().int().min(0).default(3000),
  /** 初期配布を配ったら、運営のチャンネルに知らせる（joinBonusChannelId。なければ #記録） */
  joinBonusNotify: z.boolean().default(true),
  joinBonusChannelId: snowflake.optional(),
  /** おみくじ（1 日 1 回のログボ）の基本の量。吉でこの量、大吉は 3 倍、凶は半分（0 なら花びらなし） */
  omikujiBase: z.number().int().min(0).default(10),
  /** おみくじは通話に入っているときだけ引ける（AFK・数えない通話はのぞく） */
  omikujiVoiceOnly: z.boolean().default(true),
  /** 奉納している人の授与品の割引（%。免罪符・贈り物はのぞく。0 で割引なし） */
  boostDiscountPercent: z.number().int().min(0).max(90).default(20),
  /** コアタイム中の通話の花びら（%。150 で 1.5 倍。増えた分は 1 日の上限に数えない） */
  coreTimePercent: z.number().int().min(100).max(500).default(150),
  /** 「はじめての参拝」（おみくじ・朱印・通話）を全部できたときのお祝い（1 人 1 回。0 でなし） */
  onboardingReward: z.number().int().min(0).default(300),
  /** 招待のお礼: 入鯖申請で「招待してくれた人」に選ばれた人に、招待された人が 🔰参拝者 になったとき（1 人につき 1 回。0 でなし） */
  inviteReward: z.number().int().min(0).default(500),
  /** 招待した人が浮上した日（発言した・通話に 10 分いた）ごとに、招待した人へ（1 日 1 回。0 でなし） */
  inviteActiveReward: z.number().int().min(0).default(20),
  /** ↑を続ける日数（招待された人が参拝者になってから） */
  inviteActiveDays: z.number().int().min(1).max(365).default(30),
});

export type EconomyConfig = z.infer<typeof economySchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, '時刻は 21:00 のように');

/** コアタイム: みんなが集まる時間。通話の花びらが増え、#境内 で予告する（日本時間） */
export const coreTimeSchema = z.object({
  /** day: 0 = 日曜 … 6 = 土曜。start < end（日をまたがない） */
  slots: z
    .array(z.object({ day: z.number().int().min(0).max(6), start: hhmm, end: hhmm }).refine((s) => s.start < s.end, '終わりは始まりより後に'))
    .max(14)
    .default([
      { day: 5, start: '21:00', end: '23:00' },
      { day: 6, start: '21:00', end: '23:00' },
    ]),
  /** 前日のこの時刻に予告（空なら予告しない） */
  noticeDayBefore: hhmm.or(z.literal('')).default('21:00'),
  /** 始まる何分前に予告（0 なら予告しない） */
  noticeMinutesBefore: z.number().int().min(0).max(720).default(60),
});
export type CoreTimeConfig = z.infer<typeof coreTimeSchema>;

/** 部屋の種類ごとの値段（花びら。0 なら無料） */
const roomPrices = z.object({
  public: z.number().int().min(0).max(1_000_000).default(0),
  invite: z.number().int().min(0).max(1_000_000).default(0),
  secret: z.number().int().min(0).max(1_000_000).default(0),
  twoshot: z.number().int().min(0).max(1_000_000).default(0),
});
/** 自分の通話部屋の値段: once = ひらくたびに 1 回、hourly = 1 時間ごと */
export const roomsSchema = z.object({
  once: roomPrices.default(roomPrices.parse({})),
  hourly: roomPrices.default(roomPrices.parse({})),
  /** 奉納（ブースト）している人の部屋代の割引（%。100 で無料） */
  boosterDiscountPercent: z.number().int().min(0).max(100).default(100),
  /**
   * 💎 極（遊郭の VIP）: roleId の人だけが見える入口（hubId）から、VIP だけの部屋をひらける。部屋代はなし。
   * 社務所Web の「ショップ」の「💎 極の VIP を作る」で作る
   */
  vip: z.object({ roleId: snowflake, hubId: snowflake }).optional(),
});
export type RoomsConfig = z.infer<typeof roomsSchema>;

/** 自動で増える通話（例: 大きな縁側 1〜3。全部埋まったら 4 を作り、空きが 2 つ以上になったら減らす） */
export const voiceGroupSchema = z.object({
  /** 番号の前の名前（例: 大きな縁側）。飾り・空白は無視して比べる */
  name: z.string().min(1).max(50),
  /** いつもある数（これより減らさない） */
  min: z.number().int().min(1).max(20).default(3),
  /** 増やす上限 */
  max: z.number().int().min(1).max(50).default(20),
});
export type VoiceGroup = z.infer<typeof voiceGroupSchema>;

/** 通話のチャット（通話チャンネルの中のテキスト） */
export const voiceChatSchema = z.object({
  /** 人がいなくなった通話のチャットを消す（ピン留めは残す） */
  clearWhenEmpty: z.boolean().default(true),
  /** いなくなってから消すまでの分（その間にだれか入れば消さない） */
  delayMinutes: z.number().int().min(0).max(60).default(1),
});

/** 呼び鈴（運営を呼ぶ） */
export const bellSchema = z.object({
  /** 呼び鈴のカードを出すチャンネル（なければ #記録（log）） */
  channelId: snowflake.optional(),
  /** 同じ人が続けて鳴らせない分 */
  cooldownMinutes: z.number().int().min(0).max(120).default(5),
  /** 呼んだロールに通知を飛ばす */
  mentionStaff: z.boolean().default(true),
  /** 呼べるロール（なければ神職・宮司などの運営の役職） */
  roleIds: z.array(snowflake).max(10).default([]),
  /** 「🔔 呼び鈴」のボタンを、いつもいちばん下に置くチャンネル */
  channelIds: z.array(snowflake).max(25).default([]),
});

/** 物御籤の運勢（出やすさの順ではなく、良い順） */
/** super: 超大当たり（大吉より上。0.01% など、ごくまれ） */
export const GACHA_TIERS = ['super', 'daikichi', 'chukichi', 'shokichi', 'kichi'] as const;
export type GachaTier = (typeof GACHA_TIERS)[number];
/** 物御籤で出る券 */
export const TICKET_KINDS = [
  // 部屋代（種類を問わない無料券・種類ごとの無料券・半額券・一日券）
  'room_free',
  'room_free_public',
  'room_free_invite',
  'room_free_secret',
  'room_free_twoshot',
  'room_half_public',
  'room_half_invite',
  'room_half_secret',
  'room_half_twoshot',
  'room_day_public',
  'room_day_invite',
  'room_day_secret',
  'room_day_twoshot',
  // ショップの割引
  'shop_10',
  'shop_30',
  'shop_50',
  'ema_pin',
  'market_nofee',
  // 使うと効くもの
  'fuku',
  'luck',
  'omikuji_extra',
  'gacha_free',
  'gacha_gold10',
  'gacha_gift',
  'name_deco',
  'casino_boost',
] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

/** 🔔 通知 OK／🔕 通知 NG（社務所Web で用意する）。用意すると、募集と「すべての役職」のお知らせは通知 OK のロールだけを鳴らす */
export const notifySchema = z.object({
  okRoleId: snowflake.optional(),
  ngRoleId: snowflake.optional(),
});
export type NotifyConfig = z.infer<typeof notifySchema>;

/** おみくじの連続日数のおまけ（days 日続けた日に。repeat: days 日ごとに毎回。ロールは一度付いたらそのまま） */
export const streakRewardSchema = z.object({
  days: z.number().int().min(2).max(365),
  repeat: z.boolean().default(true),
  coins: z.number().int().min(0).max(1_000_000).default(0),
  ticket: z.enum([...TICKET_KINDS, 'none']).default('none'),
  tickets: z.number().int().min(0).max(100).default(0),
  roleId: snowflake.optional(),
});
export type StreakReward = z.infer<typeof streakRewardSchema>;
export const omikujiStreakSchema = z.object({
  rewards: z
    .array(streakRewardSchema)
    .max(5)
    .default([
      { days: 7, repeat: true, coins: 50, ticket: 'gacha_free', tickets: 1 },
      { days: 30, repeat: true, coins: 300, ticket: 'gacha_free', tickets: 3 },
    ]),
});
export type OmikujiStreakConfig = z.infer<typeof omikujiStreakSchema>;

/** 🎴 運営吉（おみくじでまれに出る、運営の特別な運勢）。絵は社務所Web で入れる（omikuji-1〜4） */
export const OMIKUJI_SPECIAL_MAX = 4;
export const omikujiSpecialSchema = z.object({
  enabled: z.boolean().default(false),
  /** 出る確率（%・全部合わせて。出たら、その中から同じ確率で 1 つ）。mode が interval のときは使わない */
  percent: z.number().min(0).max(100).default(1),
  /** fixed: 決めた確率 / interval: 出したい間隔から、最近のおみくじの回数で確率を決める（鯖が大きくなると下がる） */
  mode: z.enum(['fixed', 'interval']).default('fixed'),
  /** 出したい間隔（日。全部の枠を合わせて、だいたい何日に 1 回出るか） */
  everyDays: z.number().min(1).max(365).default(30),
  /** 間隔で決めるときの確率の下限・上限（%） */
  minPercent: z.number().min(0).max(100).default(0.01),
  maxPercent: z.number().min(0).max(100).default(1),
  /** {通貨}の倍率（おみくじの基本の量に掛ける。大吉は 3） */
  mult: z.number().min(0).max(100).default(3),
  list: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(20),
        message: z.string().trim().max(200).default(''),
        /** その人の色（#rrggbb。結果のカードとおみくじの紙の柄） */
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      }),
    )
    .max(OMIKUJI_SPECIAL_MAX)
    .default([]),
});
export type OmikujiSpecialConfig = z.infer<typeof omikujiSpecialSchema>;

/** ⛩ おみくじの文（運勢ごとの一言・項目・ラッキー場所）と紙。はじめの文は omikujiTexts.ts */
export const OMIKUJI_LINE_MAX = 60;
const omikujiLine = z.string().trim().min(1).max(OMIKUJI_LINE_MAX);
const omikujiLines = (d: string[]) => z.array(omikujiLine).max(80).default(d);
export const omikujiItemSchema = z.object({
  key: z.string().trim().min(1).max(20),
  emoji: z.string().trim().max(8).default(''),
  label: z.string().trim().min(1).max(6),
  /** 毎日出す（外すと、外した項目の中から毎日 1 つ） */
  fixed: z.boolean().default(false),
  good: z.array(omikujiLine).max(40).default([]),
  normal: z.array(omikujiLine).max(40).default([]),
  bad: z.array(omikujiLine).max(40).default([]),
});
export type OmikujiItem = z.infer<typeof omikujiItemSchema>;
export const omikujiTextsSchema = z.object({
  /** 紙の上と印に出る神社の名前（空なら「御神籤」だけ） */
  shrine: z.string().trim().max(8).default('咲楽ノ宮'),
  /** 結果を紙の画像で出す（外すと、前のように文字だけ） */
  slip: z.boolean().default(true),
  /** 引いたとき「ガラガラ…」と少し待たせる */
  shake: z.boolean().default(true),
  messages: z
    .object(Object.fromEntries(FORTUNE_KEYS.map((k) => [k, omikujiLines(DEFAULT_MESSAGES[k])])) as Record<FortuneKey, ReturnType<typeof omikujiLines>>)
    .default(DEFAULT_MESSAGES),
  items: z.array(omikujiItemSchema).max(8).default(DEFAULT_ITEMS),
  places: omikujiLines(DEFAULT_PLACES),
});
export type OmikujiTextsConfig = z.infer<typeof omikujiTextsSchema>;

const gachaPrizeSchema = z.object({
  /** 物御籤限定のロール（色守り・称号）を 1 つ（まだ持っていないもの）。全部持っていたら・なければ券 */
  role: z.boolean().default(false),
  /** 券の種類（none: 券なし） */
  ticket: z.enum([...TICKET_KINDS, 'none']).default('none'),
  count: z.number().int().min(0).max(10).default(1),
  /** 花びら（おまけ。0 でなし） */
  coins: z.number().int().min(0).max(1_000_000).default(0),
});
export type GachaPrize = z.infer<typeof gachaPrizeSchema>;

/** 物御籤（花びらで引くくじ。本物のお金は扱わない） */
export const gachaSchema = z.object({
  enabled: z.boolean().default(true),
  /** 1 回の値段（花びら）。10 連は 10 倍 */
  price: z.number().int().min(1).max(1_000_000).default(500),
  /** 大吉が出ないまま、この回数目は必ず大吉（0 で天井なし） */
  pity: z.number().int().min(0).max(1000).default(30),
  /** 出やすさ（合計が 100 でなくてもよい。割合で出す。小数も使える: 超大当たり 0.01 など） */
  rates: z
    .object({
      super: z.number().min(0).max(1000).default(0.01),
      daikichi: z.number().min(0).max(1000),
      chukichi: z.number().min(0).max(1000),
      shokichi: z.number().min(0).max(1000),
      kichi: z.number().min(0).max(1000),
    })
    .default({ super: 0.01, daikichi: 3, chukichi: 12, shokichi: 25, kichi: 60 })
    .refine((r) => r.super + r.daikichi + r.chukichi + r.shokichi + r.kichi > 0, '出やすさの合計が 0 です'),
  /** 🍶 おすそ分け: 大吉・超大当たりが出たとき、同じ通話にいる人それぞれに配る銭（0 でなし） */
  share: z.number().int().min(0).max(100_000).default(50),
  /** 物御籤限定のロール（色守り・称号） */
  roleIds: z.array(snowflake).max(25).default([]),
  prizes: z.object({ daikichi: gachaPrizeSchema, chukichi: gachaPrizeSchema, shokichi: gachaPrizeSchema, kichi: gachaPrizeSchema }).default({
    daikichi: { role: true, ticket: 'room_free', count: 3, coins: 0 },
    chukichi: { role: false, ticket: 'room_free', count: 1, coins: 0 },
    shokichi: { role: false, ticket: 'market_nofee', count: 1, coins: 0 },
    kichi: { role: false, ticket: 'ema_pin', count: 1, coins: 0 },
  }),
});
export type GachaConfig = z.infer<typeof gachaSchema>;

/** 市場（花びらだけ。本物のお金は扱わない） */
export const marketSchema = z.object({
  /** サーバーの手数料（%）。売った人には値段からこれを引いた分を渡す */
  feePercent: z.number().int().min(0).max(50).default(10),
  /** 買った人が「受け取った」も「問題あり」も押さなければ、この日数で売った人に渡す */
  autoReleaseDays: z.number().int().min(1).max(60).default(7),
});

export const DEFAULT_BOOST_ANNOUNCE = '🏮 **{名前}** さんが、咲楽ノ宮に奉納（サーバーブースト）してくださいました。\nありがとうございます！';
export const DEFAULT_BOOST_DM = '🏮 咲楽ノ宮に奉納（サーバーブースト）してくださり、ありがとうございます。';

export const boostSchema = z.object({
  /** #慶事 に出すお知らせ */
  announceText: z.string().min(1).max(1000).default(DEFAULT_BOOST_ANNOUNCE),
  /** 本人への DM の最初の文（お礼の花びら・割引の案内は BOT が下に足す） */
  dmText: z.string().min(1).max(1000).default(DEFAULT_BOOST_DM),
});

export const applicationsSchema = z.object({
  /**
   * 半自動承認: Discord アカウントを作ってからこの日数以上たっている人は自動で承認する。
   * 0 なら全員を神職が承認する（手動）
   */
  autoApproveAccountDays: z.number().int().min(0).default(0),
  /** 却下した人をキックする */
  kickOnReject: z.boolean().default(true),
});

export const omairiSchema = z.object({
  /** お参り期間の日数 */
  days: z.number().int().positive().default(14),
  /** 期間内に氏子に届かなかったとき、1 回だけ自動で延ばす日数（0 で延ばさない） */
  extendDays: z.number().int().min(0).default(7),
});

/** 一発 BAN の理由（定型） */
export const DEFAULT_INSTANT_BAN_REASONS = [
  '18 歳未満への恋愛・性的な目的での接触',
  '個人情報の晒し',
  '荒らし・レイド・スパムの大量投稿',
  'なりすまし・詐欺',
  '違法な内容の投稿',
];

/** 厄の理由（定型） */
export const DEFAULT_YAKU_REASONS = [
  '誹謗中傷',
  '迷惑行為（通話）',
  '大人の話題を全年齢の場所で',
  'スパム・宣伝',
];

/** 経済の見守り（週ごとのお知らせ・警告・お賽銭） */
export const economyOpsSchema = z.object({
  /** 週ごとのお知らせ */
  reportEnabled: z.boolean().default(true),
  /** お知らせ・警告を出すチャンネル（なければ #記録） */
  channelId: snowflake.optional(),
  /** お知らせの曜日（0 = 日曜 … 6 = 土曜）と時（日本時間） */
  reportWeekday: z.number().int().min(0).max(6).default(1),
  reportHour: z.number().int().min(0).max(23).default(9),
  /** 警告: 24 時間で稼いだ・使った量がこれ以上なら知らせる（0 で知らせない） */
  alertsEnabled: z.boolean().default(true),
  alertEarn24h: z.number().int().min(0).max(100_000_000).default(5000),
  alertSpend24h: z.number().int().min(0).max(100_000_000).default(20000),
  /** お賽銭（持ちすぎた分）: 週に 1 回、この量を超えた分の % を納めてもらう（はじめは止めている） */
  saisenEnabled: z.boolean().default(false),
  saisenThreshold: z.number().int().min(0).max(100_000_000).default(50000),
  saisenPercent: z.number().int().min(1).max(20).default(1),
});
export type EconomyOpsConfig = z.infer<typeof economyOpsSchema>;

/** 運営の見守り: 対応待ちがそのままなら知らせる・週ごとのまとめ */
export const opsWatchSchema = z.object({
  /** 対応待ちのお知らせ */
  remindEnabled: z.boolean().default(true),
  /** 知らせるチャンネル（なければ #記録） */
  channelId: snowflake.optional(),
  /** そのままにしてから知らせるまで（0 で知らせない）。入鯖・宵参り申請・相談（未対応）・お参り判定は時間、呼び鈴は分 */
  applicationHours: z.number().int().min(0).max(168).default(12),
  soudanHours: z.number().int().min(0).max(168).default(24),
  omairiHours: z.number().int().min(0).max(168).default(24),
  bellMinutes: z.number().int().min(0).max(1440).default(30),
  /** 神職・宮司のロールに通知を飛ばす（@ロール） */
  mention: z.boolean().default(true),
  /** 夜は知らせない（日本時間。quietStart 時〜quietEnd 時。同じなら止めない） */
  quietStart: z.number().int().min(0).max(23).default(1),
  quietEnd: z.number().int().min(0).max(23).default(8),
  /** 週ごとのまとめ（曜日 0 = 日曜 … 6 = 土曜・時は日本時間） */
  reportEnabled: z.boolean().default(true),
  reportWeekday: z.number().int().min(0).max(6).default(1),
  reportHour: z.number().int().min(0).max(23).default(9),
});
export type OpsWatchConfig = z.infer<typeof opsWatchSchema>;

/** カジノ（社務所Web の /casino。メンバーが Discord でログインして銭で遊ぶ） */
export const CASINO_GAMES = ['blackjack', 'highlow', 'baccarat', 'slots', 'atslot', 'roulette', 'chinchiro', 'othello', 'versus', 'bj_table', 'baccarat_table', 'roulette_table', 'chinchiro_table', 'poker', 'daifugo', 'babanuki', 'mahjong', 'keiba'] as const;
/** ゲームの一覧を保存したとき（knownGames がない）にあったゲーム。あとから足したゲームは、保存した一覧になくても遊べる */
export const CASINO_GAMES_V1: readonly string[] = ['blackjack', 'highlow', 'baccarat', 'slots', 'roulette', 'othello', 'versus', 'bj_table', 'baccarat_table', 'roulette_table', 'poker', 'daifugo', 'babanuki'];
/** みんなで座る卓（ゲームの種類） */
export const TABLE_KINDS = ['bj_table', 'baccarat_table', 'roulette_table', 'chinchiro_table', 'poker', 'daifugo', 'babanuki', 'mahjong', 'keiba'] as const;
export type TableKind = (typeof TABLE_KINDS)[number];
export type CasinoGame = (typeof CASINO_GAMES)[number];
export const casinoSchema = z.object({
  enabled: z.boolean().default(true),
  /** 1 回に賭けられる銭 */
  minBet: z.number().int().min(1).max(1_000_000).default(10),
  maxBet: z.number().int().min(1).max(1_000_000).default(1000),
  /** ルーレットの 1 か所に賭けられる最高（0 で maxBet と同じ）。合計はこの 10 か所分まで */
  rouletteMaxBet: z.number().int().min(0).max(10_000_000).default(0),
  /** 🀄 麻雀で参加費を賭けられるか（false なら、どの卓も賭けなし・点数だけで遊ぶ） */
  mahjongBets: z.boolean().default(true),
  /** 🏇 馬主: 馬 1 頭の値段（0 で買えない）・1 人が持てる頭数 */
  keibaHorsePrice: z.number().int().min(0).max(10_000_000).default(3000),
  keibaMaxOwned: z.number().int().min(0).max(20).default(3),
  /** 🏇 調教 1 回の値段（0 で調教できない） */
  keibaTrainPrice: z.number().int().min(0).max(1_000_000).default(300),
  /** 🏇 馬主への還元: 賞金・出走手当の倍率（%。100 で元のまま） */
  keibaPrizeMult: z.number().int().min(0).max(1000).default(150),
  /** 🏇 最低保証の 1 着賞金（クラスごと: 新馬・未勝利・1〜3 勝・オープン・G3・G2・G1。2〜5 着はその 20・13・10・7 / 50）。胴元が出す */
  keibaPurse: z.array(z.number().int().min(0).max(1_000_000)).length(9).default([300, 300, 400, 500, 700, 1000, 2000, 3000, 5000]),
  /** 🏇 最低保証で足す分（胴元が出す）を、1 人が 1 日（日本時間）に受け取れる上限（0 で上限なし） */
  keibaPurseDailyCap: z.number().int().min(0).max(100_000_000).default(20000),
  /** 🏇 応援金: その馬の単勝・複勝に、馬主でない人が賭けた額の何 % を馬主へ */
  keibaFanPct: z.number().int().min(0).max(20).default(3),
  /** 🏇 血統ロイヤリティ: 産駒が稼いだ賞金の何 % を親の馬主へ（胴元が出す） */
  keibaRoyaltyPct: z.number().int().min(0).max(50).default(10),
  /** 🏇 功労金: 引退するとき 1 勝につき（重賞の勝ちは 3 倍）。胴元が出す */
  keibaRetirePerWin: z.number().int().min(0).max(1_000_000).default(300),
  /** 🏇 馬主の馬が勝ったときにお祝いを流すチャンネル（なければ流さない） */
  keibaAnnounceChannelId: z.string().regex(/^\d{5,25}$/).optional(),
  /** 🐴 馬主ロール（走れる馬を持っている人）・🏆 G1 馬主ロール（G1 を勝ったことがある人）。なければ付けない */
  keibaOwnerRoleId: z.string().regex(/^\d{5,25}$/).optional(),
  keibaG1RoleId: z.string().regex(/^\d{5,25}$/).optional(),
  /** 1 日（日本時間）に賭けられる合計（0 で上限なし） */
  dailyBetLimit: z.number().int().min(0).max(100_000_000).default(20000),
  /** 遊べるゲーム */
  games: z.array(z.enum(CASINO_GAMES)).default([...CASINO_GAMES]),
  /** games を保存したときにあったゲーム（これにないゲームは、あとから足したものなので遊べるようにする） */
  knownGames: z.array(z.string()).optional(),
  /** 位のロールがある人だけ入れる（accessRoleId を決めたときは、そちらを使う） */
  requireRank: z.boolean().default(true),
  /** このロールがある人だけ入れる（「🎰 カジノ」など。決めると位のロールは見ない） */
  accessRoleId: z.string().regex(/^\d{5,25}$/).optional(),
  /** そのロールの名前（入れなかった人への案内に出す） */
  accessRoleName: z.string().max(100).optional(),
  /** スロットの台（並び順に 1 番台・2 番台…）。それぞれの設定 1〜6、random はおまかせ（日替わり） */
  slotMachines: z
    .array(z.union([z.literal('random'), z.number().int().min(1).max(6)]))
    .min(1)
    .max(20)
    .default(['random', 'random', 'random', 'random', 'random', 'random', 'random', 'random']),
  /** 🦊 AT 機（鬼斬り白狐）の島の台。それぞれの設定 1〜6、random はおまかせ（日替わり） */
  atMachines: z
    .array(z.union([z.literal('random'), z.number().int().min(1).max(6)]))
    .min(1)
    .max(20)
    .default(['random', 'random', 'random', 'random', 'random', 'random']),
  /** AT 機を公開する（はじめは準備中で、メンバーは遊べない。社務所Web で公開する） */
  atOpen: z.boolean().default(false),
  /** AT 機の 1 ゲームの賭け（島で決まっている。AT のときだけ多く賭けられないように） */
  atBet: z.number().int().min(1).max(1_000_000).default(30),
  /** 💰 収益の分け前: 前の日（日本時間）の胴元の収支が黒字なら、宮司のロールの人それぞれにこの %（0 で止める。合計が 100% を超えるときは山分け） */
  profitSharePercent: z.number().int().min(0).max(50).default(25),
  /** 🎰 大勝負の札（その日だけ、カジノの上限を上げる）: 1 回の最高と 1 日の合計を何倍にするか */
  boostMult: z.number().int().min(2).max(20).default(5),
  /**
   * BOT が中で使う（保存しない）: 大勝負の札が効いている人の、元の上限。
   * 卓の参加費・ブラインド（みんなが同じだけ払うもの）は元の「1 回の最高」まで。卓のほかの人は元の上限で数える
   */
  boostBase: z.object({ maxBet: z.number().int(), rouletteMaxBet: z.number().int(), dailyBetLimit: z.number().int() }).optional(),
});
export type CasinoConfig = z.infer<typeof casinoSchema>;
/** 卓の参加費・ブラインド（みんなが同じだけ払うもの）の最高。🎰 大勝負の札が効いていても、元の 1 回の最高 */
export const sharedMaxBet = (c: Pick<CasinoConfig, 'maxBet' | 'boostBase'>) => c.boostBase?.maxBet ?? c.maxBet;

export const guildConfigSchema = z
  .object({
    guildId: snowflake,
    channels: z.object({
      /** #慶事: 昇格の発表 */
      keiji: snowflake,
      /** #記録: BOT のログ（任意） */
      log: snowflake.optional(),
      /** #絵馬-男性: 自己紹介（任意） */
      ema: snowflake.optional(),
      /** #絵馬-女性: 自己紹介（任意） */
      emaFemale: snowflake.optional(),
      /** #運営紹介: 宮司・神職の紹介（任意） */
      staffIntro: snowflake.optional(),
      /** #鳥居: 入口。BOT が作る招待リンクはここに入る（任意。なければ名前で探す） */
      entrance: snowflake.optional(),
      /** #お出迎え: 新しく参拝した人のお知らせ（任意） */
      welcome: snowflake.optional(),
      /** #市場: 開業権利を持つ人の出品（任意） */
      market: snowflake.optional(),
      /** #申請受付: 入鯖・宵参り申請のカードが届く（運営のみ） */
      applications: snowflake.optional(),
      /** #お参り判定: お参り期間が終わっても氏子に届かなかった人の通知（運営のみ） */
      omairi: snowflake.optional(),
      /** #相談窓口: 匿名相談が届く（運営のみ） */
      soudan: snowflake.optional(),
      /** #番付: ご縁のランキングを BOT が貼る（省略時は「番付」という名前のチャンネル） */
      banzuke: snowflake.optional(),
      /** #おみくじ: /おみくじ を引く場所（省略時は「おみくじ」という名前のチャンネル） */
      omikuji: snowflake.optional(),
      /** #境内: 花吹雪（ショップ）を出す場所（省略時は「境内」という名前のチャンネル） */
      keidai: snowflake.optional(),
      /** #面談日程: 案内待ちの人が面談の日程を書く場所。案内待ちが外れたら、その人の書き込みを消す（省略時は名前に「面談日程」を含むチャンネル） */
      interviewSchedule: snowflake.optional(),
    }),
    roles: z
      .object({
        /** 👹 厄年: 朱印を押せない（任意） */
        yakudoshi: snowflake.optional(),
        /** 🔞 宵参り: 成人エリアに入れる（任意） */
        yoimairi: snowflake.optional(),
        /** ♂ 男性・♀ 女性: 入鯖申請で選ぶ（任意） */
        male: snowflake.optional(),
        female: snowflake.optional(),
        /** 📝 絵馬待ち: 承認されて、まだ自己紹介を書いていない人。書くと 🔰参拝者 になる（任意。なければ承認ですぐ参拝者） */
        emaPending: snowflake.optional(),
        /** 🧭 案内待ち: Discord の参加時の質問（オンボーディング）を終えて、まだ承認されていない人。承認（絵馬待ち・役職）で外す（任意。なければ名前に「案内待ち」を含むロール） */
        guidePending: snowflake.optional(),
        /** 年齢のロール（Discord の参加時の質問で付く）。宵参りの申請を、17 歳以下なら自動で却下・18 歳以上なら自動で承認（任意。なければ名前に「17歳以下」「18歳以上」を含むロール） */
        ageMinor: snowflake.optional(),
        ageAdult: snowflake.optional(),
        /** 🏪 開業: 市場に出品できる（授与品「開業権利」で受ける）（任意） */
        merchant: snowflake.optional(),
        /** DM・フレンド追加の OK / 要相談 / NG（入鯖申請と #授与所 のボタンで選ぶ。プロフィールに出る）（任意） */
        contact: z
          .object({
            dm: z.object({ ok: snowflake.optional(), ask: snowflake.optional(), ng: snowflake.optional() }).default({}),
            friend: z.object({ ok: snowflake.optional(), ask: snowflake.optional(), ng: snowflake.optional() }).default({}),
          })
          .optional(),
        /** 前の版のお守り（募集の通知のロール）。今は使わない。BOT が起きたときに 1 回だけ、このロールを消す */
        omamori: z
          .array(
            z.object({
              roleId: snowflake,
              /** ボタンの文字（例: 寝落ち） */
              label: z.string().min(1).max(40),
              emoji: z.string().max(10).default(''),
              /** 何の募集が届くか（パネルに書く） */
              description: z.string().max(100).default(''),
              /** 宵参りの人だけ付けられる */
              adultOnly: z.boolean().default(false),
            }),
          )
          .default([]),
      })
      .default({ omamori: [] }),
    ranks: z.array(rankSchema).min(1),
    economy: economySchema.default(economySchema.parse({})),
    omikujiStreak: omikujiStreakSchema.default(omikujiStreakSchema.parse({})),
    omikujiSpecial: omikujiSpecialSchema.default(omikujiSpecialSchema.parse({})),
    omikujiTexts: omikujiTextsSchema.default(omikujiTextsSchema.parse({})),
    notify: notifySchema.default({}),
    applications: applicationsSchema.default(applicationsSchema.parse({})),
    omairi: omairiSchema.default(omairiSchema.parse({})),
    /** ブースト（奉納）のお礼の文面。{名前} は奉納した人（メンションになるが通知は飛ばない） */
    boost: boostSchema.default(boostSchema.parse({})),
    coreTime: coreTimeSchema.default(coreTimeSchema.parse({})),
    rooms: roomsSchema.default(roomsSchema.parse({})),
    market: marketSchema.default(marketSchema.parse({})),
    voiceGroups: z.array(voiceGroupSchema).max(10).default([]),
    voiceChat: voiceChatSchema.default(voiceChatSchema.parse({})),
    bell: bellSchema.default(bellSchema.parse({})),
    gacha: gachaSchema.default(gachaSchema.parse({})),
    economyOps: economyOpsSchema.default(economyOpsSchema.parse({})),
    opsWatch: opsWatchSchema.default(opsWatchSchema.parse({})),
    casino: casinoSchema.default(casinoSchema.parse({})),
    /** 募集: チャンネルのいちばん下に「募集する」ボタンを置き、押した人の募集を役職のある人みんなに知らせる */
    recruit: z
      .object({
        /** 同じ人が続けて募集できるまでの分 */
        cooldownMinutes: z.number().int().min(0).default(10),
        /** 同じチャンネルに続けて通知を飛ばせるまでの分（だれが押しても） */
        channelCooldownMinutes: z.number().int().min(0).max(120).default(5),
        /** 秒で決めたとき（社務所Web の設定。あれば分より優先） */
        cooldownSeconds: z.number().int().min(0).max(7200).optional(),
        channelCooldownSeconds: z.number().int().min(0).max(7200).optional(),
        /** 役職（🔰参拝者 以上）のある人だけ募集できる */
        requireRank: z.boolean().default(true),
        /** 👹厄年の人は募集できない */
        blockYakudoshi: z.boolean().default(true),
        /** 入ってからこの日数がたつまで募集できない（0 でなし） */
        newMemberDays: z.number().int().min(0).max(90).default(0),
        /** 待ち時間中にこの回数押した人を運営に知らせる（0 で知らせない） */
        spamAlertCount: z.number().int().min(0).max(50).default(3),
        panels: z
          .array(
            z.object({
              channelId: snowflake,
              /** 何の募集か（例: 寝落ち） */
              label: z.string().min(1).max(40),
              emoji: z.string().max(10).default(''),
              /** 通話にいないときに案内する「➕ ○○をひらく」 */
              hubId: snowflake.optional(),
              /** 宵参りの人だけ募集できる */
              adultOnly: z.boolean().default(false),
            }),
          )
          .default([]),
      })
      .default({
        cooldownMinutes: 10,
        channelCooldownMinutes: 5,
        requireRank: true,
        blockYakudoshi: true,
        newMemberDays: 0,
        spamAlertCount: 3,
        panels: [],
      }),
    /** ショップ: セットアップが作った色守り・称号のロール（BOT が起動時に品物として並べる） */
    shop: z
      .object({
        colors: z.array(z.object({ roleId: snowflake, name: z.string(), emoji: z.string().default(''), boosterOnly: z.boolean().optional() })).default([]),
        titles: z.array(z.object({ roleId: snowflake, name: z.string(), emoji: z.string().default(''), boosterOnly: z.boolean().optional() })).default([]),
        /** 開業権利（市場に出品できるロール）。セットアップが書く */
        license: z.object({ roleId: snowflake }).optional(),
      })
      .default({ colors: [], titles: [] }),
    /** 自分の通話部屋: ここに入ると、その人の通話が同じカテゴリにでき、全員抜けると消える */
    tempVoice: z
      .object({
        hubs: z
          .array(
            z.object({
              channelId: snowflake,
              /** できる通話の名前。{name} が入った人の表示名になる */
              name: z.string().min(1).max(90),
              /**
               * 部屋の種類（公開・招待限定・シークレット・ツーショット）を選べて、花びらを払う入口。
               * once: ひらくたびに 1 回（宿坊） / hourly: 1 時間ごと（宵宮） / free: 種類は選べて部屋代なし（💎 極） / none: 選べない・無料。
               * 省略時は名前から決める（宿坊 → once、🍶・宵宮 → hourly）
               */
              plan: z.enum(['none', 'once', 'hourly', 'free']).optional(),
            }),
          )
          .default([]),
      })
      .default({ hubs: [] }),
    moderation: z
      .object({
        yakuReasons: z.array(z.string().min(1)).default(DEFAULT_YAKU_REASONS),
        instantBanReasons: z.array(z.string().min(1)).default(DEFAULT_INSTANT_BAN_REASONS),
      })
      .default({ yakuReasons: DEFAULT_YAKU_REASONS, instantBanReasons: DEFAULT_INSTANT_BAN_REASONS }),
    /**
     * 社務所Web に入れる人（社務所Web の「設定」で選ぶ）。
     * shinshokuRoleIds: 前の形（全部のページ）。entries: ロール・人ごとに見られるページ
     */
    webAccess: z
      .object({ shinshokuRoleIds: z.array(snowflake).max(20).default([]), entries: z.array(webAccessEntrySchema).max(50).default([]) })
      .default({ shinshokuRoleIds: [], entries: [] }),
    /** 管理画面に入れるロール（省略時は役職キー shinshoku / guji のロール） */
    admin: z
      .object({
        shinshokuRoleIds: z.array(snowflake).default([]),
        gujiRoleIds: z.array(snowflake).default([]),
      })
      .optional(),
  })
  .superRefine((cfg, ctx) => {
    const keys = new Set<string>();
    const roleIds = new Set<string>();
    for (const r of cfg.ranks) {
      if (keys.has(r.key)) ctx.addIssue({ code: 'custom', message: `役職キーが重複しています: ${r.key}` });
      if (roleIds.has(r.roleId)) ctx.addIssue({ code: 'custom', message: `ロール ID が重複しています: ${r.roleId}` });
      keys.add(r.key);
      roleIds.add(r.roleId);
    }
    const auto = cfg.ranks.filter((r) => r.auto);
    if (!auto.some((r) => r.requiredGoen === 0)) {
      ctx.addIssue({ code: 'custom', message: 'ご縁 0 の自動役職（参拝者）が必要です' });
    }
    const goens = auto.map((r) => r.requiredGoen);
    if (new Set(goens).size !== goens.length) {
      ctx.addIssue({ code: 'custom', message: '自動役職の requiredGoen が重複しています' });
    }
  });

export type GuildConfig = z.infer<typeof guildConfigSchema>;

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN を設定してください'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL を設定してください'),
  GUILD_CONFIG: z.string().default('config/guild.json'),
  HEALTH_PORT: z.coerce.number().int().min(0).default(8080),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** 管理画面の URL（/member の結果から管理画面へリンクする。任意） */
  WEB_BASE_URL: z
    .string()
    .optional()
    .transform((u) => (u ? u.replace(/\/+$/, '') : undefined)),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(env);
}

const webEnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN を設定してください'),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/, 'DISCORD_CLIENT_ID を設定してください'),
  DISCORD_CLIENT_SECRET: z.string().min(1, 'DISCORD_CLIENT_SECRET を設定してください'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL を設定してください'),
  GUILD_CONFIG: z.string().default('config/guild.json'),
  /** 管理画面の URL（例: https://shamusho.example.com）。末尾の / なし */
  WEB_BASE_URL: z.url().transform((u) => u.replace(/\/+$/, '')),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  /** 秘密の入口（https://…/enter/この文字 からだけログイン画面を出す）。16 文字以上の英数字。なければ入口なし */
  WEB_ENTRY_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,128}$/, 'WEB_ENTRY_KEY は 16 文字以上の英数字にしてください')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Discord でのログイン（on にすると使える。標準は止めて、ID とパスワードだけ） */
  WEB_DISCORD_LOGIN: z.enum(['on', 'off']).default('off'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function loadWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  return webEnvSchema.parse(env);
}

export type AdminLevel = 'shinshoku' | 'guji';

/** URL のパスが、選べるページのどれか（選べないページ・ログインなどは undefined = だれでも通す） */
export function webPageOf(path: string): WebPage | undefined {
  const first = path.split('/')[1] ?? '';
  return WEB_PAGES.find((p) => (p.prefixes as readonly string[]).includes(first))?.key;
}

/** 社務所Web に入れる人（role: そのロールの人 / member: その人だけ）。pages の '*' は「全部（これから増えるページも）」 */
export type WebAccessEntry = { kind: 'role' | 'member'; id: string; pages: (WebPage | '*')[] };

/** 前の「ロールを選ぶだけ」の分も、全部のページの行として並べる */
export function webAccessEntries(cfg: GuildConfig): WebAccessEntry[] {
  const legacy = cfg.webAccess.shinshokuRoleIds
    .filter((id) => !cfg.webAccess.entries.some((e) => e.kind === 'role' && e.id === id))
    .map((id) => ({ kind: 'role' as const, id, pages: ['*' as const] }));
  return [...legacy, ...cfg.webAccess.entries];
}

/** pages: 見られるページ（null は全部） */
export type WebAccess = { level: AdminLevel; pages: WebPage[] | null };

/**
 * 社務所Web に入れるか・どのページを見られるか（Discord の運営コマンドは adminLevelOf のまま）。
 * 宮司: 全部。人を指定した行があれば、神職でもその行のページだけ（1 つもなければ入れない）。
 * 神職: 全部。そのほか、ロールの行に当たる人は神職と同じで、当たった行のページを合わせたもの
 */
export function webAccessOf(cfg: GuildConfig, userId: string, roleIds: readonly string[]): WebAccess | undefined {
  const admin = adminLevelOf(cfg, roleIds);
  if (admin === 'guji') return { level: 'guji', pages: null };
  const entries = webAccessEntries(cfg);
  const pagesOf = (list: WebAccessEntry[]): WebPage[] | null =>
    list.some((e) => e.pages.includes('*')) ? null : WEB_PAGE_KEYS.filter((k) => list.some((e) => e.pages.includes(k)));
  const mine = entries.find((e) => e.kind === 'member' && e.id === userId);
  if (mine) {
    const pages = pagesOf([mine]);
    return pages?.length === 0 ? undefined : { level: 'shinshoku', pages };
  }
  if (admin) return { level: admin, pages: null };
  const hits = entries.filter((e) => e.kind === 'role' && roleIds.includes(e.id) && e.pages.length);
  return hits.length ? { level: 'shinshoku', pages: pagesOf(hits) } : undefined;
}

/** ロールから管理画面の権限を決める（宮司が上） */
export function adminLevelOf(cfg: GuildConfig, roleIds: readonly string[]): AdminLevel | undefined {
  const byKey = (key: string) => cfg.ranks.filter((r) => r.key === key).map((r) => r.roleId);
  const guji = cfg.admin?.gujiRoleIds.length ? cfg.admin.gujiRoleIds : byKey('guji');
  const shinshoku = cfg.admin?.shinshokuRoleIds.length ? cfg.admin.shinshokuRoleIds : byKey('shinshoku');
  if (roleIds.some((id) => guji.includes(id))) return 'guji';
  if (roleIds.some((id) => shinshoku.includes(id))) return 'shinshoku';
  return undefined;
}

export function parseGuildConfig(json: unknown): GuildConfig {
  return guildConfigSchema.parse(json);
}

export function loadGuildConfig(file: string): GuildConfig {
  return parseGuildConfig(JSON.parse(readFileSync(file, 'utf8')));
}

/** 自己紹介のチャンネル（#絵馬-男性・#絵馬-女性・#運営紹介）。授与品「絵馬の奉納」でピン留めできる */
export function emaChannelIds(cfg: GuildConfig): string[] {
  return [cfg.channels.ema, cfg.channels.emaFemale, cfg.channels.staffIntro].filter((id): id is string => Boolean(id));
}

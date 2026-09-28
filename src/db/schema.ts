import { sql } from 'drizzle-orm';
import type { GachaTier, TicketKind } from '../config.js';
import { bigint, bigserial, boolean, check, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * 朱印（評価スタンプ）。
 * (giver_id, receiver_id) を主キーにして「同じ人には 1 回だけ」を DB で保証する。
 * 取り消しは revoked_at を入れる論理削除で、押し直すと null に戻して再利用する。
 */
export const shuin = pgTable(
  'shuin',
  {
    giverId: text('giver_id').notNull(),
    receiverId: text('receiver_id').notNull(),
    /** 押した時点の格（ご縁の加算量） */
    weight: integer('weight').notNull(),
    /** 押した時点の役職キー（例: sewayaku） */
    giverRank: text('giver_rank').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.giverId, t.receiverId] }),
    index('shuin_receiver_idx').on(t.receiverId),
    check('shuin_not_self', sql`${t.giverId} <> ${t.receiverId}`),
    check('shuin_weight_positive', sql`${t.weight} > 0`),
  ],
);

export type Shuin = typeof shuin.$inferSelect;

/**
 * サーバーのメンバー（BOT が参加・退出・ロール変更を同期する）。
 * 管理画面の一覧・検索はこのテーブルだけで作る（Discord に問い合わせない）。
 */
export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    /** アバター画像の URL */
    avatarUrl: text('avatar_url'),
    roleIds: text('role_ids').array().notNull().default(sql`'{}'::text[]`),
    isBot: boolean('is_bot').notNull().default(false),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    /** 退出した日時（在籍中は null） */
    leftAt: timestamp('left_at', { withTimezone: true }),
    /** サーバーブースト（奉納）を始めた日時（していなければ null） */
    boostingSince: timestamp('boosting_since', { withTimezone: true }),
    /** 年齢区分: minor（13〜17）/ adult（18 以上）/ unknown。生年月日は持たない */
    ageGroup: text('age_group').notNull().default('unknown'),
    /** 最後に発言した・通話に入った日時 */
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('members_display_name_idx').on(t.displayName),
    index('members_left_at_idx').on(t.leftAt),
    check('members_age_group', sql`${t.ageGroup} in ('minor', 'adult', 'unknown')`),
  ],
);

/** 参加・退出・再参加・昇格の履歴 */
export const memberEvents = pgTable(
  'member_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    /** join / rejoin / leave / promote */
    kind: text('kind').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('member_events_member_idx').on(t.memberId, t.at)],
);

/** 操作の記録（追記のみ。消さない） */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: text('actor_id').notNull(),
    targetId: text('target_id'),
    /** 例: auth.login / yaku.add / member.kick */
    action: text('action').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    /** web / discord / system */
    via: text('via').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_at_idx').on(t.at), index('audit_logs_target_idx').on(t.targetId, t.at)],
);

/** 管理画面のログイン状態。id にはトークンそのものではなく SHA-256 を入れる */
export const adminSessions = pgTable('admin_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  username: text('username').notNull(),
  avatarUrl: text('avatar_url'),
  /** shinshoku / guji */
  level: text('level').notNull(),
  csrfToken: text('csrf_token').notNull(),
  /** 最後に Discord のロールを確認した日時 */
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Member = typeof members.$inferSelect;
export type MemberEvent = typeof memberEvents.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;

/** 通貨（花びら）の残高。変更は必ず coin_tx と同じトランザクションで行う */
export const wallets = pgTable(
  'wallets',
  {
    memberId: text('member_id').primaryKey(),
    balance: integer('balance').notNull().default(0),
    /** これまでに貯めた合計（使っても減らない） */
    lifetimeEarned: integer('lifetime_earned').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('wallets_balance_nonneg', sql`${t.balance} >= 0`)],
);

/** 通貨の入出金の記録 */
export const coinTx = pgTable(
  'coin_tx',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    /** 増えたら正、減ったら負 */
    amount: integer('amount').notNull(),
    /** voice / shuin_give / shuin_receive / shuin_revoke / menzaifu / adjust */
    reason: text('reason').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('coin_tx_member_idx').on(t.memberId, t.at)],
);

/** 厄（警告）。cleared_at が null のものが「今ついている厄」 */
export const yaku = pgTable(
  'yaku',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    /** normal: 通常の厄 / instant_ban: 一発 BAN */
    kind: text('kind').notNull().default('normal'),
    reason: text('reason').notNull(),
    issuedBy: text('issued_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    clearedBy: text('cleared_by'),
    /** menzaifu: 免罪符 / staff: 神職が取り消し */
    clearedReason: text('cleared_reason'),
    clearedNote: text('cleared_note'),
  },
  (t) => [index('yaku_member_idx').on(t.memberId, t.createdAt)],
);

/** 神職どうしの申し送りメモ（本人には見えない） */
export const memos = pgTable(
  'memos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    body: text('body').notNull(),
    authorId: text('author_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('memos_member_idx').on(t.memberId, t.createdAt)],
);

/** 日ごとの活動（発言の本文は保存しない）。date は日本時間の日付 */
export const activityDaily = pgTable(
  'activity_daily',
  {
    memberId: text('member_id').notNull(),
    date: text('date').notNull(),
    messageCount: integer('message_count').notNull().default(0),
    vcMinutes: integer('vc_minutes').notNull().default(0),
    /** その日に通話で貯めた通貨（1 日の上限の判定用） */
    vcCoins: integer('vc_coins').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.date] })],
);

export type Wallet = typeof wallets.$inferSelect;
export type CoinTx = typeof coinTx.$inferSelect;
export type Yaku = typeof yaku.$inferSelect;
export type Memo = typeof memos.$inferSelect;
export type ActivityDaily = typeof activityDaily.$inferSelect;

/** 入鯖申請・宵参り申請 */
export const applications = pgTable(
  'applications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    /** join: 入鯖 / yoimairi: 宵参り（成人エリア） */
    kind: text('kind').notNull(),
    answers: jsonb('answers').$type<Record<string, string>>().notNull().default({}),
    /** pending / approved / rejected */
    status: text('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    note: text('note'),
    /** #申請受付 に出したカード（あとで「承認済み」に書き換える） */
    channelId: text('channel_id'),
    messageId: text('message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('applications_status_idx').on(t.status, t.createdAt),
    index('applications_member_idx').on(t.memberId),
    // 同じ人の同じ種類の申請は、待ちが 1 件まで
    uniqueIndex('applications_one_pending').on(t.memberId, t.kind).where(sql`${t.status} = 'pending'`),
  ],
);

/** お参り期間（新人期間） */
export const omairi = pgTable('omairi', {
  memberId: text('member_id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  extendedCount: integer('extended_count').notNull().default(0),
  /** ongoing / promoted / review / removed */
  status: text('status').notNull().default('ongoing'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

/** 匿名相談 */
export const soudan = pgTable(
  'soudan',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** open / in_progress / done */
    status: text('status').notNull().default('open'),
    assigneeId: text('assignee_id'),
    channelId: text('channel_id'),
    messageId: text('message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('soudan_status_idx').on(t.status, t.updatedAt)],
);

/** 相談した人（神職には見せない。宮司が確認したときだけ読み、記録に残す） */
export const soudanSenders = pgTable('soudan_senders', {
  soudanId: bigint('soudan_id', { mode: 'number' }).primaryKey(),
  senderId: text('sender_id').notNull(),
});

/** 相談のやり取り */
export const soudanMessages = pgTable(
  'soudan_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    soudanId: bigint('soudan_id', { mode: 'number' }).notNull(),
    /** sender: 相談した人 / staff: 神職 */
    fromRole: text('from_role').notNull(),
    /** 神職のときだけ入れる（相談した人の ID はここに入れない） */
    staffId: text('staff_id'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('soudan_messages_idx').on(t.soudanId, t.createdAt)],
);

/** 管理画面から変えた設定（config/guild.json の値を上書きする） */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Application = typeof applications.$inferSelect;
export type Omairi = typeof omairi.$inferSelect;
export type Soudan = typeof soudan.$inferSelect;
export type SoudanMessage = typeof soudanMessages.$inferSelect;

/**
 * 掲示（#鳥居・#しきたり などに BOT が投稿する文面）。管理画面（宮司）から編集する。
 * body は {免罪符の値段} や {#しきたり} などの差し込みを含むひな形で、投稿するときに今の設定で置き換える。
 */
export const notices = pgTable(
  'notices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    channelId: text('channel_id').notNull(),
    /** 同じチャンネルの中での順番（小さいほど上） */
    position: integer('position').notNull(),
    /** 管理画面で見分けるための名前（Discord には出ない） */
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** 見せ方: embed = カード（1 つずつ区切られて見やすい）、text = 普通のメッセージ */
    style: text('style').$type<'embed' | 'text'>().notNull().default('embed'),
    /** 投稿済みならそのメッセージ ID */
    messageId: text('message_id'),
    /** 最後に投稿・書き換えしたときの本文（差し込み後）。今の本文と違えば「未反映」 */
    postedText: text('posted_text'),
    /** 最後に投稿・書き換えしたときの見せ方 */
    postedStyle: text('posted_style'),
    /** ピン留めする（チャンネルの使い方の案内など。話が流れても上のピンから読める） */
    pinned: boolean('pinned').notNull().default(false),
    /** Discord でピン留めできているか */
    postedPinned: boolean('posted_pinned').notNull().default(false),
    /** いちばん下に表示し続ける（誰かが書き込むと、落ち着いてから下へ置き直す。#絵馬 のひな形など） */
    sticky: boolean('sticky').notNull().default(false),
    /** メンション: '' = なし、'here'、'everyone'、または ロール ID をカンマ区切り。通知が届くのは最初に投稿したときだけ */
    mention: text('mention').notNull().default(''),
    /** 最後に投稿・書き換えしたときのメンション */
    postedMention: text('posted_mention'),
    /** 写真（中身は notice_images）の印。写真がなければ null */
    imageHash: text('image_hash'),
    /** 写真を本文の上に出すか下に出すか */
    imagePosition: text('image_position').$type<'top' | 'bottom'>().notNull().default('bottom'),
    /** 最後に投稿・書き換えしたときの写真（印:上下）。なければ null */
    postedImage: text('posted_image'),
    /** 「🌸 朱印を押す」ボタンを付ける（#絵馬 のひな形など。押すと相手を選んで朱印を押せる） */
    shuinButton: boolean('shuin_button').notNull().default(false),
    /** 最後に投稿・書き換えしたときにボタンを付けていたか */
    postedShuinButton: boolean('posted_shuin_button').notNull().default(false),
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notices_channel_idx').on(t.channelId, t.position)],
);

export type Notice = typeof notices.$inferSelect;

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength),
  fromDriver: (v) => new Uint8Array(v),
});

/** 掲示の写真（投稿するたびに Discord に添付して送る） */
export const noticeImages = pgTable('notice_images', {
  noticeId: bigint('notice_id', { mode: 'number' })
    .primaryKey()
    .references(() => notices.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  data: bytea('data').notNull(),
  hash: text('hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 自分の通話部屋（➕ の通話に入るとできる。全員抜けたら消して、行も消す） */
export const tempVoice = pgTable('temp_voice', {
  channelId: text('channel_id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  hubId: text('hub_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** 部屋の種類（宿坊・宵宮）: public 公開 / invite 招待限定 / secret シークレット / twoshot ツーショット */
  kind: text('kind').$type<'public' | 'invite' | 'secret' | 'twoshot'>().notNull().default('public'),
  /** この部屋で払った花びら（1 回払いの部屋で、種類を変えたときの差額に使う） */
  paid: integer('paid').notNull().default(0),
  /** 1 時間ごとの部屋: ここまで払ってある */
  paidUntil: timestamp('paid_until', { withTimezone: true }),
  /** 1 時間ごとの部屋: 払えなくなった時刻（5 分たったら閉じる） */
  unpaidSince: timestamp('unpaid_since', { withTimezone: true }),
  /** 招待した人 */
  invited: text('invited').array().notNull().default(sql`'{}'::text[]`),
  /** 種類を選んだ（1 回だけ選べる。選んだあとは変えられない） */
  kindLocked: boolean('kind_locked').notNull().default(false),
  /** 部屋主の分の部屋代を払う人（権限を譲渡して「部屋代は自分が持つ」を選んだ前の部屋主）。なければ部屋主 */
  payerId: text('payer_id'),
  /** 部屋代無料券を使った（1 回払いの部屋: この部屋では種類を変えても払わない） */
  freeTicket: boolean('free_ticket').notNull().default(false),
});

/** おみくじ（1 日 1 回。(member_id, date) を主キーにして 2 回引けないようにする） */
export const omikuji = pgTable(
  'omikuji',
  {
    memberId: text('member_id').notNull(),
    /** 日本時間の日付（YYYY-MM-DD） */
    date: text('date').notNull(),
    fortune: text('fortune').notNull(),
    /** もらった花びら */
    amount: integer('amount').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.date] })],
);

/**
 * ショップ（授与品）の品物。管理画面（宮司）で名前・値段・説明・販売のオン／オフを変えられる。
 * kind: role = ロールを付ける（色守り・称号）、ほかは決まった動き
 */
export const shopItems = pgTable(
  'shop_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').$type<'role' | 'hanafubuki' | 'gift' | 'ema_pin' | 'omikuji_extra' | 'menzaifu'>().notNull(),
    name: text('name').notNull(),
    emoji: text('emoji').notNull().default(''),
    description: text('description').notNull().default(''),
    /** 値段（免罪符は設定の値段を使うので 0） */
    price: integer('price').notNull().default(0),
    /** kind = role のとき付けるロール */
    roleId: text('role_id'),
    /** 同じ組のロールは 1 つだけ（色守りを買い替えると前の色は外れる）。例: color / title */
    roleGroup: text('role_group'),
    /** 何日で外れるか（なし = ずっと） */
    durationDays: integer('duration_days'),
    enabled: boolean('enabled').notNull().default(true),
    position: integer('position').notNull().default(0),
    /** 奉納（ブースト）している人だけが受けられる。ロールは奉納をやめると外れる */
    boosterOnly: boolean('booster_only').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('shop_items_price', sql`${t.price} >= 0`)],
);

export type ShopItem = typeof shopItems.$inferSelect;

/** 買った記録（期限のあるもの＝色守り・絵馬のピン留めは、期限が来たら BOT が外す） */
export const shopPurchases = pgTable(
  'shop_purchases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    itemId: bigint('item_id', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    price: integer('price').notNull(),
    roleId: text('role_id'),
    /** 花吹雪・贈り物の相手 */
    targetId: text('target_id'),
    /** 絵馬のピン留め: チャンネルとメッセージ */
    channelId: text('channel_id'),
    messageId: text('message_id'),
    /** 使った券（割引券・絵馬のピン留め券。払い戻すときに券も戻す） */
    ticket: text('ticket').$type<TicketKind>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** 期限切れで外した・買い替えた・払い戻した日時 */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shop_purchases_member_idx').on(t.memberId, t.createdAt), index('shop_purchases_expires_idx').on(t.expiresAt)],
);

export type ShopPurchase = typeof shopPurchases.$inferSelect;

/**
 * ブースト（奉納）のお礼。奉納 1 回（Discord の「ブーストを始めた日時」）ごとに 1 行。
 * お知らせは 1 回だけ。花びらは同じ人に 30 日に 1 回まで（やめてすぐ始め直しても増えない）。
 */
export const boostThanks = pgTable(
  'boost_thanks',
  {
    memberId: text('member_id').notNull(),
    /** Discord の premium_since */
    since: timestamp('since', { withTimezone: true }).notNull(),
    announcedAt: timestamp('announced_at', { withTimezone: true }).notNull().defaultNow(),
    /** この奉納で最後に花びらを贈った日時 */
    lastRewardAt: timestamp('last_reward_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.since] })],
);

/** ブーストのお知らせ（Discord のシステムメッセージ）ごとのお礼。同じメッセージで 2 回贈らないための記録 */
export const boostMessages = pgTable('boost_messages', {
  messageId: text('message_id').primaryKey(),
  memberId: text('member_id').notNull(),
  /** 何回分のブーストか */
  count: integer('count').notNull(),
  /** 贈った花びら */
  granted: integer('granted').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

/** 1 時間ごとの部屋（宵宮）: 入っている人それぞれが、どこまで払ってあるか */
export const roomPayers = pgTable(
  'room_payers',
  {
    channelId: text('channel_id').notNull(),
    memberId: text('member_id').notNull(),
    paidUntil: timestamp('paid_until', { withTimezone: true }).notNull(),
    /** 払えなくなった時刻（5 分たったら通話から抜ける） */
    unpaidSince: timestamp('unpaid_since', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.memberId] })],
);

/** 市場: 開業権利を持つ人の出品（イラスト・歌・作成物・通話など）。花びらだけで売り買いする */
export const marketListings = pgTable(
  'market_listings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id').notNull(),
    /** illust / voice / craft / call / other */
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    price: integer('price').notNull(),
    /** open 受付中 / closed 売った人が終了 / removed 運営が取り下げ */
    status: text('status').$type<'open' | 'closed' | 'removed'>().notNull().default('open'),
    channelId: text('channel_id'),
    messageId: text('message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('market_listings_seller_idx').on(t.sellerId), check('market_listings_price', sql`${t.price} > 0`)],
);
export type MarketListing = typeof marketListings.$inferSelect;

/** 市場の取引。買った人の花びらは預かっておき、「受け取った」（または期限）で売った人に渡す */
export const marketOrders = pgTable(
  'market_orders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    listingId: bigint('listing_id', { mode: 'number' }).notNull(),
    buyerId: text('buyer_id').notNull(),
    sellerId: text('seller_id').notNull(),
    price: integer('price').notNull(),
    /** サーバーの手数料（売った人に渡すのは price - fee） */
    fee: integer('fee').notNull(),
    /** paid 預かり中 / completed 渡した / disputed 問題あり（運営が判断） / refunded 買った人に戻した */
    status: text('status').$type<'paid' | 'completed' | 'disputed' | 'refunded'>().notNull().default('paid'),
    /** やり取りのスレッド */
    threadId: text('thread_id'),
    /** この時刻までに「受け取った」「問題あり」がなければ、売った人に渡す */
    autoReleaseAt: timestamp('auto_release_at', { withTimezone: true }).notNull(),
    decidedBy: text('decided_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [index('market_orders_status_idx').on(t.status, t.autoReleaseAt)],
);
export type MarketOrder = typeof marketOrders.$inferSelect;

/** 「はじめての参拝」を全部できた人（お祝いは 1 人 1 回） */
export const onboardingDone = pgTable('onboarding_done', {
  memberId: text('member_id').primaryKey(),
  reward: integer('reward').notNull().default(0),
  doneAt: timestamp('done_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 招待（入鯖申請で「招待してくれた人」に選ばれた人）。お礼は招待された人 1 人につき 1 回 */
export const invites = pgTable(
  'invites',
  {
    memberId: text('member_id').primaryKey(),
    inviterId: text('inviter_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    rewardedAt: timestamp('rewarded_at', { withTimezone: true }),
    reward: integer('reward').notNull().default(0),
    /** answer: 申請で選んだ / link: その人の招待リンクで入った */
    source: text('source').notNull().default('answer'),
  },
  (t) => [index('invites_inviter_idx').on(t.inviterId)],
);

export type Invite = typeof invites.$inferSelect;

/** 招待された人が浮上した日ごとの、招待した人へのボーナス（1 人 1 日 1 回） */
export const inviteActive = pgTable(
  'invite_active',
  {
    memberId: text('member_id').notNull(),
    /** 日本時間の日付（YYYY-MM-DD） */
    date: text('date').notNull(),
    inviterId: text('inviter_id').notNull(),
    amount: integer('amount').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.date] })],
);

/** BOT が作った、メンバーごとの招待リンク（だれのリンクで入ったか分かるように） */
export const inviteLinks = pgTable(
  'invite_links',
  {
    code: text('code').primaryKey(),
    inviterId: text('inviter_id').notNull(),
    channelId: text('channel_id').notNull(),
    /** 最後に確かめたときの使われた回数 */
    uses: integer('uses').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Discord で消されていた・作り直した */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('invite_links_inviter_idx').on(t.inviterId)],
);

export type InviteLink = typeof inviteLinks.$inferSelect;

/** 自己紹介（#絵馬-男性・#絵馬-女性 に書いた、いちばん新しいもの）。プロフィールに出す */
export const intros = pgTable('intros', {
  memberId: text('member_id').primaryKey(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  /** 本文のはじめ（BOT が本文を読めないときは空） */
  excerpt: text('excerpt').notNull().default(''),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
});

export type Intro = typeof intros.$inferSelect;

/** 通話にいた時間（人 × 日 × 通話チャンネル。1 分ごとに足す。AFK はのぞく） */
export const voiceUsage = pgTable(
  'voice_usage',
  {
    memberId: text('member_id').notNull(),
    /** 日本時間の日付（YYYY-MM-DD） */
    date: text('date').notNull(),
    channelId: text('channel_id').notNull(),
    minutes: integer('minutes').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.date, t.channelId] }), index('voice_usage_date_idx').on(t.date)],
);

/** 同じ通話にいた時間（2 人 × 日。member_a < member_b） */
export const voicePairs = pgTable(
  'voice_pairs',
  {
    memberA: text('member_a').notNull(),
    memberB: text('member_b').notNull(),
    date: text('date').notNull(),
    minutes: integer('minutes').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.memberA, t.memberB, t.date] }), index('voice_pairs_b_idx').on(t.memberB), index('voice_pairs_date_idx').on(t.date)],
);

/** 通話チャンネルの記録（名前・カテゴリ。自分の通話部屋は、消えたあとも作った人・種類が分かるように） */
export const voiceChannels = pgTable('voice_channels', {
  channelId: text('channel_id').primaryKey(),
  name: text('name').notNull(),
  categoryId: text('category_id'),
  categoryName: text('category_name'),
  /** 自分の通話部屋のとき: 入口・作った人・種類 */
  hubId: text('hub_id'),
  ownerId: text('owner_id'),
  kind: text('kind'),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
});

export type VoiceChannelRow = typeof voiceChannels.$inferSelect;

/** 呼び鈴（運営を呼んだ記録） */
export const bells = pgTable(
  'bells',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    /** 鳴らしたチャンネル */
    channelId: text('channel_id'),
    /** そのとき入っていた通話 */
    voiceChannelId: text('voice_channel_id'),
    reason: text('reason').notNull().default(''),
    /** 呼んだロール */
    roleId: text('role_id'),
    /** open: 待っている / taken: 対応中 / done: 対応済み */
    status: text('status').notNull().default('open'),
    takenBy: text('taken_by'),
    /** 運営に出したカード */
    cardChannelId: text('card_channel_id'),
    cardMessageId: text('card_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    takenAt: timestamp('taken_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (t) => [index('bells_member_idx').on(t.memberId, t.createdAt)],
);

export type Bell = typeof bells.$inferSelect;

/** 物御籤: 1 人ごとの回数（大吉が出てからの回数で天井を数える） */
export const gachaState = pgTable('gacha_state', {
  memberId: text('member_id').primaryKey(),
  /** 大吉が出てから引いた回数 */
  sinceTop: integer('since_top').notNull().default(0),
  total: integer('total').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 持っている券（部屋代無料・絵馬のピン留め・市場の手数料なし） */
export const tickets = pgTable(
  'tickets',
  {
    memberId: text('member_id').notNull(),
    kind: text('kind').$type<TicketKind>().notNull(),
    count: integer('count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.kind] })],
);

/** 物御籤を引いた記録 */
export const gachaDraws = pgTable(
  'gacha_draws',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    tier: text('tier').$type<GachaTier>().notNull(),
    /** 天井で出た */
    pity: boolean('pity').notNull().default(false),
    /** 1 回分の値段 */
    price: integer('price').notNull(),
    roleId: text('role_id'),
    ticket: text('ticket').$type<TicketKind>(),
    ticketCount: integer('ticket_count').notNull().default(0),
    coins: integer('coins').notNull().default(0),
    /** 出た中身（gacha_prizes） */
    prizeId: bigint('prize_id', { mode: 'number' }),
    /** ショップの品が出たとき */
    shopItemId: integer('shop_item_id'),
    /** 自由な券が出たとき（枚数は ticket_count） */
    customTicketId: bigint('custom_ticket_id', { mode: 'number' }),
    /** 十二支のお守りが出たとき（子・丑…） */
    zodiac: text('zodiac'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gacha_draws_member_idx').on(t.memberId, t.createdAt)],
);

export type GachaDraw = typeof gachaDraws.$inferSelect;

/**
 * 物御籤の中身（運勢ごとにいくつでも）。運勢が決まったら、その運勢の中から重みで 1 つ選ぶ。
 * kind: role 限定ロール / ticket 券 / coins 花びら / shop ショップのロールの品（色守り・称号など）
 */
export const gachaPrizes = pgTable(
  'gacha_prizes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tier: text('tier').$type<GachaTier>().notNull(),
    kind: text('kind').$type<'role' | 'ticket' | 'coins' | 'shop' | 'special' | 'custom' | 'zodiac'>().notNull(),
    /** 運営が渡す特別な賞品の名前（例: Discord Nitro 1 か月分） */
    label: text('label'),
    /** 残りの数（null はいくらでも。0 になったら出ない） */
    stock: integer('stock'),
    /** 自由な券（custom_tickets） */
    customTicketId: bigint('custom_ticket_id', { mode: 'number' }),
    /** 期間限定（この間だけ出る。なければいつでも） */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    roleId: text('role_id'),
    ticket: text('ticket').$type<TicketKind>(),
    shopItemId: integer('shop_item_id'),
    /** 券の枚数・花びらの枚数 */
    amount: integer('amount').notNull().default(1),
    /** 同じ運勢の中での出やすさ */
    weight: integer('weight').notNull().default(1),
    /** ほかの中身が出せないとき（ロールを全部持っているなど）だけ出す */
    fallback: boolean('fallback').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    position: integer('position').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gacha_prizes_tier_idx').on(t.tier, t.position)],
);

export type GachaPrizeRow = typeof gachaPrizes.$inferSelect;

/** 部屋の一日券（使い始めてから 24 時間、その種類の部屋代が無料） */
export const roomPasses = pgTable(
  'room_passes',
  {
    memberId: text('member_id').notNull(),
    kind: text('kind').$type<'public' | 'invite' | 'secret' | 'twoshot'>().notNull(),
    until: timestamp('until', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.kind] })],
);

/** 使っている札（fuku: 福の札・until まで通話の銭 2 倍 / luck: 運気アップの札・あと remaining 回、物御籤の大吉 2 倍） */
export const memberBuffs = pgTable(
  'member_buffs',
  {
    memberId: text('member_id').notNull(),
    kind: text('kind').$type<'fuku' | 'luck'>().notNull(),
    until: timestamp('until', { withTimezone: true }),
    remaining: integer('remaining').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.kind] })],
);

/** 名前の飾り（until まで、名前の前に絵文字。終わったら base の名前に戻す） */
export const nameDecos = pgTable('name_decos', {
  memberId: text('member_id').primaryKey(),
  emoji: text('emoji').notNull(),
  /** 飾る前のニックネーム（なければ null = サーバーのニックネームなし） */
  baseNick: text('base_nick'),
  until: timestamp('until', { withTimezone: true }).notNull(),
});

export type NameDeco = typeof nameDecos.$inferSelect;

/** 運営が渡す特別な賞品の当たり（渡したら deliveredAt） */
export const gachaClaims = pgTable(
  'gacha_claims',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    prizeId: bigint('prize_id', { mode: 'number' }),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    deliveredBy: text('delivered_by'),
  },
  (t) => [index('gacha_claims_created_idx').on(t.createdAt)],
);

export type GachaClaim = typeof gachaClaims.$inferSelect;

/** 自由な券（運営が名前を決める券。使うと運営に知らせて、運営が対応する） */
export const customTickets = pgTable('custom_tickets', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  emoji: text('emoji').notNull().default('🎟'),
  name: text('name').notNull(),
  note: text('note').notNull().default(''),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CustomTicket = typeof customTickets.$inferSelect;

/** 自由な券を持っている枚数 */
export const customTicketHoldings = pgTable(
  'custom_ticket_holdings',
  {
    memberId: text('member_id').notNull(),
    ticketId: bigint('ticket_id', { mode: 'number' }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.ticketId] })],
);

/** 十二支のお守りコレクション（物御籤で 1 つずつ集める） */
export const gachaCollection = pgTable(
  'gacha_collection',
  {
    memberId: text('member_id').notNull(),
    item: text('item').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.item] })],
);

/** 全員へのプレゼント（社務所Web から。同じ送信を 2 回受けないよう nonce を覚える） */
export const giftBatches = pgTable('gift_batches', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  nonce: text('nonce').notNull().unique(),
  /** coins / 券の種類 / custom:<id> */
  item: text('item').notNull(),
  /** 贈ったときの名前（あとで券の名前が変わっても分かるように） */
  label: text('label').notNull(),
  count: integer('count').notNull(),
  note: text('note').notNull(),
  /** このロールを持っている人だけに贈ったとき */
  roleId: text('role_id'),
  recipients: integer('recipients').notNull(),
  by: text('by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type GiftBatch = typeof giftBatches.$inferSelect;

/** 期間限定イベント（通話ボーナス・授与品セール・物御籤セール）。始まり・終わりは BOT が自動で知らせる */
export const economyEvents = pgTable('economy_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** voice = 通話でもらえる銭が value% に / shop = 授与品が value% 引き / gacha = 物御籤が value% 引き */
  kind: text('kind').$type<'voice' | 'shop' | 'gacha'>().notNull(),
  value: integer('value').notNull(),
  title: text('title').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  /** 始まり・終わりを知らせるチャンネル（なければ知らせない） */
  announceChannelId: text('announce_channel_id'),
  startNotified: boolean('start_notified').notNull().default(false),
  endNotified: boolean('end_notified').notNull().default(false),
  /** 途中でやめた */
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EconomyEvent = typeof economyEvents.$inferSelect;

/** 経済の警告（同じものを 2 回知らせないよう key を覚える） */
export const economyAlerts = pgTable(
  'economy_alerts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    key: text('key').notNull().unique(),
    /** earn = 稼ぎすぎ / spend = 使いすぎ / saisen = お賽銭 / report = 週ごとのお知らせ */
    kind: text('kind').notNull(),
    memberId: text('member_id'),
    amount: integer('amount').notNull().default(0),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('economy_alerts_created_idx').on(t.createdAt)],
);

export type EconomyAlert = typeof economyAlerts.$inferSelect;

/** 用語集（社務所Web で編集。#しきたり・#用語集 の掲示と /用語 に出す） */
export const glossaryTerms = pgTable(
  'glossary_terms',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** roles / system / economy / gacha / places / voice */
    category: text('category').notNull(),
    term: text('term').notNull(),
    /** 読みがな（/用語 で探せる） */
    reading: text('reading').notNull().default(''),
    emoji: text('emoji').notNull().default(''),
    description: text('description').notNull(),
    /** 別の呼び名（カンマ区切り。/用語 で探せる） */
    aliases: text('aliases').notNull().default(''),
    position: integer('position').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('glossary_terms_category_idx').on(t.category, t.position)],
);

export type GlossaryTerm = typeof glossaryTerms.$inferSelect;

/** 募集の記録（続けて募集できない時間を、BOT を起動し直しても覚えておく） */
export const recruitPosts = pgTable(
  'recruit_posts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    channelId: text('channel_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recruit_posts_member_idx').on(t.memberId, t.createdAt), index('recruit_posts_channel_idx').on(t.channelId, t.createdAt)],
);

/** 面談（面談告知のページで作る。予約して流す・リマインド・時間の変更・中止） */
export const interviews = pgTable(
  'interviews',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** 面談の日時 */
    at: timestamp('at', { withTimezone: true }).notNull(),
    /** 場所: 通話チャンネル（リンクにする）か、手で書いた場所 */
    placeChannelId: text('place_channel_id'),
    placeText: text('place_text').notNull().default(''),
    note: text('note').notNull().default(''),
    /** 使った定型文（あとで定型文を直しても、この面談の文面は変わらない） */
    templateName: text('template_name').notNull(),
    template: text('template').notNull(),
    /** 流すチャンネルと、流す日時（予約。今すぐなら作った日時） */
    channelId: text('channel_id').notNull(),
    postAt: timestamp('post_at', { withTimezone: true }).notNull(),
    /** scheduled 予約中 / posted 流した / cancelled 中止 */
    status: text('status').$type<'scheduled' | 'posted' | 'cancelled'>().notNull().default('scheduled'),
    messageId: text('message_id'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    /** リマインド（1 時間前・10 分前）と、流したか */
    remind60: boolean('remind_60').notNull().default(true),
    remind10: boolean('remind_10').notNull().default(true),
    remind60At: timestamp('remind_60_at', { withTimezone: true }),
    remind10At: timestamp('remind_10_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('interviews_at_idx').on(t.at), index('interviews_status_idx').on(t.status, t.postAt)],
);

export type Interview = typeof interviews.$inferSelect;

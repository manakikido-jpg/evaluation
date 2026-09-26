import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notices_channel_idx').on(t.channelId, t.position)],
);

export type Notice = typeof notices.$inferSelect;

/** 自分の通話部屋（➕ の通話に入るとできる。全員抜けたら消して、行も消す） */
export const tempVoice = pgTable('temp_voice', {
  channelId: text('channel_id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  hubId: text('hub_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** 期限切れで外した・買い替えた・払い戻した日時 */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shop_purchases_member_idx').on(t.memberId, t.createdAt), index('shop_purchases_expires_idx').on(t.expiresAt)],
);

export type ShopPurchase = typeof shopPurchases.$inferSelect;

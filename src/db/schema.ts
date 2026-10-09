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
 * ✨ 特別ご縁（宮司が社務所Web から振る）。朱印のご縁に足して数える。
 * 取り消しは revoked_at を入れる（役職は下げない）。nonce で二度押しを 1 回にする。
 * checked_at は、BOT が昇格を確かめたら入れる（社務所Web からは Discord のロールを変えないため）。
 */
export const specialGoen = pgTable(
  'special_goen',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    grantedBy: text('granted_by').notNull(),
    nonce: text('nonce').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
  },
  (t) => [
    index('special_goen_member_idx').on(t.memberId),
    uniqueIndex('special_goen_nonce_idx').on(t.nonce),
    check('special_goen_amount_positive', sql`${t.amount} > 0`),
  ],
);

export type SpecialGoen = typeof specialGoen.$inferSelect;

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
  /** 見られるページ（null は全部。社務所Web の「設定」で人・ロールごとに選ぶ） */
  pages: text('pages').array(),
  /** ID とパスワードでログインしたとき、そのアカウント（Discord でログインしたときは null） */
  accountId: bigint('account_id', { mode: 'number' }),
  csrfToken: text('csrf_token').notNull(),
  /** 最後に Discord のロールを確認した日時 */
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** カジノのログイン（メンバーが Discord でログイン。運営の画面には入れない） */
export const memberSessions = pgTable('member_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  csrfToken: text('csrf_token').notNull(),
  /** 最後に Discord のロールを確認した日時 */
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MemberSession = typeof memberSessions.$inferSelect;

/** カジノにログインなしで入るリンク（/カジノ で BOT が作る。1 回きり・短い時間だけ）。id はリンクの印のハッシュ */
export const memberLoginLinks = pgTable('member_login_links', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** カジノの 1 回のゲーム（1 人で遊ぶもの）。state は BOT 側だけが持つ（山札など、見せない分も入る） */
export const casinoGames = pgTable(
  'casino_games',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    game: text('game').notNull(),
    /** 賭けた銭（ダブルダウンなどで増えた分も入れる） */
    bet: integer('bet').notNull(),
    state: jsonb('state').notNull(),
    /** playing / done */
    status: text('status').notNull().default('playing'),
    /** 戻った銭（負けは 0・引き分けは賭けた分） */
    payout: integer('payout').notNull().default(0),
    /** 同時に 2 回動かさないための番号 */
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('casino_games_member_idx').on(t.memberId, t.status), index('casino_games_created_idx').on(t.createdAt)],
);

export type CasinoGameRow = typeof casinoGames.$inferSelect;

/** メンバー同士の対戦（オセロ）。賭けた銭は両方から預かり、勝った人がまとめてもらう */
export const casinoMatches = pgTable(
  'casino_matches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    game: text('game').notNull().default('othello'),
    hostId: text('host_id').notNull(),
    guestId: text('guest_id'),
    bet: integer('bet').notNull(),
    state: jsonb('state').notNull(),
    /** open（相手待ち）/ playing / done / cancelled */
    status: text('status').notNull().default('open'),
    winnerId: text('winner_id'),
    /** どう終わったか（end / resign / timeout / cancel / expired） */
    endReason: text('end_reason'),
    version: integer('version').notNull().default(0),
    /** 最後に動いた日時（持ち時間の判定） */
    turnAt: timestamp('turn_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('casino_matches_status_idx').on(t.status)],
);

export type CasinoMatch = typeof casinoMatches.$inferSelect;

/**
 * みんなで座る卓（ブラックジャック・バカラ・ルーレットの卓、ポーカー、大富豪、ババ抜き）。
 * state に座っている人・山札・手札など全部を入れ、画面には見せてよい分だけ出す。動かすときは行をロックする
 */
export const casinoTables = pgTable(
  'casino_tables',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    hostId: text('host_id').notNull(),
    /** open / closed */
    status: text('status').notNull().default('open'),
    state: jsonb('state').notNull(),
    /** 座っている人（1 人 1 卓まで・自分の卓を探す） */
    seatIds: text('seat_ids').array().notNull().default(sql`'{}'::text[]`),
    version: integer('version').notNull().default(0),
    /** 次に時間で動く日時（持ち時間・次の回）。なければ null */
    dueAt: timestamp('due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('casino_tables_status_idx').on(t.status, t.kind)],
);

export type CasinoTable = typeof casinoTables.$inferSelect;

/**
 * 💰 カジノの収益の分け前: 日本時間の 1 日ごとに 1 行（同じ日は 2 回渡さない）。
 * profit: その日の胴元の収支（賭けた − 戻した。マイナスもある）。note: start（始めた日・渡さない）/ off / loss（赤字）/ no_one（宮司がいない）
 */
export const casinoProfitShares = pgTable('casino_profit_shares', {
  date: text('date').primaryKey(),
  profit: bigint('profit', { mode: 'number' }).notNull(),
  percent: integer('percent').notNull(),
  paid: bigint('paid', { mode: 'number' }).notNull().default(0),
  recipients: jsonb('recipients').$type<{ memberId: string; amount: number }[]>().notNull().default([]),
  note: text('note'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
export type CasinoProfitShare = typeof casinoProfitShares.$inferSelect;

/** 🤖 AI（BOT）と人の勝負（人と AI が両方いた勝負だけ）。AI の強さを直すときに見る */
export const aiMatches = pgTable(
  'ai_matches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** daifugo / babanuki / poker / mahjong / sanma */
    game: text('game').notNull(),
    /** ルールの違い（大富豪のローカルルール・麻雀の長さなど） */
    variant: text('variant').notNull().default(''),
    /** AI の版（AI を変えたら上げる。前とくらべられるように） */
    aiVersion: text('ai_version').notNull().default('1'),
    tableId: bigint('table_id', { mode: 'number' }),
    players: integer('players').notNull(),
    bots: integer('bots').notNull(),
    /** [{ id, name, bot, place, net, left? }] */
    seats: jsonb('seats').$type<{ id: string; name: string; bot: boolean; place: number; net: number; left?: boolean }[]>().notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_matches_game_idx').on(t.game, t.at)],
);

/** 社務所Web の ID とパスワード（宮司が発行する。パスワードは scrypt のハッシュだけ保存） */
export const webAccounts = pgTable('web_accounts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** ログイン ID（小文字で保存） */
  loginId: text('login_id').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** 画面に出す名前 */
  name: text('name').notNull(),
  /** guji / shinshoku */
  level: text('level').$type<'guji' | 'shinshoku'>().notNull(),
  /** 見られるページ（null は全部。神職のとき） */
  pages: text('pages').array(),
  /** 結びつけた Discord の人（記録に名前を出す。なくてもよい） */
  memberId: text('member_id'),
  disabled: boolean('disabled').notNull().default(false),
  /** 続けて間違えた回数と、ログインできない期限 */
  failedCount: integer('failed_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WebAccount = typeof webAccounts.$inferSelect;

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

/** 1 時間ごとの浮上（人 × 日本時間の日付 × 時。発言数と通話の分。浮上の時間帯のグラフ用） */
export const activityHourly = pgTable(
  'activity_hourly',
  {
    memberId: text('member_id').notNull(),
    date: text('date').notNull(),
    /** 日本時間の時（0〜23） */
    hour: integer('hour').notNull(),
    messages: integer('messages').notNull().default(0),
    vcMinutes: integer('vc_minutes').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.date, t.hour] }), index('activity_hourly_date_idx').on(t.date)],
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
    /** 出た一言（同じ人に同じ文が続かないように） */
    message: text('message'),
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
    /** otoshidama: お年玉袋（値段は手数料）/ mycolor: 自分だけの色（BOT がロールを作る） */
    /** casino_style: 🎴 勝負の御籤の品（見た目の品・お試し券。style_key で決める） */
    kind: text('kind').$type<'role' | 'hanafubuki' | 'gift' | 'ema_pin' | 'omikuji_extra' | 'menzaifu' | 'otoshidama' | 'mycolor' | 'casino_boost' | 'casino_style'>().notNull(),
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
    /** kind = casino_style のとき渡す品（勝負の御籤の品の key。trial = お試し券） */
    styleKey: text('style_key'),
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
    /** 🎁 プレゼントで買った人（memberId は受け取った人。払い戻しはこの人へ） */
    giftFrom: text('gift_from'),
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
    /** fixed: 値段を決めた / offer: 値段の提案を受ける（price は最低額） */
    price: integer('price').notNull(),
    pricing: text('pricing').$type<'fixed' | 'offer'>().notNull().default('fixed'),
    /** 通話の種類（twoshot / sleep / care / consult / other） */
    subcategory: text('subcategory'),
    /** 同時に受けられる取引の数（0 = いくつでも） */
    capacity: integer('capacity').notNull().default(0),
    /** 📞 今すぐ通話 OK（この時刻まで） */
    standbyUntil: timestamp('standby_until', { withTimezone: true }),
    /** カードの画像（Discord に上げ直した URL） */
    imageUrl: text('image_url'),
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
    /** 依頼の募集から（market_requests.id） */
    requestId: bigint('request_id', { mode: 'number' }),
    /** 通話の予定（📅 予定を決める） */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    /** 問題ありの種類（problem: 問題あり / noshow: 🚫 来なかった） */
    disputeKind: text('dispute_kind'),
    /** ⭐ 評価（1〜5）と一言（買った人が、終わったあとに） */
    rating: integer('rating'),
    review: text('review'),
    ratedAt: timestamp('rated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [index('market_orders_status_idx').on(t.status, t.autoReleaseAt), index('market_orders_seller_idx').on(t.sellerId)],
);
export type MarketOrder = typeof marketOrders.$inferSelect;

/** 💬 値段の提案（買いたい人 → 出品した人）。受けると、その値段で取引を始める */
export const marketOffers = pgTable(
  'market_offers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    listingId: bigint('listing_id', { mode: 'number' }).notNull(),
    buyerId: text('buyer_id').notNull(),
    sellerId: text('seller_id').notNull(),
    amount: integer('amount').notNull(),
    note: text('note').notNull().default(''),
    /** pending 返事待ち / accepted 受けた / declined 断った / cancelled 取り下げ / expired 期限切れ */
    status: text('status').$type<'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'>().notNull().default('pending'),
    orderId: bigint('order_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('market_offers_listing_idx').on(t.listingId, t.status), check('market_offers_amount', sql`${t.amount} > 0`)],
);
export type MarketOffer = typeof marketOffers.$inferSelect;

/** 📝 依頼の募集（買いたい人が出す）。出品できる人が手を挙げ、依頼した人が選ぶと取引になる */
export const marketRequests = pgTable(
  'market_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requesterId: text('requester_id').notNull(),
    category: text('category').notNull(),
    subcategory: text('subcategory'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** 予算（目安） */
    budget: integer('budget').notNull(),
    imageUrl: text('image_url'),
    /** open 募集中 / matched 決まった / closed 締め切った・取り下げ */
    status: text('status').$type<'open' | 'matched' | 'closed'>().notNull().default('open'),
    channelId: text('channel_id'),
    messageId: text('message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('market_requests_status_idx').on(t.status), check('market_requests_budget', sql`${t.budget} > 0`)],
);
export type MarketRequest = typeof marketRequests.$inferSelect;

/** ✋ 依頼に手を挙げた（出品できる人が、値段と一言つきで） */
export const marketBids = pgTable(
  'market_bids',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requestId: bigint('request_id', { mode: 'number' }).notNull(),
    sellerId: text('seller_id').notNull(),
    amount: integer('amount').notNull(),
    note: text('note').notNull().default(''),
    /** pending / accepted / declined（ほかの人に決まった・取り下げ） */
    status: text('status').$type<'pending' | 'accepted' | 'declined'>().notNull().default('pending'),
    orderId: bigint('order_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('market_bids_one_idx').on(t.requestId, t.sellerId), check('market_bids_amount', sql`${t.amount} > 0`)],
);
export type MarketBid = typeof marketBids.$inferSelect;

/** 🀄 麻雀の戦績（終局ごとに 1 人 1 行。BOT は入れない） */
export const mahjongResults = pgTable(
  'mahjong_results',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tableId: bigint('table_id', { mode: 'number' }).notNull(),
    memberId: text('member_id').notNull(),
    name: text('name').notNull(),
    /** 順位 1〜4・終わったときの点数 */
    rank: integer('rank').notNull(),
    points: integer('points').notNull(),
    /** tonpu / hanchan */
    length: text('length').notNull(),
    /** 人数（4 人打ち・3 人打ち） */
    players: integer('players').notNull().default(4),
    entry: integer('entry').notNull().default(0),
    payout: integer('payout').notNull().default(0),
    /** その対局の局の数・和了・ツモ・放銃・リーチの回数 */
    hands: integer('hands').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    tsumo: integer('tsumo').notNull().default(0),
    dealins: integer('dealins').notNull().default(0),
    riichi: integer('riichi').notNull().default(0),
    /** いちばん高かった和了 */
    bestPoints: integer('best_points').notNull().default(0),
    bestName: text('best_name'),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mahjong_results_member_idx').on(t.memberId, t.finishedAt), index('mahjong_results_time_idx').on(t.finishedAt)],
);
export type MahjongResultRow = typeof mahjongResults.$inferSelect;

/** 🏇 競馬の名簿の馬（何度も走って成績がたまる。名前は運営がつけ直せる） */
export const keibaHorses = pgTable('keiba_horses', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  /** 脚質 0〜3・速さ・スタミナ・得意な距離 0〜3・得意な馬場 0 芝 / 1 ダート / 2 どちらも・毛色 */
  style: integer('style').notNull(),
  spd: integer('spd_milli').notNull(),
  sta: integer('sta_milli').notNull(),
  apt: integer('apt').notNull(),
  surf: integer('surf').notNull(),
  coat: integer('coat').notNull(),
  /** 勝負服 */
  silk: jsonb('silk').$type<{ base: string; accent: string; pattern: number }>().notNull(),
  starts: integer('starts').notNull().default(0),
  wins: integer('wins').notNull().default(0),
  seconds: integer('seconds').notNull().default(0),
  thirds: integer('thirds').notNull().default(0),
  /** 最近のレース（新しい順・5 走まで） */
  recent: jsonb('recent').$type<{ pos: number; race: string; dist: number; surface: number }[]>().notNull().default([]),
  /** 馬主（メンバー。BOT の馬は null） */
  ownerId: text('owner_id'),
  /** 獲得賞金（銭。馬主に払った分） */
  prize: integer('prize').notNull().default(0),
  /** 性 0 牡 / 1 牝 / 2 セン・年齢・ふだんの馬体重（kg） */
  sex: integer('sex').notNull().default(0),
  age: integer('age').notNull().default(3),
  weight: integer('weight').notNull().default(480),
  /** 疲れ（0〜100。fatigueAt から 1 時間に 10 ずつ抜ける）・次のレースの調子の上乗せ（調教）・最後に調教した日時・放牧の終わり */
  fatigue: integer('fatigue').notNull().default(0),
  fatigueAt: timestamp('fatigue_at', { withTimezone: true }),
  trainBoost: integer('train_boost').notNull().default(0),
  trainedAt: timestamp('trained_at', { withTimezone: true }),
  restUntil: timestamp('rest_until', { withTimezone: true }),
  /** 売りに出している値段（null は売っていない） */
  salePrice: integer('sale_price'),
  /** 親（産駒のとき）・繁殖入りした馬か */
  parentId: bigint('parent_id', { mode: 'number' }),
  breeding: boolean('breeding').notNull().default(false),
  /** 引退した日時（走らない） */
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type KeibaHorseRow = typeof keibaHorses.$inferSelect;

/** 🏇 馬主ごとの設定（勝負服） */
export const keibaOwners = pgTable('keiba_owners', {
  memberId: text('member_id').primaryKey(),
  silk: jsonb('silk').$type<{ base: string; accent: string; pattern: number }>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 🏇 馬主の馬の 1 走（リーディングオーナー・お祝いのお知らせに使う） */
export const keibaRuns = pgTable(
  'keiba_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    horseId: bigint('horse_id', { mode: 'number' }).notNull(),
    horseName: text('horse_name').notNull(),
    ownerId: text('owner_id').notNull(),
    pos: integer('pos').notNull(),
    /** 賞金と出走手当（銭） */
    prize: integer('prize').notNull().default(0),
    cls: integer('cls').notNull(),
    race: text('race').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** Discord に流した日時（流さないものは null のまま） */
    announcedAt: timestamp('announced_at', { withTimezone: true }),
  },
  (t) => [index('keiba_runs_owner_idx').on(t.ownerId, t.at), index('keiba_runs_time_idx').on(t.at)],
);

/** 🦊 AT 機の絵（運営が社務所Web で入れる。キャラ・背景・ロゴ・絵柄。なければコードで描いた仮の絵） */
export const slotArt = pgTable('slot_art', {
  key: text('key').primaryKey(),
  contentType: text('content_type').notNull(),
  data: bytea('data').notNull(),
  hash: text('hash').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 🦊 AT 機の台（台の状態は台に残る: 回転数・前兆・AT の残り。座っている人と、最後に回した時刻） */
export const slotAtMachines = pgTable('slot_at_machines', {
  machine: integer('machine').primaryKey(),
  state: jsonb('state').$type<Record<string, unknown>>().notNull(),
  seatBy: text('seat_by'),
  seatAt: timestamp('seat_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 運営の見守り: 知らせた印（同じものを 2 回知らせない。key は stale:種類:ID:回 / weekly:日付） */
export const opsNotices = pgTable('ops_notices', {
  key: text('key').primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

/** 🏇 名簿の馬の 1 走ずつ（馬の成績ページ。馬主がいなくても残す） */
export const keibaEntries = pgTable(
  'keiba_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    horseId: bigint('horse_id', { mode: 'number' }).notNull(),
    horseName: text('horse_name').notNull(),
    ownerId: text('owner_id'),
    race: text('race').notNull(),
    cls: integer('cls').notNull(),
    dist: integer('dist').notNull(),
    /** 0 芝 / 1 ダート・馬場 0 良 / 1 稍重 / 2 重 */
    surface: integer('surface').notNull(),
    going: integer('going').notNull().default(0),
    /** 頭数・馬番・人気・単勝（10 倍した倍率）・着順 */
    field: integer('field').notNull(),
    no: integer('no').notNull(),
    pop: integer('pop').notNull(),
    odds: integer('odds').notNull(),
    pos: integer('pos').notNull(),
    /** 走破タイム（1:34.5）・着差・上がり 3F（10 倍した秒）・通過順 */
    time: text('time').notNull(),
    margin: text('margin').notNull().default(''),
    last3f: integer('last3f').notNull().default(0),
    corners: text('corners').notNull().default(''),
    /** 賞金と出走手当（銭） */
    prize: integer('prize').notNull().default(0),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('keiba_entries_horse_idx').on(t.horseId, t.at)],
);

/** 🎫 メンバーの馬券（1 枚ずつ。自分の馬券成績のページ） */
export const keibaBets = pgTable(
  'keiba_bets',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    memberId: text('member_id').notNull(),
    race: text('race').notNull(),
    cls: integer('cls').notNull().default(0),
    /** 賭け方（win・place・quinella・wide・exacta・trio・trifecta）と組（"3" / "2-5" / "5>2>7"） */
    type: text('type').notNull(),
    key: text('key').notNull(),
    /** 馬の名前（組の順） */
    names: text('names').notNull().default(''),
    amount: integer('amount').notNull(),
    /** 10 倍した倍率（はずれは 0）・払い戻し */
    odds: integer('odds').notNull().default(0),
    payout: integer('payout').notNull().default(0),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('keiba_bets_member_idx').on(t.memberId, t.at)],
);

/** 「はじめての参拝」を全部できた人（お祝いは 1 人 1 回） */
export const onboardingDone = pgTable('onboarding_done', {
  memberId: text('member_id').primaryKey(),
  reward: integer('reward').notNull().default(0),
  doneAt: timestamp('done_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 招待（申請・リンクで記録した人）。お礼は招待された人・段階ごとに1回 */
export const invites = pgTable(
  'invites',
  {
    memberId: text('member_id').primaryKey(),
    inviterId: text('inviter_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    rewardedAt: timestamp('rewarded_at', { withTimezone: true }),
    reward: integer('reward').notNull().default(0),
    ujikoRewardedAt: timestamp('ujiko_rewarded_at', { withTimezone: true }),
    ujikoReward: integer('ujiko_reward').notNull().default(0),
    legacyReward: boolean('legacy_reward').notNull().default(false),
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

/** BOT が作った、メンバーごとの招待リンク（だれのリンクで入ったか分かるように）。inviterId = 'shared' は運営が作る共通のリンク */
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
    /** 共通の招待リンク（inviterId = 'shared'）の名前（X 用・ポスター用 など） */
    label: text('label'),
    /** 共通の招待リンクを作った人 */
    createdBy: text('created_by'),
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

/** 物御籤の「はじめての 1 回は無料」を使った人（物御籤のリセットでも消さない。出直しても 1 回だけ） */
export const gachaFirstFree = pgTable('gacha_first_free', {
  memberId: text('member_id').primaryKey(),
  usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
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
    kind: text('kind').$type<'fuku' | 'luck' | 'casino'>().notNull(),
    until: timestamp('until', { withTimezone: true }),
    remaining: integer('remaining').notNull().default(0),
    /** 🎰 大勝負の札: 今日（日本時間）使った枚数を数える日と枚数（重ねて使える枚数の上限に使う） */
    day: text('day'),
    uses: integer('uses').notNull().default(0),
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
  /** この時までに入った人だけに贈ったとき（あとで入った日を直したら、直した日） */
  joinedBy: timestamp('joined_by', { withTimezone: true }),
  /** 贈った相手（前からのプレゼントは null。あとで取り消すときに使う） */
  memberIds: text('member_ids').array(),
  by: text('by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type GiftBatch = typeof giftBatches.$inferSelect;

/** 期間限定イベント（通話ボーナス・授与品セール・物御籤セール）。始まり・終わりは BOT が自動で知らせる */
export const economyEvents = pgTable('economy_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /**
   * voice = 通話でもらえる銭が value% に / shop = 授与品が value% 引き / gacha = 物御籤が value% 引き
   * voice_ticket = その日の通話が value 分になった人に券（ticket を ticket_count 枚。1 日 1 回）
   */
  kind: text('kind').$type<'voice' | 'shop' | 'gacha' | 'voice_ticket'>().notNull(),
  value: integer('value').notNull(),
  /** voice_ticket で配る券と枚数 */
  ticket: text('ticket').notNull().default('gacha_free'),
  ticketCount: integer('ticket_count').notNull().default(1),
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

/** voice_ticket のイベントで券を配った人（イベント × 人 × 日本時間の日付で 1 回） */
export const eventTicketGrants = pgTable(
  'event_ticket_grants',
  {
    eventId: bigint('event_id', { mode: 'number' }).notNull(),
    memberId: text('member_id').notNull(),
    date: text('date').notNull(),
    minutes: integer('minutes').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.memberId, t.date] })],
);

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

/** 📓 議事録（運営の会議。社務所Web で書く） */
export const meetings = pgTable(
  'meetings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    title: text('title').notNull(),
    /** 会議の日時 */
    heldAt: timestamp('held_at', { withTimezone: true }).notNull(),
    /** 場所: 通話チャンネル（なくてもよい） */
    placeChannelId: text('place_channel_id'),
    /** 参加した人（メンバーの ID） */
    attendees: text('attendees').array().notNull().default(sql`'{}'::text[]`),
    /** 議題・話したこと・決まったこと（決まったことは 1 行に 1 つ） */
    agenda: text('agenda').notNull().default(''),
    notes: text('notes').notNull().default(''),
    decisions: text('decisions').notNull().default(''),
    /** Discord に出したまとめ（チャンネル・メッセージ） */
    postedChannelId: text('posted_channel_id'),
    postedMessageId: text('posted_message_id'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('meetings_held_at_idx').on(t.heldAt)],
);

export type Meeting = typeof meetings.$inferSelect;

/** 議事録の「やること」（担当・期限・済んだか） */
export const meetingTodos = pgTable(
  'meeting_todos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    meetingId: bigint('meeting_id', { mode: 'number' })
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    assigneeId: text('assignee_id'),
    /** 期限（日本時間の日付 YYYY-MM-DD） */
    due: text('due'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: text('done_by'),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('meeting_todos_meeting_idx').on(t.meetingId), index('meeting_todos_open_idx').on(t.doneAt)],
);

export type MeetingTodo = typeof meetingTodos.$inferSelect;

/** ⏳ 一時的なロール・チャンネルの権限（期限が来たら BOT が外す） */
export const tempGrants = pgTable(
  'temp_grants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** role = ロールを付ける / perm = チャンネルの権限（その人だけの上書き） */
    kind: text('kind').$type<'role' | 'perm'>().notNull(),
    memberId: text('member_id').notNull(),
    roleId: text('role_id'),
    channelId: text('channel_id'),
    /** perm のとき: 何の権限か（write・view・speak・manage・mute） */
    preset: text('preset'),
    /** perm のとき: 付ける前のその人だけの上書き（なければ null。外すときに戻す） */
    prevAllow: text('prev_allow'),
    prevDeny: text('prev_deny'),
    reason: text('reason').notNull().default(''),
    grantedBy: text('granted_by').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 終わった日時と、だれが・なぜ（expired 期限 / revoked 手で外した / failed 外せなかった） */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: text('ended_by'),
    endReason: text('end_reason'),
  },
  (t) => [index('temp_grants_active_idx').on(t.endedAt, t.expiresAt), index('temp_grants_member_idx').on(t.memberId)],
);

export type TempGrant = typeof tempGrants.$inferSelect;

/** 🧧 お年玉袋: 買った人がチャンネルに置き、先着の人がボタンで銭を受け取る（中身の量は運しだい） */
export const otoshidamaBags = pgTable(
  'otoshidama_bags',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerId: text('owner_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id'),
    total: integer('total').notNull(),
    count: integer('count').notNull(),
    /** 1 人ずつの量（受け取った順に前から使う） */
    shares: integer('shares').array().notNull(),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 全部受け取られた・期限で残りを戻した */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** 期限で持ち主に戻した量 */
    refunded: integer('refunded').notNull().default(0),
  },
  (t) => [index('otoshidama_bags_open_idx').on(t.endedAt, t.expiresAt)],
);

export type OtoshidamaBag = typeof otoshidamaBags.$inferSelect;

export const otoshidamaClaims = pgTable(
  'otoshidama_claims',
  {
    bagId: bigint('bag_id', { mode: 'number' }).notNull(),
    memberId: text('member_id').notNull(),
    amount: integer('amount').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.bagId, t.memberId] })],
);

export type OtoshidamaClaim = typeof otoshidamaClaims.$inferSelect;

/** 📌 掲示板の募集（仕事・手伝い・仲間など）。報酬（銭）を付けたら、人数分を宮が預かる */
export const boardPosts = pgTable(
  'board_posts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    authorId: text('author_id').notNull(),
    /** work 仕事・依頼 / help 手伝い / team 仲間 / event イベント / other その他 */
    category: text('category').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** 募集する人数 */
    slots: integer('slots').notNull().default(1),
    /** 1 人あたりの報酬（0 = なし） */
    reward: integer('reward').notNull().default(0),
    /** 今預かっている銭（採用した人に渡す・締め切りで余りを戻すと減る） */
    escrow: integer('escrow').notNull().default(0),
    /** open 募集中 / closed 締め切り（本人・期限・満員） / removed 運営が取り下げ */
    status: text('status').$type<'open' | 'closed' | 'removed'>().notNull().default('open'),
    channelId: text('channel_id'),
    messageId: text('message_id'),
    /** みんなの質問のスレッド */
    threadId: text('thread_id'),
    /** 応募が届く、募集した人（と運営）だけのスレッド */
    applyThreadId: text('apply_thread_id'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [index('board_posts_status_idx').on(t.status, t.deadlineAt), check('board_posts_reward', sql`${t.reward} >= 0 and ${t.escrow} >= 0`)],
);
export type BoardPost = typeof boardPosts.$inferSelect;

/** 応募・採用。報酬つきなら、採用した人に「完了」（または期限）で渡す */
export const boardEntries = pgTable(
  'board_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    postId: bigint('post_id', { mode: 'number' }).notNull(),
    memberId: text('member_id').notNull(),
    /** applied 応募 / hired 採用（仕事中） / done 完了（報酬を渡した） / disputed 問題あり / refunded 募集した人に戻した */
    status: text('status').$type<'applied' | 'hired' | 'done' | 'disputed' | 'refunded'>().notNull().default('applied'),
    /** 採用したあとの、募集した人と採用された人（と運営）だけのスレッド */
    threadId: text('thread_id'),
    /** 渡した報酬（手数料を引いたあと） */
    paid: integer('paid').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    hiredAt: timestamp('hired_at', { withTimezone: true }),
    /** この時刻までに「完了」「問題あり」がなければ、報酬を渡す */
    releaseAt: timestamp('release_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    decidedBy: text('decided_by'),
  },
  (t) => [uniqueIndex('board_entries_post_member_idx').on(t.postId, t.memberId), index('board_entries_status_idx').on(t.status, t.releaseAt)],
);
export type BoardEntry = typeof boardEntries.$inferSelect;

/** 🎀 キャスト（寝落ち・雑談などの通話を銭で受ける人）。18 歳以上の人だけが申し込め、運営が承認する */
export const casts = pgTable('casts', {
  memberId: text('member_id').primaryKey(),
  /** pending 申し込み / active キャスト / paused 運営がお休みにした / removed 外した・断った */
  status: text('status').$type<'pending' | 'active' | 'paused' | 'removed'>().notNull().default('pending'),
  bio: text('bio').notNull().default(''),
  /** 得意なこと（寝落ち・雑談・ゲーム・相談 など） */
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  price30: integer('price_30').notNull().default(0),
  price60: integer('price_60').notNull().default(0),
  /** 寝落ち（朝 7 時まで）。0 = 受けない */
  priceNight: integer('price_night').notNull().default(0),
  /**
   * 🎀 メニュー（内容・時間・値段。運営が社務所Web で足す）。空なら前の 30 分・1 時間・寝落ちの値段から作る
   * night: 寝落ち（朝 7 時まで。minutes は使わない）/ consult: 内容により相談（値段と時間は、キャストがそのつど出す）
   */
  menu: jsonb('menu').$type<{ id: string; name: string; note: string; minutes: number; price: number; night: boolean; consult?: boolean }[]>().notNull().default(sql`'[]'::jsonb`),
  /** 未成年の人の公開の雑談を受ける */
  minorOk: boolean('minor_ok').notNull().default(true),
  /** off お休み / waiting 待機中（waitingUntil まで） */
  available: text('available').$type<'off' | 'waiting'>().notNull().default('off'),
  waitingUntil: timestamp('waiting_until', { withTimezone: true }),
  /** 指名できない人（キャストがブロックした） */
  blocked: text('blocked').array().notNull().default(sql`'{}'::text[]`),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by'),
});
export type Cast = typeof casts.$inferSelect;

/** 🎀 指名。銭は先に預かり、終わってからキャストに渡す（手数料を引く） */
export const castSessions = pgTable(
  'cast_sessions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    castId: text('cast_id').notNull(),
    customerId: text('customer_id').notNull(),
    /** メニューの番号（寝落ちは night）。前の指名は 30 / 60 / night */
    plan: text('plan').notNull(),
    /** 指名したメニューの名前（前の指名は空） */
    menuName: text('menu_name').notNull().default(''),
    minutes: integer('minutes').notNull(),
    /** 預かっている銭（延長で増える） */
    price: integer('price').notNull(),
    /**
     * reserved 予約（キャストの返事待ち）/ accepted 予約を受けた（始まる時刻待ち）/ requested 今すぐ（返事待ち）/ active 通話中 /
     * done 終わった（渡した）/ declined 断られた・返事がなかった / canceled 取り消し / disputed 通報（運営が決める）/ refunded 運営が戻した
     */
    status: text('status')
      .$type<'reserved' | 'accepted' | 'requested' | 'active' | 'done' | 'declined' | 'canceled' | 'disputed' | 'refunded'>()
      .notNull(),
    /** 公開の部屋（未成年の人の雑談）。2 人だけの部屋は 18 歳以上どうしだけ */
    isPublic: boolean('is_public').notNull().default(false),
    channelId: text('channel_id'),
    /** 予約のやり取りのスレッド */
    threadId: text('thread_id'),
    /** 予約の始まる時刻 */
    startAt: timestamp('start_at', { withTimezone: true }),
    /** この時刻までに返事がなければ断ったことにする */
    acceptBy: timestamp('accept_by', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** 部屋を消す時刻（終わってから少し残して評価してもらう） */
    deleteAt: timestamp('delete_at', { withTimezone: true }),
    /** 終わりの 5 分前の知らせを出した */
    warned: boolean('warned').notNull().default(false),
    extensions: integer('extensions').notNull().default(0),
    /** キャストに渡した銭（手数料を引いたあと） */
    paid: integer('paid').notNull().default(0),
    rating: integer('rating'),
    decidedBy: text('decided_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('cast_sessions_status_idx').on(t.status), index('cast_sessions_cast_idx').on(t.castId, t.createdAt), check('cast_sessions_price', sql`${t.price} >= 0`)],
);
export type CastSession = typeof castSessions.$inferSelect;

/** 🎀 キャストのメニューの画像（社務所Web で上げる） */
export const castImages = pgTable('cast_images', {
  key: text('key').primaryKey(),
  contentType: text('content_type').notNull(),
  data: bytea('data').notNull(),
  hash: text('hash').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});


/** 📋 ロールの権限のテンプレート（運営が作ったもの。はじめからあるものはコードの中） */
export const roleTemplates = pgTable('role_templates', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull().unique(),
  /** 権限のビット（10 進の文字列） */
  bits: text('bits').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type RoleTemplateRow = typeof roleTemplates.$inferSelect;

/** 💡 アイデア・共有メモ（運営どうし。足したい機能・共有・不具合・メモ） */
export const ideas = pgTable(
  'ideas',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** idea: 足したい機能 / share: 共有 / bug: 不具合 / memo: メモ */
    kind: text('kind').notNull().default('idea'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** new: アイデア / review: 検討中 / todo: やる / doing: 作業中 / done: できた / dropped: 見送り */
    status: text('status').notNull().default('new'),
    pinned: boolean('pinned').notNull().default(false),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ideas_updated_idx').on(t.updatedAt)],
);

export const ideaComments = pgTable(
  'idea_comments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ideaId: bigint('idea_id', { mode: 'number' }).notNull(),
    body: text('body').notNull(),
    by: text('by').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idea_comments_idea_idx').on(t.ideaId, t.at)],
);

/** 👍（1 人 1 回） */
export const ideaVotes = pgTable(
  'idea_votes',
  {
    ideaId: bigint('idea_id', { mode: 'number' }).notNull(),
    memberId: text('member_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ideaId, t.memberId] })],
);

/** 📎 アイデア・コメントにつけた写真・ファイル（社務所Web から見る・ダウンロードする） */
export const ideaFiles = pgTable(
  'idea_files',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ideaId: bigint('idea_id', { mode: 'number' }).notNull(),
    /** コメントにつけたもの（本文につけたものは null） */
    commentId: bigint('comment_id', { mode: 'number' }),
    /** 元のファイル名（ダウンロードするときの名前） */
    name: text('name').notNull(),
    /** 写真なら image/○○（そのまま見られる）。ほかは application/octet-stream（ダウンロードだけ） */
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    data: bytea('data').notNull(),
    by: text('by').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idea_files_idea_idx').on(t.ideaId, t.at)],
);

export type Idea = typeof ideas.$inferSelect;
export type IdeaComment = typeof ideaComments.$inferSelect;
export type IdeaFile = Omit<typeof ideaFiles.$inferSelect, 'data'>;

/** カジノの見た目。ゲームの勝ち負けのデータとは分ける */
export const casinoStyles = pgTable('casino_styles', {
  memberId: text('member_id').primaryKey(),
  owned: jsonb('owned').$type<string[]>().notNull().default([]),
  equipped: jsonb('equipped').$type<Record<string, string>>().notNull().default({}),
  trialKey: text('trial_key'),
  trialUntil: timestamp('trial_until', { withTimezone: true }),
  tickets: integer('tickets').notNull().default(0),
  pity: integer('pity').notNull().default(0),
});
/** 同じボタン・フォームを再送しても、もう一度引かない */
export const casinoStyleDraws = pgTable('casino_style_draws', {
  memberId: text('member_id').notNull(),
  requestId: text('request_id').notNull(),
  results: jsonb('results').$type<string[]>().notNull(),
  cost: integer('cost').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.memberId, t.requestId] })]);


/** 7時間の浮上ボーナス。支払いと通知の記録を残す。 */
export const longVoiceBonuses = pgTable('long_voice_bonuses', {
  memberId: text('member_id').notNull(),
  date: text('date').notNull(),
  /** 日本時間の週の月曜日 */
  week: text('week').notNull(),
  weekSlot: integer('week_slot').notNull(),
  amount: integer('amount').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  notifyClaimedAt: timestamp('notify_claimed_at', { withTimezone: true }),
}, t => [primaryKey({ columns: [t.memberId, t.date] }), uniqueIndex('long_voice_bonus_week_slot_idx').on(t.memberId, t.week, t.weekSlot), check('long_voice_bonus_slot_check', sql`${t.weekSlot} between 1 and 2`)]);

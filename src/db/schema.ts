import { sql } from 'drizzle-orm';
import { bigserial, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

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

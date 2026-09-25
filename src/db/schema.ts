import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

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

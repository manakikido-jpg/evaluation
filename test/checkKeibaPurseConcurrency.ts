/**
 * 本物のPostgreSQLの複数接続で日額上限を検証する（PGliteは単一接続）。
 * 使い捨てのローカルDBだけを使う。例:
 * node --import tsx test/checkKeibaPurseConcurrency.ts postgresql://postgres@127.0.0.1:15432/keiba_test
 * 引数のDBへ移行・試験データ・一時トリガーを作る。本番用ではない。
 */
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { connectDb } from '../src/db/client.js';
import { casinoTables, coinTx, members } from '../src/db/schema.js';
import { keiba, type KbState } from '../src/services/casino/tables/keiba.js';
import { payCredit, pollTable } from '../src/services/casino/tables/service.js';
import { cfg } from './helpers.js';

const url = new URL(process.argv[2] ?? '');
assert(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/keiba_test', '使い捨てのローカルkeiba_test DBを指定してください');
const { db, close } = await connectDb(url.href);
const owner = { id: `790000000000${randomInt(100000, 999999)}`, name: '同時精算の検証' };
const now = new Date();
try {
  await db.insert(members).values({ id: owner.id, username: owner.name, displayName: owner.name });
  await payCredit(db, cfg, { memberId: owner.id, amount: 990, reason: 'keiba_prize', cap: 'keiba_purse_bet' }, now, 'keiba', 0);
  let n = 7;
  const ctx = (at: number) => ({ cfg, now: at, rng: (k: number) => (n = (n * 1103515245 + 12345) % 2147483648) % k });
  const created = keiba.create(owner, { cls: '0' }, ctx(now.getTime()));
  assert(created.ok);
  const bought = keiba.act(created.state, owner.id, { action: 'bet', type: 'win', a: '1', bet: '100' }, ctx(now.getTime()));
  assert(bought.ok);
  const started = keiba.act(bought.state, owner.id, { action: 'start' }, ctx(now.getTime()));
  assert(started.ok);
  const state: KbState = started.state;
  // 抽選を変えず、当選馬券の入金が先に財布をロックしない精算条件を作る。
  state.tickets[0]!.key = String(state.run!.order.at(-1));
  state.horses[state.run!.order[0]! - 1]!.ownerId = owner.id;
  const rows = await db.insert(casinoTables).values([1, 2].map(() => ({ kind: 'keiba', hostId: owner.id, state, seatIds: [owner.id], dueAt: new Date(state.deadline) }))).returning();
  // 一方が日額を読んで入金する間に、もう一方も精算を始めるよう入金を遅らせる。
  await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION keiba_test_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.member_id = '${owner.id}' AND NEW.reason = 'keiba_prize' THEN PERFORM pg_sleep(0.3); END IF; RETURN NEW; END $$`));
  await db.execute(sql.raw('CREATE TRIGGER keiba_test_delay BEFORE INSERT ON coin_tx FOR EACH ROW EXECUTE FUNCTION keiba_test_delay()'));
  const at = new Date(state.deadline);
  const results = await Promise.all(rows.map(row => pollTable(db, cfg, row.id, at)));
  assert(results.every(row => (row?.state as KbState).phase === 'result'));
  const payments = await db.select().from(coinTx).where(eq(coinTx.memberId, owner.id));
  const total = payments.filter(p => p.reason === 'keiba_prize' && p.detail?.purse_bet).reduce((sum, p) => sum + p.amount, 0);
  assert.equal(total, 1000, '同時精算でも日額1,000を超えない');
  const count = payments.length;
  await Promise.all(rows.map(row => pollTable(db, cfg, row.id, at)));
  assert.equal((await db.select().from(coinTx).where(eq(coinTx.memberId, owner.id))).length, count, '再確認しても二重払いしない');
  console.log('PASS: PostgreSQLの2接続で同時精算、保証合計1000、再精算の二重払いなし');
} finally {
  await db.execute(sql.raw('DROP TRIGGER IF EXISTS keiba_test_delay ON coin_tx'));
  await db.execute(sql.raw('DROP FUNCTION IF EXISTS keiba_test_delay()'));
  await close();
}

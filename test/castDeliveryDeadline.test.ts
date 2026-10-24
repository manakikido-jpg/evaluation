import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { castSessions } from '../src/db/schema.js';
import { CAST_DEFAULTS, castTick, deliverSession } from '../src/services/cast.js';
import { walletOf } from '../src/services/economy.js';
import { makeDb } from './helpers.js';
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());});afterEach(async()=>{await close();});
const CAST='600000000000000081', CUSTOMER='600000000000000082';
const DAY=86_400_000, CREATED=new Date('2026-10-01T12:34:56.789Z');
const at=(days:number)=>new Date(CREATED.getTime()+days*DAY);
const migration=readFileSync(new URL('../drizzle/0126_cast_delivery_week.sql',import.meta.url),'utf8');
const apply=()=>db.execute(sql.raw(migration));
async function order(values:Partial<typeof castSessions.$inferInsert>={}) {
 return (await db.insert(castSessions).values({castId:CAST,customerId:CUSTOMER,plan:'dlv:voice',menuName:'ボイス',
  minutes:0,price:1000,status:'ordered',createdAt:CREATED,acceptBy:at(1),...values}).returning())[0]!;
}

describe('既存のキャスト納品も注文から1週間へ',()=>{
 it('納品待ちだけ延ばし、長い期限・通話・納品済み・返金済みは一切変えない',async()=>{
  const eligible=[await order(),await order({plan:'dlv:gacha',menuName:'ガチャ：おやすみ'})];
  const excluded=[await order({acceptBy:at(10)}),await order({acceptBy:at(7)}),
   await order({plan:'30',status:'requested'}),await order({plan:'30',status:'reserved'}),
   await order({status:'delivered',endsAt:at(3)}),await order({status:'done',paid:900}),
   await order({status:'declined'}),await order({status:'canceled'})];
  await apply();const rows=await db.select().from(castSessions);
  for(const old of eligible)expect(rows.find(s=>s.id===old.id)).toEqual({...old,acceptBy:at(7)});
  for(const old of excluded)expect(rows.find(s=>s.id===old.id)).toEqual(old);
  await apply();expect(await db.select().from(castSessions)).toEqual(rows);
 });
 it('旧24時間を過ぎた納品待ちも7日までは失効せず、7日の境界で一度だけ返金する',async()=>{
  const s=await order();await apply();
  expect((await castTick(db,CAST_DEFAULTS,at(2))).expired).toEqual([]);
  expect((await castTick(db,CAST_DEFAULTS,new Date(at(7).getTime()-1))).expired).toEqual([]);
  expect((await walletOf(db,CUSTOMER)).balance).toBe(0);
  expect((await castTick(db,CAST_DEFAULTS,at(7))).expired.map(s=>s.id)).toEqual([s.id]);
  expect((await walletOf(db,CUSTOMER)).balance).toBe(1000);
  expect((await castTick(db,CAST_DEFAULTS,at(8))).expired).toEqual([]);
  expect((await walletOf(db,CUSTOMER)).balance).toBe(1000);
 });
 it('6日目には納品でき、期限ちょうどでは納品できない',async()=>{
  const before=await order(),expired=await order();await apply();
  expect((await deliverSession(db,before.id,CAST,at(6)))?.status).toBe('delivered');
  expect(await deliverSession(db,expired.id,CAST,at(7))).toBeUndefined();
 });
});

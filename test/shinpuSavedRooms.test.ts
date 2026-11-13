import {beforeEach,afterEach,it,expect} from 'vitest';
import {eq,sql} from 'drizzle-orm';
import {makeDb} from './helpers.js';
import {shinpuSavedRooms} from '../src/db/schema.js';
import {SavedShinpuRooms,ShinpuStorageError} from '../src/services/shinpu/store.js';
import {battleSummary,defend,defenseForecast,create,playableCards,type Card,type State} from '../src/services/shinpu/engine.js';
const A={id:'a',name:'あおい'},B={id:'b',name:'こはく'};
let db:Awaited<ReturnType<typeof makeDb>>['db'],close:()=>Promise<void>,clock:number,rooms:SavedShinpuRooms;
beforeEach(async()=>{({db,close}=await makeDb());clock=Date.now();rooms=new SavedShinpuRooms(db,'guild',()=>clock,()=>0);});
afterEach(async()=>{await close();});
async function start(){let v=await rooms.create(A,2);v=await rooms.join(v.roomId,B);return rooms.start(v.roomId,A.id,v.revision);}
async function snapshot(id:string){return (await db.select().from(shinpuSavedRooms).where(eq(shinpuSavedRooms.id,id)))[0]!.snapshot;}
async function over(id:string){const s=await snapshot(id);s.state!.phase='over';s.state!.winner=0;s.state!.players[1]!.hp=0;s.state!.stats=[{damageDealt:60,damageTaken:5,blocked:7},{damageDealt:5,damageTaken:60,blocked:3}];s.state!.lastHit={from:0,to:1,cards:['決め手の札'],damage:8};await db.update(shinpuSavedRooms).set({snapshot:s}).where(eq(shinpuSavedRooms.id,id));return rooms.view(id,A.id);}
it('再起動後も手札・山札・席・更新番号を復元し、他人の手札は返さない',async()=>{
 const v=await start(),saved=await snapshot(v.roomId),restart=new SavedShinpuRooms(db,'guild',()=>clock);
 const restored=await restart.view(v.roomId,A.id);expect(restored.revision).toBe(v.revision);expect(restored.state!.players[0]!.hand).toEqual(v.state!.players[0]!.hand);expect(restored.state!.players[1]!.hand).toEqual([]);expect((await snapshot(v.roomId)).state!.deck).toEqual(saved.state!.deck);expect(saved.state).not.toHaveProperty('rng');expect((await restart.list(A.id))[0]!.mine).toBe(true);
});
it('2つのWebから同時操作しても同じ更新番号の両替は1回',async()=>{
 const v=await start(),other=new SavedShinpuRooms(db,'guild',()=>clock),move={revision:v.revision,action:'exchange',ids:[],target:'mp'};
 const r=await Promise.allSettled([rooms.move(v.roomId,A.id,move),other.move(v.roomId,A.id,move)]);expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect((await rooms.view(v.roomId,A.id)).state!.players[0]!.money).toBe(16);
});
it('同じ人の同時作成は1部屋で、別ギルドは分ける',async()=>{
 const other=new SavedShinpuRooms(db,'guild',()=>clock);const r=await Promise.allSettled([rooms.create(A,2),other.create(A,2)]);expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(await other.list(A.id)).toHaveLength(1);expect(await new SavedShinpuRooms(db,'another',()=>clock).list(A.id)).toEqual([]);await new SavedShinpuRooms(db,'another',()=>clock).create(A,2);
});
it('保存失敗はトランザクションごと戻し、成功した表示を返さない',async()=>{
 const v=await start();await db.execute(sql`CREATE FUNCTION reject_shinpu_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture save failure'; END $$`);await db.execute(sql`CREATE TRIGGER reject_shinpu_save BEFORE UPDATE ON shinpu_saved_rooms FOR EACH ROW EXECUTE FUNCTION reject_shinpu_save()`);
 await expect(rooms.move(v.roomId,A.id,{revision:v.revision,action:'exchange',ids:[],target:'mp'})).rejects.toBeInstanceOf(ShinpuStorageError);const after=await rooms.view(v.roomId,A.id);expect(after.revision).toBe(v.revision);expect(after.state!.players[0]!.money).toBe(20);
});
it('形式不明・破損した保存を勝手に上書きしない',async()=>{
 const v=await start();await db.update(shinpuSavedRooms).set({format:2}).where(eq(shinpuSavedRooms.id,v.roomId));await expect(rooms.view(v.roomId,A.id)).rejects.toBeInstanceOf(ShinpuStorageError);expect((await db.select().from(shinpuSavedRooms))[0]!.format).toBe(2);
});
it('再起動後の時間切れは同時読込でも1手だけ進める',async()=>{
 const v=await start();clock+=120001;const other=new SavedShinpuRooms(db,'guild',()=>clock);const [a,b]=await Promise.all([rooms.view(v.roomId,A.id),other.view(v.roomId,A.id)]);expect(a.revision).toBe(v.revision+1);expect(b.revision).toBe(a.revision);expect(a.state!.turn).toBe(1);
});
it('2時間の保存期限を越えた部屋は復帰させず席も解放する',async()=>{
 const v=await start();clock+=2*60*60000+1;expect(await rooms.list(A.id)).toEqual([]);await expect(rooms.view(v.roomId,A.id)).rejects.toThrow('保存期限');expect(await rooms.create(A,2)).toBeTruthy();
});
it('防御予測は本人だけが行え、札・資源・更新番号を消費しない',async()=>{
 let v=await start();v=await rooms.move(v.roomId,A.id,{revision:v.revision,action:'attack',ids:[v.state!.players[0]!.hand[0]!.uid],target:1});const original=await snapshot(v.roomId);
 await expect(rooms.preview(v.roomId,A.id,{revision:v.revision,action:'defend',ids:[]})).rejects.toThrow('防御');const p=await rooms.preview(v.roomId,B.id,{revision:v.revision,action:'defend',ids:[]});expect(p.without.damage).toBe(5);expect(p.selected.damage).toBe(5);expect(await snapshot(v.roomId)).toEqual(original);
 await expect(rooms.preview(v.roomId,B.id,{revision:v.revision-1,action:'defend',ids:[]})).rejects.toThrow('更新');await expect(rooms.preview(v.roomId,B.id,{revision:v.revision,action:'defend',ids:[99999]})).rejects.toThrow();expect(await snapshot(v.roomId)).toEqual(original);
});
it('防御の追加支払いや属性・貫通を実際の解決と同じ計算で予測する',()=>{
 const s=create(2,()=>0),card=(effect:string,uid:number)=>({...playableCards.find(c=>c.effect===effect)!,uid}) as Card;
 const guard=card('optional_money_guard',900);s.players[1]!.hand=[guard];s.pending={from:0,to:1,cards:[{...playableCards[0]!,uid:901}],power:15,pierce:3,burn:1,drain:false,elements:[guard.element],guardPenalty:2,bonusDamage:3};s.phase='defense';
 const before=JSON.stringify(s);const p=defenseForecast(s,[guard.uid],{pay:true});const copy=JSON.parse(JSON.stringify(s)) as State;copy.rng=()=>0;defend(copy,[guard.uid],{pay:true});expect(p.selected.damage).toBe(copy.result!.damage);expect(JSON.stringify(s)).toBe(before);expect(p.without.damage).toBe(18);expect(p.selected.damage).toBeLessThan(p.without.damage);
});
it('結果は攻撃・反射の解決値を集計し、回復でダメージを相殺しない',()=>{
 const s=create(2,()=>0);s.phase='defense';s.players[1]!.hp=60;s.players[1]!.hand=[{id:'g',uid:900,name:'回復の盾',type:'guard',element:'土',power:2,cost:0,icon:'',text:'',effect:'guard_heal'}];s.pending={from:0,to:1,cards:[{...playableCards[0]!,uid:901}],power:8,pierce:0,burn:0,drain:false};defend(s,[900]);expect(s.result!.damage).toBe(6);expect(s.players[1]!.hp).toBe(57);const summary=battleSummary(s);expect(summary.players[0]!.damageDealt).toBe(6);expect(summary.players[1]!.blocked).toBe(2);expect(summary).not.toHaveProperty('hand');
});
it('全員の同意で1回だけ同じ席から再戦し、前の結果を残す',async()=>{
 const v=await start(),ended=await over(v.roomId);expect(ended.summary!.players[0]!.damageDealt).toBe(60);expect(ended.summary).not.toHaveProperty('hand');let ready=await rooms.rematch(v.roomId,A.id,ended.revision);expect(ready.state!.phase).toBe('over');expect(ready.rematchReady).toEqual([true,false]);await expect(rooms.rematch(v.roomId,A.id,ended.revision)).rejects.toThrow('更新');
 const other=new SavedShinpuRooms(db,'guild',()=>clock);const results=await Promise.allSettled([rooms.rematch(v.roomId,B.id,ready.revision),other.rematch(v.roomId,B.id,ready.revision)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);ready=await rooms.view(v.roomId,A.id);expect(ready.round).toBe(2);expect(ready.state!.phase).toBe('action');expect(ready.state!.players.map(p=>p.hp)).toEqual([60,60]);expect(ready.previousSummary!.lastHit!.cards).toEqual(['決め手の札']);expect(ready.rematchReady).toEqual([false,false]);expect(ready.seats.map(p=>p.name)).toEqual([A.name,B.name]);
});
it('同意しなかった人が退出すると、同意済みの人とCPUで再戦する',async()=>{
 const v=await start(),ended=await over(v.roomId);await rooms.rematch(v.roomId,A.id,ended.revision);await rooms.leave(v.roomId,B.id);const next=await rooms.view(v.roomId,A.id);expect(next.round).toBe(2);expect(next.seats[1]!.cpu).toBe(true);expect(next.previousSummary!.players[1]!.name).toBe(B.name);
});
it('最初の席の作成者が退出しても、残った人が同じ席で再戦できる',async()=>{
 const v=await start(),ended=await over(v.roomId);await rooms.leave(v.roomId,A.id);const b=await rooms.view(v.roomId,B.id);const next=await rooms.rematch(v.roomId,B.id,b.revision);expect(next.round).toBe(2);expect(next.myIndex).toBe(1);expect(next.seats.map(p=>p.cpu)).toEqual([true,false]);expect(next.state!.players[1]!.name).toBe(B.name);
});
it('全種類の防御札は実際の計算と一致し、元の乱数も呼ばない',()=>{
 for(const def of playableCards.filter(c=>c.type==='guard')){
  let randomCalls=0;const s=create(2,()=>0);s.rng=()=>{randomCalls++;return .5;};const guard={...def,uid:999};s.players[1]!.hand=[guard];s.players[1]!.mp=100;s.players[1]!.money=100;s.players[1]!.hp=20;s.phase='defense';s.pending={from:0,to:1,cards:[{...playableCards[0]!,uid:998}],power:15,pierce:3,burn:1,drain:true,guardPenalty:1,bonusDamage:3,elements:[guard.element]};
  const original=JSON.stringify(s),preview=defenseForecast(s,[999],{pay:true});const actual=JSON.parse(JSON.stringify(s)) as State;actual.rng=()=>0;defend(actual,[999],{pay:true});expect(preview.selected.damage,guard.name).toBe(actual.result!.damage);expect(JSON.stringify(s)).toBe(original);expect(randomCalls).toBe(0);
 }
});

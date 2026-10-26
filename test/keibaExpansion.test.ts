import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {development,EMPTY_DEVELOPMENT,trained,growthMultiplier,inherited,SKILLS,type Development} from '../src/services/casino/keibaDevelopment.js';
import {formationKeys} from '../src/services/casino/keibaTickets.js';
import {keiba,type KbState} from '../src/services/casino/tables/keiba.js';
import {makeRace,seeded,simulate,KB_BET_TYPES,picksOf} from '../src/services/casino/keiba.js';
import {addHorse,trainHorse,restHorse,breedFoal} from '../src/services/casino/keibaStable.js';
import {equipSkills,clubHorse,pedigree,ownerLedger} from '../src/services/casino/keibaClub.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {keibaHorses,coinTx,keibaReplays} from '../src/db/schema.js';
import {actTable,createTable,pollTable} from '../src/services/casino/tables/service.js';
import {cfg,makeDb} from './helpers.js';
import {eq} from 'drizzle-orm';
import type {Db} from '../src/db/client.js';
const A='760000000000000001',B='760000000000000002',now=new Date('2026-10-27T00:00:00Z');
describe('育成の上限と実走行',()=>{
 it('各成長20・履歴30・スキル2枠で、素質は1種だけ継承する',()=>{let d=development(null);for(let n=0;n<50;n++)d=trained(d,'start',10,now);expect(d.points.start).toBe(20);expect(d.history).toHaveLength(30);expect(EMPTY_DEVELOPMENT.history).toHaveLength(0);const a={...d,skills:['dash','heavy'] as Development['skills']};expect(inherited(a,a).points.start).toBe(1);expect(inherited(a,a).skills).toEqual([]);});
 it('条件外ではスキルが働かず、効果が合計1.2%を超えない',()=>{const d=development({points:{start:20,stamina:20,power:20,settle:20,speed:20},skills:['dash','grit'],history:[]});expect(growthMultiplier(d,{going:0},.5)).toBeCloseTo(1.002);expect(growthMultiplier(d,{going:0},0)).toBeCloseTo(1.006);expect(growthMultiplier({...d,points:{},skills:['dash']},{going:0},0)).toBe(1);for(const going of [0,1,2])for(let p=0;p<1.1;p+=.05)expect(growthMultiplier(d,{going},p)).toBeLessThanOrEqual(1.012);});
 it('旧馬は同じ乱数で同じ走り。育成とスキルは実際のシミュレーションに効く',()=>{const {race,horses}=makeRace(n=>n%3,1,{dist:1600});const old=simulate(race,horses,seeded(7),true);const zero=simulate(race,horses.map(h=>({...h,development:development(null)})),seeded(7),true);expect(zero.frames).toEqual(old.frames);expect(zero.times).toEqual(old.times);expect(zero.order).toEqual(old.order);const h=horses[0]!;let normal=0,grown=0;for(let i=0;i<20;i++){normal+=simulate(race,[h],seeded(i)).times[0]!;grown+=simulate(race,[{...h,development:{points:{start:20,stamina:20,speed:20,settle:20,power:20},skills:['dash','grit'],history:[]}}],seeded(i)).times[0]!;}expect(grown).toBeLessThan(normal);});
});
describe('7券種のフォーメーション',()=>{
 it('順番の有無・重複・同一馬・馬番を確認する',()=>{expect(formationKeys('trifecta',[[1],[2,3],[2,3]])).toEqual(['1>2>3','1>3>2']);expect(formationKeys('trio',[[1,2],[1,2],[3]])).toEqual(['1-2-3']);expect(formationKeys('win',[[1,1,8]])).toEqual(['1','8']);expect(formationKeys('exacta',[[1],[1]])).toEqual([]);expect(formationKeys('win',[[9]])).toEqual([]);expect(formationKeys('trio',[[1],[2]])).toEqual([]);});
 it('全馬ボックスの点数は券種ごとの数学上の数と一致する',()=>{const expected=[8,8,28,28,56,56,336];KB_BET_TYPES.forEach((t,i)=>{const keys=formationKeys(t,Array.from({length:picksOf(t)},()=>[1,2,3,4,5,6,7,8]));expect(keys).toHaveLength(expected[i]!);expect(new Set(keys).size).toBe(keys.length);});});
});
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());});afterEach(async()=>{await close();});
describe('育成の保存と権限',()=>{
 it('同時調教は一度だけ課金し、種別の成長と履歴を保存する',async()=>{await addCoins(db,A,1000,'adjust');const h=(await addHorse(db,'育成テスト',seeded(8),A))!;const r=await Promise.all([trainHorse(db,A,h.id,100,now,'stamina'),trainHorse(db,A,h.id,100,now,'stamina')]);expect(r.sort()).toEqual(['cooldown','ok']);expect((await walletOf(db,A)).balance).toBe(900);const [row]=await db.select().from(keibaHorses).where(eq(keibaHorses.id,h.id));expect(row!.development.points.stamina).toBe(1);expect(row!.development.history).toHaveLength(1);expect(row!.spd).toBe(h.spd);expect(row!.sta).toBe(Math.min(1200,h.sta+2));expect(await trainHorse(db,B,h.id,100,now,'start')).toBe('not_found');expect(await equipSkills(db,B,h.id,['dash'])).toBe(false);expect(await equipSkills(db,A,h.id,['dash'])).toBe(false);});
 it('スキル2枠、休養の履歴と再押し、知らない親を扱える',async()=>{const h=(await addHorse(db,'素質テスト',seeded(4),A))!;await db.update(keibaHorses).set({development:{points:{start:3,power:3,speed:3},skills:[],history:[]}}).where(eq(keibaHorses.id,h.id));expect(await equipSkills(db,A,h.id,['dash','heavy','grit'])).toBe(false);expect(await equipSkills(db,A,h.id,['dash','dash'])).toBe(false);expect(await equipSkills(db,A,h.id,['dash','heavy'])).toBe(true);await restHorse(db,A,h.id,now);await restHorse(db,A,h.id,now);const data=(await clubHorse(db,h.id,A,now))!;expect(data.development.history).toHaveLength(1);expect(data.development.history[0]!.kind).toBe('rest');expect((await pedigree(db,h.id))!.father).toBeNull();expect(data.myUnits).toBe(10);expect(data.manager).toBe(true);});
});
describe('新しい馬券の二重購入・確定映像',()=>{
 it('同じ確認画面は一度だけ購入し、次のレースには持ち越さない',async()=>{await addCoins(db,A,5000,'adjust');const created=await createTable(db,cfg,'keiba',{id:A,name:'さくら'},{window:'1'},now);if(created.status!=='ok'||!('table'in created))throw Error(created.status);const t=created.table,s=t.state as KbState;const form={action:'bets',mode:'formation',type:'exacta',p1:['1'],p2:['2','3'],bet:'50',v:String(t.version),raceKey:String(s.race.n)};const r=await Promise.all([actTable(db,cfg,t.id,A,form,now),actTable(db,cfg,t.id,A,form,now)]);expect(r.map(x=>x.status).sort()).toEqual(['ok','stale']);expect((await walletOf(db,A)).balance).toBe(4900);const racing=await actTable(db,cfg,t.id,A,{action:'start'},now);if(racing.status!=='ok'||!('table'in racing))throw Error(racing.status);const run=(racing.table.state as KbState);const end=new Date(run.deadline+1);await Promise.all([pollTable(db,cfg,t.id,end),pollTable(db,cfg,t.id,end)]);const saved=await db.select().from(keibaReplays);expect(saved).toHaveLength(1);expect((saved[0]!.data.live as any).confirmed).toBe(true);expect((saved[0]!.data as any).order).toEqual(run.run!.order);});
});

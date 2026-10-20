import { afterEach, beforeEach, expect, it } from 'vitest';
import { daifugo, type DaifugoState } from '../src/services/casino/tables/daifugo.js';
import { daifugoReview, variantLabel } from '../src/services/casino/aiStats.js';
import { TablesLobby, TableFrag } from '../src/web/views/casinoTables.js';
import { AiStatsSection } from '../src/web/views/aiStats.js';
import { lobbyTable } from '../src/services/casino/lobby.js';
import { createTable, actTable, tableById, joinTable } from '../src/services/casino/tables/service.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import type { CasinoTable } from '../src/db/schema.js';
import type { CasinoMe } from '../src/web/views/casino.js';
import type { Db } from '../src/db/client.js';
import { cfg, makeDb } from './helpers.js';
const A={id:'760000000000000001',name:'あや'},B={id:'760000000000000002',name:'べに'};
const now=new Date('2026-10-20T03:00:00Z'),ctx={cfg,now:now.getTime(),rng:(n:number)=>n-1};
const me={session:{userId:A.id,csrfToken:'test',displayName:'あや'},balance:10000,coin:{name:'銭',emoji:'🪙'}} as CasinoMe;
function humanState(){const r=daifugo.create(A,{entry:'100',opponents:'humans'},ctx);if(!r.ok)throw Error(r.error);return r.state;}
it('人だけの卓はホストでもBOTを追加できず、最低人数は人で満たす',()=>{
 let s=humanState();expect(s.humansOnly).toBe(true);
 expect(daifugo.act(s,A.id,{action:'add_bot'},ctx)).toEqual({ok:false,error:'invalid'});
 expect(daifugo.act(s,A.id,{action:'start'},ctx)).toEqual({ok:false,error:'need_players'});
 for(const who of [B,{id:'760000000000000003',name:'しお'}]){const r=daifugo.join(s,who,{},ctx);if(!r.ok)throw Error(r.error);s=r.state;}
 const start=daifugo.act(s,A.id,{action:'start'},ctx);expect(start.ok && start.state.phase).toBe('playing');expect(s.seats.some(x=>x.bot)).toBe(false);
});
it('BOT可を選んだ卓と旧卓では追加できる',()=>{
 const r=daifugo.create(A,{entry:'100',opponents:'bots'},ctx);if(!r.ok)throw Error(r.error);
 expect(daifugo.act(r.state,A.id,{action:'add_bot'},ctx).ok).toBe(true);delete r.state.humansOnly;
 expect(daifugo.act(r.state,A.id,{action:'add_bot'},ctx).ok).toBe(true);
});
it('募集には人だけ・参加費・リンクを表示し、一覧でも先に案内する',()=>{
 const s=humanState(),table={id:7,kind:'daifugo',hostId:A.id,status:'open',seatIds:[A.id],state:s} as unknown as CasinoTable;
 const html=TableFrag({table,me,casino:cfg.casino,now:ctx.now}).toString();expect(html).toContain('募集文とリンクをコピー');expect(html).toContain('data-invite-path="/casino/t/7"');expect(html).toContain('人だけ・BOTなし');expect(html).toContain('参加費 100 銭');expect(html).not.toContain('BOT を入れる');
 const legacy=structuredClone(s);delete legacy.humansOnly;const botTable={...table,id:9,state:legacy};const list=TablesLobby({me,kind:'daifugo',casino:cfg.casino,tables:[botTable,table]}).toString();
 expect(list.indexOf('#7')).toBeLessThan(list.indexOf('#9'));expect(list).toContain('<option value="humans">');
 expect(lobbyTable(table,B.id)).toMatchObject({humansOnly:true,canJoin:true,players:1});expect(JSON.stringify(lobbyTable(table,B.id))).not.toContain(A.name);
});
function rows(n=24,ids=3,variant='eight|cap:500|stake:paid',players=4,bots=3,net=100){return Array.from({length:n},(_,i)=>({game:'daifugo',variant,aiVersion:'4',players,bots,seats:[{id:'human:'+i%ids,name:'人',bot:false,place:1,net},...Array.from({length:bots},(_,k)=>({id:'bot:'+k,name:'BOT',bot:true,place:k+2,net:0}))]}));}
it('ルールの順序をそろえ、AI版・人数・BOT数・配当条件を混ぜない',()=>{
 const data=[...rows(2,2,'eight,revolution|cap:500|stake:paid'),...rows(2,2,'revolution,eight|cap:500|stake:paid'),...rows(1,1,'eight,revolution'),...rows(1,1,'eight,revolution|cap:500|stake:free'),...rows(1,1,'eight,revolution|cap:500|stake:paid',3,2),...rows(1,1,'eight,revolution|cap:500|stake:paid',4,2),...rows(1,1,'eight,revolution|cap:500|stake:paid').map(r=>({...r,aiVersion:'5'}))];
 const review=daifugoReview(data);expect(review).toHaveLength(6);expect(review.find(r=>r.matches===4)).toMatchObject({rules:'eight,revolution',policy:'利益上限500銭',houseNet:-400,housePer:-100});
 expect(review.some(r=>r.policy==='旧記録・配当条件未保存')).toBe(true);expect(review.some(r=>r.policy==='無料練習')).toBe(true);
});
it('赤字・弱い傾向・少数・参加者の偏りを分け、赤字順に案内する',()=>{
 expect(daifugoReview(rows())[0]).toMatchObject({status:'weak',houseNet:-2400,humans:3,humanTop:100});
 expect(daifugoReview(rows(19))[0]!.status).toBe('few');expect(daifugoReview(rows(24,1))[0]!.status).toBe('concentrated');
 const fair=rows().map((r,k)=>{const places=k%2?[3,1,2,4]:[2,1,3,4];return {...r,seats:r.seats.map((s,i)=>({...s,place:places[i]!}))};});expect(daifugoReview(fair)[0]!.status).toBe('loss');
 const html=AiStatsSection({ai:{rows:[],totals:[],players:[],othello:[],daifugo:daifugoReview(rows())},coinName:'銭',rangeLabel:'30日'}).toString();expect(html).toContain('改善候補');expect(html).toContain('-2,400');expect(html).not.toContain('human:');
 expect(variantLabel('daifugo','eight|cap:500|stake:paid')).toContain('利益上限500銭');
});
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());await addCoins(db,A.id,1000,'admin_grant');await addCoins(db,B.id,1000,'admin_grant');});
afterEach(async()=>close());
it('実際の卓操作でもBOT追加を拒否し、リンク閲覧では課金せず参加時だけ預かる',async()=>{
 const made=await createTable(db,cfg,'daifugo',A,{entry:'100',opponents:'humans'},now);if(!('table'in made))throw Error(made.status);const id=made.table.id;
 expect((await actTable(db,cfg,id,A.id,{action:'add_bot'},now)).status).toBe('invalid');
 expect((await tableById(db,id))?.state).toMatchObject({humansOnly:true});expect((await walletOf(db,B.id)).balance).toBe(1000);
 expect((await joinTable(db,cfg,id,B,{},now)).status).toBe('ok');expect((await walletOf(db,B.id)).balance).toBe(900);
});

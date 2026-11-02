import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {eq} from 'drizzle-orm';
import type {Db} from '../src/db/client.js';
import {casts,castSessions} from '../src/db/schema.js';
import {CAST_DEFAULTS,applyCast,setCastStatus,addMenuItem,getCast,menuOf,requestSession,isAdult} from '../src/services/cast.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {CastApp} from '../src/discord/cast.js';
import {cfg,makeDb} from './helpers.js';
const CAST='880000000000000001',USER='880000000000000003',now=new Date('2026-11-03T15:00:00Z');
let db:Db,close:()=>Promise<void>,app:CastApp;
beforeEach(async()=>{
 ({db,close}=await makeDb());
 await applyCast(db,CAST_DEFAULTS,{id:CAST,adult:true},{bio:'会話',tags:[],price30:300,price60:500,priceNight:2000,minorOk:true},now);
 await setCastStatus(db,CAST,'active','staff',now);await addCoins(db,USER,10000,'adjust');
 await addMenuItem(db,CAST_DEFAULTS,CAST,[{name:'相談',note:'',minutes:0,price:0,night:false,consult:true},{name:'納品',note:'',minutes:0,price:300,night:false,delivery:true},{name:'フリー',note:'',minutes:0,price:500,night:false},{name:'長時間',note:'',minutes:180,price:600,night:false}]);
 app=new CastApp(db,()=>cfg,{} as never);
});
afterEach(async()=>{await close();});
function select(action:string,values:string[]){return {customId:`cast:${action}`,guildId:cfg.guildId,inCachedGuild:()=>true,isStringSelectMenu:()=>true,isButton:()=>false,isModalSubmit:()=>false,user:{id:USER},member:{roles:{cache:new Map()}},message:{flags:{has:()=>true}},values,update:vi.fn(async (_body?:unknown)=>undefined),deferReply:vi.fn(async (_body?:unknown)=>undefined),editReply:vi.fn(async (_body?:unknown)=>undefined),reply:vi.fn(async (_body?:unknown)=>undefined),showModal:vi.fn(async (_body?:unknown)=>undefined),isRepliable:()=>true};}
it('年齢未設定も受付ONなら全メニューが表示され、OFFでは選べない',async()=>{
 expect(await isAdult(db,cfg,USER,[])).toBe(false);
 const menu=menuOf((await getCast(db,CAST))!);const i=select('pick',[CAST]);await app.onInteraction(i as never);
 const body=i.editReply.mock.calls[0]![0] as unknown as {components:{components:{options:{value:string}[]}[]}[]};
 expect(body.components[0]!.components[0]!.options.map(o=>o.value)).toEqual(menu.map(m=>m.id));
 await db.update(casts).set({minorOk:false}).where(eq(casts.memberId,CAST));
 const off=select('pick',[CAST]);await app.onInteraction(off as never);expect(off.editReply).toHaveBeenCalledWith(expect.objectContaining({components:[]}));
});
it('相談・納品の入口を開け、古いパネルでも受付OFFなら拒否する',async()=>{
 const menu=menuOf((await getCast(db,CAST))!);
 for(const item of menu.filter(m=>m.consult||m.delivery)){
  const i=select(`plansel:${CAST}`,[item.id]);await app.onInteraction(i as never);
  if(item.consult)expect(i.update).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('どんなことを頼みたい')}));
  else expect(i.showModal).toHaveBeenCalledOnce();
 }
 await db.update(casts).set({minorOk:false}).where(eq(casts.memberId,CAST));
 for(const item of menu){const i=select(`plansel:${CAST}`,[item.id]);await app.onInteraction(i as never);expect(i.showModal).not.toHaveBeenCalled();expect(i.update).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('受付を停止')}));}
});
it('受付OFFは通話・寝落ち・フリー・相談・納品すべてを課金前に拒否する',async()=>{
 await db.update(casts).set({minorOk:false}).where(eq(casts.memberId,CAST));
 for(const item of menuOf((await getCast(db,CAST))!)){
  for(const delivery of item.consult?[false,true]:[false]){
   const r=await requestSession(db,CAST_DEFAULTS,{castId:CAST,customerId:USER,customerAdult:false,plan:item.id,...(item.consult?{quote:delivery?{minutes:0,price:500,delivery:true}:{minutes:180,price:500}}:{})},now);
   expect(r.status).toBe('minor_off');
  }
 }
 expect((await walletOf(db,USER)).balance).toBe(10000);expect(await db.select().from(castSessions)).toHaveLength(0);
 // 18歳以上はminorOkのOFFで拒否しない。
 expect((await requestSession(db,CAST_DEFAULTS,{castId:CAST,customerId:USER,customerAdult:true,plan:'30'},now)).status).toBe('ok');
});

it('相談フォームを開いた後に受付OFFへ変われば、送信時に拒否する',async()=>{
 const consult=menuOf((await getCast(db,CAST))!).find(m=>m.consult)!;
 await db.update(casts).set({minorOk:false}).where(eq(casts.memberId,CAST));
 const i={...select(`cmodal:${CAST}:${consult.id}:call:180`,[]),isStringSelectMenu:()=>false,isUserSelectMenu:()=>false,isModalSubmit:()=>true};
 await app.onInteraction(i as never);expect(i.editReply).toHaveBeenCalledWith(expect.stringContaining('受付を停止'));
 expect((await walletOf(db,USER)).balance).toBe(10000);expect(await db.select().from(castSessions)).toHaveLength(0);
});

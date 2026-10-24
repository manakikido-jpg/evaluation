import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { KobanApp, kobanBuyConfirm } from '../src/discord/koban.js';
import { ShopApp } from '../src/discord/shop.js';
import { itemsView } from '../src/discord/presents.js';
import { buyKoban, heldKoban } from '../src/services/koban.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { listItems, seedDefaultItems } from '../src/services/shop.js';
import { cfg, makeDb } from './helpers.js';
const A='700000000000000001', B='700000000000000002';
let db:Db,close:()=>Promise<void>,app:KobanApp,dm:ReturnType<typeof vi.fn>,fetchMember:ReturnType<typeof vi.fn>;
beforeEach(async()=>{
 ({db,close}=await makeDb());await seedDefaultItems(db,{colors:[],titles:[]});
 await db.insert(members).values([A,B].map(id=>({id,username:id,displayName:'メンバー'})));await addCoins(db,A,10000,'admin_grant');
 dm=vi.fn().mockResolvedValue(false);fetchMember=vi.fn().mockResolvedValue({id:B,user:{bot:false},displayName:'受取人'});
 app=new KobanApp(db,()=>cfg,{sendDm:dm} as unknown as DiscordActions);
});
afterEach(async()=>close());
function interaction(id:string,kind='button',value?:string,userId=A){
 const views:any[]=[];
 const i={customId:id,guildId:cfg.guildId,user:{id:userId},member:{displayName:'送り主'},guild:{members:{fetch:fetchMember}},values:value?[value]:[],deferred:false,replied:false,
 inCachedGuild:()=>true,isButton:()=>kind==='button',isStringSelectMenu:()=>kind==='select',isUserSelectMenu:()=>kind==='user',
 async deferUpdate(){i.deferred=true;},async editReply(view:any){views.push(view);},async update(view:any){views.push(view);},async reply(view:any){views.push(view);}};
 return {i,views};
}
const item=async()=>(await listItems(db)).find(i=>i.kind==='koban_1000')!;
it('SHOPで小判を選ぶと固定価格の購入確認を出し、20％送金や割引券の経路を使わない',async()=>{
 const shop=new ShopApp(db,()=>cfg,{} as DiscordActions);
 const i=await item(),req=interaction('shop:pick:gift','select',String(i.id));
 Object.assign(req.i.member,{premiumSince:new Date()});
 await shop.onInteraction(req.i as never);
 const text=JSON.stringify(req.views[0]);expect(text).toContain('koban:buy:');expect(text).toContain('1,500');expect(text).toContain('手数料');expect(text).not.toContain('shop:buy:');
 expect((await walletOf(db,A)).balance).toBe(10000);
 expect(JSON.stringify(itemsView([]))).toContain('koban:inventory');
});
it('買う→持ち物→相手→確認→送付で受取人に換金し、DM失敗や再押下でも増やさない',async()=>{
 const i=await item(),view=kobanBuyConfirm(i,10000);const buyId=(view.components[0]!.components[0] as any).custom_id;
 const buy=interaction(buyId);await app.onInteraction(buy.i as never);
 expect((await walletOf(db,A)).balance).toBe(8500);const receipt=(await heldKoban(db,A))[0]!;
 const inv=interaction('koban:inventory');await app.onInteraction(inv.i as never);expect(JSON.stringify(inv.views)).toContain('1,000銭小判（1枚）');
 const pick=interaction('koban:pick','select',receipt.id);await app.onInteraction(pick.i as never);expect(JSON.stringify(pick.views)).toContain('koban:to:');
 const to=interaction(`koban:to:${receipt.id}`,'user',B);await app.onInteraction(to.i as never);expect(JSON.stringify(to.views)).toContain('受取人');
 expect((await walletOf(db,B)).balance).toBe(0);
 const send=interaction(`koban:send:${receipt.id}:${B}`);await app.onInteraction(send.i as never);
 expect((await walletOf(db,B)).balance).toBe(1000);expect(dm).toHaveBeenCalledOnce();expect(JSON.stringify(send.views)).toContain('換金は完了');
 await app.onInteraction(send.i as never);expect((await walletOf(db,B)).balance).toBe(1000);expect(dm).toHaveBeenCalledOnce();
 const replay=interaction(buyId);await app.onInteraction(replay.i as never);expect((await walletOf(db,A)).balance).toBe(8500);
});
it('送付確認後に相手の在籍を確認できなくなった場合は消費しない。他人の持ち物も操作できない',async()=>{
 const r=await buyKoban(db,A,(await item()).id,randomUUID());
 const other=interaction('koban:pick','select',r.receipt.id,B);await app.onInteraction(other.i as never);expect(JSON.stringify(other.views)).toContain('持っていません');
 fetchMember.mockRejectedValue(new Error('offline'));
 const send=interaction(`koban:send:${r.receipt.id}:${B}`);await app.onInteraction(send.i as never);
 expect(await heldKoban(db,A)).toHaveLength(1);expect((await walletOf(db,B)).balance).toBe(0);expect(dm).not.toHaveBeenCalled();
});

it('専用の小判売り場から全4種類を選べ、持ち物が空でも購入へ進める',async()=>{
 const inv=interaction('koban:inventory');await app.onInteraction(inv.i as never);expect(JSON.stringify(inv.views)).toContain('koban:shop');
 const shop=interaction('koban:shop');await app.onInteraction(shop.i as never);const options=shop.views[0].components[0].components[0].options;
 expect(options).toHaveLength(4);expect(JSON.stringify(options)).toContain('15,000');
 const pick=interaction('koban:shop-pick','select',options[3].value);await app.onInteraction(pick.i as never);expect(JSON.stringify(pick.views)).toContain('koban:buy:');
 expect((await walletOf(db,A)).balance).toBe(10000);
});

import {afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import sharp from 'sharp';
import {makeDb} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {members} from '../src/db/schema.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {visitData} from '../src/services/visitProfile.js';
import {VISIT_ORDER_PRICE,orderImage,orderImageIds,fulfillOrder,openOrder,placeOrder,refuseOrder} from '../src/services/visitOrders.js';
const A='790000000000000011',B='790000000000000012',now=new Date('2026-10-26T00:00:00Z');
let db:Db,close:()=>Promise<void>,png:Uint8Array;
beforeAll(async()=>{png=new Uint8Array(await sharp({create:{width:1080,height:640,channels:3,background:'#c04080'}}).png().toBuffer());});
beforeEach(async()=>{({db,close}=await makeDb());await db.insert(members).values([A,B].map(id=>({id,username:id,displayName:'参拝者'})));await addCoins(db,A,10000,'admin_grant');});
afterEach(async()=>close());

it('7,000銭で注文でき、同時に押しても1回だけ払う。銭が足りない・値段違い・未確認は払わない',async()=>{
 expect(VISIT_ORDER_PRICE).toBe(7000);
 await expect(placeOrder(db,A,'桜の背景',6000,true,now)).rejects.toThrow('値段');
 await expect(placeOrder(db,A,'桜の背景',7000,false,now)).rejects.toThrow('確認');
 await expect(placeOrder(db,A,'',7000,true,now)).rejects.toThrow();
 await expect(placeOrder(db,B,'桜の背景',7000,true,now)).rejects.toThrow('足りません');
 expect(await openOrder(db,B)).toBeUndefined();
 const r=await Promise.allSettled([placeOrder(db,A,'桜の背景',7000,true,now),placeOrder(db,A,'桜の背景',7000,true,now)]);
 expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 expect((await walletOf(db,A)).balance).toBe(3000);
});

it('運営が作って渡すと着せ替えで使え、断ると全額返す',async()=>{
 const o=await placeOrder(db,A,'夜桜',7000,true,now);
 const design=await fulfillOrder(db,o.id,'admin',{name:'夜桜の背景',bytes:png},now);
 expect((await visitData(db,A,now)).owned).toContain(design.id);
 await expect(refuseOrder(db,o.id,'admin','')).rejects.toThrow();
 await addCoins(db,A,7000,'admin_grant');
 const o2=await placeOrder(db,A,'海',7000,true,now);
 expect((await walletOf(db,A)).balance).toBe(3000);
 const refused=await refuseOrder(db,o2.id,'admin','今は作れません');
 expect(refused.status).toBe('refused');
 expect((await walletOf(db,A)).balance).toBe(10000);
 expect(await openOrder(db,A)).toBeUndefined();
});

it('アイコン・素材の写真を3枚までそえられ、webpにそろえる。4枚・読めない写真は払わない',async()=>{
 await expect(placeOrder(db,A,'夜桜',7000,true,now,[png,png,png,png])).rejects.toThrow('3 枚');
 await expect(placeOrder(db,A,'夜桜',7000,true,now,[new Uint8Array([1,2,3])])).rejects.toThrow('読めません');
 expect((await walletOf(db,A)).balance).toBe(10000);
 const o=await placeOrder(db,A,'夜桜',7000,true,now,[png,png]);
 const ids=(await orderImageIds(db,[o.id])).get(o.id)!;expect(ids).toHaveLength(2);
 const img=await orderImage(db,ids[0]!);expect(img!.contentType).toBe('image/webp');expect(img!.memberId).toBe(A);
 expect((await sharp(Buffer.from(img!.data)).metadata()).format).toBe('webp');
});

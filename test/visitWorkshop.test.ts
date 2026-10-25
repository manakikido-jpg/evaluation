import {afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {eq,sql} from 'drizzle-orm';
import sharp from 'sharp';
import {makeDb} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {members,visitPurchases,visitCreatorLicenses,visitDesigns,coinTx} from '../src/db/schema.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {buyVisitItem,saveVisitProfile,visitData} from '../src/services/visitProfile.js';
import {visitCardSvg,renderVisitCard} from '../src/services/visitCard.js';
import {accessibleDesign,buyCreatorLicense,createDesign,deletePrivateDesign,loadWorkshopSettings,normalizeDesign,reviewDesign,saveWorkshopSettings,submitDesign,workshopData} from '../src/services/visitWorkshop.js';
import {visitRevenue} from '../src/services/visitRevenue.js';
const A='790000000000000001',B='790000000000000002',C='790000000000000003',now=new Date('2026-10-01T00:00:00Z');
let db:Db,close:()=>Promise<void>,png:Uint8Array,frame:Uint8Array;
beforeAll(async()=>{png=new Uint8Array(await sharp({create:{width:1080,height:640,channels:3,background:'#0040c0'}}).png().toBuffer());frame=new Uint8Array(await sharp({create:{width:1080,height:640,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer());});
beforeEach(async()=>{({db,close}=await makeDb());await db.insert(members).values([A,B,C].map(id=>({id,username:id,displayName:'参拝者'})));for(const id of [A,B,C])await addCoins(db,id,10000,'admin_grant');});
afterEach(async()=>close());
const license=async(id=A)=>{await saveWorkshopSettings(db,{enabled:true,licensePrice:5000},'admin');return buyCreatorLicense(db,id,5000,true,now);};
const create=(sell=false,kind='background')=>createDesign(db,A,{kind,name:'自作の青い背景',description:'作品の説明',price:1001,sell,rights:true,bytes:kind==='frame'?frame:png},now);
it('権利は初期販売停止。価格未定・未確認・改ざんでは課金せず、価格設定後の同時購入は1回',async()=>{
 expect(await loadWorkshopSettings(db)).toEqual({enabled:false,licensePrice:0});
 await expect(buyCreatorLicense(db,A,0,true,now)).rejects.toThrow('販売停止');
 await expect(saveWorkshopSettings(db,{enabled:true,licensePrice:0},'admin')).rejects.toThrow('価格');
 await saveWorkshopSettings(db,{enabled:true,licensePrice:5000},'admin');
 await expect(buyCreatorLicense(db,A,1,true,now)).rejects.toThrow('価格');await expect(buyCreatorLicense(db,A,5000,false,now)).rejects.toThrow();
 const results=await Promise.all([buyCreatorLicense(db,A,5000,true,now),buyCreatorLicense(db,A,5000,true,now)]);expect(results.sort()).toEqual(['bought','owned']);
 expect(await db.select().from(visitCreatorLicenses)).toHaveLength(1);expect((await walletOf(db,A)).balance).toBe(5000);
 await saveWorkshopSettings(db,{enabled:false,licensePrice:5000},'admin');expect(await buyCreatorLicense(db,A,5000,true,now)).toBe('owned');
});
it('権利なし・退会・権利の未確認・不正な価格は作品を作れない',async()=>{
 await expect(create()).rejects.toThrow('制作権利');await license();
 await expect(createDesign(db,A,{kind:'background',name:'a',description:'',price:1,sell:false,rights:false,bytes:png},now)).rejects.toThrow('権利');
 await expect(createDesign(db,A,{kind:'background',name:'a',description:'',price:0,sell:true,rights:true,bytes:png},now)).rejects.toThrow('販売価格');
 await db.update(members).set({leftAt:now}).where(eq(members.id,A));await expect(create()).rejects.toThrow('在籍');expect(await db.select().from(visitDesigns)).toHaveLength(0);
});
it('SVG・壊れた画像・大きすぎる画像・透過のないフレームを拒否し、正規化する',async()=>{
 for(const bytes of [new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),new Uint8Array([1,2,3]),new Uint8Array(8*1024*1024+1)])await expect(normalizeDesign(bytes,'background')).rejects.toThrow();
 await expect(normalizeDesign(png,'frame')).rejects.toThrow('透過');
 const normalized=await normalizeDesign(frame,'frame');expect(await sharp(normalized).metadata()).toMatchObject({width:1080,height:640,format:'png',hasAlpha:true});
});
it('自分用の作品は他人のカタログへ出さず、プレビュー・装備・Discord共通カードに反映する',async()=>{
 await license();const bg=await create(),f=await create(false,'frame');
 expect(await accessibleDesign(db,bg.id,B)).toBeUndefined();expect((await visitData(db,B,now,{background:bg.id})).art[bg.id]).toBeUndefined();
 await expect(saveVisitProfile(db,B,{background:bg.id,frame:'plain',title:'rank',badges:[],publicStats:true},now)).rejects.toThrow('持って');
 const before=(await walletOf(db,A)).balance;
 await saveVisitProfile(db,A,{background:bg.id,frame:f.id,title:'rank',badges:[],publicStats:true},now);
 const d=await visitData(db,A,now);expect(visitCardSvg(d)).toContain(d.art[bg.id]);expect(visitCardSvg(d)).toContain(d.art[f.id]);
 const rendered=renderVisitCard(d);expect(await sharp(rendered).metadata()).toMatchObject({width:1080,height:640});
 const pixel=await sharp(rendered).extract({left:900,top:500,width:1,height:1}).raw().toBuffer();expect(pixel[2]!).toBeGreaterThan(pixel[0]!+50);expect((await walletOf(db,A)).balance).toBe(before);
});
it('販売は運営承認後だけ。二重購入でも70/30を1回だけ配分し、自己購入は無料',async()=>{
 await license();const item=await create(true);
 await expect(buyVisitItem(db,B,item.id,1001,true,now)).rejects.toThrow('販売状態');
 await reviewDesign(db,item.id,'admin','approve','',now);
 await expect(buyVisitItem(db,B,item.id,1,true,now)).rejects.toThrow('金額');
 const results=await Promise.all([buyVisitItem(db,B,item.id,1001,true,now),buyVisitItem(db,B,item.id,1001,true,now)]);expect(results.sort()).toEqual(['bought','owned']);
 expect((await walletOf(db,B)).balance).toBe(8999);expect((await walletOf(db,A)).balance).toBe(5700);
 expect((await db.select().from(visitPurchases))[0]).toMatchObject({creatorId:A,creatorPaid:700,price:1001});
 expect(await buyVisitItem(db,A,item.id,1001,true,now)).toBe('owned');expect((await workshopData(db,A)).sales).toEqual({count:1,gross:1001,received:700});
 expect(await visitRevenue(db)).toMatchObject({sales:1001,creatorPaid:700,licenseSales:5000,revenue:5301});
});
it('残高不足・制作者への入金失敗なら支払と購入履歴をすべて戻せる',async()=>{
 await license();const item=await create(true);await reviewDesign(db,item.id,'admin','approve','',now);
 await db.execute(sql`CREATE FUNCTION fail_visit_credit() RETURNS trigger AS $$ BEGIN IF NEW.reason='visit_design_reward' THEN RAISE EXCEPTION 'credit unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
 await db.execute(sql`CREATE TRIGGER fail_visit_credit BEFORE INSERT ON coin_tx FOR EACH ROW EXECUTE FUNCTION fail_visit_credit()`);
 await expect(buyVisitItem(db,B,item.id,1001,true,now)).rejects.toThrow();expect((await walletOf(db,B)).balance).toBe(10000);expect((await walletOf(db,A)).balance).toBe(5000);expect(await db.select().from(visitPurchases)).toHaveLength(0);
 await db.execute(sql`DROP TRIGGER fail_visit_credit ON coin_tx`);
 await buyVisitItem(db,B,item.id,1001,true,now);expect((await walletOf(db,A)).balance).toBe(5700);
});
it('販売停止後も購入済み画像を維持し、未購入者は購入できない',async()=>{
 await license();const item=await create(true);await reviewDesign(db,item.id,'admin','approve','',now);await buyVisitItem(db,B,item.id,1001,true,now);
 await reviewDesign(db,item.id,'admin','withdraw','公開停止',now);
 await expect(buyVisitItem(db,C,item.id,1001,true,now)).rejects.toThrow('販売状態');
 expect(await accessibleDesign(db,item.id,C)).toBeUndefined();expect(await accessibleDesign(db,item.id,B)).toBeDefined();
 await saveVisitProfile(db,B,{background:item.id,frame:'plain',title:'rank',badges:[],publicStats:true},now);expect((await visitData(db,B,now)).art[item.id]).toBeDefined();
 await expect(deletePrivateDesign(db,item.id,A)).rejects.toThrow('自分用');
});
it('申請は持ち主と販売権利確認が必要。却下理由を保存し、承認済みを差し替えない',async()=>{
 await license();const item=await create();
 await expect(submitDesign(db,item.id,A,1001)).rejects.toThrow('権利');await expect(submitDesign(db,item.id,B,1001,true)).rejects.toThrow('自分用');
 await submitDesign(db,item.id,A,1001,true);await expect(reviewDesign(db,item.id,'admin','reject','',now)).rejects.toThrow('理由');
 await reviewDesign(db,item.id,'admin','reject','作り直してください',now);expect((await workshopData(db,A)).designs[0]!.reviewNote).toBe('作り直してください');
 await expect(reviewDesign(db,item.id,'admin','approve','',now)).rejects.toThrow('状態');
});
it('私物の削除は本人だけ。装備中なら標準へ戻す',async()=>{
 await license();const item=await create();await saveVisitProfile(db,A,{background:item.id,frame:'plain',title:'rank',badges:[],publicStats:true},now);
 await expect(deletePrivateDesign(db,item.id,B)).rejects.toThrow('自分用');await deletePrivateDesign(db,item.id,A);
 expect((await visitData(db,A,now)).profile.background).toBe('paper');expect(await db.select().from(visitDesigns)).toHaveLength(0);
});
it('購入時の金額で月別・累計を集計し、日本時間の月初を含め月末を含まない',async()=>{
 await db.insert(visitPurchases).values([{memberId:B,itemId:'sakura',price:1234,createdAt:new Date('2026-09-30T14:59:59Z')},{memberId:B,itemId:'moon',price:2345,createdAt:new Date('2026-09-30T15:00:00Z')},{memberId:C,itemId:'petal',price:3456,createdAt:new Date('2026-10-31T15:00:00Z')}]);
 const before=(await walletOf(db,B)).balance;const october=await visitRevenue(db,new Date('2026-09-30T15:00:00Z'),new Date('2026-10-31T15:00:00Z'));
 expect(october).toMatchObject({count:1,buyers:1,sales:2345,revenue:2345});expect(october.items[0]).toMatchObject({name:'月夜の神社',sales:2345});
 expect(await visitRevenue(db)).toMatchObject({count:3,buyers:2,sales:7035,revenue:7035});expect((await walletOf(db,B)).balance).toBe(before);
});
it('制作者同士の同時購入も配分を1回ずつ行い、同じ相手への二重支払いをしない',async()=>{
 await license(A);await license(B);const a=await create(true),b=await createDesign(db,B,{kind:'background',name:'Bの作品',description:'',price:1001,sell:true,rights:true,bytes:png},now);
 await reviewDesign(db,a.id,'admin','approve','',now);await reviewDesign(db,b.id,'admin','approve','',now);
 expect(await Promise.all([buyVisitItem(db,A,b.id,1001,true,now),buyVisitItem(db,B,a.id,1001,true,now)])).toEqual(['bought','bought']);
 expect((await walletOf(db,A)).balance).toBe(4699);expect((await walletOf(db,B)).balance).toBe(4699);
});
it('私物と申請は同時保存でも20点まで。承認すると申請枠が空く',async()=>{
 await license();await db.insert(visitDesigns).values(Array.from({length:19},(_,i)=>({id:'design_seed'+i,creatorId:A,kind:'background',name:'保存作品',status:'private',data:png})));
 const results=await Promise.allSettled([create(true),create(true)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await db.select().from(visitDesigns)).toHaveLength(20);
 const pending=results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof create>>>;
 await reviewDesign(db,pending.value.id,'admin','approve','',now);await expect(create()).resolves.toBeDefined();
});
it('制作者が退会した作品の新規購入と、残高不足は支払わずに止める',async()=>{
 await license();const item=await createDesign(db,A,{kind:'background',name:'高い作品',description:'',price:20000,sell:true,rights:true,bytes:png},now);await reviewDesign(db,item.id,'admin','approve','',now);
 await expect(buyVisitItem(db,B,item.id,20000,true,now)).rejects.toThrow('銭が足りません');
 const affordable=await create(true);await reviewDesign(db,affordable.id,'admin','approve','',now);await db.update(members).set({leftAt:now}).where(eq(members.id,A));
 await expect(buyVisitItem(db,B,affordable.id,1001,true,now)).rejects.toThrow('販売状態');expect((await walletOf(db,B)).balance).toBe(10000);expect(await db.select().from(visitPurchases)).toHaveLength(0);
});

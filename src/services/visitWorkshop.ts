import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {and,asc,desc,eq,inArray,or,sql} from 'drizzle-orm';
import type {Db} from '../db/client.js';
import {members,settings,visitCreatorLicenses,visitDesigns,visitPurchases,visitProfiles} from '../db/schema.js';
import {spendWithin,addCoins} from './economy.js';
import {audit} from './audit.js';
import {VisitError} from './visitErrors.js';
export const CREATOR_PERCENT=70;
export const DESIGN_INPUT_MAX=8*1024*1024;
const DESIGN_MAX=2*1024*1024,KEY='visit.workshop',MAX_DESIGNS=20;
export type WorkshopSettings={enabled:boolean;licensePrice:number};
export async function loadWorkshopSettings(db:Db):Promise<WorkshopSettings>{
 const [r]=await db.select().from(settings).where(eq(settings.key,KEY));const v=(r?.value??{}) as Record<string,unknown>;
 const price=typeof v.licensePrice==='number'&&Number.isInteger(v.licensePrice)&&v.licensePrice>=1&&v.licensePrice<=10000000?v.licensePrice:0;
 return {enabled:v.enabled===true&&price>0,licensePrice:price};
}
export async function saveWorkshopSettings(db:Db,value:WorkshopSettings,by:string){
 if(!Number.isInteger(value.licensePrice)||value.licensePrice<0||value.licensePrice>10000000||value.enabled&&value.licensePrice===0)throw new VisitError('販売するには1〜10,000,000銭の価格を設定してください。');
 await db.transaction(async tx=>{await tx.insert(settings).values({key:KEY,value,updatedBy:by}).onConflictDoUpdate({target:settings.key,set:{value,updatedBy:by,updatedAt:new Date()}});await audit(tx,{actorId:by,action:'visit.workshop_settings',detail:value,via:'web'});});
}
export async function buyCreatorLicense(db:Db,id:string,quote:number,confirmed:boolean,now=new Date()){
 return db.transaction(async tx=>{
  const [m]=await tx.select().from(members).where(eq(members.id,id)).for('update');if(!m||m.leftAt||m.isBot)throw new VisitError('在籍を確認できません。');
  const [old]=await tx.select().from(visitCreatorLicenses).where(eq(visitCreatorLicenses.memberId,id));if(old)return 'owned' as const;
  const c=await loadWorkshopSettings(tx);if(!c.enabled||!confirmed||quote!==c.licensePrice)throw new VisitError('制作権利は販売停止中か、価格が変わりました。画面を開き直してください。');
  if(!await spendWithin(tx,id,c.licensePrice,'shop',{kind:'visit_creator_license'}))throw new VisitError('銭が足りません。');
  await tx.insert(visitCreatorLicenses).values({memberId:id,price:c.licensePrice,createdAt:now});await audit(tx,{actorId:id,action:'visit.license_buy',detail:{price:c.licensePrice},via:'web'});return 'bought' as const;
 });
}
export async function normalizeDesign(bytes:Uint8Array,kind:'background'|'frame'){
 if(!bytes.length||bytes.length>DESIGN_INPUT_MAX)throw new VisitError('画像は8MBまでのPNG・JPEG・WebPにしてください。');
 try{
  const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
  const jpeg=bytes[0]===255&&bytes[1]===216;
  const webp=Buffer.from(bytes.subarray(0,4)).toString()==='RIFF'&&Buffer.from(bytes.subarray(8,12)).toString()==='WEBP';
  if(!png&&!jpeg&&!webp)throw Error('format');
  const image=sharp(bytes,{limitInputPixels:16777216,failOn:'error'}),meta=await image.metadata();
  if(!['png','jpeg','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw Error('format');
  if(kind==='frame'&&(!meta.hasAlpha||meta.width!==1080||meta.height!==640||meta.format==='jpeg'))throw new VisitError('フレームは1080×640pxの透過PNG・WebPにしてください。');
  const data=await image.rotate().resize(1080,640,{fit:kind==='frame'?'fill':'cover'}).ensureAlpha().png({compressionLevel:9}).toBuffer();
  if(data.length>DESIGN_MAX)throw new VisitError('正規化後の画像が大きすぎます。画像を簡単にして保存し直してください。');
  if(kind==='frame'){
   const center=await sharp(data).extract({left:540,top:320,width:1,height:1}).raw().toBuffer();
   if(center[3]!>32)throw new VisitError('フレームの中央は、プロフィールが見えるように透明にしてください。');
  }
  return new Uint8Array(data);
 }catch(e){if(e instanceof VisitError)throw e;throw new VisitError('読み込めるPNG・JPEG・WebPを選んでください。SVGや動画・アニメ画像は使えません。');}
}
const metaColumns={id:visitDesigns.id,creatorId:visitDesigns.creatorId,kind:visitDesigns.kind,name:visitDesigns.name,description:visitDesigns.description,price:visitDesigns.price,status:visitDesigns.status,reviewNote:visitDesigns.reviewNote,createdAt:visitDesigns.createdAt};
export const designMetadata=(db:Db)=>db.select(metaColumns).from(visitDesigns).where(inArray(visitDesigns.status,['pending','approved','rejected','withdrawn'])).orderBy(desc(visitDesigns.createdAt));
export type DesignMetadata=Awaited<ReturnType<typeof designMetadata>>[number];
export async function createDesign(db:Db,creatorId:string,input:{kind:string;name:string;description:string;price:number;sell:boolean;rights:boolean;bytes:Uint8Array},now=new Date()){
 const name=input.name.trim(),description=input.description.trim();
 if(!['background','frame'].includes(input.kind)||!name||name.length>60||description.length>300||!input.rights)throw new VisitError('種類・作品名・利用する権利の確認をしてください。');
 if(input.sell&&(!Number.isInteger(input.price)||input.price<1||input.price>1000000))throw new VisitError('販売価格は1〜1,000,000銭にしてください。');
 // 権利がない人の画像は処理しない。保存時にも再確認する。
 const [license]=await db.select().from(visitCreatorLicenses).where(eq(visitCreatorLicenses.memberId,creatorId));if(!license)throw new VisitError('制作権利の購入が必要です。');
 const data=await normalizeDesign(input.bytes,input.kind as 'background'|'frame');
 return db.transaction(async tx=>{
  const [m]=await tx.select().from(members).where(eq(members.id,creatorId)).for('update');if(!m||m.leftAt||m.isBot)throw new VisitError('在籍を確認できません。');
  const [stillLicensed]=await tx.select().from(visitCreatorLicenses).where(eq(visitCreatorLicenses.memberId,creatorId));if(!stillLicensed)throw new VisitError('制作権利を確認できません。');
  const [count]=await tx.select({n:sql<number>`count(*)::int`}).from(visitDesigns).where(and(eq(visitDesigns.creatorId,creatorId),inArray(visitDesigns.status,['private','pending','rejected'])));if((count?.n??0)>=MAX_DESIGNS)throw new VisitError('自分用・審査待ち・却下作品は合計20点までです。不要な自分用・却下作品を削除してください。');
  const [row]=await tx.insert(visitDesigns).values({id:'design_'+randomUUID(),creatorId,kind:input.kind,name,description,price:input.sell?input.price:0,status:input.sell?'pending':'private',data,createdAt:now}).returning(metaColumns);
  await audit(tx,{actorId:creatorId,action:'visit.design_create',detail:{id:row!.id,kind:input.kind,sell:input.sell,price:input.sell?input.price:0},via:'web'});return row!;
 });
}
export async function submitDesign(db:Db,id:string,creatorId:string,price:number,rights=false){
 if(!rights)throw new VisitError('販売に利用する権利を確認してください。');
 if(!Number.isInteger(price)||price<1||price>1000000)throw new VisitError('販売価格は1〜1,000,000銭にしてください。');
 return db.transaction(async tx=>{
  const [m]=await tx.select().from(members).where(eq(members.id,creatorId)).for('update');if(!m||m.leftAt||m.isBot)throw new VisitError('在籍を確認できません。');
  const [row]=await tx.update(visitDesigns).set({status:'pending',price,reviewNote:''}).where(and(eq(visitDesigns.id,id),eq(visitDesigns.creatorId,creatorId),eq(visitDesigns.status,'private'))).returning(metaColumns);
  if(!row)throw new VisitError('自分用の作品だけ販売申請できます。');await audit(tx,{actorId:creatorId,action:'visit.design_submit',detail:{id,price},via:'web'});return row;
 });
}
export async function reviewDesign(db:Db,id:string,by:string,decision:'approve'|'reject'|'withdraw',note:string,now=new Date()){
 if(note.length>300||decision==='reject'&&!note.trim())throw new VisitError('却下する理由は300文字以内で入力してください。');
 return db.transaction(async tx=>{
  const [row]=await tx.select().from(visitDesigns).where(eq(visitDesigns.id,id)).for('update');
  if(!row || (decision==='withdraw' ? row.status!=='approved' : row.status!=='pending'))throw new VisitError('現在の審査状態を確認して開き直してください。');
  const status=decision==='approve'?'approved':decision==='reject'?'rejected':'withdrawn';
  if(decision==='approve'&&row!.price<=0)throw new VisitError('販売価格を確認してください。');
  await tx.update(visitDesigns).set({status,reviewNote:note.trim(),reviewedBy:by,reviewedAt:now}).where(eq(visitDesigns.id,id));
  await audit(tx,{actorId:by,targetId:row!.creatorId,action:'visit.design_'+decision,detail:{id,price:row!.price,note:note.trim()},via:'web'});
 });
}
export async function deletePrivateDesign(db:Db,id:string,creatorId:string){
 await db.transaction(async tx=>{
  const [m]=await tx.select().from(members).where(eq(members.id,creatorId)).for('update');if(!m||m.leftAt||m.isBot)throw new VisitError('在籍を確認できません。');
  const [row]=await tx.select().from(visitDesigns).where(eq(visitDesigns.id,id)).for('update');
  if(!row||row.creatorId!==creatorId||!['private','rejected'].includes(row.status))throw new VisitError('自分用・却下作品だけ削除できます。');
  // 装備中なら標準へ戻す。購入済みの販売作品はここへ来ない。
  await tx.update(visitProfiles).set(row.kind==='background'?{background:'paper'}:{frame:'plain'}).where(and(eq(visitProfiles.memberId,creatorId),row.kind==='background'?eq(visitProfiles.background,id):eq(visitProfiles.frame,id)));
  await tx.delete(visitDesigns).where(eq(visitDesigns.id,id));await audit(tx,{actorId:creatorId,action:'visit.design_delete',detail:{id},via:'web'});
 });
}
export async function accessibleDesign(db:Db,id:string,userId:string){
 const [row]=await db.select().from(visitDesigns).where(eq(visitDesigns.id,id));if(!row)return undefined;
 const [bought]=await db.select().from(visitPurchases).where(and(eq(visitPurchases.memberId,userId),eq(visitPurchases.itemId,id)));
 return row.creatorId===userId||row.status==='approved'||!!bought?row:undefined;
}
export type CustomVisitItem={id:string;kind:'background'|'frame';name:string;price:number;colors:readonly string[];badge:null;creatorId:string;creatorName:string;status:string;sellable:boolean};
export async function customCatalog(db:Db,id:string,ownedIds:string[]):Promise<CustomVisitItem[]>{
 const rows=await db.select({...metaColumns,creatorName:members.displayName,leftAt:members.leftAt}).from(visitDesigns).innerJoin(members,eq(members.id,visitDesigns.creatorId)).where(or(eq(visitDesigns.status,'approved'),eq(visitDesigns.creatorId,id),ownedIds.length?inArray(visitDesigns.id,ownedIds):sql`false`));
 return rows.filter(r=>r.kind==='background'||r.kind==='frame').map(r=>({id:r.id,kind:r.kind as 'background'|'frame',name:r.name,price:r.price,colors:['#c7aa7b','#c7aa7b'],badge:null,creatorId:r.creatorId,creatorName:r.creatorName,status:r.status,sellable:r.status==='approved'&&!r.leftAt}));
}
export async function buyCustomDesign(db:Db,buyerId:string,itemId:string,quote:number,confirmed:boolean,now=new Date()){
 const [before]=await db.select().from(visitDesigns).where(eq(visitDesigns.id,itemId));if(!before)throw new VisitError('作品が見つかりません。');
 return db.transaction(async tx=>{
  const people=await tx.select().from(members).where(inArray(members.id,[...new Set([buyerId,before.creatorId])])).orderBy(asc(members.id)).for('update');
  const buyer=people.find(m=>m.id===buyerId),creator=people.find(m=>m.id===before.creatorId);
  if(!buyer||buyer.leftAt||buyer.isBot)throw new VisitError('在籍を確認できません。');
  const [old]=await tx.select().from(visitPurchases).where(and(eq(visitPurchases.memberId,buyerId),eq(visitPurchases.itemId,itemId)));if(old||buyerId===before.creatorId)return 'owned' as const;
  const [item]=await tx.select().from(visitDesigns).where(eq(visitDesigns.id,itemId)).for('update');
  if(!item||item.status!=='approved'||!creator||creator.leftAt||creator.isBot||!confirmed||quote!==item.price||item.price<=0)throw new VisitError('販売状態や金額を確認して開き直してください。');
  const creatorPaid=Math.floor(item.price*CREATOR_PERCENT/100);
  if(!await spendWithin(tx,buyerId,item.price,'shop',{kind:'visit_cosmetic',itemId,creatorId:item.creatorId,creatorPaid}))throw new VisitError('銭が足りません。');
  if(creatorPaid)await addCoins(tx,item.creatorId,creatorPaid,'visit_design_reward',{itemId,buyerId,price:item.price});
  await tx.insert(visitPurchases).values({memberId:buyerId,itemId,price:item.price,creatorId:item.creatorId,creatorPaid,createdAt:now});
  await audit(tx,{actorId:buyerId,targetId:item.creatorId,action:'visit.buy',detail:{itemId,price:item.price,creatorPaid,platform:item.price-creatorPaid},via:'web'});return 'bought' as const;
 });
}
export async function workshopData(db:Db,id:string){
 const [config,licenses,designs,sales]=await Promise.all([loadWorkshopSettings(db),db.select().from(visitCreatorLicenses).where(eq(visitCreatorLicenses.memberId,id)),db.select(metaColumns).from(visitDesigns).where(eq(visitDesigns.creatorId,id)).orderBy(desc(visitDesigns.createdAt)),db.select({count:sql<number>`count(*)::int`,gross:sql<string>`coalesce(sum(${visitPurchases.price}),0)`,received:sql<string>`coalesce(sum(${visitPurchases.creatorPaid}),0)`}).from(visitPurchases).where(eq(visitPurchases.creatorId,id))]);
 return {config,license:licenses[0],designs,sales:{count:sales[0]!.count,gross:Number(sales[0]!.gross),received:Number(sales[0]!.received)}};
}
export type WorkshopData=Awaited<ReturnType<typeof workshopData>>;

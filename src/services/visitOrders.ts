import sharp from 'sharp';
import {and,asc,desc,eq,inArray,sql} from 'drizzle-orm';
import type {Db} from '../db/client.js';
import {members,visitOrderImages,visitOrders,type VisitOrder} from '../db/schema.js';
import {addCoins,spendWithin} from './economy.js';
import {audit} from './audit.js';
import {VisitError} from './visitErrors.js';
import {createStaffDesign,grantDesign} from './visitWorkshop.js';

/**
 * 🖌 参拝帳の背景のオーダーメイド。
 * メンバーが銭を払って注文し、運営が作って渡す。運営が断ったら全額返す。
 * 1 人が同時に頼めるのは 1 つだけ。
 */
export const VISIT_ORDER_PRICE=7000;
export const VISIT_ORDER_REQUEST_MAX=500;
export const VISIT_ORDER_IMAGES_MAX=3;
export const VISIT_ORDER_IMAGE_INPUT_MAX=8*1024*1024;

/** そえる写真を、長い辺 1600px までの webp にそろえる（写真の中の位置情報などは消える） */
export async function normalizeOrderImage(bytes:Uint8Array):Promise<Uint8Array>{
 if(!bytes.length||bytes.length>VISIT_ORDER_IMAGE_INPUT_MAX)throw new VisitError('写真は 1 枚 8MB までです。');
 try{return new Uint8Array(await sharp(bytes,{limitInputPixels:40_000_000}).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer());}
 catch{throw new VisitError('写真が読めませんでした（PNG・JPEG・WebP にしてください）。');}
}
/** 注文ごとの写真の番号 */
export async function orderImageIds(db:Db,orderIds:number[]):Promise<Map<number,number[]>>{
 const map=new Map<number,number[]>();if(!orderIds.length)return map;
 for(const r of await db.select({id:visitOrderImages.id,orderId:visitOrderImages.orderId}).from(visitOrderImages).where(inArray(visitOrderImages.orderId,orderIds)).orderBy(asc(visitOrderImages.id)))map.set(r.orderId,[...(map.get(r.orderId)??[]),r.id]);
 return map;
}
export async function orderImage(db:Db,id:number){
 const [row]=await db.select({data:visitOrderImages.data,contentType:visitOrderImages.contentType,orderId:visitOrderImages.orderId,memberId:visitOrders.memberId}).from(visitOrderImages).innerJoin(visitOrders,eq(visitOrders.id,visitOrderImages.orderId)).where(eq(visitOrderImages.id,id));
 return row;
}

export async function openOrder(db:Db,memberId:string):Promise<VisitOrder|undefined>{
 const [row]=await db.select().from(visitOrders).where(and(eq(visitOrders.memberId,memberId),eq(visitOrders.status,'pending')));
 return row;
}
export const ordersOf=(db:Db,memberId:string)=>db.select().from(visitOrders).where(eq(visitOrders.memberId,memberId)).orderBy(desc(visitOrders.id)).limit(10);
export const listOrders=(db:Db)=>db.select().from(visitOrders).orderBy(sql`case when ${visitOrders.status}='pending' then 0 else 1 end`,desc(visitOrders.id)).limit(100);

/** 注文する（値段を確かめて銭を払う。同時に押されても 1 回だけ） */
export async function placeOrder(db:Db,memberId:string,request:string,quote:number,confirmed:boolean,now=new Date(),images:Uint8Array[]=[]):Promise<VisitOrder>{
 const text=request.trim();
 if(!text||text.length>VISIT_ORDER_REQUEST_MAX)throw new VisitError(`どんな背景がほしいかを ${VISIT_ORDER_REQUEST_MAX} 文字までで書いてください。`);
 if(!confirmed)throw new VisitError('値段の確認にチェックを入れてください。');
 if(quote!==VISIT_ORDER_PRICE)throw new VisitError('値段が変わりました。画面を開き直してください。');
 if(images.length>VISIT_ORDER_IMAGES_MAX)throw new VisitError(`写真は ${VISIT_ORDER_IMAGES_MAX} 枚までです。`);
 const pics=await Promise.all(images.map(normalizeOrderImage));
 return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'visit.order:'+memberId}))`);
  const [m]=await tx.select().from(members).where(eq(members.id,memberId));if(!m||m.leftAt||m.isBot)throw new VisitError('メンバーだけが注文できます。');
  if(await openOrder(tx,memberId))throw new VisitError('いま頼んでいる背景があります。できあがるまでお待ちください。');
  const [row]=await tx.insert(visitOrders).values({memberId,request:text,price:VISIT_ORDER_PRICE,createdAt:now}).returning();
  if(!await spendWithin(tx,memberId,VISIT_ORDER_PRICE,'shop',{kind:'visit_order',orderId:row!.id}))throw new VisitError('銭が足りません。');
  if(pics.length)await tx.insert(visitOrderImages).values(pics.map(data=>({orderId:row!.id,contentType:'image/webp',data,createdAt:now})));
  await audit(tx,{actorId:memberId,action:'visit.order_place',detail:{id:row!.id,price:VISIT_ORDER_PRICE,images:pics.length},via:'web'});
  return row!;
 });
}

async function pendingOrder(db:Db,id:number){
 const [row]=await db.select().from(visitOrders).where(eq(visitOrders.id,id));
 if(!row||row.status!=='pending')throw new VisitError('受付中の注文が見つかりません。');
 return row;
}

/** 作って渡す（画像から運営の作品を作り、注文した人に渡して、注文を終える） */
export async function fulfillOrder(db:Db,id:number,by:string,input:{name:string;bytes:Uint8Array},now=new Date()){
 const order=await pendingOrder(db,id);
 const design=await createStaffDesign(db,by,{kind:'background',name:input.name,bytes:input.bytes},now);
 await db.transaction(async tx=>{
  const rows=await tx.update(visitOrders).set({status:'done',designId:design.id,handledBy:by,handledAt:now}).where(and(eq(visitOrders.id,id),eq(visitOrders.status,'pending'))).returning();
  if(!rows.length)throw new VisitError('この注文はもう対応ずみです。');
  await audit(tx,{actorId:by,targetId:order.memberId,action:'visit.order_done',detail:{id,designId:design.id},via:'web'});
 });
 await grantDesign(db,design.id,order.memberId,by,now);
 return design;
}

/** 断る（全額返す） */
export async function refuseOrder(db:Db,id:number,by:string,note:string,now=new Date()){
 return db.transaction(async tx=>{
  const rows=await tx.update(visitOrders).set({status:'refused',note:note.trim().slice(0,300),handledBy:by,handledAt:now}).where(and(eq(visitOrders.id,id),eq(visitOrders.status,'pending'))).returning();
  const row=rows[0];if(!row)throw new VisitError('受付中の注文が見つかりません。');
  await addCoins(tx,row.memberId,row.price,'shop_refund',{kind:'visit_order',orderId:id});
  await audit(tx,{actorId:by,targetId:row.memberId,action:'visit.order_refuse',detail:{id,refund:row.price},via:'web'});
  return row;
 });
}

import {createHash} from 'node:crypto';
import {and,desc,eq} from 'drizzle-orm';
import type {Db} from '../../db/client.js';
import {casinoArcadeRequests,casinoGames,wallets,type CasinoGameRow} from '../../db/schema.js';
import type {GuildConfig} from '../../config.js';
import {isArcadeKind,type ArcadeKind} from '../../domain/casinoArcade.js';
import {walletOf,spendWithin,addCoins} from '../economy.js';
import {isRestrictedAccount} from '../staffAlts.js';
import {audit} from '../audit.js';
import {checkBet,BET_ERROR} from './casino.js';
import {casinoCfgFor} from './boost.js';
import {cryptoRng,type Rng} from './cards.js';
import {newArcade,actArcade,arcadePublic,arcadePayout,ARCADE_MAX_MULT,ARCADE_PAYOUT_LIMIT,ArcadeRuleError,type ArcadeState,type ArcadeOptions} from './arcadeRules.js';
export class ArcadeError extends Error{constructor(message:string,public status:400|403|404|409|429=400){super(message);}}
export type ArcadeCommand={operationId:string;kind:ArcadeKind;action:'start'|'pick'|'collect'|'roll'|'step'|'draw'|'settle'|'giveup';bet?:number;id?:number;version?:number;choice?:number;picks?:number[]};
export function arcadeState(row:CasinoGameRow):ArcadeState{
 const s=row.state as ArcadeState;if(row.game!=='arcade'||s?.v!==1||!isArcadeKind(s.kind)||!s.hidden)throw new ArcadeError('この回の保存形式を確認できません。',409);return s;
}
export const arcadeMaxBet=(maxBet:number,kind:ArcadeKind)=>Math.min(maxBet,Math.floor(ARCADE_PAYOUT_LIMIT/ARCADE_MAX_MULT[kind]));
export function arcadeRound(row:CasinoGameRow,now:Date){return {id:row.id,version:row.version,bet:row.bet,payout:row.payout,status:row.status,model:arcadePublic(arcadeState(row),now.getTime())};}
export type ArcadeRound=ReturnType<typeof arcadeRound>;
export async function arcadeRows(db:Db,id:string,limit=20){return db.select().from(casinoGames).where(and(eq(casinoGames.memberId,id),eq(casinoGames.game,'arcade'))).orderBy(desc(casinoGames.id)).limit(limit);}
export async function arcadeById(db:Db,id:string,gameId:number){const [r]=await db.select().from(casinoGames).where(and(eq(casinoGames.memberId,id),eq(casinoGames.game,'arcade'),eq(casinoGames.id,gameId))).limit(1);return r;}
/** wallet→操作ID→保存状態の順で排他。金額・抽選・払戻はクライアントから受け取らない。 */
export async function commandArcade(db:Db,cfg:GuildConfig,memberId:string,command:ArcadeCommand,now=new Date(),rng:Rng=cryptoRng):Promise<CasinoGameRow>{
 if(!/^[a-zA-Z0-9_-]{16,80}$/.test(command.operationId)||!isArcadeKind(command.kind))throw new ArcadeError('操作IDと台を確認してください。');
 if(command.picks&&command.picks.length>10)throw new ArcadeError('選択は10個までです。');
 const normalized={kind:command.kind,action:command.action,bet:command.bet,id:command.id,version:command.version,choice:command.choice,picks:command.picks?[...command.picks].sort((a,b)=>a-b):undefined};
 const fingerprint=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 await walletOf(db,memberId);
 try{return await db.transaction(async tx=>{
  await tx.select({id:wallets.memberId}).from(wallets).where(eq(wallets.memberId,memberId)).for('update');
  const [prior]=await tx.select().from(casinoArcadeRequests).where(and(eq(casinoArcadeRequests.memberId,memberId),eq(casinoArcadeRequests.operationId,command.operationId)));
  if(prior){if(prior.fingerprint!==fingerprint)throw new ArcadeError('同じ操作IDの内容が変わっています。最新の画面から操作してください。',409);const existing=await arcadeById(tx,memberId,prior.gameId);if(!existing)throw new ArcadeError('保存した結果が見つかりません。',404);return existing;}
  if(await isRestrictedAccount(tx,memberId))throw new ArcadeError('このアカウントでは銭を使う操作ができません。',403);
  let row:CasinoGameRow,action='casino.arcade.act';
  if(command.action==='start'){
   const [busy]=await tx.select().from(casinoGames).where(and(eq(casinoGames.memberId,memberId),eq(casinoGames.game,'arcade'),eq(casinoGames.status,'playing'))).limit(1);
   if(busy)throw new ArcadeError('先に、進行中の台で受取または終了をしてください。',409);
   const c=await casinoCfgFor(tx,cfg,memberId,now),bet=command.bet??NaN;
   if(!c.casino.arcadeGames.includes(command.kind))throw new ArcadeError('この台はお休み中です。',403);
   if(!Number.isSafeInteger(bet))throw new ArcadeError('賭ける銭は整数で入力してください。');
   const check=await checkBet(tx,cfg,memberId,'arcade',bet,now,{maxBet:arcadeMaxBet(c.casino.maxBet,command.kind)});if(check!=='ok')throw new ArcadeError(BET_ERROR[check]);
   const [last]=await tx.select({at:casinoGames.createdAt}).from(casinoGames).where(and(eq(casinoGames.memberId,memberId),eq(casinoGames.game,'arcade'))).orderBy(desc(casinoGames.id)).limit(1);
   if(last&&now.getTime()-last.at.getTime()<1000)throw new ArcadeError('続けて賭けるときは、1秒あけてください。',429);
   const options:ArcadeOptions={choice:command.choice,picks:normalized.picks},state=newArcade(command.kind,options,rng,now.getTime()),payout=arcadePayout(bet,state);
   if(payout>ARCADE_PAYOUT_LIMIT)throw new ArcadeError('この賭け額では払戻の上限を超えます。');
   if(!await spendWithin(tx,memberId,bet,'casino_bet',{game:'arcade',kind:command.kind,operationId:command.operationId}))throw new ArcadeError('銭が足りないか、このアカウントでは使えません。',403);
   [row]=await tx.insert(casinoGames).values({memberId,game:'arcade',bet,state,status:state.done?'done':'playing',payout,createdAt:now,finishedAt:state.done?now:null}).returning() as [CasinoGameRow];
   action='casino.arcade.start';
  }else{
   if(!Number.isSafeInteger(command.id)||!Number.isInteger(command.version)||command.version!<0)throw new ArcadeError('回と画面の番号を確認してください。');
   const current=await arcadeById(tx,memberId,command.id!);if(!current)throw new ArcadeError('この回が見つかりません。',404);
   const old=arcadeState(current);if(old.kind!==command.kind||current.status!=='playing'||current.version!==command.version)throw new ArcadeError('画面が更新されています。最新の状態を確認してください。',409);
   const state=actArcade(old,command.action,command.choice,normalized.picks,now.getTime(),rng),payout=arcadePayout(current.bet,state);
   if(payout>ARCADE_PAYOUT_LIMIT)throw new ArcadeError('払戻上限を超えるため確認が必要です。',409);
   [row]=await tx.update(casinoGames).set({state,version:current.version+1,payout,status:state.done?'done':'playing',finishedAt:state.done?now:null}).where(and(eq(casinoGames.id,current.id),eq(casinoGames.version,current.version),eq(casinoGames.status,'playing'))).returning() as [CasinoGameRow];
   if(!row)throw new ArcadeError('別の操作が先に完了しました。',409);
  }
  if(row.status==='done'&&row.payout>0)await addCoins(tx,memberId,row.payout,'casino_win',{game:'arcade',kind:command.kind,id:row.id,operationId:command.operationId});
  await tx.insert(casinoArcadeRequests).values({memberId,operationId:command.operationId,fingerprint,gameId:row.id,createdAt:now});
  await audit(tx,{actorId:memberId,action,via:'web',detail:{id:row.id,kind:command.kind,version:row.version,bet:row.bet,payout:row.payout,operationId:command.operationId}});
  if(row.status==='done')await audit(tx,{actorId:memberId,action:'casino.arcade.finish',via:'web',detail:{id:row.id,kind:command.kind,payout:row.payout,operationId:command.operationId}});
  return row;
 });}catch(e){if(e instanceof ArcadeRuleError)throw new ArcadeError(e.message);throw e;}
}

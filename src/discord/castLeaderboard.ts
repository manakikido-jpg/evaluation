import { createHash } from 'node:crypto';
import { logger } from '../lib/logger.js';
import { escapeMarkdown } from 'discord.js';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { castLeaderboard, type CastLeaderboardRow } from '../services/castLeaderboard.js';
import { namesOf } from '../services/members.js';
import { audit } from '../services/audit.js';
import { DiscordHttpError, type DiscordActions, type MessageBody } from '../lib/discordRest.js';
const KEY='cast.live-ranking';
export function castLeaderboardBody(month:string,rows:CastLeaderboardRow[],names:ReadonlyMap<string,string>,coin:string):MessageBody {
 const clean=(value:string)=>escapeMarkdown(value.replace(/[\r\n]/g,' ').replaceAll('@','＠').replaceAll('<','＜').replaceAll('>','＞').slice(0,40));
 const list=(metric:'count'|'revenue')=>{
  const sorted=rows.filter(r=>r[metric]>0).sort((a,b)=>b[metric]-a[metric]||a.castId.localeCompare(b.castId)).slice(0,10);
  let rank=0;
  return sorted.map((r,i)=>{if(i===0||r[metric]!==sorted[i-1]![metric])rank=i+1;return `${['🥇','🥈','🥉'][rank-1]??`${rank}位`} **${clean(names.get(r.castId)??r.castId)}**　${r[metric].toLocaleString('ja-JP')}${metric==='count'?'本':` ${clean(coin).slice(0,12)}`}`;}).join('\n')||'今月の実績はまだありません。';
 };
 return {content:'',embeds:[{title:`🌸 ${month} キャストランキング`,description:'日本時間の今月・上位10人。同じ数字は同順位です。\n本数：完了した通話（納品・予約中・キャンセルを除く）。\n売上：完了通話・納品＋支払済みシャンパン。返金を除く手数料前の金額です。',color:0xe58eac,fields:[{name:'🏆 指名本数ランキング',value:list('count'),inline:false},{name:'💰 売上ランキング（シャンパン込み）',value:list('revenue'),inline:false}],footer:{text:'毎分確認・変更があると更新 ／ 月が変わると自動切替'}}],components:[{type:1,components:[{type:2,style:2,custom_id:'cast:live-rank-update',label:'最新に更新（運営）',emoji:{name:'🔄'}}]}],allowed_mentions:{parse:[]}};
}
/** 保存先は専用key。ほかのキャスト設定を上書きしない。同時更新も同じ投稿だけを扱う。 */
export async function refreshCastLeaderboard(db:Db,discord:Pick<DiscordActions,'sendMessage'|'editMessage'|'deleteMessage'>,coin:string,opts:{channelId?:string;by?:string;via?:'web'|'discord';force?:boolean;now?:Date}={}) {
 return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY}))`);
  const [stored]=await tx.select().from(settings).where(eq(settings.key,KEY));
  const old=(stored?.value??{}) as {channelId?:string;messageId?:string;hash?:string;checkedAt?:string};
  const channel=opts.channelId??old.channelId;if(!channel)return false;
  if(!/^\d{17,20}$/.test(channel))throw Error('ランキングの投稿先が正しくありません');
  const now=opts.now??new Date(),data=await castLeaderboard(tx as Db,now),names=await namesOf(tx as Db,data.rows.map(r=>r.castId));
  const body=castLeaderboardBody(data.month,data.rows,names,coin),hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  if(!opts.channelId&&!opts.force&&old.hash===hash&&old.checkedAt&&now.getTime()-Date.parse(old.checkedAt)<300000)return true;
  let messageId=channel===old.channelId?old.messageId:undefined;
  if(messageId){try{await discord.editMessage(channel,messageId,body);}catch(err){if(!(err instanceof DiscordHttpError)||err.status!==404)throw err;messageId=undefined;}}
  if(!messageId)messageId=(await discord.sendMessage(channel,{...body,nonce:createHash('sha256').update(channel+hash+(old.messageId??'')).digest('hex').slice(0,24),enforce_nonce:true})).id;
  const value={channelId:channel,messageId,hash,checkedAt:now.toISOString()};
  await tx.insert(settings).values({key:KEY,value,updatedBy:opts.by??'system'}).onConflictDoUpdate({target:settings.key,set:{value,updatedBy:opts.by??'system',updatedAt:now}});
  if(opts.channelId)await audit(tx as Db,{actorId:opts.by??'system',action:'cast.ranking_panel',detail:{channelId:channel,messageId},via:opts.via??'discord'});
  // 新しい場所に置けた後で、古い場所の投稿だけ片付ける。
  if(opts.channelId&&old.channelId&&old.messageId&&old.channelId!==channel)await discord.deleteMessage(old.channelId,old.messageId).catch((err:unknown)=>logger.warn({err},'old cast leaderboard delete failed'));
  return true;
 });
}

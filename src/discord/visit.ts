import { MessageFlags, type Guild, type Interaction, type Message } from 'discord.js';
import { eq } from 'drizzle-orm';
import { settings } from '../db/schema.js';
import { restickPanel, type OmikujiPanelPlace } from '../services/omikujiPanel.js';
import { audit } from '../services/audit.js';
import type { Db } from '../db/client.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import { visitData, VisitError } from '../services/visitProfile.js';
import { renderVisitCard } from '../services/visitCard.js';
import { loadReceptionAvatar } from '../services/castReceptionImage.js';
import { createLoginLink } from '../services/casino/loginLinks.js';
import { logger } from '../lib/logger.js';

const PANEL_KEY='visit_panel';
const sf=(x:unknown)=>typeof x==='string'&&/^\d{17,20}$/.test(x)?x:undefined;
/** 🪪 「参拝プロフィールを出す」ボタン（/パネル 参拝プロフィール。御神籤と同じく、いちばん下に出し続ける） */
export const visitPanelBody=()=>({components:[{type:1,components:[{type:2,style:1,label:'参拝プロフィールを出す',emoji:{name:'🪪'},custom_id:'visit:show'}]}]});

export class VisitApp{
 private guild?:Guild;
 private place:OmikujiPanelPlace={};
 private timer?:NodeJS.Timeout;
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private db:Db,private cfg:()=>GuildConfig,private baseUrl:string|undefined,private restickMs=3_000){}
 private async savePlace(p:OmikujiPanelPlace,by:string){
  this.place=p;
  const value={channelId:p.channelId??null,messageId:p.messageId??null};
  await this.db.insert(settings).values({key:PANEL_KEY,value,updatedBy:by}).onConflictDoUpdate({target:settings.key,set:{value,updatedBy:by,updatedAt:new Date()}});
 }
 async attach(guild:Guild):Promise<void>{
  this.guild=guild;
  const [row]=await this.db.select().from(settings).where(eq(settings.key,PANEL_KEY));
  const v=(row?.value??{}) as Record<string,unknown>;
  this.place={channelId:sf(v.channelId),messageId:sf(v.messageId)};
  this.checkPanel();
 }
 checkPanel():void{this.queue=this.queue.then(()=>this.restick()).catch((err:unknown)=>logger.warn({err},'visit panel restick failed'));}
 onMessage(msg:Message):void{
  if(!this.place.channelId||msg.channelId!==this.place.channelId||msg.id===this.place.messageId)return;
  clearTimeout(this.timer);
  this.timer=setTimeout(()=>this.checkPanel(),this.restickMs);
 }
 /** ボタンが消されたら（BOT が出し直したときはのぞく）、置くのをやめる */
 async onMessageDelete(msg:{id:string;guildId:string|null}):Promise<void>{
  if(msg.guildId!==this.cfg().guildId||!this.place.messageId||msg.id!==this.place.messageId)return;
  await this.savePlace({},'system');
 }
 private async restick():Promise<void>{
  const ch=this.place.channelId?this.guild?.channels.cache.get(this.place.channelId):undefined;
  if(!ch?.isTextBased()||!ch.isSendable())return;
  await restickPanel(this.place,{
   lastMessageId:async()=>(await ch.messages.fetch({limit:1})).first()?.id,
   send:async()=>(await ch.send({...visitPanelBody(),allowedMentions:{parse:[]}} as never)).id,
   remove:async(id)=>void(await ch.messages.delete(id)),
  },(p)=>this.savePlace(p,'system'));
 }
 async onInteraction(i:Interaction):Promise<void>{
  if(!i.inCachedGuild()||i.guildId!==this.cfg().guildId)return;
  // /パネル 参拝プロフィール
  if(i.isChatInputCommand()&&i.commandName==='panel'&&i.options.getSubcommand(false)==='visitprofile'){
   if(!i.channel?.isSendable()){await i.reply({content:'このチャンネルには置けません。',flags:MessageFlags.Ephemeral});return;}
   const old=this.place;
   const sent=await i.channel.send({...visitPanelBody(),allowedMentions:{parse:[]}} as never);
   await this.savePlace({channelId:i.channelId,messageId:sent.id},i.user.id);
   // 前に置いたボタンは消す（置き場所は 1 つ）
   const oldCh=old.channelId?i.guild.channels.cache.get(old.channelId):undefined;
   if(old.messageId&&oldCh?.isTextBased())await oldCh.messages.delete(old.messageId).catch(()=>undefined);
   await audit(this.db,{actorId:i.user.id,action:'visit.panel',detail:{channelId:i.channelId},via:'discord'});
   await i.reply({content:'🪪 参拝プロフィールのボタンを置きました（このチャンネルのいちばん下に出し続けます）。',flags:MessageFlags.Ephemeral});
   return;
  }
  const show=i.isButton()&&i.customId==='visit:show';
  const command=(i.isChatInputCommand()&&i.commandName==='visitprofile')||show;
  const bingo=i.isChatInputCommand()&&i.commandName==='bingo';
  const open=i.isButton()&&i.customId==='visit:open';
  if(!command&&!open&&!bingo)return;
  try{
   if((open&&i.isButton())||bingo){
    await i.deferReply({flags:MessageFlags.Ephemeral});
    if(!this.baseUrl){await i.editReply({content:'プロフィールのWeb入口はまだ準備中です。'});return;}
    const token=await createLoginLink(this.db,{id:i.user.id,displayName:i.member.displayName,avatarUrl:i.user.displayAvatarURL({size:128})});
    await i.editReply({content:bingo?'イベントビンゴの本人用入口です。無料参加・1人1枚。リンクは10分・1回限りです。':'背景・フレームのお店と着せ替えです。このリンクはあなた専用で10分・1回限りです。',components:[{type:1,components:[{type:2,style:5,label:bingo?'イベントビンゴを開く':'参拝プロフィールを開く',url:this.baseUrl+'/visit/link/'+token+(bingo?'?next=bingo':'')}]}],allowedMentions:{parse:[]}});
   }else if(command&&(i.isChatInputCommand()||i.isButton())){
    // 出せるのは自分のプロフィールだけ
    const target=i.user;
    // コマンドは省略すると自分だけ（まちがえて雑談に出しても消せないため。公開: はい でチャンネルへ）。パネルのボタンは今までどおり
    const isPublic=i.isChatInputCommand()?(i.options.getBoolean('public')??false):true;
    await i.deferReply(isPublic?{}:{flags:MessageFlags.Ephemeral});
    const member=await i.guild.members.fetch({user:target.id,force:true}).catch(()=>undefined);
    if(!member||member.user.bot){await i.editReply({content:'在籍中のメンバーを選んでください。',allowedMentions:{parse:[]}});return;}
    const data=await visitData(this.db,target.id);
    data.staffTheme=!!adminLevelOf(this.cfg(),[...(member.roles?.cache.keys()??[])]);
    const privateView=target.id===i.user.id&&!isPublic;
    const png=renderVisitCard(data,{privateView,avatar:await loadReceptionAvatar(member.displayAvatarURL({size:128}))});
    await i.editReply({content:privateView?'自分用の参拝プロフィールです。/参拝プロフィール で「公開: はい」を選ぶと、チャンネルに表示できます。活動記録の公開設定はWebで変更できます。':data.profile.publicStats?'参拝プロフィールです。':'活動記録は本人の設定で非公開です。',files:[{attachment:png,name:'sakura-profile.png'}],components:[{type:1,components:[{type:2,style:2,label:'背景・フレームと着せ替え',custom_id:'visit:open'}]}],allowedMentions:{parse:[]}});
   }
  }catch(e){
   logger.warn({err:e},'visit interaction failed');
   if(i.isRepliable()){
    const content=e instanceof VisitError?e.message:'プロフィールを確認できません。少し待ってからやり直してください。';
    if(i.deferred||i.replied)await i.editReply({content,components:[]}).catch(()=>undefined);
    else await i.reply({content,flags:MessageFlags.Ephemeral}).catch(()=>undefined);
   }
  }
 }
}

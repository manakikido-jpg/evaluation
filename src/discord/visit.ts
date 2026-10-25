import { MessageFlags, type Interaction } from 'discord.js';
import type { Db } from '../db/client.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import { visitData, VisitError } from '../services/visitProfile.js';
import { renderVisitCard } from '../services/visitCard.js';
import { loadReceptionAvatar } from '../services/castReceptionImage.js';
import { createLoginLink } from '../services/casino/loginLinks.js';
import { logger } from '../lib/logger.js';

export class VisitApp{
 constructor(private db:Db,private cfg:()=>GuildConfig,private baseUrl:string|undefined){}
 async onInteraction(i:Interaction):Promise<void>{
  if(!i.inCachedGuild()||i.guildId!==this.cfg().guildId)return;
  const command=i.isChatInputCommand()&&i.commandName==='visitprofile';
  const open=i.isButton()&&i.customId==='visit:open';
  if(!command&&!open)return;
  try{
   if(open&&i.isButton()){
    await i.deferReply({flags:MessageFlags.Ephemeral});
    if(!this.baseUrl){await i.editReply({content:'プロフィールのWeb入口はまだ準備中です。'});return;}
    const token=await createLoginLink(this.db,{id:i.user.id,displayName:i.member.displayName,avatarUrl:i.user.displayAvatarURL({size:128})});
    await i.editReply({content:'背景・フレームのお店と着せ替えです。このリンクはあなた専用で10分・1回限りです。',components:[{type:1,components:[{type:2,style:5,label:'参拝プロフィールを開く',url:this.baseUrl+'/visit/link/'+token}]}],allowedMentions:{parse:[]}});
   }else if(command&&i.isChatInputCommand()){
    const target=i.options.getUser('user')??i.user;
    const isPublic=i.options.getBoolean('public')??true;
    await i.deferReply(isPublic?{}:{flags:MessageFlags.Ephemeral});
    const member=await i.guild.members.fetch({user:target.id,force:true}).catch(()=>undefined);
    if(!member||member.user.bot){await i.editReply({content:'在籍中のメンバーを選んでください。',allowedMentions:{parse:[]}});return;}
    const data=await visitData(this.db,target.id);
    data.staffTheme=!!adminLevelOf(this.cfg(),[...(member.roles?.cache.keys()??[])]);
    const privateView=target.id===i.user.id&&!isPublic;
    const png=renderVisitCard(data,{privateView,avatar:await loadReceptionAvatar(member.displayAvatarURL({size:128}))});
    await i.editReply({content:privateView?'自分用の参拝プロフィールです。/参拝プロフィール だけでチャンネルに表示できます。活動記録の公開設定はWebで変更できます。':data.profile.publicStats?'参拝プロフィールです。':'活動記録は本人の設定で非公開です。',files:[{attachment:png,name:'sakura-profile.png'}],components:[{type:1,components:[{type:2,style:2,label:'背景・フレームと着せ替え',custom_id:'visit:open'}]}],allowedMentions:{parse:[]}});
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

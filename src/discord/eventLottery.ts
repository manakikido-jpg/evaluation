import {createHash} from 'node:crypto';
import {DiscordHttpError} from '../lib/discordRest.js';
import {MessageFlags,type Interaction} from 'discord.js';
import type {Db} from '../db/client.js';
import type {GuildConfig} from '../config.js';
import type {DiscordActions,MessageBody} from '../lib/discordRest.js';
import {enterEventLottery,sendEventLotteryNotices,EventLotteryError} from '../services/eventLottery.js';
import {logger} from '../lib/logger.js';
export class EventLotteryApp{
 private sending=false;
 constructor(private db:Db,private cfg:()=>GuildConfig,private discord:Pick<DiscordActions,'sendMessage'>&Partial<Pick<DiscordActions,'editMessage'>>){}
 async onInteraction(i:Interaction){if(!i.isButton()||!i.customId.startsWith('eventlottery:')||!i.inCachedGuild()||i.guildId!==this.cfg().guildId)return;
  await i.deferReply({flags:MessageFlags.Ephemeral});try{await i.editReply({content:await enterEventLottery(this.db,i.customId.slice(13),i.user.id,i.member.displayName),allowedMentions:{parse:[]}});}catch(e){if(!(e instanceof EventLotteryError))logger.warn({err:e},'event lottery entry failed');await i.editReply({content:e instanceof EventLotteryError?e.message:'受付に失敗しました。もう一度確認してください。',allowedMentions:{parse:[]}});}
 }
 /** 消したメッセージだけを出し直す。403や通信失敗では新規投稿しない。 */
 private async editOrRestore(channel:string,message:string,body:Record<string,unknown>):Promise<void|{id:string}>{
  try{await this.discord.editMessage!(channel,message,body as MessageBody);}
  catch(error){if(!(error instanceof DiscordHttpError)||error.status!==404)throw error;
   const nonce=BigInt('0x'+createHash('sha256').update(`event-lottery-panel-restore:${channel}:${message}`).digest('hex').slice(0,16)).toString();
   return this.discord.sendMessage(channel,{...body,nonce,enforce_nonce:true} as MessageBody);
  }
 }
 async notify(){if(this.sending)return;this.sending=true;try{await sendEventLotteryNotices(this.db,(channel,body)=>this.discord.sendMessage(channel,body as MessageBody),new Date(),this.discord.editMessage?(channel,message,body)=>this.editOrRestore(channel,message,body):undefined);}finally{this.sending=false;}}
}

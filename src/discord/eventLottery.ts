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
 async notify(){if(this.sending)return;this.sending=true;try{await sendEventLotteryNotices(this.db,(channel,body)=>this.discord.sendMessage(channel,body as MessageBody),new Date(),this.discord.editMessage?(channel,message,body)=>this.discord.editMessage!(channel,message,body as MessageBody):undefined);}finally{this.sending=false;}}
}

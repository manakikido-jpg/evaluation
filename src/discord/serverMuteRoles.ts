import type { Guild, GuildMember, Role, VoiceState } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { KeyedLock } from '../lib/lock.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { muteState, mutedMemberIds, saveMuteState } from '../services/serverMuteState.js';

/** ロールは目印だけ。権限で音声を止めるものではない。 */
export function muteRoleOf(roles: Iterable<Role>): Role | undefined {
  const matches=[...roles].filter(r=>r.name.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'')==='ミュート中');
  if (matches.length>1 || matches[0]?.managed) throw new Error('ミュート中ロールが重複しているかBOT管理のロールです');
  return matches[0];
}

/** ネイティブのサーバーミュートも監視する。自己マイクミュートは対象外。 */
export class ServerMuteRolesApp {
  private readonly lock=new KeyedLock();
  private readonly versions=new Map<string,number>();
  private reconciling=false;
  constructor(private readonly db:Db,private readonly cfg:()=>GuildConfig) {}

  private async role(guild:Guild):Promise<Role> {
    return this.lock.run('role:'+guild.id,async()=>{
      let role=muteRoleOf(guild.roles.cache.values());
      if (role) return role;
      const roles=await guild.roles.fetch();
      role=muteRoleOf(roles.values());
      if (role) return role;
      role=await guild.roles.create({name:'ミュート中',permissions:0n,mentionable:false,hoist:false,reason:'サーバーミュートの目印'});
      await this.log('role.mute_marker_created',guild.client.user.id,role.id,true);
      return role;
    });
  }

  async attach(guild:Guild):Promise<void> { await this.reconcile(guild); }

  async onVoiceStateUpdate(before:VoiceState,after:VoiceState):Promise<void> {
    if (after.guild.id!==this.cfg().guildId || after.member?.user.bot) return;
    if (before.channelId===after.channelId && before.serverMute===after.serverMute) return;
    const version=(this.versions.get(after.id)??0)+1;
    this.versions.set(after.id,version);
    await this.lock.run('member:'+after.id,()=>this.process(after.guild,after.id,version,{before,after}))
      .catch(err=>logger.warn({err,memberId:after.id},'server mute role sync failed'));
  }

  /** 起動時と1分ごと。記録と接続セッションで、再起動と再入室を区別する。 */
  async reconcile(guild:Guild):Promise<void> {
    if (guild.id!==this.cfg().guildId || this.reconciling) return;
    this.reconciling=true;
    try {
      const role=await this.role(guild);
      const ids=new Set(await mutedMemberIds(this.db));
      for(const voice of guild.voiceStates.cache.values()) {
        if(voice.channelId && (voice.serverMute || voice.member?.roles.cache.has(role.id))) ids.add(voice.id);
      }
      for(const id of ids) {
        const version=this.versions.get(id)??0;
        await this.lock.run('member:'+id,()=>this.process(guild,id,version))
          .catch(err=>logger.warn({err,memberId:id},'server mute role recovery failed'));
      }
    } finally { this.reconciling=false; }
  }

  private async process(guild:Guild,id:string,version:number,event?:{before:VoiceState;after:VoiceState}):Promise<void> {
    const current=()=> (this.versions.get(id)??0)===version;
    if(!current()) return;
    const state=await muteState(this.db,id);
    if(!current()) return;
    const voice=guild.voiceStates.cache.get(id)??event?.after;
    let member=voice?.member;
    if(!member) {
      try { member=await guild.members.fetch(id); }
      catch(err) {
        if(err && typeof err==='object' && 'code' in err && err.code===10007) {
          if(current()) await saveMuteState(this.db,id);
          return;
        }
        throw err;
      }
    }
    if(member.user.bot || !current()) return;
    // 切断ではサーバーミュートを解除できない。マークと記録を次の入室まで残す。
    if(!voice?.channelId) {
      if(state || event?.before.serverMute || event?.after.serverMute) {
        await this.remember(id,state?.sessionId??event?.before.sessionId??null,true);
        if(!current()) return;
        if(event?.before.serverMute || event?.after.serverMute) {
          const role=await this.role(guild);
          if(current()) await this.addRole(member,role);
        }
      }
      return;
    }
    if(voice.serverMute && !state) {
      await this.remember(id,voice.sessionId,false);
      if(!current()) return;
    }
    const role=await this.role(guild);
    if(!current()) return;
    const marked=member.roles.cache.has(role.id);
    // 退出後の新しいミュート操作は、そのミュートを優先する。
    const newlyMuted=!!event && !!event.before.channelId && event.before.channelId===event.after.channelId && !event.before.serverMute && event.after.serverMute===true;
    const joined=!!event && !event.before.channelId && !!event.after.channelId;
    const newSession=!!state?.sessionId && !!voice.sessionId && state.sessionId!==voice.sessionId;
    const reconnected=!newlyMuted && (joined || state?.waiting || (!event && newSession));
    if(voice.channelId===guild.afkChannelId) {
      // 奥の院では寝落ち用ミュートを保つ。実際のミュートはAfkMuteAppが行う。
      if(voice.serverMute) {
        await this.remember(id,voice.sessionId,false);
        if(current()) await this.addRole(member,role);
      } else if(event && event.before.channelId===event.after.channelId && event.before.serverMute===true && event.after.serverMute===false && (marked || state)) {
        await this.clear(member,role,id,current);
      }
      return;
    }
    if(reconnected && (marked || state)) {
      await this.remember(id,voice.sessionId,true);
      if(!current()) return;
      if(voice.serverMute) await voice.setMute(false,'ミュート中に退出したため、VCへの再入室で解除');
      if(current()) await this.clear(member,role,id,current);
      return;
    }
    if(voice.serverMute) {
      await this.remember(id,voice.sessionId,false);
      if(current()) await this.addRole(member,role);
    } else if(marked || state) await this.clear(member,role,id,current);
  }

  private async remember(id:string,sessionId:string|null,waiting:boolean):Promise<void> {
    const old=await muteState(this.db,id);
    if(old?.sessionId===sessionId && old.waiting===waiting) return;
    await saveMuteState(this.db,id,{sessionId,waiting});
  }
  private async addRole(member:GuildMember,role:Role):Promise<void> {
    if(member.roles.cache.has(role.id)) return;
    await member.roles.add(role.id,'サーバーミュート中の目印');
    await this.log('member.mute_role',member.id,role.id,true);
  }
  private async clear(member:GuildMember,role:Role,id:string,current:()=>boolean):Promise<void> {
    if(!current()) return;
    if(member.roles.cache.has(role.id)) {
      await member.roles.remove(role.id,'サーバーミュート解除');
      await this.log('member.mute_role',id,role.id,false);
    }
    if(current()) await saveMuteState(this.db,id);
  }
  private async log(action:string,id:string,roleId:string,on:boolean):Promise<void> {
    await audit(this.db,{actorId:'system',targetId:id,action,detail:{roleId,on},via:'discord'})
      .catch(err=>logger.warn({err},'mute role audit failed'));
  }
}

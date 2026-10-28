import type {Context} from 'hono';
import {getCookie} from 'hono/cookie';
import type {Db} from '../db/client.js';
import {webAccessOf,type GuildConfig} from '../config.js';
import {accountAccess,getAccount} from '../services/webAccounts.js';
import {isStaffAlt} from '../services/staffAlts.js';
import {loadOrg,orgPagesOf} from '../services/orgChart.js';
import {audit} from '../services/audit.js';
import {findSession,markChecked,deleteSession,RECHECK_MS} from './sessions.js';
import type {DiscordApi} from './discordApi.js';
export const CASINO_PRESENTATION_COOKIE='sakura_casino_presentation';
/** 見た目だけの確認モード。会員認証・ゲームの操作権限は別で維持する。 */
export async function casinoPresentation(db:Db,c:Context,userId:string,now:Date,cfg:GuildConfig,api:DiscordApi):Promise<'immersive'|undefined>{
 if(getCookie(c,CASINO_PRESENTATION_COOKIE)!=='1')return;
 const token=getCookie(c,'shamusho_session');if(!token)return;
 const staff=await findSession(db,token,now);if(!staff||staff.userId!==userId)return;
 if(now.getTime()-staff.checkedAt.getTime()>RECHECK_MS){
  try{
   const account=staff.accountId!==null?await getAccount(db,staff.accountId):undefined;
   const roles=staff.accountId===null?await api.memberRoles(cfg.guildId,userId):null;
   const access=staff.accountId!==null?(account?accountAccess(account):undefined):roles&&!(await isStaffAlt(db,userId))?webAccessOf(cfg,userId,roles,orgPagesOf(await loadOrg(db),userId)):undefined;
   if(!access){await deleteSession(db,staff.id);await audit(db,{actorId:userId,action:'auth.revoked',via:'system'});return;}
   await markChecked(db,staff.id,access,now);staff.level=access.level;staff.pages=access.pages;
  }catch{return;}// 再確認できなくてもゲームは止めず、通常表示へ戻す。
 }
 if(!['guji','shinshoku'].includes(staff.level)||staff.pages&&!staff.pages.includes('economy'))return;
 return 'immersive';
}

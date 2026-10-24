import { Collection } from 'discord.js';
import type { Guild, GuildMember, Role, VoiceState } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { ServerMuteRolesApp, muteRoleOf } from '../src/discord/serverMuteRoles.js';
import { AfkMuteApp } from '../src/discord/afkMute.js';
import { muteState, saveMuteState } from '../src/services/serverMuteState.js';
import { cfg, makeDb } from './helpers.js';
const USER='600000000000000071', ROLE='600000000000000072', VC='600000000000000073', OTHER='600000000000000074', AFK='600000000000000075';
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());});afterEach(async()=>{await close();});
function fake(withRole=true) {
 const role={id:ROLE,name:'🔇 ミュート中',managed:false};
 const roles=new Collection<string,Role>();if(withRole)roles.set(ROLE,role as Role);
 const own=new Collection<string,Role>();const voices=new Collection<string,VoiceState>();
 const member={id:USER,user:{bot:false},roles:{cache:own,add:vi.fn(async()=>{own.set(ROLE,role as Role);}),remove:vi.fn(async()=>{own.delete(ROLE);})}};
 const guild={id:cfg.guildId,afkChannelId:AFK,client:{user:{id:'bot'}},voiceStates:{cache:voices},
  members:{fetch:vi.fn(async()=>member)},roles:{cache:roles,fetch:vi.fn(async()=>roles),create:vi.fn(async()=>{roles.set(ROLE,role as Role);return role;})}};
 const state=(channelId:string|null,serverMute=false,sessionId='first')=>{
  const v={id:USER,guild,member,channelId,serverMute,sessionId,setMute:vi.fn(async(value:boolean)=>{v.serverMute=value;})};
  return v;
 };
 const app=new ServerMuteRolesApp(db,()=>cfg);
 const update=async(before:ReturnType<typeof state>,after:ReturnType<typeof state>)=>{
  voices.set(USER,after as unknown as VoiceState);
  await app.onVoiceStateUpdate(before as unknown as VoiceState,after as unknown as VoiceState);
 };
 return{app,member,own,voices,guild,state,update};
}

describe('サーバーミュート中のロールと再接続',()=>{
 it('同じVCでミュートした時にロールを付け、自己ミュートだけでは付けない',async()=>{
  const f=fake();await f.update(f.state(VC),f.state(VC));expect(f.member.roles.add).not.toHaveBeenCalled();
  await f.update(f.state(VC),f.state(VC,true));expect(f.own.has(ROLE)).toBe(true);
  expect(await muteState(db,USER)).toEqual({sessionId:'first',waiting:false});
 });
 it('ミュート中の退出でロールを残し、未接続状態のmute値がfalseでも次のVC入室で解除する',async()=>{
  const f=fake();await f.update(f.state(VC),f.state(VC,true));
  const left=f.state(null,false);await f.update(f.state(VC,true),left);
  expect(f.own.has(ROLE)).toBe(true);expect((await muteState(db,USER))?.waiting).toBe(true);expect(left.setMute).not.toHaveBeenCalled();
  const joined=f.state(OTHER,true,'second');await f.update(f.state(null,false),joined);
  expect(joined.setMute).toHaveBeenCalledWith(false,expect.any(String));expect(f.own.has(ROLE)).toBe(false);expect(await muteState(db,USER)).toBeUndefined();
 });
 it('ロールだけ付いた人の再入室も、既に解除済みならロールだけ外す',async()=>{
  const f=fake();f.own.set(ROLE,{} as Role);const joined=f.state(VC,false,'second');
  await f.update(f.state(null),joined);expect(joined.setMute).not.toHaveBeenCalled();expect(f.own.has(ROLE)).toBe(false);
 });
 it('普通のVC間の移動では手動のミュートを解除しない',async()=>{
  const f=fake();await f.update(f.state(VC),f.state(VC,true));const moved=f.state(OTHER,true,'moved');
  await f.update(f.state(VC,true),moved);expect(moved.setMute).not.toHaveBeenCalled();expect(f.own.has(ROLE)).toBe(true);
 });
 it('奥の院への再入室ではミュートとロールを続ける',async()=>{
  const f=fake();await f.update(f.state(VC),f.state(VC,true));await f.update(f.state(VC,true),f.state(null));
  const joined=f.state(AFK,true,'second');await f.update(f.state(null),joined);
  expect(joined.setMute).not.toHaveBeenCalled();expect(f.own.has(ROLE)).toBe(true);expect((await muteState(db,USER))?.waiting).toBe(false);
 });
 it('奥の院への未ミュートの再入室は既存のAFK処理でミュートし、ロールを消さない',async()=>{
  const f=fake();f.own.set(ROLE,{} as Role);await saveMuteState(db,USER,{sessionId:'first',waiting:true});
  const joined=f.state(AFK,false,'second'),before=f.state(null);
  await new AfkMuteApp(db,()=>cfg).onVoiceStateUpdate(before as unknown as VoiceState,joined as unknown as VoiceState);
  await f.update(before,joined);expect(f.own.has(ROLE)).toBe(true);
  expect(joined.setMute).toHaveBeenCalledWith(true,expect.any(String));expect(f.own.has(ROLE)).toBe(true);
 });
 it('手動でサーバーミュートを解除した時もロールを外す',async()=>{
  const f=fake();await f.update(f.state(VC),f.state(VC,true));await f.update(f.state(VC,true),f.state(VC,false));
  expect(f.own.has(ROLE)).toBe(false);expect(await muteState(db,USER)).toBeUndefined();
 });
 it('解除失敗はロールと記録を残し、定期確認で再試行する',async()=>{
  const f=fake();await f.update(f.state(VC),f.state(VC,true));await f.update(f.state(VC,true),f.state(null));
  const joined=f.state(VC,true,'second');joined.setMute.mockRejectedValueOnce(new Error('Missing Permissions'));
  await f.update(f.state(null),joined);expect(f.own.has(ROLE)).toBe(true);expect((await muteState(db,USER))?.waiting).toBe(true);
  await f.app.reconcile(f.guild as unknown as Guild);expect(f.own.has(ROLE)).toBe(false);expect(await muteState(db,USER)).toBeUndefined();
 });
 it('ミュート解除後のロール削除失敗も、再確認で直す',async()=>{
  const f=fake();await f.update(f.state(VC),f.state(VC,true));await f.update(f.state(VC,true),f.state(null));
  f.member.roles.remove.mockRejectedValueOnce(new Error('Missing Permissions'));const joined=f.state(VC,true,'second');
  await f.update(f.state(null),joined);expect(joined.serverMute).toBe(false);expect(f.own.has(ROLE)).toBe(true);
  await f.app.reconcile(f.guild as unknown as Guild);expect(f.own.has(ROLE)).toBe(false);expect(await muteState(db,USER)).toBeUndefined();
 });
 it('BOT再起動で同じ通話中のミュートを外さず、停止中の再接続はセッションで判別する',async()=>{
  const f=fake();await f.update(f.state(VC),f.state(VC,true));let restarted=new ServerMuteRolesApp(db,()=>cfg);
  const current=f.voices.get(USER)!;await restarted.attach(f.guild as unknown as Guild);expect(current.setMute).not.toHaveBeenCalled();expect(f.own.has(ROLE)).toBe(true);
  const rejoined=f.state(VC,true,'second');f.voices.set(USER,rejoined as unknown as VoiceState);restarted=new ServerMuteRolesApp(db,()=>cfg);
  await restarted.attach(f.guild as unknown as Guild);expect(rejoined.setMute).toHaveBeenCalledWith(false,expect.any(String));expect(f.own.has(ROLE)).toBe(false);
 });
 it('既存の手動ミュートは起動時にロールを補い、勝手に解除しない',async()=>{
  const f=fake();const muted=f.state(VC,true);f.voices.set(USER,muted as unknown as VoiceState);
  await f.app.attach(f.guild as unknown as Guild);expect(f.own.has(ROLE)).toBe(true);expect(muted.setMute).not.toHaveBeenCalled();
 });
 it('ロールがなければ権限なしの目印だけ作り、同名重複や管理ロールを使わない',async()=>{
  const f=fake(false);await f.update(f.state(VC),f.state(VC,true));
  expect(f.guild.roles.create).toHaveBeenCalledWith(expect.objectContaining({name:'ミュート中',permissions:0n,mentionable:false,hoist:false}));
  expect(()=>muteRoleOf([{id:'a',name:'ミュート中',managed:false},{id:'b',name:'🔇 ミュート中',managed:false}] as Role[])).toThrow();
  expect(()=>muteRoleOf([{id:'a',name:'ミュート中',managed:true}] as Role[])).toThrow();
 });
 it('ロール作成に失敗してもミュートの記録を残し、権限復旧後に目印を補える',async()=>{
  const f=fake(false);f.guild.roles.create.mockRejectedValueOnce(new Error('Missing Permissions'));
  await f.update(f.state(VC),f.state(VC,true));expect(f.own.has(ROLE)).toBe(false);
  expect(await muteState(db,USER)).toEqual({sessionId:'first',waiting:false});
  await f.app.reconcile(f.guild as unknown as Guild);expect(f.own.has(ROLE)).toBe(true);
 });
 it('サーバー自体を退会済みの人は記録を片付け、エラーを繰り返さない',async()=>{
  const f=fake();await f.update(f.state(VC),f.state(VC,true));f.voices.clear();
  f.guild.members.fetch.mockRejectedValue(Object.assign(new Error('Unknown Member'),{code:10007}));
  await f.app.reconcile(f.guild as unknown as Guild);expect(await muteState(db,USER)).toBeUndefined();
 });
 it('別サーバーやBOTを操作しない',async()=>{
  const f=fake();f.guild.id='other';await f.update(f.state(VC),f.state(VC,true));expect(f.member.roles.add).not.toHaveBeenCalled();
  f.guild.id=cfg.guildId;f.member.user.bot=true;await f.update(f.state(VC),f.state(VC,true));expect(f.member.roles.add).not.toHaveBeenCalled();
 });
});

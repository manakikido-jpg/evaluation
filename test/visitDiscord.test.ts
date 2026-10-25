import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { MessageFlags } from 'discord.js';
import { makeDb, cfg } from './helpers.js';
import type { Db } from '../src/db/client.js';
import { members, visitProfiles } from '../src/db/schema.js';
import { VisitApp } from '../src/discord/visit.js';
import { commandDefinitions } from '../src/discord/commands.js';
import { peekLoginLink } from '../src/services/casino/loginLinks.js';
import { recordVisitMinute, visitData } from '../src/services/visitProfile.js';
import { renderVisitCard } from '../src/services/visitCard.js';
const A='780000000000000001',B='780000000000000002';
let db:Db,close:()=>Promise<void>,app:VisitApp;
const who=(id:string)=>({id,bot:false,displayAvatarURL:()=> 'https://example.invalid/avatar.png'});
beforeEach(async()=>{({db,close}=await makeDb());await db.insert(members).values([A,B].map(id=>({id,username:id,displayName:'さくら'})));app=new VisitApp(db,()=>cfg,'https://visit.test');});
afterEach(async()=>close());
const interaction=(target?:string,publicPost:boolean|null=null)=>({
 inCachedGuild:()=>true,guildId:cfg.guildId,isChatInputCommand:()=>true,isButton:()=>false,isRepliable:()=>true,
 commandName:'visitprofile',user:who(A),options:{getUser:()=>target?who(target):null,getBoolean:()=>publicPost},
 guild:{members:{fetch:async(input:{user:string;force:boolean})=>({user:who(input.user),displayAvatarURL:()=> 'https://example.invalid/avatar.png'})}},
 deferReply:vi.fn(),editReply:vi.fn(),deferred:true,
});
it('コマンドだけで自分の記録入りカードをチャンネルへ表示し、Web設定は不要',async()=>{
 const definition=commandDefinitions(cfg).find(c=>c.name==='visitprofile')!;
 expect(definition).toBeDefined();expect(definition.options?.every(o=>!o.required)).toBe(true);
 await recordVisitMinute(db,[A],new Date());const d=await visitData(db,A);
 app=new VisitApp(db,()=>cfg,undefined);
 const i=interaction();await app.onInteraction(i as any);
 expect(i.deferReply).toHaveBeenCalledWith({});expect(i.editReply).toHaveBeenCalledTimes(1);
 const reply=i.editReply.mock.calls[0]![0];expect(reply.content).toBe('参拝プロフィールです。');
 expect(reply.files[0].attachment.equals(renderVisitCard(d))).toBe(true);expect(reply.allowedMentions).toEqual({parse:[]});
});
it('公開いいえなら本人だけにプレビューし、非公開でも自分の記録は確認できる',async()=>{
 await visitData(db,A);await db.update(visitProfiles).set({publicStats:false}).where(eq(visitProfiles.memberId,A));
 const d=await visitData(db,A),self=interaction(undefined,false);await app.onInteraction(self as any);
 expect(self.deferReply).toHaveBeenCalledWith({flags:MessageFlags.Ephemeral});
 expect(self.editReply.mock.calls[0]![0].files[0].attachment.equals(renderVisitCard(d,{privateView:true}))).toBe(true);
});
it('本人が非公開にした記録は、自分の公開投稿にも他人からの表示にも出さない',async()=>{
 await visitData(db,A);await visitData(db,B);await db.update(visitProfiles).set({publicStats:false});
 for(const i of [interaction(),interaction(A,true),interaction(B),interaction(B,false)]){
  await app.onInteraction(i as any);const id=i.options.getUser()?.id??A;
  expect(i.editReply.mock.calls[0]![0].content).toContain('非公開');
  expect(i.editReply.mock.calls[0]![0].files[0].attachment.equals(renderVisitCard(await visitData(db,id)))).toBe(true);
 }
 expect((await visitData(db,A)).profile.publicStats).toBe(false);
});
it('相手を指定するとその人の公開カードを実行したチャンネルへ表示する',async()=>{
 await recordVisitMinute(db,[B],new Date());const i=interaction(B);await app.onInteraction(i as any);
 expect(i.deferReply).toHaveBeenCalledWith({});
 expect(i.editReply.mock.calls[0]![0].files[0].attachment.equals(renderVisitCard(await visitData(db,B)))).toBe(true);
});
it('公開カードの着せ替えボタンでも、リンクは押した本人だけに渡す',async()=>{
 const i={...interaction(B),isChatInputCommand:()=>false,isButton:()=>true,customId:'visit:open',member:{displayName:'本人'}};
 await app.onInteraction(i as any);expect(i.deferReply).toHaveBeenCalledWith({flags:MessageFlags.Ephemeral});
 const url=i.editReply.mock.calls[0]![0].components[0].components[0].url;
 const token=new URL(url).pathname.split('/').at(-1)!;expect((await peekLoginLink(db,token))!.id).toBe(A);
});

it('対象者の現在の宮司/神職ロールで判定し、実行者の権限を他人のカードへ適用しない',async()=>{
 const role='780000000000000099';const localCfg=structuredClone(cfg);localCfg.admin={...localCfg.admin,gujiRoleIds:[role],shinshokuRoleIds:[]};app=new VisitApp(db,()=>localCfg,'https://visit.test');
 let targetRoles=[role];const i=interaction(B);i.guild.members.fetch=async(input:{user:string;force:boolean})=>({user:who(input.user),displayAvatarURL:()=> 'https://example.invalid/avatar.png',roles:{cache:new Map(targetRoles.map(r=>[r,{}]))}} as any);
 await app.onInteraction(i as any);const data=await visitData(db,B);data.staffTheme=true;expect(i.editReply.mock.calls[0]![0].files[0].attachment.equals(renderVisitCard(data))).toBe(true);
 targetRoles=[];i.editReply.mockClear();await app.onInteraction(i as any);data.staffTheme=false;expect(i.editReply.mock.calls[0]![0].files[0].attachment.equals(renderVisitCard(data))).toBe(true);
});

it('保存した青銀は対象の運営カードに使い、ロール解除後は一般の装いに戻る',async()=>{
 const {saveVisitStaffStyle}=await import('../src/services/visitProfile.js');await saveVisitStaffStyle(db,B,'blue-lantern',true);
 const role='780000000000000099',localCfg=structuredClone(cfg);localCfg.admin={...localCfg.admin,gujiRoleIds:[role],shinshokuRoleIds:[]};app=new VisitApp(db,()=>localCfg,'https://visit.test');let roles=[role];const i=interaction(B);
 i.guild.members.fetch=async(input:{user:string;force:boolean})=>({user:who(input.user),displayAvatarURL:()=> 'https://example.invalid/avatar.png',roles:{cache:new Map(roles.map(r=>[r,{}]))}} as any);
 await app.onInteraction(i as any);const data=await visitData(db,B);data.staffTheme=true;expect(i.editReply.mock.calls[0]![0].files[0].attachment.equals(renderVisitCard(data))).toBe(true);
 roles=[];i.editReply.mockClear();await app.onInteraction(i as any);data.staffTheme=false;expect(i.editReply.mock.calls[0]![0].files[0].attachment.equals(renderVisitCard(data))).toBe(true);
});


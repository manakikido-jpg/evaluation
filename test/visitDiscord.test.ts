import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeDb, cfg } from './helpers.js';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
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
const interaction=(target:string,publicPost=false)=>({
 inCachedGuild:()=>true,guildId:cfg.guildId,isChatInputCommand:()=>true,isButton:()=>false,isRepliable:()=>true,
 commandName:'visitprofile',user:who(A),options:{getUser:()=>who(target),getBoolean:()=>publicPost},
 guild:{members:{fetch:async(id:string)=>({user:who(id),displayAvatarURL:()=> 'https://example.invalid/avatar.png'})}},
 deferReply:vi.fn(),editReply:vi.fn(),deferred:true,
});
it('コマンドを登録し、自分の非公開表示でも公開投稿では本人の公開設定を守る',async()=>{
 expect(commandDefinitions(cfg).find(c=>c.name==='visitprofile')).toBeDefined();
 await recordVisitMinute(db,[A],new Date());const d=await visitData(db,A);
 const self=interaction(A);await app.onInteraction(self as any);expect(self.deferReply).toHaveBeenCalledWith({flags:MessageFlags.Ephemeral});
 expect(self.editReply.mock.calls[0]![0].files[0].attachment.equals(renderVisitCard(d,{privateView:true}))).toBe(true);
 const pub=interaction(A,true);await app.onInteraction(pub as any);expect(pub.editReply.mock.calls[0]![0].files[0].attachment.equals(renderVisitCard(d))).toBe(true);
 const other=interaction(B);await app.onInteraction(other as any);expect(other.editReply.mock.calls[0]![0].content).toContain('非公開');
});
it('公開ボタンを押しても、着せ替えリンクは押した本人だけに渡す',async()=>{
 const i={...interaction(B),isChatInputCommand:()=>false,isButton:()=>true,customId:'visit:open',member:{displayName:'本人'}};
 await app.onInteraction(i as any);expect(i.deferReply).toHaveBeenCalledWith({flags:MessageFlags.Ephemeral});
 const url=i.editReply.mock.calls[0]![0].components[0].components[0].url;
 const token=new URL(url).pathname.split('/').at(-1)!;expect((await peekLoginLink(db,token))!.id).toBe(A);
});

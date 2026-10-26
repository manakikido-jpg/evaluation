import { Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { tempVoice } from '../src/db/schema.js';
import { RoomApp } from '../src/discord/rooms.js';
import { roomOf } from '../src/services/rooms.js';
import { cfg as base, makeDb } from './helpers.js';
const HUB='960000000000000001', ROOM='960000000000000002', OWNER='960000000000000003', BOT='960000000000000004';
const cfg={...base,tempVoice:{...base.tempVoice,hubs:[{channelId:HUB,name:'宿坊',plan:'once' as const}]}};
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());});afterEach(async()=>{await close();});
const row=()=>db.insert(tempVoice).values({channelId:ROOM,ownerId:OWNER,hubId:HUB,keepUntil:new Date('2099-01-01'),paid:3000});
function fake() {
 const messages=new Collection<string,any>(); let seq=0;
 const send=vi.fn(async(body:unknown)=>{const id=`panel-${++seq}`;messages.set(id,{id,author:{id:BOT},components:[{components:[{customId:'room:open'}]}]});return{id,body};});
 const fetch=vi.fn(async(arg:unknown)=>{
  const id=typeof arg==='string'?arg:arg && typeof arg==='object' && 'message' in arg ? String(arg.message) : undefined;
  if(id){if(!messages.has(id))throw Object.assign(new Error('Unknown Message'),{code:10008});return messages.get(id);}
  return messages.clone();
 });
 const channel={id:ROOM,name:'好きな名前に変えた部屋',userLimit:5,parent:null as {name:string}|null,isVoiceBased:()=>true,isTextBased:()=>true,messages:{fetch},send};
 const guild={client:{user:{id:BOT}},channels:{cache:new Map([[ROOM,channel]])}};
 const app=new RoomApp(db,()=>cfg,vi.fn());return{app,guild,channel,messages,send,fetch};
}

describe('宿のメッセージと設定パネル',()=>{
 it('廃止前のBOT案内は同じ投稿を更新し、部屋や履歴を消さない',async()=>{
  await row();const f=fake();
  const old:any={id:'old',author:{id:BOT},components:[{components:[{customId:'room:open'}]}],embeds:[{description:'公開・招待限定・シークレット・ツーショット'}]};
  old.edit=vi.fn(async(body:any)=>{old.embeds=body.embeds;return old;});f.messages.set('old',old);
  await f.app.attach(f.guild as never);
  expect(old.edit).toHaveBeenCalledOnce();expect(JSON.stringify(old.embeds)).not.toContain('ツーショット');
  expect(f.send).not.toHaveBeenCalled();expect(f.messages.has('old')).toBe(true);expect(f.channel.userLimit).toBe(5);
  await f.app.restoreRoomNotices();expect(old.edit).toHaveBeenCalledOnce();
 });
 it('部屋データと入口で判定し、宿の名前変更でも保護する',async()=>{
  await row();const f=fake();await f.app.attach(f.guild as never);
  expect(await f.app.preservesMessages(ROOM)).toBe(true);expect(await f.app.preservesMessages(HUB)).toBe(true);
  expect(await f.app.preservesMessages('ordinary')).toBe(false);
 });
 it('宿坊カテゴリの固定通話も保護する',async()=>{
  const f=fake();f.channel.parent={name:'🏨 宿坊'};await f.app.attach(f.guild as never);
  expect(await f.app.preservesMessages(ROOM)).toBe(true);
 });
 it('消えた設定入口を起動で復旧し、残った会話を削除しない',async()=>{
  await row();const f=fake();f.messages.set('chat',{id:'chat',author:{id:'user'},components:[]});
  await f.app.attach(f.guild as never);expect(f.send).toHaveBeenCalledOnce();expect(f.messages.has('chat')).toBe(true);
  expect(JSON.stringify(f.send.mock.calls[0])).toContain('room:open');
  expect(JSON.stringify(f.send.mock.calls[0])).toContain('"parse":[]');
  expect((await roomOf(db,ROOM))?.paid).toBe(3000);
  await Promise.all([f.app.restoreRoomNotices(),f.app.restoreRoomNotices()]);expect(f.send).toHaveBeenCalledOnce();
 });
 it('既にあるBOTのパネルを使い、確実に削除されたときだけ再投稿する',async()=>{
  await row();const f=fake();f.messages.set('old',{id:'old',author:{id:BOT},components:[{components:[{customId:'room:open'}]}]});
  await f.app.attach(f.guild as never);expect(f.send).not.toHaveBeenCalled();
  await f.app.restoreRoomNotices();expect(f.fetch).toHaveBeenCalledWith({message:'old',force:true});expect(f.send).not.toHaveBeenCalled();
  f.messages.delete('old');await f.app.restoreRoomNotices();expect(f.send).toHaveBeenCalledOnce();
 });
 it('取得の権限エラーではパネルを増やさず、直った後に再確認する',async()=>{
  await row();const f=fake();f.fetch.mockRejectedValueOnce(Object.assign(new Error('Missing Permissions'),{code:50013}));
  await f.app.attach(f.guild as never);expect(f.send).not.toHaveBeenCalled();
  await f.app.restoreRoomNotices();expect(f.send).toHaveBeenCalledOnce();
  f.fetch.mockRejectedValueOnce(Object.assign(new Error('Missing Permissions'),{code:50013}));
  await f.app.restoreRoomNotices();expect(f.send).toHaveBeenCalledOnce();
 });
});

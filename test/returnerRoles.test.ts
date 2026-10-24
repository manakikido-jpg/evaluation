import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { GuildMember, Role } from 'discord.js';
import { ShuinApp } from '../src/discord/app.js';
import { ReturnerRoles, returnerRoleOf } from '../src/discord/returnerRoles.js';
import { recordJoin, recordLeave, upsertMember, getMember, returningMemberIds } from '../src/services/members.js';
import { cfg, makeDb } from './helpers.js';
import type { Db } from '../src/db/client.js';
const ID = '600000000000000091', ROLE = '600000000000000092';
let db: Db, close: () => Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());});
afterEach(async()=>{await close();});
const snapshot = (joinedAt = new Date('2026-01-01')) => ({id:ID,username:'visitor',displayName:'visitor',avatarUrl:null,roleIds:[],isBot:false,joinedAt});
function member(name='🔁 出戻り') {
 const role={id:ROLE,name,managed:false,editable:true};
 const cache=new Map<string,unknown>();
 const m={id:ID,user:{id:ID,bot:false,username:'visitor'},displayName:'visitor',joinedAt:new Date('2026-10-24'),premiumSince:null,
  displayAvatarURL:()=>null,guild:{id:cfg.guildId,roles:{cache:new Map([[ROLE,role]])}},
  roles:{cache,add:vi.fn(async(id:string)=>{cache.set(id,{});})}};
 return {m:m as unknown as GuildMember,raw:m,role};
}
const app = () => new ShuinApp({} as never,db,cfg);

describe('出戻り判別ですぐロールを付ける',()=>{
 it('初参加は付けず、退出後の入鯖イベント内で付ける',async()=>{
  const {m,raw}=member(); const bot=app();
  await bot.onMemberAdd(m); expect(raw.roles.add).not.toHaveBeenCalled();
  await recordLeave(db,ID); await bot.onMemberAdd(m);
  expect(raw.roles.add).toHaveBeenCalledWith(ROLE,expect.any(String));
  expect(await returningMemberIds(db,[ID])).toEqual(new Set([ID]));
 });
 it('入鯖前に情報更新で行が作られても初参加を誤判定しない',async()=>{
  const {m,raw}=member(); await upsertMember(db,{...snapshot(),joinedAt:m.joinedAt});
  await app().onMemberAdd(m); expect(raw.roles.add).not.toHaveBeenCalled();
  expect(await returningMemberIds(db,[ID])).toEqual(new Set());
 });
 it('停止中の退出を記録できなくても、参加日時が新しくなれば同期で拾う',async()=>{
  await recordJoin(db,snapshot()); const {m,raw}=member();
  await app().syncAll([m]); expect(raw.roles.add).toHaveBeenCalledOnce();
  expect((await getMember(db,ID))?.joinedAt).toEqual(m.joinedAt);
 });
 it('付与失敗の後、メンバー更新で再試行できる',async()=>{
  await recordJoin(db,snapshot()); await recordLeave(db,ID);
  const {m,raw}=member(); raw.roles.add.mockRejectedValueOnce(new Error('Missing Permissions'));
  const bot=app(); await bot.onMemberAdd(m); expect(raw.roles.cache.has(ROLE)).toBe(false);
  const roles=new ReturnerRoles(db); await roles.onMemberUpdate(m);
  expect(raw.roles.cache.has(ROLE)).toBe(true); expect(raw.roles.add).toHaveBeenCalledTimes(2);
  await roles.onMemberUpdate(m); expect(raw.roles.add).toHaveBeenCalledTimes(2);
 });
 it('確認済みの履歴は起動同期でも復旧する',async()=>{
  await recordJoin(db,snapshot()); await recordLeave(db,ID); await recordJoin(db,snapshot());
  const {m,raw}=member(); await new ReturnerRoles(db).sync([m]);
  expect(raw.roles.add).toHaveBeenCalledOnce();
 });
 it('同時付与でも一度だけ、BOTや別サーバーは対象外',async()=>{
  const {m,raw}=member(); const roles=new ReturnerRoles(db);
  await Promise.all([roles.onDetected(m),roles.onDetected(m)]); expect(raw.roles.add).toHaveBeenCalledOnce();
  const other=member(); other.raw.guild.id='other'; await app().onMemberAdd(other.m); expect(other.raw.roles.add).not.toHaveBeenCalled();
  const robot=member(); robot.raw.user.bot=true; await roles.onDetected(robot.m); expect(robot.raw.roles.add).not.toHaveBeenCalled();
 });
 it('同名が複数・管理ロール・似た名前では付けず、編集できないロールも拒否',async()=>{
  const {m,raw,role}=member();
  expect(returnerRoleOf([{...role,name:'出戻り疑い'}] as unknown as Role[])).toBeUndefined();
  expect(returnerRoleOf([role,{...role,id:'duplicate'}] as unknown as Role[])).toBeUndefined();
  expect(returnerRoleOf([{...role,managed:true}] as unknown as Role[])).toBeUndefined();
  role.editable=false; await new ReturnerRoles(db).onDetected(m); expect(raw.roles.add).not.toHaveBeenCalled();
 });
});

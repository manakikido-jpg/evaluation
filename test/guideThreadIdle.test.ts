import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { Collection } from 'discord.js';
import type { Db } from '../src/db/client.js';
import { makeDb } from './helpers.js';
import { hideIdleGuideThread, GUIDE_THREAD_IDLE_MS } from '../src/discord/guideThreadIdle.js';
import { recordThread, threadOf, bookSlot, setScheduleMessage, touchGuideThread, closeThread } from '../src/services/guideThreads.js';
const M='880000000000000001', now=new Date('2026-11-26T00:00:00Z'), D=86400000;
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());await recordThread(db,M,'thread',false,new Date(+now-5*D));});
afterEach(async()=>close());
function message(id:string,at:number,bot=false){return {id,createdTimestamp:at,author:{bot},system:false};}
function thread(messages:ReturnType<typeof message>[]=[]){const list=new Collection(messages.map(m=>[m.id,m]));return {id:'thread',archived:false,locked:false,messages:{fetch:vi.fn().mockResolvedValue(list)},edit:vi.fn().mockResolvedValue(undefined)};}
async function row(){return (await threadOf(db,M))!;}
it('3日を過ぎた案内だけを、ロックせず非表示にする。DBは未完了のまま',async()=>{const t=thread([message('old',+now-GUIDE_THREAD_IDLE_MS)]);expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(true);expect(t.edit).toHaveBeenCalledWith(expect.objectContaining({archived:true}));expect(t.edit.mock.calls[0]![0]).not.toHaveProperty('locked');expect((await row()).closedAt).toBeNull();});
it('最近の人の投稿を残し、BOTの最近の通知は期限を延ばさない',async()=>{const recent=thread([message('human',+now-D)]);expect(await hideIdleGuideThread(db,await row(),recent as never,now)).toBe(false);const bot=thread([message('bot',+now-1000,true),message('old',+now-4*D)]);expect(await hideIdleGuideThread(db,await row(),bot as never,now)).toBe(true);});
it('作成から3日未満の無返信は残す',async()=>{await recordThread(db,M,'thread',false,new Date(+now-2*D));const t=thread();expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);expect(t.messages.fetch).not.toHaveBeenCalled();});
it('今後の予約・直近の予約を保護する',async()=>{await bookSlot(db,M,'2026-11-26','12:00');const t=thread();expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);expect(t.edit).not.toHaveBeenCalled();});
it('予約時刻から3日は残し、その後に返信がなければ非表示にできる',async()=>{await bookSlot(db,M,'2026-11-24','09:00');const t=thread();expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);await bookSlot(db,M,'2026-11-22','09:00');expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(true);});
it('自由記入の希望は、日付を推測せず確認待ちとして残す',async()=>{await setScheduleMessage(db,M,'schedule');const t=thread();expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);expect(t.edit).not.toHaveBeenCalled();});
it('既にアーカイブ済み、または手動で施錠済みなら触らない',async()=>{const t=thread();t.locked=true;expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);t.locked=false;t.archived=true;expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);expect(t.edit).not.toHaveBeenCalled();});
it('取得や権限のエラーは終了扱いにせず、次回再試行できる',async()=>{const t=thread();t.messages.fetch.mockRejectedValueOnce(new Error('network'));await expect(hideIdleGuideThread(db,await row(),t as never,now)).rejects.toThrow();expect(t.edit).not.toHaveBeenCalled();t.edit.mockRejectedValueOnce(new Error('permission'));await expect(hideIdleGuideThread(db,await row(),t as never,now)).rejects.toThrow();expect((await row()).closedAt).toBeNull();expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(true);});
it('調査中に予約が入ったら隠さない',async()=>{const t=thread();t.messages.fetch.mockImplementationOnce(async()=>{await bookSlot(db,M,'2026-11-26','12:00');return new Collection();});expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);expect(t.edit).not.toHaveBeenCalled();});
it('編集前に投稿が届いたら隠さない',async()=>{const t=thread();t.messages.fetch.mockResolvedValueOnce(new Collection()).mockResolvedValueOnce(new Collection([['new',message('new',+now)]]));expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);expect(t.edit).not.toHaveBeenCalled();});
it('編集と同時に投稿が届いたら、すぐ再開して施錠しない',async()=>{const t=thread();t.messages.fetch.mockResolvedValueOnce(new Collection()).mockResolvedValueOnce(new Collection()).mockResolvedValueOnce(new Collection([['new',message('new',+now)]]));expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);expect(t.edit.mock.calls.map(c=>c[0].archived)).toEqual([true,false]);});
it('入り直して新しい案内ができていたら、古い調査の結果を適用しない',async()=>{const old=await row();await recordThread(db,M,'new-thread',false,now);const t=thread();expect(await hideIdleGuideThread(db,old,t as never,now)).toBe(false);expect(t.edit).not.toHaveBeenCalled();});
it('大量のBOT投稿で確認範囲を超えたら、推測で隠さない',async()=>{const t=thread(Array.from({length:100},(_,n)=>message(String(n),+now-1000-n,true)));expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);expect(t.messages.fetch).toHaveBeenCalledTimes(5);expect(t.edit).not.toHaveBeenCalled();});
it('BOT投稿をさかのぼり、最近の人の返信が見つかれば残す',async()=>{const t=thread();const bots=new Collection(Array.from({length:100},(_,n)=>[String(n),message(String(n),+now-1000-n,true)] as const));t.messages.fetch.mockResolvedValueOnce(bots).mockResolvedValueOnce(new Collection([['human',message('human',+now-D)]]));expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);expect(t.edit).not.toHaveBeenCalled();});

it('本人のボタン操作も3日間の起点にし、古い操作では時刻を巻き戻さない',async()=>{
 await touchGuideThread(db,'thread',now);await touchGuideThread(db,'thread',new Date(+now-D));expect((await row()).lastActivityAt).toEqual(now);
 const t=thread();expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);
 expect(await hideIdleGuideThread(db,await row(),t as never,new Date(+now+3*D))).toBe(true);
});
it('編集直後にボタンの操作が記録され、通知に失敗していても再開する',async()=>{
 const t=thread();t.edit.mockImplementationOnce(async()=>{await touchGuideThread(db,'thread',now);});
 expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);expect(t.edit.mock.calls.map(c=>c[0].archived)).toEqual([true,false]);
});

it('整理中に完了が確定していたら、終わった案内を開き直さない',async()=>{
 const t=thread();t.edit.mockImplementationOnce(async()=>{await closeThread(db,M,now,'thread');});
 expect(await hideIdleGuideThread(db,await row(),t as never,now)).toBe(false);expect(t.edit.mock.calls.map(c=>c[0].archived)).toEqual([true]);
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { castSessions, supportTickets } from '../src/db/schema.js';
import { forgetMessages, keptChannelIds, recordMessage, takeMessages } from '../src/services/leaverMessages.js';
import { staffOnly } from '../src/discord/leaverCleanup.js';
import { makeDb } from './helpers.js';

let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => close());

describe('🧹 抜けた人の書き込み', () => {
  it('書き込みの番号を覚え、消されたものは忘れ、抜けたらチャンネルごとに取り出す（2 回目は空）', async () => {
    const at = new Date('2026-10-24T00:00:00Z');
    await recordMessage(db, { id: 'm1', channelId: 'c1', authorId: 'u1', at });
    await recordMessage(db, { id: 'm1', channelId: 'c1', authorId: 'u1', at });
    await recordMessage(db, { id: 'm2', channelId: 'c1', authorId: 'u1', at });
    await recordMessage(db, { id: 'm3', channelId: 'c2', authorId: 'u1', at });
    await recordMessage(db, { id: 'm4', channelId: 'c1', authorId: 'u2', at });
    await forgetMessages(db, ['m2']);
    const got = await takeMessages(db, 'u1');
    expect([...got.entries()].map(([c, l]) => [c, l.map((m) => m.id)])).toEqual([['c1', ['m1']], ['c2', ['m3']]]);
    expect((await takeMessages(db, 'u1')).size).toBe(0);
    expect((await takeMessages(db, 'u2')).get('c1')?.map((m) => m.id)).toEqual(['m4']);
  });

  it('残すチャンネル: キャストの予約スレッドと、お問い合わせのチャンネル', async () => {
    await db.insert(castSessions).values({ castId: 'c', customerId: 'u', plan: '30', minutes: 30, price: 1, status: 'done', threadId: 'thread1' } as never);
    await db.insert(supportTickets).values({ typeKey: 'q', openerId: 'u', channelId: 'ticket1' } as never);
    expect([...(await keptChannelIds(db))].sort()).toEqual(['thread1', 'ticket1']);
  });

  it('運営だけのチャンネル（@everyone にも役職にも見えない）は残す。スレッドは親で見る', () => {
    const guild = { roles: { everyone: { id: 'everyone' } } } as never;
    const ch = (visible: string[]) => ({ isThread: () => false, permissionsFor: (id: string) => ({ has: () => visible.includes(id) }) });
    expect(staffOnly(ch([]) as never, guild, ['rank1'])).toBe(true);
    expect(staffOnly(ch(['rank1']) as never, guild, ['rank1'])).toBe(false);
    expect(staffOnly(ch(['everyone']) as never, guild, [])).toBe(false);
    expect(staffOnly({ isThread: () => true, parent: ch([]) } as never, guild, ['rank1'])).toBe(true);
  });
});

it('退会者の片づけは続けるが、削除件数をDiscordの記録へ送信しない',async()=>{
 const {LeaverCleanupApp}=await import('../src/discord/leaverCleanup.js');
 const {cfg}=await import('./helpers.js');
 const {vi}=await import('vitest');
 const sendMessage=vi.fn(async()=>({id:'notice'})),quiet=vi.fn(),remove=vi.fn(async()=>undefined);
 await recordMessage(db,{id:'deleted-message',channelId:'talk',authorId:'leaver',at:new Date()});
 const channel={isThread:()=>false,isTextBased:()=>true,permissionsFor:()=>({has:()=>true}),messages:{fetchPinned:async()=>new Map(),delete:remove}};
 const guild={id:cfg.guildId,roles:{everyone:{id:'everyone'}},channels:{cache:new Map([['talk',channel]])}};
 const app=new LeaverCleanupApp(db,()=>cfg,{sendMessage},quiet);
 expect(await app.onMemberRemove(guild as never,'leaver')).toBe(1);expect(remove).toHaveBeenCalledWith('deleted-message');expect(quiet).toHaveBeenCalledWith(['deleted-message']);expect(sendMessage).not.toHaveBeenCalled();
});

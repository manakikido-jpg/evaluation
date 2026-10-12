import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { buyDiary, createDiary, changeDiaryMode, clearDiaryThread, diaryOf, mayPostDiary } from '../src/services/diary.js';
import { DiaryApp } from '../src/discord/diary.js';
import { ChannelType, type Message, type Interaction } from 'discord.js';
import { cfg, makeDb } from './helpers.js';
let db: Db, close: () => Promise<void>;
const U = '100000000000000111', OTHER = '100000000000000112', THREAD = '100000000000000113', BOT = '100000000000000114';
beforeEach(async () => { ({db, close} = await makeDb()); await addCoins(db, U, 1000, 'adjust'); });
afterEach(async () => { await close(); });
describe('日記の権利と投稿設定', () => {
  it('500銭を一度だけ払い、残高不足では権利を作らない', async () => {
    expect(await buyDiary(db, OTHER)).toBe('poor');
    expect(await diaryOf(db, OTHER)).toBeUndefined();
    expect(await Promise.all([buyDiary(db, U), buyDiary(db, U)])).toEqual(['ok', 'owned']);
    expect((await walletOf(db, U)).balance).toBe(500);
    expect(await buyDiary(db, U)).toBe('owned');
  });
  it('購入後の作成失敗でも権利は残り、同時作成は一つだけ、削除後も買い直さない', async () => {
    const create = vi.fn(async () => THREAD);
    expect(await createDiary(db, U, 'owner', create)).toEqual({status:'no_right'});
    expect(create).not.toHaveBeenCalled();
    await buyDiary(db, U);
    await expect(createDiary(db, U, 'owner', async () => { throw new Error('Discord unavailable'); })).rejects.toThrow();
    expect((await diaryOf(db, U))?.threadId).toBeNull();
    expect((await walletOf(db, U)).balance).toBe(500);
    const results = await Promise.all([createDiary(db, U, 'owner', create), createDiary(db, U, 'everyone', create)]);
    expect(results.map(r => r.status)).toEqual(['ok', 'exists']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await changeDiaryMode(db, OTHER, THREAD, 'everyone')).toBe(false);
    expect(await changeDiaryMode(db, U, THREAD, 'everyone')).toBe(true);
    expect((await diaryOf(db, U))?.mode).toBe('everyone');
    await clearDiaryThread(db, THREAD);
    expect((await createDiary(db, U, 'owner', create)).status).toBe('ok');
    expect((await walletOf(db, U)).balance).toBe(500);
  });
  it('フォーラムにも公開日記を作り、購入確認なしでは課金しない', async () => {
    const thread = { id: THREAD, delete: vi.fn() };
    const create = vi.fn(async (_options: unknown) => thread);
    const app = new DiaryApp(db, () => cfg);
    const editReply = vi.fn(), deferReply = vi.fn();
    const i = { isButton: () => true, inCachedGuild: () => true, guildId: cfg.guildId, customId: 'diary:open', user: {id: U}, member: {displayName: 'さくら'}, guild: {channels: {fetch: async () => ({type: ChannelType.GuildForum, threads: {create}})}}, editReply, deferReply };
    await app.onInteraction(i as unknown as Interaction);
    expect((await walletOf(db, U)).balance).toBe(1000);
    expect(JSON.stringify(editReply.mock.calls)).toContain('diary:buy');
    await app.onInteraction({...i, customId:'diary:buy'} as unknown as Interaction);
    expect((await walletOf(db, U)).balance).toBe(500);
    await app.onInteraction({...i, customId:'diary:create:everyone'} as unknown as Interaction);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0]).toMatchObject({name:'📖 さくらの日記',message:{allowedMentions:{parse:[]}}});
    expect((await diaryOf(db, U))?.mode).toBe('everyone');
    expect(thread.delete).not.toHaveBeenCalled();
  });
  it('投稿を削除できないBOTでは本人だけ投稿の日記を作らない', async () => {
    await buyDiary(db, U);
    const create = vi.fn();
    const app = new DiaryApp(db, () => cfg);
    const i = {isButton:()=>true,inCachedGuild:()=>true,guildId:cfg.guildId,customId:'diary:create:owner',user:{id:U},guild:{members:{me:{}},channels:{fetch:async () => ({type:ChannelType.GuildText,permissionsFor:()=>({has:()=>false}),threads:{create}})}},deferReply:vi.fn(),editReply:vi.fn()};
    await app.onInteraction(i as unknown as Interaction);
    expect(create).not.toHaveBeenCalled();
    expect((await diaryOf(db, U))?.threadId).toBeNull();
    expect(JSON.stringify(i.editReply.mock.calls)).toContain('メッセージを管理');
  });

  it('作成後の案内送信に失敗したら空のスレッドを片付け、権利は残す', async () => {
    await buyDiary(db, U);
    const thread = {id:THREAD,send:vi.fn(async () => {throw new Error('message failed');}),delete:vi.fn()};
    const app = new DiaryApp(db, () => cfg);
    const i = {isButton:() => true,inCachedGuild:() => true,guildId:cfg.guildId,customId:'diary:create:owner',user:{id:U},member:{displayName:'さくら'},guild:{members:{me:{}},channels:{fetch:async () => ({type:ChannelType.GuildText,permissionsFor:()=>({has:()=>true}),threads:{create:async () => thread}})}},deferReply:vi.fn(),editReply:vi.fn()};
    await app.onInteraction(i as unknown as Interaction);
    expect(thread.delete).toHaveBeenCalledOnce();
    expect((await diaryOf(db, U))?.threadId).toBeNull();
    expect((await walletOf(db, U)).balance).toBe(500);
    expect(JSON.stringify(i.editReply.mock.calls)).toContain('購入済みの権利は残っています');
  });

  it('本人だけ投稿では他人を削除し、みんな投稿では残す。別のチャンネルには触れない', async () => {
    await buyDiary(db, U);
    await createDiary(db, U, 'owner', async () => THREAD);
    const app = new DiaryApp(db, () => cfg);
    const message = (authorId: string, parentId = cfg.diary.channelId) => ({ guildId: cfg.guildId, channelId: THREAD, channel: {isThread: () => true, parentId}, author: {id: authorId}, client: {user:{id:BOT}}, delete: vi.fn() });
    const outsider = message(OTHER), owner = message(U), otherChannel = message(OTHER, '100000000000000999');
    await app.onMessage(outsider as unknown as Message);
    await app.onMessage(owner as unknown as Message);
    await app.onMessage(otherChannel as unknown as Message);
    expect(outsider.delete).toHaveBeenCalledOnce();
    expect(owner.delete).not.toHaveBeenCalled();
    expect(otherChannel.delete).not.toHaveBeenCalled();
    await changeDiaryMode(db, U, THREAD, 'everyone');
    const comment = message(OTHER);
    await app.onMessage(comment as unknown as Message);
    expect(comment.delete).not.toHaveBeenCalled();
    expect(mayPostDiary({memberId:U,mode:'owner'},BOT,BOT)).toBe(true);
  });
});

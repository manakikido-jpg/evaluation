import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANGELOG, LATEST_CHANGE_ID, type ChangelogEntry } from '../src/changelog.js';
import type { Db } from '../src/db/client.js';
import type { DiscordActions, GuildChannel, MessageBody } from '../src/lib/discordRest.js';
import { announceUpdates, loadUpdateNews, newsChannelOf, newsEmbed, newsMessages, pendingNews, saveUpdateNews } from '../src/services/updateNews.js';
import { makeDb } from './helpers.js';

const NEWS = '910000000000000070';
const CHANNELS: GuildChannel[] = [
  { id: '910000000000000001', name: '⛩ 鳥居', type: 4, parent_id: null, position: 0 },
  { id: NEWS, name: '📰｜更新速報', type: 0, parent_id: '910000000000000001', position: 1 },
];
const entry = (id: string, kind: ChangelogEntry['kind'], where: ChangelogEntry['where'], date = '2026-09-28'): ChangelogEntry => ({ id, date, kind, where, title: `題 ${id}`, items: ['一つ目', '二つ目'] });

let db: Db;
let close: () => Promise<void>;
let sent: { channelId: string; body: MessageBody }[];
const discord = { sendMessage: async (channelId: string, body: MessageBody) => (sent.push({ channelId, body }), { id: '1' }) } as unknown as DiscordActions;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  sent = [];
});
afterEach(async () => {
  await close();
});

describe('📰 更新速報', () => {
  it('カード: 種類ごとの色と見出し、箇条書き、日付と場所', () => {
    const card = newsEmbed(entry('a', 'new', ['Discord', '社務所Web']));
    expect(card).toMatchObject({ author: { name: '✨ 新しい機能' }, title: '題 a', description: '- 一つ目\n- 二つ目', color: 0xd7003a });
    expect(card.footer?.text).toBe('9月28日 ・ Discord・社務所Web（運営）');
    expect(newsEmbed(entry('b', 'fix', ['Discord'])).author?.name).toBe('🩹 直しました');
  });

  it('メッセージ: 古い順、1 通目に見出し、カードは 10 枚ずつ', () => {
    const many = Array.from({ length: 12 }, (_, i) => entry(`e${i}`, 'improve', ['Discord']));
    const msgs = newsMessages(many);
    expect(msgs.length).toBe(2);
    expect(msgs[0]!.content).toContain('📰 更新速報');
    expect(msgs[0]!.content).toContain('9月28日のアップデート（12 件）');
    expect(msgs[0]!.embeds!.length).toBe(10);
    expect(msgs[0]!.embeds![0]!.title).toBe('題 e11');
    expect(msgs[1]!.content).toBeUndefined();
  });

  it('まだ出していない更新: 印より新しいもの。メンバー向けだけにもできる', () => {
    const all = [entry('c', 'new', ['社務所Web']), entry('b', 'new', ['Discord']), entry('a', 'fix', ['Discord'])];
    expect(pendingNews({ enabled: true, scope: 'discord', lastId: 'a' }, all).map((e) => e.id)).toEqual(['b']);
    expect(pendingNews({ enabled: true, scope: 'all', lastId: 'a' }, all).map((e) => e.id)).toEqual(['c', 'b']);
    // 印がない・見つからないときは出さない（最初に全部を出さない）
    expect(pendingNews({ enabled: true, scope: 'all' }, all)).toEqual([]);
    expect(pendingNews({ enabled: true, scope: 'all', lastId: 'zz' }, all)).toEqual([]);
  });

  it('チャンネル: 選んだもの、なければ「更新速報」の名前で探す', () => {
    expect(newsChannelOf({ enabled: true, scope: 'discord' }, CHANNELS)?.id).toBe(NEWS);
    expect(newsChannelOf({ enabled: true, scope: 'discord', channelId: '910000000000000001' }, CHANNELS)?.id).toBe(NEWS);
    expect(newsChannelOf({ enabled: true, scope: 'discord' }, CHANNELS.slice(0, 1))).toBeUndefined();
  });

  it('BOT の起動時: 自動なら印より新しい分を出して印を進める。2 回目は出さない', async () => {
    const ctx = { db, discord, channels: CHANNELS };
    // 自動でなければ何もしない
    expect(await announceUpdates(ctx)).toBe(0);
    const prevId = CHANGELOG.find((e, i) => i > 0 && CHANGELOG.slice(0, i).some((x) => x.where.includes('Discord')))!.id;
    await saveUpdateNews(db, { enabled: true, scope: 'discord', lastId: prevId }, 'x');
    const n = await announceUpdates(ctx);
    expect(n).toBeGreaterThan(0);
    expect(sent[0]!.channelId).toBe(NEWS);
    expect((await loadUpdateNews(db)).lastId).toBe(LATEST_CHANGE_ID);
    sent = [];
    expect(await announceUpdates(ctx)).toBe(0);
    expect(sent).toEqual([]);
  });
});

it('周知担当が要否・対象・手順・文面・画像指示を同じカードで確認できる',()=>{
 const e:ChangelogEntry={...entry('brief','new',['Discord']),announcement:{priority:'required',audience:'参拝者',steps:['ボタンを押す','表示額を確認する'],postText:'新しい機能をご利用ください。',imagePrompt:'桜の案内画像。見出しと2つの手順を大きく。',notes:'現在の設定を確認してください。'}};
 const fields=newsEmbed(e).fields!;
 expect(fields.find(f=>f.name==='周知の判断')!.value).toContain('周知をお願いします');
 expect(fields.find(f=>f.name==='誰に伝える？')!.value).toBe('参拝者');
 expect(fields.find(f=>f.name==='案内する操作・手順')!.value).toBe('1. ボタンを押す\n2. 表示額を確認する');
 expect(fields.find(f=>f.name==='周知文のたたき台')!.value).toBe(e.announcement!.postText);
 expect(fields.find(f=>f.name==='画像制作の指示')!.value).toBe(e.announcement!.imagePrompt);
});
it('周知不要は運営向けと明示し、一般向けの下書きや画像制作を依頼しない',()=>{
 const e:ChangelogEntry={...entry('internal','fix',['社務所Web']),announcement:{priority:'none',audience:'運営',steps:['管理画面を確認する'],postText:'公開しない文',imagePrompt:'公開しない指示'}};
 const card=newsEmbed(e);expect(card.fields![0]!.value).toContain('周知は不要');expect(JSON.stringify(card.fields)).not.toContain('公開しない');
});
it('未整理の過去分は要確認。既存の変更点を使い、操作や画像の必要性を推測しない',()=>{
 const card=newsEmbed(entry('old-unknown','improve',['Discord']));
 expect(card.fields![0]!.value).toContain('要確認');
 expect(card.fields!.find(f=>f.name==='案内する操作・手順')!.value).toContain('記載がありません');
 expect(card.fields!.find(f=>f.name==='周知文のたたき台')!.value).toBe('題 old-unknown\n一つ目\n二つ目');
});
it('既存機能の制作メモを使い、更新側の指定があればそちらを優先する',()=>{
 const e={...entry('2026-10-24-talk-topic-categories','improve',['Discord'])};
 expect(newsEmbed(e).fields!.find(f=>f.name==='案内する操作・手順')!.value).toContain('/トークテーマ');
 const override:ChangelogEntry={...e,announcement:{priority:'optional',audience:'対象',steps:[],postText:'新しい案内',imagePrompt:'新しい指示'}};
 expect(newsEmbed(override).fields![0]!.value).toContain('必要に応じて');
 expect(JSON.stringify(newsMessages([entry('unrelated','new',['Discord'])]))).not.toContain('コアタイム');
 expect(newsMessages([])).toEqual([]);
});
it('長い制作メモと多数の更新もDiscordの文字数上限内に分割し、順番と通知抑止を守る',()=>{
 const long='長い文章'.repeat(3000);
 const entries:ChangelogEntry[]=Array.from({length:12},(_,i)=>({...entry(String(i),'new',['Discord']),title:long,items:[long],announcement:{priority:'required',audience:long,steps:[long],postText:long,imagePrompt:long,notes:long}}));
 const messages=newsMessages(entries);expect(messages.length).toBeGreaterThan(1);
 expect(messages.flatMap(m=>m.embeds!)).toHaveLength(12);
 for(const message of messages){
  expect(message.allowed_mentions).toEqual({parse:[]});expect(message.content?.length??0).toBeLessThanOrEqual(2000);expect(message.embeds!.length).toBeLessThanOrEqual(10);
  let total=0;
  for(const card of message.embeds!){
   expect(card.title!.length).toBeLessThanOrEqual(256);expect(card.description!.length).toBeLessThanOrEqual(4096);
   total+=(card.title?.length??0)+(card.description?.length??0)+(card.author?.name.length??0)+(card.footer?.text.length??0);
   for(const field of card.fields!){expect(field.value.length).toBeLessThanOrEqual(1024);expect(field.name.length).toBeLessThanOrEqual(256);total+=field.name.length+field.value.length;}
  }
  expect(total).toBeLessThanOrEqual(6000);
 }
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { ReactionRoleApp } from '../src/discord/reactionRoles.js';
import type { DiscordActions, GuildRole } from '../src/lib/discordRest.js';
import { deletePanel, emojiKey, emojiPath, getPanel, normalizeEmoji, panelByMessage, parsePanel, panelEmojiCatalog, roleFor, savePanel } from '../src/services/reactionRoles.js';
import { cfg, makeDb } from './helpers.js';

const CH = '920000000000000001', CH2 = '920000000000000002', GAME = '930000000000000001', BOT_ROLE = '930000000000000009', HIGH = '930000000000000010', ADMIN = '930000000000000011', BOT = '940000000000000001', USER = '950000000000000001';
const roles: GuildRole[] = [
  { id: cfg.guildId, name: '@everyone', position: 0, managed: false, color: 0, permissions: '0' },
  { id: GAME, name: 'ゲーム好き', position: 1, managed: false, color: 0, permissions: '0' },
  { id: ADMIN, name: '強いロール', position: 2, managed: false, color: 0, permissions: '8' },
  { id: BOT_ROLE, name: 'BOT', position: 5, managed: true, color: 0, permissions: '8', tags: { bot_id: BOT } },
  { id: HIGH, name: '上のロール', position: 6, managed: false, color: 0, permissions: '0' },
];
const form = (rows: [string, string][], extra: Record<string, unknown> = {}) => ({ channelId: CH, title: '遊び', body: 'えらんでね', emoji: rows.map(r => r[0]), roleId: rows.map(r => r[1]), label: rows.map(() => ''), ...extra });

describe('🎭 スタンプの読み方', () => {
  it('ふつうの絵文字とサーバーのスタンプ', () => {
    expect(normalizeEmoji('🎮')).toBe('🎮');
    expect(normalizeEmoji('❤️')).toBe('❤');
    expect(normalizeEmoji('<:sakura:123456789012345678>')).toBe('<:sakura:123456789012345678>');
    expect(normalizeEmoji('abc')).toBeUndefined();
    expect(normalizeEmoji('@everyone')).toBeUndefined();
    expect(emojiKey('<a:x:123456789012345678>')).toBe('123456789012345678');
    expect(emojiKey({ id: null, name: '❤️' })).toBe(emojiKey('❤'));
    expect(emojiPath('<:sakura:123456789012345678>')).toBe('sakura%3A123456789012345678');
    expect(emojiPath('🎮')).toBe(encodeURIComponent('🎮'));
  });

  it('ID単体は照合済みのサーバー絵文字だけ受け付け、アニメと重複も正規化する',()=>{
    const id='970000000000000001',list=[{id,name:'notice',animated:true}];
    expect(normalizeEmoji(id)).toBeUndefined();expect(normalizeEmoji(id,list)).toBe('<a:notice:'+id+'>');
    expect(normalizeEmoji(id,[{id,name:'notice',available:false}])).toBeUndefined();
    expect(normalizeEmoji(id,[{id,name:null}])).toBeUndefined();
    const valid=parsePanel(cfg,roles,form([[id,GAME]]),BOT,list);
    expect(valid).toMatchObject({ok:{entries:[{emoji:'<a:notice:'+id+'>',roleId:GAME}]}});
    expect('error' in parsePanel(cfg,roles,form([[id,GAME],['<a:notice:'+id+'>',GAME]]),BOT,list)).toBe(true);
    expect('error' in parsePanel(cfg,roles,form([[id,ADMIN]]),BOT,list)).toBe(true);
  });
  it('ID入力だけを照合し、画像スタンプや取得失敗を投稿せず説明する',async()=>{
    const id='970000000000000001';const guildEmojis=vi.fn(async()=>[{id,name:'notice'}]);
    expect(await panelEmojiCatalog({guildEmojis},cfg.guildId,form([['🎮',GAME]]))).toEqual({emojis:[]});expect(guildEmojis).not.toHaveBeenCalled();
    expect(await panelEmojiCatalog({guildEmojis},cfg.guildId,form([[id,GAME]]))).toEqual({emojis:[{id,name:'notice'}]});expect(guildEmojis).toHaveBeenCalledWith(cfg.guildId);
    const sticker=await panelEmojiCatalog({guildEmojis:async()=>[],guildStickers:async()=>[{id,name:'picture'}]},cfg.guildId,form([[id,GAME]]));expect(sticker).toHaveProperty('error',expect.stringContaining('画像スタンプ'));
    const failed=await panelEmojiCatalog({guildEmojis:async()=>{throw Error('429');}},cfg.guildId,form([[id,GAME]]));expect(failed).toHaveProperty('error',expect.stringContaining('取得できません'));
    expect(await panelEmojiCatalog({},cfg.guildId,form([[id,GAME]]))).toHaveProperty('error');
  });
  it('付けてよいロールだけ。同じスタンプは 2 回使えない', () => {
    expect('ok' in parsePanel(cfg, roles, form([['🎮', GAME]]), BOT)).toBe(true);
    for (const bad of [ADMIN, HIGH, BOT_ROLE, cfg.guildId]) expect('error' in parsePanel(cfg, roles, form([['🎮', bad]]), BOT)).toBe(true);
    expect('error' in parsePanel(cfg, roles, form([['🎮', GAME], ['🎮', GAME]]), BOT)).toBe(true);
    expect('error' in parsePanel(cfg, roles, form([['', '']]), BOT)).toBe(true);
    expect('error' in parsePanel(cfg, roles, form([['🎮', GAME]], { channelId: 'x' }), BOT)).toBe(true);
  });
});

describe('🎭 パネル', () => {
  let db: Db, close: () => Promise<void>, calls: string[], discord: Pick<DiscordActions, 'sendMessage' | 'editMessage' | 'deleteMessage' | 'addReaction' | 'removeReactionEmoji'>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
    calls = [];
    discord = {
      sendMessage: async (c) => (calls.push(`send ${c}`), { id: `9600000000000000${calls.length.toString().padStart(2, '0')}` }),
      editMessage: async (c, m) => void calls.push(`edit ${c} ${m}`),
      deleteMessage: async (c, m) => void calls.push(`delete ${c} ${m}`),
      addReaction: async (_c, _m, e) => void calls.push(`react ${decodeURIComponent(e)}`),
      removeReactionEmoji: async (_c, _m, e) => void calls.push(`unreact ${decodeURIComponent(e)}`),
    };
  });
  afterEach(async () => close());
  const input = (rows: [string, string][], channelId = CH) => {
    const r = parsePanel(cfg, [...roles, { id: '930000000000000002', name: '絵', position: 1, managed: false, color: 0, permissions: '0' }], form(rows, { channelId }), BOT);
    if (!('ok' in r)) throw new Error(r.error);
    return r.ok;
  };

  it('作ると投稿してスタンプを付ける。直すと書きかえ、外したスタンプは消す。チャンネルを変えると出しなおす', async () => {
    const p = await savePanel(db, discord, input([['🎮', GAME], ['🎨', '930000000000000002']]), () => 'ロール', 'admin');
    expect(calls).toEqual([`send ${CH}`, 'react 🎮', 'react 🎨']);
    calls = [];
    await savePanel(db, discord, input([['🎮', GAME]]), () => 'ロール', 'admin', p.id);
    expect(calls).toEqual([`edit ${CH} ${p.messageId}`, 'unreact 🎨', 'react 🎮']);
    calls = [];
    const moved = await savePanel(db, discord, input([['🎮', GAME]], CH2), () => 'ロール', 'admin', p.id);
    expect(calls[0]).toBe(`delete ${CH} ${p.messageId}`);
    expect(calls[1]).toBe(`send ${CH2}`);
    expect((await panelByMessage(db, moved.messageId!))?.id).toBe(p.id);
    expect(roleFor(moved, { name: '🎮' })).toBe(GAME);
    expect(roleFor(moved, { name: '🎨' })).toBeUndefined();
    expect(await deletePanel(db, discord, p.id, 'admin')).toBe(true);
    expect(await getPanel(db, p.id)).toBeUndefined();
  });

  it('スタンプを押すと付き、外すと外れる。BOT・ほかのメッセージ・強い権限のロールは何もしない', async () => {
    const p = await savePanel(db, discord, input([['🎮', GAME]]), () => 'ロール', 'admin');
    const has = new Set<string>();
    const member = { user: { bot: false }, roles: { cache: { has: (id: string) => has.has(id) }, add: vi.fn(async (id: string) => void has.add(id)), remove: vi.fn(async (id: string) => void has.delete(id)) } };
    let perms = 0n;
    const guild = { members: { fetch: async () => member }, roles: { cache: new Map([[GAME, { managed: false, get permissions() { return { bitfield: perms }; } }]]) } };
    const client = { user: { id: BOT }, guilds: { cache: new Map([[cfg.guildId, guild]]) } } as never;
    const app = new ReactionRoleApp(db, () => cfg);
    const ev = (over: Record<string, unknown> = {}) => ({ user_id: USER, message_id: p.messageId!, guild_id: cfg.guildId, emoji: { id: null, name: '🎮' }, ...over });
    expect(await app.onReaction(client, true, ev())).toBe('added');
    expect(await app.onReaction(client, true, ev())).toBeUndefined();
    expect(await app.onReaction(client, false, ev())).toBe('removed');
    expect(await app.onReaction(client, true, ev({ user_id: BOT }))).toBeUndefined();
    expect(await app.onReaction(client, true, ev({ message_id: '960000000000000099' }))).toBeUndefined();
    expect(await app.onReaction(client, true, ev({ emoji: { id: null, name: '🎨' } }))).toBeUndefined();
    perms = 8n;
    expect(await app.onReaction(client, true, ev())).toBeUndefined();
    expect(member.roles.add).toHaveBeenCalledOnce();
  });
});

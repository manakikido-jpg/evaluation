import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type Interaction } from 'discord.js';
import sharp from 'sharp';
import type { Db } from '../src/db/client.js';
import { castSessions } from '../src/db/schema.js';
import { CastApp, castReceptionBody, postCastIntro } from '../src/discord/cast.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { applyCast, getCast, menuOf, CAST_DEFAULTS, loadCastReception, setCastStatus, setWaiting, saveCastPhoto, loadCastPhoto, deleteCastPhoto } from '../src/services/cast.js';
import { loadReceptionAvatar, receptionSvg, renderCastReception } from '../src/services/castReceptionImage.js';
import { cfg, makeDb } from './helpers.js';

const CAST = '880000000000000001';
const OTHER = '880000000000000004';
const CUSTOMER = '880000000000000002';
const DAY = new Date('2026-10-01T15:00:00Z'); // 日本時間 10/2 00:00
const NOW = new Date('2026-10-01T15:30:00Z');
const profile = { bio: 'お話しましょう', tags: ['雑談', 'ゲーム'], price30: 300, price60: 500, priceNight: 2000, minorOk: true };
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const id of [CAST, OTHER]) {
    await applyCast(db, CAST_DEFAULTS, { id, adult: true }, profile, NOW);
    await setCastStatus(db, id, 'active', 'staff', NOW);
  }
});
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await close(); });

async function booking(values: Partial<typeof castSessions.$inferInsert> = {}) {
  const [s] = await db.insert(castSessions).values({ castId: CAST, customerId: CUSTOMER, plan: '30', minutes: 30, price: 300, status: 'accepted', startAt: DAY, createdAt: DAY, ...values }).returning();
  return s!;
}

describe('キャストの写真', () => {
  it('本人ごとに整えて保存し、壊れた写真で上書きせず、他の写真を消さない', async () => {
    const png = await sharp({ create: { width: 90, height: 60, channels: 3, background: '#ff8899' } }).png().toBuffer();
    const hash = await saveCastPhoto(db, CAST, png);
    expect(hash).toBeTruthy();
    await saveCastPhoto(db, OTHER, png);
    expect(await saveCastPhoto(db, CUSTOMER, png)).toBeUndefined();
    expect(await saveCastPhoto(db, CAST, png.subarray(0, 16))).toBeUndefined();
    const photo = (await loadCastPhoto(db, CAST))!;
    expect(photo.hash).toBe(hash);
    expect(await sharp(photo.data).metadata()).toMatchObject({ width: 90, height: 60, format: 'png' });
    await deleteCastPhoto(db, CAST);
    expect(await loadCastPhoto(db, CAST)).toBeUndefined();
    expect(await loadCastPhoto(db, OTHER)).toBeDefined();
  });
});

describe('キャスト本人の受付情報', () => {
  it('日本時間の今日だけを選び、他のキャストと取り消した予約は混ぜない', async () => {
    const first = await booking();
    const later = await booking({ startAt: NOW });
    await booking({ startAt: new Date(DAY.getTime() - 1) });
    await booking({ startAt: new Date(DAY.getTime() + 86_400_000) });
    await booking({ castId: OTHER });
    await booking({ status: 'canceled' });
    await booking({ castId: OTHER, status: 'active' });
    const d = (await loadCastReception(db, CAST, NOW))!;
    expect(d.today.map((s) => s.id)).toEqual([first.id, later.id]);
    expect(d.current).toHaveLength(0);
    expect(d.state).toBe('off');
    expect(await loadCastReception(db, CUSTOMER, NOW)).toBeUndefined();
  });

  it('今月に精算済みの本人の受取額と回数だけを数える', async () => {
    await booking({ status: 'done', paid: 270, closedAt: new Date('2026-09-30T15:00:00Z') });
    await booking({ status: 'done', paid: 450, closedAt: NOW });
    await booking({ status: 'done', paid: 999, closedAt: new Date('2026-09-30T14:59:59Z') });
    await booking({ status: 'done', paid: 999, closedAt: new Date('2026-10-31T15:00:00Z') });
    await booking({ castId: OTHER, status: 'done', paid: 999, closedAt: NOW });
    await booking({ status: 'disputed', paid: 999, closedAt: NOW });
    expect((await loadCastReception(db, CAST, NOW))?.stat).toMatchObject({ count: 2, earned: 720 });
  });

  it('待機期限と運営の休止を反映し、返事待ち・通話中を本人の分だけ表示する', async () => {
    await setWaiting(db, CAST, 2, NOW);
    expect((await loadCastReception(db, CAST, NOW))?.state).toBe('waiting');
    expect((await loadCastReception(db, CAST, new Date(NOW.getTime() + 120 * 60_000)))?.state).toBe('off');
    const s = await booking({ status: 'requested', startAt: null, channelId: '990000000000000001' });
    await booking({ castId: OTHER, status: 'active' });
    const d = (await loadCastReception(db, CAST, NOW))!;
    expect(d.state).toBe('busy');
    expect(d.current.map((x) => x.id)).toEqual([s.id]);
    await setCastStatus(db, CAST, 'paused', 'staff', NOW);
    expect((await loadCastReception(db, CAST, NOW))?.state).toBe('paused');
    await setCastStatus(db, CAST, 'removed', 'staff', NOW);
    expect(await loadCastReception(db, CAST, NOW)).toBeUndefined();
  });
});

describe('受付の画像とボタン', () => {
  it('画像に予約・残り時間・受取額を載せ、XMLとして名前を実行しない', async () => {
    await booking({ status: 'active', startedAt: NOW, endsAt: new Date(NOW.getTime() + 20 * 60_000), channelId: '990000000000000001' });
    const reception = (await loadCastReception(db, CAST, NOW))!;
    const input = { reception, name: '<script>悪い名前</script>', names: new Map([[CUSTOMER, '<image href="x"/>']]), currency: '銭' };
    const svg = receptionSvg(input);
    expect(svg).toContain('残り 20 分');
    expect(svg).toContain('2026/10/02');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('<image href="x"/>');
    const png = renderCastReception(input);
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 960, height: 1220 });
    const body = castReceptionBody(reception, 'さくら', new Map([[CUSTOMER, 'はる']]), '銭', cfg.guildId);
    expect(body.attachments).toEqual([]);
    expect(body.allowedMentions).toEqual({ parse: [] });
    expect(body.files[0]?.name).toBe('cast-reception.png');
    expect(body.files[0]?.description).toContain('対応中');
    expect(JSON.stringify(body.components)).toContain('https://discord.com/channels/' + cfg.guildId + '/990000000000000001');
    for (const id of ['cast:wait:2', 'cast:wait:4', 'cast:wait:0', 'cast:refresh', 'cast:schedule:0', 'cast:edit']) expect(JSON.stringify(body.components)).toContain(id);
  });

  it('長い名前や多い予約でもはみ出さず、運営の休止中は待機ボタンを押せない', async () => {
    for (let i = 0; i < 5; i++) await booking({ startAt: new Date(DAY.getTime() + i * 60_000) });
    await setCastStatus(db, CAST, 'paused', 'staff', NOW);
    const d = (await loadCastReception(db, CAST, NOW))!;
    const svg = receptionSvg({ reception: d, name: '桜'.repeat(200), names: new Map([[CUSTOMER, '花'.repeat(200)]]), currency: '銭' });
    expect(svg).toContain('ほか 1 件');
    expect(svg).toContain('予約一覧');
    expect(svg).not.toContain('桜'.repeat(14));
    const body = castReceptionBody(d, 'さくら', new Map(), '銭', cfg.guildId);
    expect(body.components[0]?.components.slice(0, 3).every((b) => 'disabled' in b && b.disabled)).toBe(true);
  });
});

describe('受付のアイコン', () => {
  it('Discordの画像を小さなPNGに整え、取得失敗や大きすぎる画像は文字に切り替える', async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#cc6688' } }).png().toBuffer();
    const fetcher = vi.spyOn(globalThis, 'fetch');
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array(png)));
    const avatar = await loadReceptionAvatar('https://cdn.discordapp.com/avatars/123/icon.png?size=128');
    expect(await sharp(avatar).metadata()).toMatchObject({ format: 'png', width: 180, height: 180 });
    fetcher.mockRejectedValueOnce(new Error('unavailable'));
    expect(await loadReceptionAvatar('https://cdn.discordapp.com/avatars/123/icon.png')).toBeUndefined();
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array(256 * 1024 + 1)));
    expect(await loadReceptionAvatar('https://cdn.discordapp.com/avatars/123/icon.png')).toBeUndefined();
  });

  it('Discord以外や認証情報つきのURLには接続しない', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const url of ['http://cdn.discordapp.com/x', 'https://cdn.discordapp.com.evil.example/x', 'https://example.com/x', 'https://user:pass@cdn.discordapp.com/x', 'https://cdn.discordapp.com:444/x']) expect(await loadReceptionAvatar(url)).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('本人向けDiscord受付', () => {
  function interaction(customId = 'cast:me', id = CAST) {
    return {
      customId, guildId: cfg.guildId, user: { id }, member: { id, displayName: 'さくら', displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/123/icon.png' },
      inCachedGuild: () => true, isStringSelectMenu: () => false, isUserSelectMenu: () => false, isModalSubmit: () => false, isButton: () => true, isRepliable: () => true,
      deferReply: vi.fn(async () => undefined), deferUpdate: vi.fn(async () => undefined), editReply: vi.fn(async (_payload: unknown) => undefined), followUp: vi.fn(async () => undefined),
    };
  }
  function app() {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('avatar unavailable'));
    return new CastApp(db, () => cfg, { sendMessage: vi.fn(), editMessage: vi.fn() } as unknown as DiscordActions);
  }

  it('最初は本人だけに表示し、更新と待機切り替えは同じ画像を差し替える', async () => {
    const a = app();
    const i = interaction();
    await a.onInteraction(i as unknown as Interaction);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(i.editReply).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.objectContaining({ name: 'cast-reception.png' })], attachments: [] }));
    const waiting = interaction('cast:wait:2');
    await a.onInteraction(waiting as unknown as Interaction);
    expect(waiting.deferUpdate).toHaveBeenCalledOnce();
    expect((await loadCastReception(db, CAST, NOW))?.state).toBe('waiting');
    const refresh = interaction('cast:refresh');
    await a.onInteraction(refresh as unknown as Interaction);
    expect(refresh.deferUpdate).toHaveBeenCalledOnce();
    expect(refresh.editReply).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.objectContaining({ name: 'cast-reception.png' })], attachments: [] }));
    const stop = interaction('cast:wait:0');
    await a.onInteraction(stop as unknown as Interaction);
    expect((await loadCastReception(db, CAST, NOW))?.state).toBe('off');
  });

  it('🎀 紹介パネルをみんなに見える形で出し、選んだ人にだけ確かめを返す（パネルは書き換えない）', async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#aa0000' } }).png().toBuffer();
    await saveCastPhoto(db, CAST, png);
    const send = vi.fn(async (_ch: string, _b: unknown) => ({ id: 'm1' }));
    expect(await postCastIntro(db, { sendMessage: send } as never, CAST, '990000000000000123', '🪙銭')).toBe(true);
    const [ch, body] = send.mock.calls[0] as unknown as [string, { content: string; files: { name: string }[]; components: { components: { custom_id: string }[] }[]; allowed_mentions: unknown }];
    expect(ch).toBe('990000000000000123');
    expect(body.content).toContain('メニュー');
    expect(body.files[0]?.name).toBe('cast-profile.png');
    expect(body.components.flatMap((r) => r.components.map((x) => x.custom_id))).toEqual([`cast:plansel:${CAST}`, `cast:rsv:${CAST}`]);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(await postCastIntro(db, { sendMessage: send } as never, CUSTOMER, '990000000000000123', '銭')).toBe(false);
    // みんなのパネルの選ぶ欄を押すと、押した人にだけ返事する
    const a = app();
    const plan = (await getCast(db, CAST))!;
    const first = menuOf(plan)[0]!;
    const i = { ...interaction(`cast:plansel:${CAST}`, CUSTOMER), values: [first.id], member: { id: CUSTOMER, roles: { cache: new Map() } }, isStringSelectMenu: () => true, isButton: () => false, message: { flags: { has: () => false } }, update: vi.fn(), reply: vi.fn(async () => undefined) };
    await a.onInteraction(i as unknown as Interaction);
    expect(i.update).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, content: expect.stringContaining('指名しますか') }));
  });

  it('紹介カードには選んだキャストの写真を添付する', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#00aa00' } }).png().toBuffer();
    await saveCastPhoto(db, CAST, png);
    const a = app();
    const i = { ...interaction('cast:pick', CUSTOMER), values: [CAST], member: { id: CUSTOMER, roles: { cache: new Map() } }, isStringSelectMenu: () => true };
    await a.onInteraction(i as unknown as Interaction);
    const body = i.editReply.mock.calls[0]?.[0] as { content: string; embeds: unknown[]; files: { attachment: Buffer }[] };
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    // カードにせず、文と写真の全体をそのまま出す
    expect(body.embeds).toEqual([]);
    expect(body.content).toContain('メニュー');
    expect(Buffer.from(body.files[0]!.attachment)).toEqual(Buffer.from((await loadCastPhoto(db, CAST))!.data));
  });

  it('本人の写真を受付に使い、Discordのアイコンを取りにいかない', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#00aa00' } }).png().toBuffer();
    await saveCastPhoto(db, CAST, png);
    const a = app(), i = interaction();
    await a.onInteraction(i as unknown as Interaction);
    expect(fetch).not.toHaveBeenCalled();
    expect(i.editReply).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.objectContaining({ name: 'cast-reception.png' })] }));
  });

  it('キャストでない人には予約・売上や画像を見せない', async () => {
    const a = app(), i = interaction('cast:me', CUSTOMER);
    await a.onInteraction(i as unknown as Interaction);
    expect(i.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('キャストの方だけ'), embeds: [], attachments: [] }));
    expect(i.editReply.mock.calls[0]?.[0]).not.toHaveProperty('files');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('予約一覧は本人の分を10件ずつ見せ、戻ると画像を作り直す', async () => {
    for (let j = 0; j < 11; j++) await booking({ startAt: new Date(DAY.getTime() + j * 60_000) });
    await booking({ castId: OTHER, customerId: '999999999999999999' });
    const a = app(), i = interaction('cast:schedule:1');
    await a.onInteraction(i as unknown as Interaction);
    const body = i.editReply.mock.calls[0]?.[0] as unknown as { embeds: { title: string; description: string }[] };
    expect(body.embeds[0]?.title).toContain('2/2');
    expect(body.embeds[0]?.description.split('\n')).toHaveLength(1);
    expect(body.embeds[0]?.description).toContain('00:10');
    expect(body.embeds[0]?.description).not.toContain('999999999999999999');
    const back = interaction('cast:refresh');
    await a.onInteraction(back as unknown as Interaction);
    expect(back.editReply).toHaveBeenCalledWith(expect.objectContaining({ attachments: [], files: [expect.objectContaining({ name: 'cast-reception.png' })] }));
  });
});

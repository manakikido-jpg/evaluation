import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type Interaction } from 'discord.js';
import sharp from 'sharp';
import type { Db } from '../src/db/client.js';
import { castSessions } from '../src/db/schema.js';
import { CastApp, castReceptionBody, castMenuText, postCastIntro, refreshCastIntros } from '../src/discord/cast.js';
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
    // 承認されたキャストは、はじめから予約受付中
    expect(d.state).toBe('waiting');
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
    await setWaiting(db, CAST, 1, NOW);
    // 受付中は時間で切れない
    expect((await loadCastReception(db, CAST, new Date(NOW.getTime() + 120 * 60_000)))?.state).toBe('waiting');
    await setWaiting(db, CAST, 0, NOW);
    expect((await loadCastReception(db, CAST, NOW))?.state).toBe('off');
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
    // /キャスト と「⚙ キャストの方」から、キャスト用 社務所（メニュー・写真の編集）へ行ける
    expect(JSON.stringify(castReceptionBody(reception, 'さくら', new Map(), '銭', cfg.guildId, undefined, 'https://example.test/cast-office/login').components)).toContain('https://example.test/cast-office/login');
    for (const id of ['cast:wait:1', 'cast:wait:0', 'cast:refresh', 'cast:schedule:0', 'cast:edit']) expect(JSON.stringify(body.components)).toContain(id);
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
    expect(body.components[0]?.components.slice(0, 2).every((b) => 'disabled' in b && b.disabled)).toBe(true);
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
    const [ch, body] = send.mock.calls[0] as unknown as [string, { flags: number; files: { name: string }[]; components: { type: number; content?: string; components?: { custom_id: string }[] }[]; allowed_mentions: unknown }];
    expect(ch).toBe('990000000000000123');
    expect(body.flags).toBe(MessageFlags.IsComponentsV2);
    expect(body.components.slice(0, 4).map((c) => c.type)).toEqual([14, 10, 12, 10]);
    expect(body.components.at(-1)?.type).toBe(14);
    expect(body.components.some(c => c.type === 17)).toBe(false);
    expect(body.components[1]?.content).not.toContain('🎀');
    expect(body.files[0]?.name).toBe('cast-profile.png');
    expect(body.components.flatMap((r) => (r.components ?? []).map((x) => x.custom_id))).toEqual([`cast:plansel:${CAST}`, `cast:rsv:${CAST}`]);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(await postCastIntro(db, { sendMessage: send } as never, CUSTOMER, '990000000000000123', '銭')).toBe(false);
    // みんなのパネルの選ぶ欄を押すと、押した人にだけ返事する
    const a = app();
    const plan = (await getCast(db, CAST))!;
    const first = menuOf(plan)[0]!;
    const i = { ...interaction(`cast:plansel:${CAST}`, CUSTOMER), values: [first.id], member: { id: CUSTOMER, roles: { cache: new Map() } }, isStringSelectMenu: () => true, isButton: () => false, message: { flags: { has: () => false } }, update: vi.fn(), reply: vi.fn(async () => undefined) };
    await a.onInteraction(i as unknown as Interaction);
    expect(i.update).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, content: expect.stringContaining('予約しますか') }));
    // オプションがあれば、確かめの画面で選べて、指名のボタンに入る
    const { addOption: addOpt } = await import('../src/services/cast.js');
    await addOpt(db, CAST_DEFAULTS, CAST, { name: 'カメラあり', price: 100 });
    const opt = (await getCast(db, CAST))!.options[0]!;
    const j = { ...interaction(`cast:opts:${CAST}:${first.id}`, CUSTOMER), values: [opt.id], member: { id: CUSTOMER, roles: { cache: new Map() } }, isStringSelectMenu: () => true, isButton: () => false, message: { flags: { has: () => true } }, update: vi.fn(async () => undefined), reply: vi.fn() };
    await a.onInteraction(j as unknown as Interaction);
    const shown = JSON.stringify(j.update.mock.calls[0]);
    expect(shown).toContain('カメラあり');
    expect(shown).toContain(`cast:rplan:${CAST}:${first.id}:${opt.id}`);
    expect(shown).toContain(`予約する（${(first.price + 100).toLocaleString('ja-JP')} 枚）`);
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
    expect(body.content).toContain('銭**');
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


describe('紹介の料金表示', () => {
  it('サービスごとに時間と料金をまとめ、相談の重複を出さない', () => {
    const item = { id: 'a', name: 'ツーショット', note: '', minutes: 30, price: 200, night: false };
    const text = castMenuText([item, { ...item, id: 'b', minutes: 60, price: 350 }, { ...item, id: 'c', name: 'おねがい', price: 0, consult: true }]);
    expect(text).toBe('**ツーショット**\n30分 **200銭** ／ 1時間 **350銭**\n\n**おねがい**\n内容・料金は相談');
    expect(castMenuText([])).toBe('メニューなし');
    expect(castMenuText([item, { ...item, id: 'd', note: '別の内容' }]).match(/\*\*ツーショット\*\*/g)).toHaveLength(2);
  });
});

 describe('紹介投稿の自動更新', () => {
  const CH = '990000000000000123', CH2 = '990000000000000124';
  function sender() { return { sendMessage: vi.fn(async (_ch: string, _body: unknown) => ({ id: 'intro1' })), editMessage: vi.fn(async (_ch: string, _id: string, _body: unknown) => undefined) }; }
  it('投稿の連打でも同じチャンネルに1つだけ。人とチャンネルを区別して記録する', async () => {
    const d = sender();
    await Promise.all([postCastIntro(db, d, CAST, CH, '銭'), postCastIntro(db, d, CAST, CH, '銭')]);
    expect(d.sendMessage).toHaveBeenCalledOnce();
    expect(d.editMessage).toHaveBeenCalledOnce();
    const { castIntroPosts } = await import('../src/services/castIntroPosts.js');
    expect(await castIntroPosts(db, CAST)).toMatchObject([{ channelId: CH, messageId: 'intro1' }]);
    await postCastIntro(db, d, CAST, CH2, '銭');
    await postCastIntro(db, d, OTHER, CH, '銭');
    expect(await castIntroPosts(db)).toHaveLength(3);
  });
  it('写真・オプションを更新し、変更がないときは書き換えない。写真を外すと古い添付も外す', async () => {
    const d = sender();
    await postCastIntro(db, d, CAST, CH, '銭');
    await refreshCastIntros(db, d, CAST);
    expect(d.editMessage).not.toHaveBeenCalled();
    const png = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#00aa00' } }).png().toBuffer();
    await saveCastPhoto(db, CAST, png);
    const { addOption } = await import('../src/services/cast.js');
    await addOption(db, CAST_DEFAULTS, CAST, { name: 'カメラ', price: 100 });
    expect(await refreshCastIntros(db, d, CAST)).toBe(true);
    const body = d.editMessage.mock.calls[0]?.[2] as { content: null; embeds: unknown[]; attachments: unknown[]; components: { type: number; content?: string }[]; files?: unknown[] };
    expect(body).toMatchObject({ content: null, embeds: [], attachments: [] });
    expect(body.files).toHaveLength(1);
    expect(body.components.some(c => c.type === 12)).toBe(true);
    expect(JSON.stringify(body.components)).toContain('カメラ');
    await refreshCastIntros(db, d, CAST);
    expect(d.editMessage).toHaveBeenCalledOnce();
    await deleteCastPhoto(db, CAST);
    await refreshCastIntros(db, d, CAST);
    const cleared = d.editMessage.mock.calls[1]?.[2] as typeof body;
    expect(cleared.files).toBeUndefined();
    expect(cleared.attachments).toEqual([]);
    expect(cleared.components.some(c => c.type === 12 || c.type === 17)).toBe(false);
    expect(d.sendMessage).toHaveBeenCalledOnce();
  });
  it('更新失敗は保存した変更を残して再試行し、削除された投稿を勝手に再投稿しない', async () => {
    const d = sender();
    await postCastIntro(db, d, CAST, CH, '銭');
    await setCastStatus(db, CAST, 'paused', 'staff');
    d.editMessage.mockRejectedValueOnce(new Error('通信失敗'));
    expect(await refreshCastIntros(db, d, CAST)).toBe(false);
    expect(await refreshCastIntros(db, d, CAST)).toBe(true);
    const { DiscordHttpError } = await import('../src/lib/discordRest.js');
    await setCastStatus(db, CAST, 'active', 'staff');
    d.editMessage.mockRejectedValueOnce(new DiscordHttpError('削除済み', 404));
    await refreshCastIntros(db, d, CAST);
    const { castIntroPosts } = await import('../src/services/castIntroPosts.js');
    expect(await castIntroPosts(db, CAST)).toHaveLength(0);
    await refreshCastIntros(db, d, CAST);
    expect(d.sendMessage).toHaveBeenCalledOnce();
    await postCastIntro(db, d, CAST, CH, '銭');
    expect(d.sendMessage).toHaveBeenCalledTimes(2);
  });
  it('休止すると操作ボタンを外し、再開すると同じ投稿に戻す', async () => {
    const d = sender();
    await postCastIntro(db, d, CAST, CH, '銭');
    await setCastStatus(db, CAST, 'paused', 'staff');
    await refreshCastIntros(db, d, CAST);
    expect(JSON.stringify(d.editMessage.mock.calls[0]?.[2])).toContain('受付を停止');
    expect(JSON.stringify(d.editMessage.mock.calls[0]?.[2])).not.toContain(`cast:plansel:${CAST}`);
    await setCastStatus(db, CAST, 'active', 'staff');
    await refreshCastIntros(db, d, CAST);
    expect(JSON.stringify(d.editMessage.mock.calls[1]?.[2])).toContain(`cast:plansel:${CAST}`);
    expect(d.sendMessage).toHaveBeenCalledOnce();
  });
  it('紹介の取得が待たされても、予約と通話の定期処理は動く', async () => {
    const { saveCastConfig, loadCastConfig } = await import('../src/services/cast.js');
    await saveCastConfig(db, { ...(await loadCastConfig(db)), channelId: CH }, 'staff');
    let release!: (value: null) => void;
    const pending = new Promise<null>(resolve => { release = resolve; });
    const a = new CastApp(db, () => cfg, sender() as never);
    a.attach({ id: cfg.guildId, channels: { cache: new Map(), fetch: () => pending } } as never);
    const sync = a.syncIntros();
    await a.tick(NOW);
    release(null);
    await sync;
  });

  it('従来の自分のBOTの紹介だけを引き継ぎ、ほかのBOTや別の操作欄は使わない', async () => {
    const { saveCastConfig, loadCastConfig } = await import('../src/services/cast.js');
    const { castIntroPosts, castIntroId } = await import('../src/services/castIntroPosts.js');
    await saveCastConfig(db, { ...(await loadCastConfig(db)), channelId: CH }, 'staff');
    const rows = [{ type: 1, components: [{ type: 3, custom_id: `cast:plansel:${CAST}` }] }];
    expect(castIntroId([{ type: 1, components: [{ type: 3, custom_id: 'cast:pick' }] }])).toBeUndefined();
    const messages = new Map([
      ['foreign', { id: 'foreign', author: { id: 'other-bot' }, components: rows.map(r => ({ toJSON: () => r })) }],
      ['old', { id: 'old', author: { id: 'self' }, components: rows.map(r => ({ toJSON: () => r })) }],
    ]);
    const fetch = vi.fn(async () => messages);
    const guild = { id: cfg.guildId, client: { user: { id: 'self' } }, channels: { cache: new Map(), fetch: async () => ({ isTextBased: () => true, messages: { fetch } }) } };
    const d = sender();
    const a = new CastApp(db, () => cfg, d as never);
    a.attach(guild as never);
    await a.syncIntros();
    expect((await castIntroPosts(db, CAST))[0]?.messageId).toBe('old');
    expect(d.editMessage).toHaveBeenCalledWith(CH, 'old', expect.objectContaining({ flags: MessageFlags.IsComponentsV2, content: null, embeds: [] }));
    await a.syncIntros();
    expect(fetch).toHaveBeenCalledOnce();
    expect(d.sendMessage).not.toHaveBeenCalled();
  });
 });

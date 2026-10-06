import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { omikujiEmbed, omikujiVoiceBlock, REVEAL_MS, revealOmikuji } from '../src/discord/omikuji.js';
import { saveOmikujiArt } from '../src/services/omikujiArt.js';
import { walletOf } from '../src/services/economy.js';
import { omikujiTextsSchema } from '../src/config.js';
import { DEFAULT_ITEMS, DEFAULT_MESSAGES } from '../src/omikujiTexts.js';
import { describeStreakRewards, drawFortune, drawOmikuji, FORTUNES, fortuneOf, nextStreakReward, omikujiRange, omikujiReward, omikujiSayings, streakOf } from '../src/services/omikuji.js';
import { kanjiNumber, renderSlip, wareki, wrapColumns } from '../src/services/omikujiSlip.js';
import { ticketsOf } from '../src/services/tickets.js';
import { cfg, makeDb } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

/** 決まった順に数を返す（くじの結果を決めるため） */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};

describe('おみくじ', () => {
  it('出やすさは合計 100。乱数の位置で運勢が決まる', () => {
    expect(FORTUNES.reduce((n, f) => n + f.weight, 0)).toBe(100);
    expect(drawFortune(() => 0).name).toBe('大吉');
    expect(drawFortune(() => 0.079).name).toBe('大吉');
    expect(drawFortune(() => 0.08).name).toBe('中吉');
    expect(drawFortune(() => 0.999).name).toBe('大凶');
  });

  it('🎴 運営吉: 決めた確率で出て、その中から 1 つ。止めている・名前がないと出ない', () => {
    const special = { enabled: true, percent: 1, mult: 5, list: [{ name: '小林吉', message: '' }, { name: 'ais吉', message: 'やあ' }] };
    expect(drawFortune(seq(0.0099, 0), special).name).toBe('小林吉');
    const ais = drawFortune(seq(0.005, 0.9), special);
    expect(ais).toMatchObject({ key: 'unei2', name: 'ais吉', mult: 5, message: 'やあ' });
    expect(omikujiReward({ omikujiBase: 10 }, ais)).toBe(50);
    // 1% を超えたら、ふつうの運勢（そこで引き直す）
    expect(drawFortune(seq(0.01, 0), special).name).toBe('大吉');
    expect(drawFortune(seq(0, 0), { ...special, enabled: false }).name).toBe('大吉');
    expect(drawFortune(seq(0, 0), { ...special, list: [] }).name).toBe('大吉');
    expect(fortuneOf('unei1', special)?.name).toBe('小林吉');
    expect(fortuneOf('unei3', special)?.name).toBe('運営吉');
    expect(fortuneOf('kichi')?.name).toBe('吉');
  });

  it('🎴 運営吉を引いた記録: 同じ日にもう一度引くと、その運営吉が出る', async () => {
    const special = { ...cfg.omikujiSpecial, enabled: true, percent: 100, mult: 5, list: [{ name: '小林吉', message: '' }] };
    const economy = { ...cfg.economy, omikujiBase: 10 };
    const now = new Date('2026-09-26T03:00:00Z');
    const r = await drawOmikuji(db, economy, 'A', now, seq(0, 0, 0.5), { special });
    expect(r.status).toBe('drawn');
    if (r.status !== 'drawn') return;
    expect(r.fortune.key).toBe('unei1');
    expect(r.amount).toBe(50);
    expect(omikujiEmbed(r, 'A', economy).title).toBe('🎴 御神籤 ― 小林吉');
    const again = await drawOmikuji(db, economy, 'A', now, seq(0.9), { special });
    expect(again.status === 'already' && again.fortune.name).toBe('小林吉');
  });

  it('花びら: 基本 10 なら 吉 10・大吉 30・凶 5。基本 0 ならなし', () => {
    const f = (name: string) => FORTUNES.find((x) => x.name === name)!;
    expect(omikujiReward({ omikujiBase: 10 }, f('吉'))).toBe(10);
    expect(omikujiReward({ omikujiBase: 10 }, f('大吉'))).toBe(30);
    expect(omikujiReward({ omikujiBase: 10 }, f('小吉'))).toBe(15);
    expect(omikujiReward({ omikujiBase: 10 }, f('凶'))).toBe(5);
    expect(omikujiReward({ omikujiBase: 1 }, f('凶'))).toBe(1);
    expect(omikujiReward({ omikujiBase: 0 }, f('大吉'))).toBe(0);
    expect(omikujiRange({ omikujiBase: 10 })).toBe('5〜30');
  });

  it('1 日 1 回（日本時間の 0 時に引き直せる）。花びらが増える', async () => {
    const economy = { ...cfg.economy, omikujiBase: 10 };
    const r1 = await drawOmikuji(db, economy, 'A', new Date('2026-09-26T14:00:00Z'), seq(0, 0.5)); // 日本時間 23:00
    expect(r1.status).toBe('drawn');
    if (r1.status !== 'drawn') return;
    expect(r1.fortune.name).toBe('大吉');
    expect(r1.amount).toBe(30);
    expect(r1.balance).toBe(30);
    expect(r1.sayings).toHaveLength(4);

    const again = await drawOmikuji(db, economy, 'A', new Date('2026-09-26T14:59:00Z'), seq(0.999));
    expect(again).toEqual({ status: 'already', fortune: r1.fortune, streak: 1 });

    const next = await drawOmikuji(db, economy, 'A', new Date('2026-09-26T15:00:00Z'), seq(0.5)); // 日本時間 0:00
    expect(next.status).toBe('drawn');
    expect((await walletOf(db, 'A')).balance).toBe(30 + 10);
  });

  it('同時に何回押しても 1 回だけ', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, () => drawOmikuji(db, cfg.economy, 'A', new Date('2026-09-26T00:00:00Z'))));
    expect(rs.filter((r) => r.status === 'drawn')).toHaveLength(1);
  });

  it('連続日数: 1 日も空けずに引いた日数（今日まだなら昨日まで）', () => {
    expect(streakOf([], '2026-10-01')).toBe(0);
    expect(streakOf(['2026-10-01', '2026-09-30', '2026-09-29', '2026-09-27'], '2026-10-01')).toBe(3);
    expect(streakOf(['2026-09-30', '2026-09-29'], '2026-10-01')).toBe(2);
    expect(streakOf(['2026-09-29'], '2026-10-01')).toBe(0);
    // 月・年をまたぐ
    expect(streakOf(['2027-01-01', '2026-12-31', '2026-12-30'], '2027-01-01')).toBe(3);
    const sc = { rewards: [{ days: 7, repeat: true, coins: 50, ticket: 'gacha_free' as const, tickets: 1 }, { days: 30, repeat: false, coins: 300, ticket: 'none' as const, tickets: 0 }] };
    expect(nextStreakReward(sc, 6)).toMatchObject({ left: 1, reward: { days: 7 } });
    expect(nextStreakReward(sc, 29)).toMatchObject({ left: 1, reward: { days: 30 } });
    expect(nextStreakReward(sc, 30)).toMatchObject({ left: 5, reward: { days: 7 } });
    expect(describeStreakRewards(sc, cfg.economy)).toBe('7 日ごとに 🪙銭 50・🎁物御籤の無料券 ×1／30 日目に 🪙銭 300');
    expect(describeStreakRewards({ rewards: [] }, cfg.economy)).toBe('なし');
  });

  it('続けた日のおまけ（7 日ごと・30 日目だけ）。1 日空けると 1 日目から。もう 1 回の分は数えない', async () => {
    const economy = { ...cfg.economy, omikujiBase: 10 };
    const streak = { rewards: [{ days: 3, repeat: true, coins: 50, ticket: 'gacha_free' as const, tickets: 1 }, { days: 6, repeat: false, coins: 0, ticket: 'none' as const, tickets: 0, roleId: '980000000000000060' }] };
    // 日本時間の正午
    const day = (d: number) => new Date(Date.UTC(2026, 9, d, 3));
    const got: { streak: number; bonus: number[] }[] = [];
    for (const d of [1, 2, 3, 4, 5, 6, 8, 9]) {
      const r = await drawOmikuji(db, economy, 'A', day(d), seq(0.5), { streak });
      if (r.status !== 'drawn') throw new Error('not drawn');
      got.push({ streak: r.streak, bonus: r.bonus.map((b) => b.days) });
      if (d === 3) {
        const extra = await drawOmikuji(db, economy, 'A', day(d), seq(0.5), { extra: true, streak });
        expect(extra).toMatchObject({ status: 'drawn', streak: 0, bonus: [] });
      }
    }
    expect(got).toEqual([
      { streak: 1, bonus: [] },
      { streak: 2, bonus: [] },
      { streak: 3, bonus: [3] },
      { streak: 4, bonus: [] },
      { streak: 5, bonus: [] },
      { streak: 6, bonus: [3, 6] },
      { streak: 1, bonus: [] },
      { streak: 2, bonus: [] },
    ]);
    expect((await ticketsOf(db, 'A')).gacha_free).toBe(2);
    // 9 回（もう 1 回も入れて）× 10 ＋ おまけ 50 × 2
    expect((await walletOf(db, 'A')).balance).toBe(9 * 10 + 100);
    expect(await drawOmikuji(db, economy, 'A', day(9), seq(0.5), { streak })).toMatchObject({ status: 'already', streak: 2 });
    // カード
    const sc = { rewards: [{ days: 7, repeat: true, coins: 50, ticket: 'gacha_free' as const, tickets: 1, roleId: '980000000000000060' }] };
    const r = await drawOmikuji(db, economy, 'B', day(1), seq(0.5), { streak: sc });
    if (r.status !== 'drawn') throw new Error('not drawn');
    const e = omikujiEmbed({ ...r, streak: 7, bonus: sc.rewards }, 'さくら', economy, sc);
    expect(e.description).toContain('🔥 連続 **7** 日目 ・ あと 7 日で 7 日のおまけ');
    expect(e.description).toContain('🎁 **7 日続いたおまけ**: 🪙銭 50・🎁物御籤の無料券 ×1・<@&980000000000000060>');
  });

  it('通話に入っているときだけ引ける（AFK・数えない通話は入っていないのと同じ。設定で切れる）', () => {
    const economy = { ...cfg.economy, omikujiVoiceOnly: true, excludedVoiceChannelIds: ['900000000000000003'] };
    const m = (channelId: string | null) => ({ voice: { channelId }, guild: { afkChannelId: '900000000000000002' } }) as never;
    expect(cfg.economy.omikujiVoiceOnly).toBe(true);
    expect(omikujiVoiceBlock(economy, m('900000000000000001'))).toBeUndefined();
    expect(omikujiVoiceBlock(economy, m(null))).toContain('通話に入っているときだけ');
    expect(omikujiVoiceBlock(economy, m('900000000000000002'))).toBeDefined();
    expect(omikujiVoiceBlock(economy, m('900000000000000003'))).toBeDefined();
    expect(omikujiVoiceBlock({ ...economy, omikujiVoiceOnly: false }, m(null))).toBeUndefined();
  });

  it('カード: 運勢・一言・もらった花びら', async () => {
    const r = await drawOmikuji(db, cfg.economy, 'A', new Date('2026-09-26T00:00:00Z'), seq(0, 0));
    if (r.status !== 'drawn') throw new Error('not drawn');
    const e = omikujiEmbed(r, 'さくら', cfg.economy);
    expect(e.title).toBe('⛩ おみくじ ― 大吉');
    expect(e.description).toContain('**さくら** さんの運勢');
    expect(e.description).toContain('📞 待ち人 … 来る。音信あり');
    expect(e.description).toContain('🪙銭 **+30**（いま 30 枚）');
  });

  it('一言: 同じ人には、その運勢の文を出し切るまで同じ文を出さない（第〇番つき）', async () => {
    const pool = DEFAULT_MESSAGES.daikichi;
    const seen: string[] = [];
    for (let d = 0; d < pool.length + 1; d++) {
      const r = await drawOmikuji(db, cfg.economy, 'A', new Date(Date.UTC(2026, 9, 1 + d, 3)), () => 0);
      if (r.status !== 'drawn') throw new Error('not drawn');
      expect(r.fortune.key).toBe('daikichi');
      expect(r.number).toBe(pool.indexOf(r.message) + 1);
      seen.push(r.message);
    }
    // はじめの 8 回は全部ちがう。9 回目は、すぐ前とはちがう
    expect(new Set(seen.slice(0, pool.length)).size).toBe(pool.length);
    expect(seen[pool.length]).not.toBe(seen[pool.length - 1]);
    // ほかの人は関係ない
    const b = await drawOmikuji(db, cfg.economy, 'B', new Date(Date.UTC(2026, 9, 1, 3)), () => 0);
    expect(b.status === 'drawn' && b.message).toBe(pool[0]);
  });

  it('項目: 運勢の向きに合わせる（凶はよくない日の文）。毎日出す項目＋日替わり 1 つ＋ラッキー場所', () => {
    const texts = omikujiTextsSchema.parse({});
    const kyo = omikujiSayings(texts, 'kyo', () => 0.99);
    const fixed = DEFAULT_ITEMS.filter((it) => it.fixed);
    expect(kyo.map((x) => x.label)).toEqual([...fixed.map((x) => x.label), DEFAULT_ITEMS.filter((it) => !it.fixed).at(-1)!.label, 'ラッキー場所']);
    for (const x of kyo.slice(0, -1)) expect(DEFAULT_ITEMS.find((it) => it.label === x.label)!.bad).toContain(x.text);
    // 運営吉はいい日
    const unei = omikujiSayings(texts, 'unei1', () => 0);
    expect(unei[0]!.text).toBe(DEFAULT_ITEMS[0]!.good[0]);
    // 文が空の項目は出さない・ラッキー場所が空なら出さない
    const few = omikujiSayings({ ...texts, items: [{ ...texts.items[0]!, bad: [] }], places: [] }, 'daikyo', () => 0);
    expect(few).toEqual([]);
  });

  it('おみくじの紙: 縦書きの折り返し（句読点は前の列にぶら下げる）・漢数字・和暦・PNG', () => {
    expect(wrapColumns('あいうえお。かきく', 5)).toEqual([[...'あいうえお。'], [...'かきく']]);
    expect(wrapColumns('あいうえおかきく', 3, 2).map((c) => c.join(''))).toEqual(['あい', 'うえお', 'かきく']);
    expect([1, 10, 17, 20, 31, 100, 105].map(kanjiNumber)).toEqual(['一', '十', '十七', '二十', '三十一', '百', '百五']);
    expect(wareki(new Date('2026-10-05T15:30:00Z'))).toBe('令和八年十月六日');
    const png = renderSlip({ name: '大吉', color: '#b8860b', message: '今日のあなたは無敵。', items: [{ label: '願い事', text: '叶う' }], shrine: '咲楽ノ宮', number: 3, date: new Date('2026-10-06T00:00:00Z'), tone: 'good' });
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.byteLength).toBeGreaterThan(10_000);
  });

  it('演出: ふつうは「ガラガラ…」→ 紙。運営吉は 光る → 絵 → 絵と紙。紙を出さない設定なら文字だけ', async () => {
    Object.assign(REVEAL_MS, { shake: 0, glow: 0, art: 0 });
    const special = { ...cfg.omikujiSpecial, enabled: true, percent: 100, mult: 3, list: [{ name: '小林吉', message: '', color: '#1f4fbf' }] };
    const conf = { ...cfg, omikujiSpecial: special };
    const steps: { title?: string; files: string[]; content?: string }[] = [];
    const record = (p: { content?: string; embeds: { title?: string }[]; files?: { name: string | null }[] }) =>
      steps.push({ title: p.embeds.at(-1)?.title, files: (p.files ?? []).map((f) => f.name ?? ''), ...(p.content ? { content: p.content } : {}) });
    const send = async (p: Parameters<typeof record>[0]) => {
      record(p);
      return { edit: async (q: Parameters<typeof record>[0]) => void record(q) };
    };
    const r = await drawOmikuji(db, cfg.economy, 'A', new Date('2026-10-06T03:00:00Z'), () => 0, { special });
    if (r.status !== 'drawn') throw new Error('not drawn');
    expect(r.fortune.color).toBe(0x1f4fbf);
    // 絵がないときは、光ったあとすぐ紙
    await revealOmikuji(db, conf, r, 'さくら', send);
    // 紙だけ（文字のカードなし）
    expect(steps.map((x) => x.title)).toEqual(['⛩ おみくじ', '⛩ おみくじ', undefined]);
    expect(steps.at(-1)).toEqual({ title: undefined, files: ['omikuji.png'] });
    steps.length = 0;
    const png = (await import('../src/services/omikujiSlip.js')).renderSlip({ name: '吉', color: '#e0607e', message: 'a', items: [], shrine: '', date: new Date() });
    await saveOmikujiArt(db, 1, png);
    await revealOmikuji(db, conf, r, 'さくら', send, { suffix: '（もう 1 回）' });
    // 絵だけ（写真だけ）→ 絵と紙の 2 枚（横に並ぶ）
    expect(steps.map((x) => x.title)).toEqual(['⛩ おみくじ（もう 1 回）', '⛩ おみくじ（もう 1 回）', undefined, undefined]);
    expect(steps[2]!.files).toEqual(['unei1.png']);
    // 絵のあとに紙（どちらもカードの絵）。「もう 1 回」はだれが引いたかを 1 行
    expect(steps.at(-1)).toEqual({ title: undefined, files: ['omikuji.png'], content: '-# ⛩ **さくら** さんのおみくじ（もう 1 回）' });
    // ふつうの運勢・演出なし・紙なし
    steps.length = 0;
    const n = await drawOmikuji(db, cfg.economy, 'B', new Date('2026-10-06T03:00:00Z'), () => 0);
    if (n.status !== 'drawn') throw new Error('not drawn');
    await revealOmikuji(db, { ...cfg, omikujiTexts: { ...cfg.omikujiTexts, shake: false, slip: false } }, n, 'もみじ', send);
    expect(steps).toEqual([{ title: '⛩ おみくじ ― 大吉', files: [] }]);
  });

  it('紙のいちばん下: もらった銭と連続日数（次のおまけまで）。おまけの日は文字でも出す', async () => {
    const { slipFoot } = await import('../src/discord/omikuji.js');
    const sc = { rewards: [{ days: 7, repeat: true, coins: 50, ticket: 'none' as const, tickets: 0 }] };
    const r = await drawOmikuji(db, cfg.economy, 'A', new Date('2026-10-06T03:00:00Z'), () => 0, { streak: sc });
    if (r.status !== 'drawn') throw new Error('not drawn');
    expect(slipFoot(r, cfg.economy, sc)).toEqual([`${cfg.economy.currencyName} +30（いま 30 枚）`, '連続 1 日目・あと 6 日でおまけ']);
    expect(slipFoot({ ...r, amount: 0, streak: 0 }, cfg.economy)).toEqual([]);
    const { omikujiMessage } = await import('../src/discord/omikuji.js');
    const m = await omikujiMessage(db, { ...cfg, omikujiStreak: sc }, { ...r, streak: 7, bonus: sc.rewards }, 'さくら', { streak: true });
    expect(m.embeds).toEqual([]);
    expect(m.content).toBe(`🎁 **7 日続いたおまけ**: ${cfg.economy.currencyEmoji}${cfg.economy.currencyName} 50`);
  });

  it('台紙: 無地のところを探して、その中に字を書く（飾りのふちは避ける）', async () => {
    const { Resvg } = await import('@resvg/resvg-js');
    const { plainBox } = await import('../src/services/omikujiSlip.js');
    // 884×1792・まわりに濃い飾り・真ん中（215〜670 × 195〜1665）がうすいグラデーションの無地
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="884" height="1792"><defs><radialGradient id="g"><stop offset="0" stop-color="#fdf0f2"/><stop offset="1" stop-color="#f6c9d1"/></radialGradient></defs><rect width="884" height="1792" fill="#8e0d1c"/>${[250, 500, 750, 1000, 1250].map((y) => `<rect x="160" y="${y}" width="44" height="120" fill="#d01c2c"/><rect x="680" y="${y}" width="44" height="120" fill="#d01c2c"/>`).join('')}<rect x="215" y="195" width="455" height="1470" fill="url(#g)"/></svg>`;
    const bg = { contentType: 'image/png', data: new Resvg(svg).render().asPng() };
    const box = plainBox(bg)!;
    // 600 幅にすると 0.679 倍・上下が 8 ずつ切れる。無地は x 146〜455・y 124〜1122（内側に 12 あける）
    expect(box.x).toBeGreaterThanOrEqual(150);
    expect(box.x + box.w).toBeLessThanOrEqual(452);
    expect(box.y).toBeGreaterThanOrEqual(128);
    expect(box.y + box.h).toBeLessThanOrEqual(1118);
    expect(box.w).toBeGreaterThan(260);
    // ほぼ全面が無地なら、ふつうの紙の大きさ
    const plain = { contentType: 'image/png', data: new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"><rect width="600" height="1200" fill="#fff8ee"/></svg>').render().asPng() };
    expect(plainBox(plain)).toBeUndefined();
  });

  it('🧪 運営吉を試しに出す: 運営のチャンネルに 光る → 絵 → 絵と紙。くじは引かない・銭は動かない', async () => {
    const { trialUnei, TRIAL_MS } = await import('../src/services/omikujiTrial.js');
    Object.assign(TRIAL_MS, { shake: 0, glow: 0, art: 0 });
    const calls: { kind: string; channel: string; title?: string; files: string[]; content?: string }[] = [];
    const discord = {
      sendMessage: async (channel: string, b: { content?: string; embeds?: { title?: string }[]; files?: { name: string }[] }) => {
        calls.push({ kind: 'send', channel, title: b.embeds?.at(-1)?.title, files: (b.files ?? []).map((f) => f.name), content: b.content });
        return { id: 'm1' };
      },
      editMessage: async (channel: string, _m: string, b: { content?: string; embeds?: { title?: string }[]; files?: { name: string }[] }) => {
        calls.push({ kind: 'edit', channel, title: b.embeds?.at(-1)?.title, files: (b.files ?? []).map((f) => f.name) });
      },
    };
    const conf = { ...cfg, bell: { ...cfg.bell, channelId: '900000000000000099' }, omikujiSpecial: { ...cfg.omikujiSpecial, enabled: false, percent: 1, mult: 3, list: [{ name: '小林吉', message: '', color: '#1f4fbf' }] } };
    expect(await trialUnei(db, discord as never, conf, 2, 'A')).toEqual({ ok: false, reason: 'no_slot' });
    expect(await trialUnei(db, discord as never, { ...conf, bell: { ...conf.bell, channelId: undefined }, channels: { ...conf.channels, log: undefined } }, 1, 'A')).toEqual({ ok: false, reason: 'no_channel' });
    // 出す設定が OFF でも試せる。絵がなければ 光る → 紙
    const r1 = await trialUnei(db, discord as never, conf, 1, 'A');
    if (!r1.ok) throw new Error('not ok');
    await r1.done;
    expect(calls.map((x) => [x.kind, x.title, x.files.join(',')])).toEqual([
      ['send', '⛩ おみくじ', ''],
      ['edit', '⛩ おみくじ', ''],
      ['edit', undefined, 'omikuji.png'],
    ]);
    expect(calls[0]!.channel).toBe('900000000000000099');
    expect(calls[0]!.content).toContain('試し');
    calls.length = 0;
    const png = (await import('../src/services/omikujiSlip.js')).renderSlip({ name: '吉', color: '#e0607e', message: 'a', items: [], shrine: '', date: new Date() });
    await saveOmikujiArt(db, 1, png);
    const r2 = await trialUnei(db, discord as never, conf, 1, 'A');
    if (!r2.ok) throw new Error('not ok');
    await r2.done;
    expect(calls.map((x) => [x.title, x.files.join(',')])).toEqual([
      ['⛩ おみくじ', ''],
      ['⛩ おみくじ', ''],
      [undefined, 'unei1.png'],
      [undefined, 'omikuji.png'],
    ]);
    // くじは引いていない・銭は動かない
    expect((await walletOf(db, 'A')).balance).toBe(0);
  });

  it('運営吉の絵と紙を横に並べて 1 枚に（高さをそろえる・WebP も読める）', async () => {
    const sharp = (await import('sharp')).default;
    const { joinSideBySide } = await import('../src/services/imageJoin.js');
    const art = await sharp({ create: { width: 500, height: 1000, channels: 3, background: '#c8102e' } }).webp().toBuffer();
    const slip = (await import('../src/services/omikujiSlip.js')).renderSlip({ name: '吉', color: '#e0607e', message: 'a', items: [], shrine: '', date: new Date() });
    const out = await joinSideBySide([art, slip], { height: 600, gap: 10 });
    const meta = await sharp(out).metadata();
    // 絵 300×600 ＋ すき間 10 ＋ 紙 300×600
    expect(meta).toMatchObject({ format: 'png', width: 610, height: 600 });
  });

  it('🎴 運営吉の確率を出したい間隔で決める: 100 ÷（1 日の平均回数 × 日数）を下限・上限におさめる', async () => {
    const { specialPercent, omikujiDailyAverage } = await import('../src/services/omikuji.js');
    const base = { mode: 'interval' as const, percent: 1, everyDays: 30, minPercent: 0.01, maxPercent: 1 };
    // 1 日 50 回・30 日に 1 回 → 1500 回に 1 回
    expect(specialPercent(base, 50)).toBeCloseTo(100 / 1500, 6);
    // 鯖が大きくなる（1 日 200 回）と下がる
    expect(specialPercent(base, 200)).toBeCloseTo(100 / 6000, 6);
    // 下限・上限・まだ引かれていない・決めた確率
    expect(specialPercent(base, 100000)).toBe(0.01);
    expect(specialPercent(base, 1)).toBe(1);
    expect(specialPercent(base, 0)).toBe(1);
    expect(specialPercent({ ...base, mode: 'fixed', percent: 0.04 }, 50)).toBe(0.04);
    // 1 日の平均回数（最近 30 日・もう 1 回も入れる）
    const now = new Date('2026-10-06T03:00:00Z');
    for (let d = 0; d < 6; d++) await drawOmikuji(db, cfg.economy, `m${d}`, new Date(now.getTime() - d * 86_400_000), () => 0.5);
    await drawOmikuji(db, cfg.economy, 'old', new Date(now.getTime() - 40 * 86_400_000), () => 0.5);
    expect(await omikujiDailyAverage(db, now, { fresh: true })).toBeCloseTo(6 / 30, 6);
    // 間隔で決めるとき: 平均 0.2 回・30 日 → 100 ÷ 6 で上限 1% → 乱数 0.005（0.5%）で出る
    const special = { ...cfg.omikujiSpecial, enabled: true, mode: 'interval' as const, everyDays: 30, minPercent: 0.01, maxPercent: 1, list: [{ name: '小林吉', message: '' }] };
    const r = await drawOmikuji(db, cfg.economy, 'X', now, () => 0.005, { special });
    expect(r.status === 'drawn' && r.fortune.key).toBe('unei1');
    const r2 = await drawOmikuji(db, cfg.economy, 'Y', now, () => 0.02, { special });
    expect(r2.status === 'drawn' && r2.fortune.key).not.toBe('unei1');
  });
});

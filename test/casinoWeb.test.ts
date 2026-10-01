import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { recordJoin } from '../src/services/members.js';
import { loadOverrides } from '../src/services/settings.js';
import { createWebApp } from '../src/web/app.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const A = '760000000000000001';
const B = '760000000000000002';
const NORANK = '760000000000000003';
const GUJI = '760000000000000009';
const BASE = 'https://shamusho.example.com';

let db: Db;
let close: () => Promise<void>;
let roles: Map<string, string[]>;
let clock: Date;
let loginAs: string;
let app: ReturnType<typeof createWebApp>;
let current = cfg;

const fakeApi: DiscordApi = {
  authorizeUrl: (state, redirect) => `https://discord.com/oauth2/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirect)}`,
  exchangeCode: async (code) => {
    if (code !== 'good') throw new Error('bad code');
    return 'access';
  },
  me: async () => ({ id: loginAs, username: 'u' + loginAs.slice(-1), displayName: loginAs === A ? 'あや<b>' : 'User' + loginAs.slice(-1), avatarUrl: null }),
  memberRoles: async (_g, userId) => roles.get(userId) ?? null,
};

beforeEach(async () => {
  ({ db, close } = await makeDb());
  roles = new Map([
    [A, [ROLE.sanpaisha]],
    [B, [ROLE.ujiko]],
    [NORANK, []],
    [GUJI, [ROLE.guji]],
  ]);
  clock = new Date('2026-10-01T03:00:00Z');
  current = cfg;
  app = createWebApp({ db, cfg: () => current, api: fakeApi, discord: {} as DiscordActions, baseUrl: BASE, now: () => clock, entryKey: 'abcdefghijklmnop1234' });
  for (const id of [A, B]) {
    await recordJoin(db, { id, username: id, displayName: id === A ? 'あや<b>' : 'べに', avatarUrl: null, roleIds: roles.get(id)!, isBot: false, joinedAt: new Date('2026-09-01T00:00:00Z') });
    await addCoins(db, id, 5000, 'admin_grant');
  }
});
afterEach(async () => {
  await close();
});

function cookiesFrom(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const [k, v] = pair!.split('=');
    out[k!] = v ?? '';
  }
  return out;
}

/** カジノのログイン（Discord）。Cookie とリダイレクト先を返す */
async function casinoLogin(userId: string): Promise<{ cookie?: string; location: string }> {
  loginAs = userId;
  const start = await app.request('/casino/auth/discord');
  expect(start.status).toBe(302);
  const state = cookiesFrom(start).sakura_casino_state!;
  expect(start.headers.get('location')).toContain(encodeURIComponent(`${BASE}/casino/auth/callback`));
  const cb = await app.request(`/casino/auth/callback?code=good&state=${state}`, { headers: { cookie: `sakura_casino_state=${state}` } });
  expect(cb.status).toBe(302);
  const cookie = cookiesFrom(cb).sakura_casino;
  if (cookie) expect(cb.headers.getSetCookie().find((c) => c.startsWith('sakura_casino='))).toMatch(/Path=\/casino/);
  return { cookie, location: cb.headers.get('location')! };
}

const get = (path: string, cookie: string) => app.request(path, { headers: { cookie: `sakura_casino=${cookie}` } });
const csrfOf = async (cookie: string) => {
  const html = await (await get('/casino', cookie)).text();
  return /name="_csrf" value="([^"]+)"/.exec(html)![1]!;
};
const post = async (path: string, cookie: string, body: Record<string, string>, csrf?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { cookie: `sakura_casino=${cookie}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf ?? (await csrfOf(cookie)), ...body }),
  });
const balance = async (id: string) => (await walletOf(db, id)).balance;

describe('🎰 カジノ: 入口とログイン', () => {
  it('秘密の入口がなくても、カジノの入口は見られる（運営の画面は見つからないまま）', async () => {
    const res = await app.request('/casino');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Discord でログインして入る');
    expect((await app.request('/login')).status).toBe(404);
    expect((await app.request('/')).status).toBe(404);
  });

  it('メンバーでない・位がない人は入れない', async () => {
    loginAs = '760000000000000077';
    expect((await casinoLogin('760000000000000077')).location).toBe('/casino?e=not_member');
    expect((await casinoLogin(NORANK)).location).toBe('/casino?e=no_rank');
    const page = await (await app.request('/casino?e=no_rank')).text();
    expect(page).toContain('位（🔰参拝者 など）のロールがある人だけ');
  });

  it('ログインするとロビー。カジノの Cookie では運営の画面に入れない。名前はそのまま出さない', async () => {
    const { cookie, location } = await casinoLogin(A);
    expect(location).toBe('/casino');
    const lobby = await (await get('/casino', cookie!)).text();
    expect(lobby).toContain('ようこそ');
    expect(lobby).toContain('あや&lt;b&gt;');
    expect(lobby).not.toContain('あや<b>');
    for (const g of ['ブラックジャック', 'ハイ＆ロー', 'バカラ', 'スロット', 'ルーレット', 'オセロ（CPU）', 'メンバー対戦']) expect(lobby).toContain(g);
    expect(lobby).toContain('5,000');
    const admin = await app.request('/', { headers: { cookie: `shamusho_session=${cookie}; sakura_casino=${cookie}` } });
    expect(admin.status).toBe(404);
  });

  it('位が外れたら、次に確かめたときにログアウト', async () => {
    const { cookie } = await casinoLogin(A);
    roles.set(A, []);
    expect((await get('/casino/slots', cookie!)).status).toBe(200);
    clock = new Date(clock.getTime() + 11 * 60_000);
    const res = await get('/casino/slots', cookie!);
    expect(res.headers.get('location')).toBe('/casino?e=no_rank');
  });

  it('ログアウト', async () => {
    const { cookie } = await casinoLogin(A);
    await post('/casino/logout', cookie!, {});
    expect((await get('/casino/slots', cookie!)).headers.get('location')).toBe('/casino?e=expired');
  });
});

describe('🎰 カジノ: 遊ぶ', () => {
  it('スロット: CSRF がなければ断る。回すと銭が動き、結果が出る', async () => {
    const { cookie } = await casinoLogin(A);
    expect((await post('/casino/slots', cookie!, { bet: '100' }, 'wrong')).status).toBe(403);
    const res = await post('/casino/slots', cookie!, { bet: '100' });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    expect(loc).toMatch(/^\/casino\/slots\?g=\d+$/);
    const html = await (await get(loc, cookie!)).text();
    expect(html).toContain('c-slot spun');
    expect(html).toMatch(/賭け 100 → 戻り \d/);
    // 残高は「5000 − 賭け + 戻り」（×1 で戻りが 100 のときもある）
    const back = Number(/戻り ([\d,]+)/.exec(html)![1]!.replace(/,/g, ''));
    expect(await balance(A)).toBe(5000 - 100 + back);
    // ほかの人の結果は見えない
    const other = await casinoLogin(B);
    expect(await (await get(loc, other.cookie!)).text()).not.toContain('c-slot spun');
  });

  it('好きな量・上限・足りない', async () => {
    const { cookie } = await casinoLogin(A);
    expect((await post('/casino/slots', cookie!, { bet: 'custom', betCustom: '5' })).headers.get('location')).toBe('/casino/slots?e=bad_bet');
    expect((await post('/casino/slots', cookie!, { bet: 'custom', betCustom: '1001' })).headers.get('location')).toBe('/casino/slots?e=bad_bet');
    expect((await post('/casino/roulette', cookie!, { bet: '100', on: 'purple' })).headers.get('location')).toBe('/casino/roulette?e=invalid');
    const r = await post('/casino/roulette', cookie!, { bet: 'custom', betCustom: '50', on: 'n7' });
    expect(r.headers.get('location')).toMatch(/\?g=\d+/);
    // 盤からまとめて（赤 100 と 7 に 50）
    const multi = await post('/casino/roulette', cookie!, { bets: 'red:100,n7:50' });
    const shown = await (await get(multi.headers.get('location')!, cookie!)).text();
    expect(shown).toContain('c-rb-result');
    expect(shown).toContain('data-bet="n7"');
    expect((await post('/casino/roulette', cookie!, { bets: 'red:100,blue:1' })).headers.get('location')).toBe('/casino/roulette?e=invalid');
    const page = await (await get('/casino/roulette?e=limit', cookie!)).text();
    expect(page).toContain('今日賭けられる上限');
  });

  it('ブラックジャック・ハイ＆ロー・バカラ・オセロの画面が動く', async () => {
    const { cookie } = await casinoLogin(A);
    const bj = await post('/casino/blackjack', cookie!, { bet: '100' });
    const bjPage = await (await get(bj.headers.get('location')!, cookie!)).text();
    expect(bjPage).toContain('ディーラー');
    if (bjPage.includes('value="stand"')) {
      const id = /\/casino\/blackjack\/(\d+)/.exec(bjPage)![1];
      const v = /name="v" value="(\d+)"/.exec(bjPage)![1]!;
      const done = await post(`/casino/blackjack/${id}`, cookie!, { action: 'stand', v });
      expect(await (await get(done.headers.get('location')!, cookie!)).text()).toContain('c-result');
      // 古い画面から押しても、2 回目は受け付けない
      expect((await post(`/casino/blackjack/${id}`, cookie!, { action: 'stand', v })).headers.get('location')).toBe('/casino/blackjack?e=conflict');
    }
    const hl = await post('/casino/highlow', cookie!, { bet: '100' });
    const hlPage = await (await get(hl.headers.get('location')!, cookie!)).text();
    expect(hlPage).toContain('いまの倍率');
    const bac = await post('/casino/baccarat', cookie!, { bet: '100', on: 'tie' });
    expect(await (await get(bac.headers.get('location')!, cookie!)).text()).toContain('あなたは 🟢 タイ');
    const oth = await post('/casino/othello', cookie!, { bet: '100', level: 'easy', color: 'B' });
    const othPage = await (await get(oth.headers.get('location')!, cookie!)).text();
    expect(othPage).toContain('c-cell can');
    const id = /\/casino\/othello\/(\d+)/.exec(othPage)![1];
    const v = /name="v" value="(\d+)"/.exec(othPage)![1]!;
    const moved = await post(`/casino/othello/${id}`, cookie!, { idx: '19', v });
    expect(moved.headers.get('location')).toMatch(/\?g=\d+/);
    const resign = await post(`/casino/othello/${id}`, cookie!, { idx: 'resign', v: String(Number(v) + 1) });
    expect(await (await get(resign.headers.get('location')!, cookie!)).text()).toContain('投了しました');
  });

  it('お休み・止めたゲーム', async () => {
    const { cookie } = await casinoLogin(A);
    current = { ...cfg, casino: { ...cfg.casino, games: ['slots'] } };
    expect((await get('/casino/blackjack', cookie!)).headers.get('location')).toBe('/casino?e=game_off');
    expect((await post('/casino/blackjack', cookie!, { bet: '100' })).headers.get('location')).toBe('/casino/blackjack?e=game_off');
    current = { ...cfg, casino: { ...cfg.casino, enabled: false } };
    expect(await (await get('/casino', cookie!)).text()).toContain('本日はお休みです');
    expect(await (await get('/casino/slots', cookie!)).text()).toContain('本日はお休みです');
  });
});

describe('⚔ メンバー対戦（画面）', () => {
  it('部屋を作る → 入る → 盤が出る → 置く', async () => {
    const a = (await casinoLogin(A)).cookie!;
    const b = (await casinoLogin(B)).cookie!;
    const made = await post('/casino/versus', a, { bet: '200' });
    const room = made.headers.get('location')!;
    expect(room).toMatch(/^\/casino\/versus\/\d+$/);
    const id = room.split('/').pop()!;
    expect(await (await get(room, a)).text()).toContain('相手が入るのを待っています');
    const lobby = await (await get('/casino/versus', b)).text();
    expect(lobby).toContain('あや&lt;b&gt; さん');
    const joined = await post(`/casino/versus/${id}/join`, b, {});
    expect(joined.headers.get('location')).toBe(room);
    expect(await balance(A)).toBe(4800);
    expect(await balance(B)).toBe(4800);
    const board = await (await get(`/casino/versus/${id}/board`, a)).text();
    expect(board).toContain('あなたの番です');
    expect(board).toContain('hx-trigger="every 2s"');
    const v = /name="v" value="(\d+)"/.exec(board)![1]!;
    expect((await post(`/casino/versus/${id}/move`, b, { idx: '19', v })).headers.get('location')).toBe(`${room}?e=invalid`);
    expect((await post(`/casino/versus/${id}/move`, a, { idx: '19', v })).headers.get('location')).toBe(room);
    expect(await (await get(`/casino/versus/${id}/board`, b)).text()).toContain('あなたの番です');
    await post(`/casino/versus/${id}/resign`, b, {});
    expect(await balance(A)).toBe(5200);
    expect(await (await get(room, a)).text()).toContain('あや&lt;b&gt; さんの勝ち');
  });
});

describe('🎰 カジノ（運営の画面）', () => {
  async function adminLogin(userId: string) {
    const enter = await app.request('/enter/abcdefghijklmnop1234');
    const entry = cookiesFrom(enter).shamusho_entry!;
    loginAs = userId;
    const start = await app.request('/auth/discord', { headers: { cookie: `shamusho_entry=${entry}` } });
    const state = cookiesFrom(start).shamusho_state!;
    const cb = await app.request(`/auth/callback?code=good&state=${state}`, { headers: { cookie: `shamusho_state=${state}; shamusho_entry=${entry}` } });
    return `shamusho_session=${cookiesFrom(cb).shamusho_session}; shamusho_entry=${entry}`;
  }

  it('収支と設定。宮司が保存すると設定に入る', async () => {
    const a = (await casinoLogin(A)).cookie!;
    await post('/casino/roulette', a, { bet: '100', on: 'red' });
    const g = await adminLogin(GUJI);
    const page = await app.request('/economy/casino', { headers: { cookie: g } });
    const html = await page.text();
    expect(html).toContain(`${BASE}/casino`);
    expect(html).toContain('ルーレット');
    expect(html).toContain('action="/economy/casino"');
    const csrf = /name="_csrf" value="([^"]+)"/.exec(html)![1]!;
    const save = await app.request('/economy/casino', {
      method: 'POST',
      headers: { cookie: g, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([
        ['_csrf', csrf],
        ['enabled', 'yes'],
        ['requireRank', 'yes'],
        ['minBet', '20'],
        ['maxBet', '3000'],
        ['dailyBetLimit', '0'],
        ['games', 'slots'],
        ['games', 'versus'],
      ]),
    });
    expect(save.headers.get('location')).toBe('/economy/casino?msg=saved');
    expect((await loadOverrides(db)).casino).toMatchObject({ minBet: 20, maxBet: 3000, dailyBetLimit: 0, games: ['slots', 'versus'] });
    const bad = await app.request('/economy/casino', {
      method: 'POST',
      headers: { cookie: g, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, minBet: '500', maxBet: '100', dailyBetLimit: '0' }),
    });
    expect(bad.headers.get('location')).toBe('/economy/casino?msg=invalid');
  });
});

describe('👥 みんなで座る卓（画面）', () => {
  it('ロビーに「みんなで遊ぶ」が出る。ポーカー卓を立てて、2 人目が座り、配られる', async () => {
    const a = (await casinoLogin(A)).cookie!;
    const b = (await casinoLogin(B)).cookie!;
    const lobby = await (await get('/casino', a)).text();
    expect(lobby).toContain('みんなで遊ぶ');
    expect(lobby).toContain('/casino/tables/poker');
    expect(lobby).toContain('/casino/tables/daifugo');
    const list = await (await get('/casino/tables/poker', a)).text();
    expect(list).toContain('卓を立てて座る');
    expect(list).toContain('のんびり（2 分）');
    const made = await post('/casino/tables/poker', a, { bb: '20', buyin: '1000', pace: 'slow' });
    const loc = made.headers.get('location')!;
    expect(loc).toMatch(/^\/casino\/t\/\d+$/);
    const id = loc.split('/').pop()!;
    expect(await balance(A)).toBe(4000);
    expect((await post(`/casino/t/${id}/join`, b, { buyin: '600' })).headers.get('location')).toBe(loc);
    const page = await (await get(loc, a)).text();
    expect(page).toContain('id="c-live"');
    expect(page).toContain('あや&lt;b&gt;');
    clock = new Date(clock.getTime() + 6000);
    const poll = (await (await get(`/casino/t/${id}/poll`, a)).json()) as { open: boolean };
    expect(poll.open).toBe(true);
    const frag = await (await get(`/casino/t/${id}/frag`, b)).text();
    expect(frag).toContain('プリフロップ');
    // 相手の手札は伏せたまま
    expect((frag.match(/class="pc back small"/g) ?? []).length).toBe(2);
    // 自分の番の人だけに操作が出る
    const fa = await (await get(`/casino/t/${id}/frag`, a)).text();
    const actor = fa.includes('value="fold"') ? a : b;
    const r = await post(`/casino/t/${id}/act`, actor, { action: 'fold' });
    expect(r.headers.get('location')).toBe(loc);
    // ほかの卓は立てられない
    expect((await post('/casino/tables/bj_table', a, {})).headers.get('location')).toBe('/casino/tables/bj_table?e=seated');
  });

  it('ブラックジャック卓: 賭けて、2 人そろうと配る。ババ抜きは作った人が始める', async () => {
    const a = (await casinoLogin(A)).cookie!;
    const b = (await casinoLogin(B)).cookie!;
    const loc = (await post('/casino/tables/bj_table', a, {})).headers.get('location')!;
    const id = loc.split('/').pop()!;
    await post(`/casino/t/${id}/join`, b, {});
    expect((await post(`/casino/t/${id}/act`, a, { action: 'bet', bet: 'custom', betCustom: '150' })).headers.get('location')).toBe(loc);
    expect(await balance(A)).toBe(4850);
    await post(`/casino/t/${id}/act`, b, { action: 'bet', bet: '100' });
    const frag = await (await get(`/casino/t/${id}/frag`, a)).text();
    expect(frag).toMatch(/さんの番|結果/);
    // 立って、ババ抜きへ
    for (const c of [a, b]) {
      for (let k = 0; k < 5; k++) {
        const f = await (await get(`/casino/t/${id}/frag`, c)).text();
        if (!f.includes('value="stand"')) break;
        await post(`/casino/t/${id}/act`, c, { action: 'stand' });
      }
    }
    clock = new Date(clock.getTime() + 10_000);
    await get(`/casino/t/${id}/poll`, a);
    await post(`/casino/t/${id}/leave`, a, {});
    await post(`/casino/t/${id}/leave`, b, {});
    const bl = (await post('/casino/tables/babanuki', a, { entry: '50' })).headers.get('location')!;
    const bid = bl.split('/').pop()!;
    await post(`/casino/t/${bid}/join`, b, {});
    expect((await post(`/casino/t/${bid}/act`, b, { action: 'start' })).headers.get('location')).toBe(`${bl}?e=invalid`);
    await post(`/casino/t/${bid}/act`, a, { action: 'start' });
    const bf = await (await get(`/casino/t/${bid}/frag`, a)).text();
    expect(bf).toContain('あなたの手札');
  });
});

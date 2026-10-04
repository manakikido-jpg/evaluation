import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { TABLE_KINDS, type CasinoGame, type GuildConfig, type TableKind } from '../config.js';
import { actTable, createTable, joinTable, leaveTable, myTable, openTables, pollTable, sweepTables, tableById, tableCounts, type TableResult } from '../services/casino/tables/service.js';
import type { Form } from '../services/casino/tables/types.js';
import { TableFrag, TablePage, TablesLobby } from './views/casinoTables.js';
import type { Db } from '../db/client.js';
import type { CasinoGameRow, MemberSession } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { BAC_BETS, type BacBet } from '../services/casino/baccarat.js';
import {
  actBlackjack,
  actHighLow,
  actOthello,
  activeGame,
  bigWins,
  gameById,
  playBaccarat,
  playRoulette,
  aimSlots,
  playChinchiro,
  playSlots,
  recentGames,
  startBlackjack,
  startHighLow,
  startOthello,
  todayBets,
  type Acted,
  type BjAction,
  type Played,
  type SlotsSpin,
} from '../services/casino/casino.js';
import { isOthelloLevel } from '../services/casino/othello.js';
import { isRouletteBet, parseStakes } from '../services/casino/roulette.js';
import { cancelMatch, createMatch, MOVE_SECONDS, joinMatch, moveMatch, myMatch, openMatches, readMatch, recentMatches, resignMatch, sweepMatches, type MatchResult } from '../services/casino/versus.js';
import { walletOf } from '../services/economy.js';
import { namesOf } from '../services/members.js';
import type { DiscordApi } from './discordApi.js';
import { createMemberSession, deleteMemberSession, findMemberSession, markMemberChecked, MEMBER_RECHECK_MS, MEMBER_SESSION_DAYS } from './memberSessions.js';
import { randomToken, safeEqual } from './sessions.js';
import {
  BaccaratPage,
  BlackjackPage,
  CasinoClosed,
  CasinoGate,
  CasinoLanding,
  CasinoLinkPage,
  CasinoLobby,
  casinoMsg,
  HighLowPage,
  OthelloPage,
  RoulettePage,
  VersusBoard,
  VersusLobby,
  VersusRoom,
  type CasinoMe,
} from './views/casino.js';
import { SlotFloor, SlotsPage } from './views/slots.js';
import { peekLoginLink, useLoginLink } from '../services/casino/loginLinks.js';
import { slotFloorData, validMachine } from '../services/casino/slotFloor.js';
import { ChinchiroPage } from './views/chinchiro.js';
import { MjRecords } from './views/mahjong.js';
import { KbLobbyExtra, KbStablePage } from './views/keiba.js';
import {
  breedFoal,
  buyFromOwner,
  buyHorse,
  foalsOf,
  horsesForSale,
  isSilk,
  leadingOwners,
  myHorses,
  nameOwnHorse,
  ownerSilk,
  restHorse,
  retireOwnHorse,
  retireToBreed,
  setOwnerSilk,
  setSale,
  trainHorse,
} from '../services/casino/keibaStable.js';
import { fatigueNow } from '../services/casino/keiba.js';
import { mjRanking, mjStats, monthStartJst } from '../services/casino/mahjongStats.js';

/** ランキングに出る対局数 */
const MJ_RANK_MIN = 3;

/**
 * 🎰 カジノ（/casino）。メンバーが Discord でログインして、サーバーの銭で遊ぶ。
 * 運営の画面（秘密の入口・ID とパスワード）とは Cookie もログインも別。
 */

const COOKIE = 'sakura_casino';
const STATE = 'sakura_casino_state';

type Deps = { db: Db; api: DiscordApi; cfg: () => GuildConfig; baseUrl: string; secure: boolean; now: () => Date };
type Me = CasinoMe;

/** 位のロールがあるか（requireRank を止めていれば、サーバーにいればよい） */
export const casinoAllowed = (cfg: GuildConfig, roles: string[]) =>
  cfg.casino.accessRoleId ? roles.includes(cfg.casino.accessRoleId) : !cfg.casino.requireRank || cfg.ranks.some((r) => roles.includes(r.roleId));
/** 入れなかったときの案内（カジノのロールか、位のロールか） */
const deniedCode = (cfg: GuildConfig) => (cfg.casino.accessRoleId ? 'no_role' : 'no_rank');

const SOLO: CasinoGame[] = ['blackjack', 'highlow', 'baccarat', 'slots', 'roulette', 'chinchiro', 'othello'];

export function mountCasino(app: Hono<any>, d: Deps): void {
  const { db, api } = d;
  const redirectUri = `${d.baseUrl}/casino/auth/callback`;
  const coin = () => ({ name: d.cfg().economy.currencyName, emoji: d.cfg().economy.currencyEmoji });

  /** ログイン中の人（いなければ undefined。確かめ直しで外れたら Cookie も消す） */
  async function current(c: Context): Promise<{ session: MemberSession } | { error: string } | undefined> {
    const token = getCookie(c, COOKIE);
    if (!token) return undefined;
    const session = await findMemberSession(db, token, d.now());
    if (!session) {
      deleteCookie(c, COOKIE, { path: '/casino' });
      return { error: 'expired' };
    }
    if (d.now().getTime() - session.checkedAt.getTime() > MEMBER_RECHECK_MS) {
      let roles: string[] | null | undefined;
      try {
        roles = await api.memberRoles(d.cfg().guildId, session.userId);
      } catch (err) {
        // Discord が混んでいるときは、そのまま使う（次に開いたときにまた確かめる）
        logger.warn({ err }, 'casino role recheck failed');
        roles = undefined;
      }
      if (roles !== undefined) {
        if (!roles || !casinoAllowed(d.cfg(), roles)) {
          await deleteMemberSession(db, session.id);
          deleteCookie(c, COOKIE, { path: '/casino' });
          return { error: roles ? deniedCode(d.cfg()) : 'not_member' };
        }
        await markMemberChecked(db, session.id, d.now());
      }
    }
    return { session };
  }

  const meOf = async (session: MemberSession): Promise<Me> => ({ session, balance: (await walletOf(db, session.userId)).balance, coin: coin() });

  /** ログインが要るページ。お休み中はお休みの画面 */
  const page =
    (handler: (c: Context, me: Me) => Response | Promise<Response>, opts: { post?: boolean } = {}) =>
    async (c: Context) => {
      const r = await current(c);
      if (!r || 'error' in r) {
        if (c.req.header('hx-request')) return c.body(null, 401, { 'hx-redirect': `/casino${r ? `?e=${r.error}` : ''}` });
        return c.redirect(`/casino${r ? `?e=${r.error}` : ''}`);
      }
      if (opts.post) {
        const body = await c.req.parseBody();
        if (!safeEqual(typeof body._csrf === 'string' ? body._csrf : '', r.session.csrfToken)) return c.text('不正なリクエストです（CSRF）。', 403);
      }
      const me = await meOf(r.session);
      if (!d.cfg().casino.enabled) return c.html(<CasinoClosed me={me} />);
      return handler(c, me);
    };

  // ───────── 入口・ログイン ─────────

  // 入口: カジノか雀荘かを選ぶ
  app.get('/casino', async (c) => {
    const r = await current(c);
    if (!r || 'error' in r) return c.html(<CasinoLanding error={r ? r.error : c.req.query('e')} roleName={d.cfg().casino.accessRoleName} />);
    const me = await meOf(r.session);
    const cfg = d.cfg();
    if (!cfg.casino.enabled) return c.html(<CasinoClosed me={me} />);
    await sweepTables(db, cfg, d.now());
    return c.html(
      <CasinoGate
        me={me}
        casinoOn={cfg.casino.games.some((g) => g !== 'mahjong')}
        jansouOn={cfg.casino.games.includes('mahjong')}
        jansouTables={(await tableCounts(db)).get('mahjong') ?? 0}
        mine={await myTable(db, me.session.userId)}
        msg={casinoMsg(c.req.query('e'))}
      />,
    );
  });

  // 🀄 咲楽ノ宮雀荘（麻雀の卓の一覧）
  app.get(
    '/casino/jansou',
    page(async (c, me) => {
      if (!kindOn('mahjong')) return c.redirect('/casino?e=game_off');
      await sweepTables(db, d.cfg(), d.now());
      const since = monthStartJst(d.now());
      const [stats, ranking, stats3, ranking3] = await Promise.all([
        mjStats(db, me.session.userId),
        mjRanking(db, since, MJ_RANK_MIN),
        mjStats(db, me.session.userId, 3),
        mjRanking(db, since, MJ_RANK_MIN, 20, 3),
      ]);
      return c.html(
        <TablesLobby
          me={me}
          kind="mahjong"
          casino={d.cfg().casino}
          tables={await openTables(db, 'mahjong')}
          mine={await myTable(db, me.session.userId)}
          msg={casinoMsg(c.req.query('e'))}
          extra={
            <>
              <MjRecords me={me} stats={stats} ranking={ranking} minGames={MJ_RANK_MIN} />
              {(stats3.games > 0 || ranking3.length > 0) && <MjRecords me={me} stats={stats3} ranking={ranking3} minGames={MJ_RANK_MIN} players={3} />}
            </>
          }
        />,
      );
    }),
  );

  // 🎰 カジノのロビー
  app.get('/casino/hall', async (c) => {
    const r = await current(c);
    if (!r || 'error' in r) return c.redirect(`/casino${r ? `?e=${r.error}` : ''}`);
    const me = await meOf(r.session);
    const cfg = d.cfg();
    if (!cfg.casino.enabled) return c.html(<CasinoClosed me={me} />);
    await sweepMatches(db, d.now());
    await sweepTables(db, cfg, d.now());
    const wins = await bigWins(db, new Date(d.now().getTime() - 7 * 86_400_000));
    const names = await namesOf(db, wins.map((w) => w.memberId));
    const open = (await openMatches(db)).filter((m) => m.status === 'open').length;
    return c.html(
      <CasinoLobby
        me={me}
        casino={cfg.casino}
        today={await todayBets(db, me.session.userId, d.now())}
        recent={await recentGames(db, me.session.userId, 10)}
        bigWins={wins.map((w) => ({ ...w, name: names.get(w.memberId) ?? 'だれか' }))}
        openMatches={open}
        tables={await tableCounts(db)}
        mine={await myTable(db, me.session.userId)}
        msg={casinoMsg(c.req.query('e'))}
      />,
    );
  });

  app.get('/casino/auth/discord', (c) => {
    const state = randomToken();
    setCookie(c, STATE, state, { httpOnly: true, secure: d.secure, sameSite: 'Lax', path: '/casino/auth', maxAge: 600 });
    return c.redirect(api.authorizeUrl(state, redirectUri));
  });

  // ── ログインなしで入るリンク（Discord の /カジノ で本人にだけ渡す） ──
  app.get('/casino/link/:token', async (c) => {
    const user = await peekLoginLink(db, c.req.param('token') ?? '', d.now());
    if (!user) return c.html(<CasinoLanding error="link" />);
    return c.html(<CasinoLinkPage name={user.displayName} action={`/casino/link/${c.req.param('token')}`} />);
  });
  app.post('/casino/link/:token', async (c) => {
    // ほかのサイトから送らせて、別の人として入らせることはさせない
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(d.baseUrl).origin) return c.text('不正なリクエストです。', 403);
    const user = await useLoginLink(db, c.req.param('token') ?? '', d.now());
    if (!user) return c.redirect('/casino?e=link');
    let roles;
    try {
      roles = await api.memberRoles(d.cfg().guildId, user.id);
    } catch (err) {
      logger.warn({ err }, 'casino link login failed');
      return c.redirect('/casino?e=failed');
    }
    if (!roles) return c.redirect('/casino?e=not_member');
    if (!casinoAllowed(d.cfg(), roles)) return c.redirect(`/casino?e=${deniedCode(d.cfg())}`);
    const token = await createMemberSession(db, { id: user.id, username: user.displayName, displayName: user.displayName, avatarUrl: user.avatarUrl }, d.now());
    setCookie(c, COOKIE, token, { httpOnly: true, secure: d.secure, sameSite: 'Lax', path: '/casino', maxAge: MEMBER_SESSION_DAYS * 86_400 });
    await audit(db, { actorId: user.id, action: 'casino.login', detail: { via: 'link' }, via: 'web' });
    return c.redirect('/casino');
  });

  app.get('/casino/auth/callback', async (c) => {
    const state = getCookie(c, STATE);
    deleteCookie(c, STATE, { path: '/casino/auth' });
    const code = c.req.query('code');
    if (!state || !code || !safeEqual(state, c.req.query('state') ?? '')) return c.redirect('/casino?e=state');
    let user;
    let roles;
    try {
      const token = await api.exchangeCode(code, redirectUri);
      user = await api.me(token);
      roles = await api.memberRoles(d.cfg().guildId, user.id);
    } catch (err) {
      logger.warn({ err }, 'casino login failed');
      return c.redirect('/casino?e=failed');
    }
    if (!roles) return c.redirect('/casino?e=not_member');
    if (!casinoAllowed(d.cfg(), roles)) return c.redirect(`/casino?e=${deniedCode(d.cfg())}`);
    const token = await createMemberSession(db, user, d.now());
    setCookie(c, COOKIE, token, { httpOnly: true, secure: d.secure, sameSite: 'Lax', path: '/casino', maxAge: MEMBER_SESSION_DAYS * 86_400 });
    await audit(db, { actorId: user.id, action: 'casino.login', via: 'web' });
    return c.redirect('/casino');
  });

  app.post('/casino/logout', async (c) => {
    const r = await current(c);
    if (r && !('error' in r)) {
      const body = await c.req.parseBody();
      if (!safeEqual(typeof body._csrf === 'string' ? body._csrf : '', r.session.csrfToken)) return c.text('不正なリクエストです（CSRF）。', 403);
      await deleteMemberSession(db, r.session.id);
    }
    deleteCookie(c, COOKIE, { path: '/casino' });
    return c.redirect('/casino');
  });

  // ───────── 1 人で遊ぶゲーム ─────────

  const betOf = (body: Record<string, unknown>) => {
    const raw = body.bet === 'custom' ? body.betCustom : body.bet;
    return typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  };
  const versionOf = (body: Record<string, unknown>) => (typeof body.v === 'string' && /^\d+$/.test(body.v) ? Number(body.v) : undefined);
  const idOf = (c: Context) => {
    const id = Number(c.req.param('id'));
    return Number.isInteger(id) && id > 0 ? id : undefined;
  };

  /** 始めた・進めたあとの行き先（PRG）。?g= で結果を出す */
  const after = (c: Context, game: CasinoGame, r: Played | Acted) =>
    r.status === 'ok' || r.status === 'busy' ? c.redirect(`/casino/${game}?g=${r.row.id}`) : c.redirect(`/casino/${game}?e=${r.status}`);

  /** そのゲームで見せる 1 回（途中のもの、なければ ?g= の自分の結果） */
  async function shown(c: Context, me: Me, game: CasinoGame): Promise<CasinoGameRow | undefined> {
    const active = await activeGame(db, me.session.userId, game);
    if (active) return active;
    const g = Number(c.req.query('g'));
    if (!Number.isInteger(g) || g <= 0) return undefined;
    const row = await gameById(db, g);
    return row && row.memberId === me.session.userId && row.game === game ? row : undefined;
  }

  const VIEWS = { blackjack: BlackjackPage, highlow: HighLowPage, baccarat: BaccaratPage, roulette: RoulettePage, chinchiro: ChinchiroPage, othello: OthelloPage } as const;
  for (const game of SOLO) {
    const View = VIEWS[game as keyof typeof VIEWS];
    app.get(
      `/casino/${game}`,
      page(async (c, me) => {
        if (!d.cfg().casino.games.includes(game)) return c.redirect('/casino?e=game_off');
        if (game === 'slots') return slotsPage(c, me);
        return c.html(<View me={me} casino={d.cfg().casino} row={await shown(c, me, game)} msg={casinoMsg(c.req.query('e'))} />);
      }),
    );
  }

  /**
   * 🎰 スロット: 台を選ぶ島（?m がなく、持ち越しも結果もないとき）か、その台の画面。
   * 回したばかりでまだ止めていない回は、データの当たり・差枚に入れない（止める前に結果が分からないように）
   */
  async function slotsPage(c: Context, me: Me) {
    const cfg = d.cfg();
    const row = await shown(c, me, 'slots');
    const st = row?.state as SlotsSpin | undefined;
    const q = Number(c.req.query('m'));
    const machine = st?.machine ?? (row ? 1 : validMachine(cfg, q) ? q : undefined);
    const hide = row && st && !st.aimed && (row.status === 'playing' || (row.finishedAt && d.now().getTime() - row.finishedAt.getTime() < 60_000)) ? row.id : undefined;
    const data = await slotFloorData(db, cfg, d.now(), hide);
    const msg = casinoMsg(c.req.query('e'));
    if (!machine) return c.html(<SlotFloor me={me} casino={cfg.casino} data={data} msg={msg} />);
    return c.html(<SlotsPage me={me} casino={cfg.casino} row={row} msg={msg} machine={machine} data={data} />);
  }

  /** 途中のゲームを進める前に: 画面が古い（2 回押した）なら断る */
  async function fresh(id: number | undefined, me: Me, body: Record<string, unknown>): Promise<CasinoGameRow | 'stale' | undefined> {
    if (!id) return undefined;
    const row = await gameById(db, id);
    if (!row || row.memberId !== me.session.userId) return undefined;
    const v = versionOf(body);
    if (v !== undefined && v !== row.version) return 'stale';
    return row;
  }

  app.post(
    '/casino/blackjack',
    page(async (c, me) => after(c, 'blackjack', await startBlackjack(db, d.cfg(), me.session.userId, betOf(await c.req.parseBody()), undefined, d.now())), { post: true }),
  );
  app.post(
    '/casino/blackjack/:id',
    page(async (c, me) => {
      const body = await c.req.parseBody();
      const action = body.action;
      if (action !== 'hit' && action !== 'stand' && action !== 'double') return c.redirect('/casino/blackjack?e=invalid');
      const row = await fresh(idOf(c), me, body);
      if (row === 'stale') return c.redirect(`/casino/blackjack?e=conflict`);
      if (!row) return c.redirect('/casino/blackjack?e=not_found');
      return after(c, 'blackjack', await actBlackjack(db, d.cfg(), row.id, me.session.userId, action as BjAction, d.now()));
    }, { post: true }),
  );

  app.post(
    '/casino/highlow',
    page(async (c, me) => after(c, 'highlow', await startHighLow(db, d.cfg(), me.session.userId, betOf(await c.req.parseBody()), undefined, d.now())), { post: true }),
  );
  app.post(
    '/casino/highlow/:id',
    page(async (c, me) => {
      const body = await c.req.parseBody();
      const action = body.action;
      if (action !== 'high' && action !== 'low' && action !== 'cashout') return c.redirect('/casino/highlow?e=invalid');
      const row = await fresh(idOf(c), me, body);
      if (row === 'stale') return c.redirect('/casino/highlow?e=conflict');
      if (!row) return c.redirect('/casino/highlow?e=not_found');
      return after(c, 'highlow', await actHighLow(db, row.id, me.session.userId, action, undefined, d.now()));
    }, { post: true }),
  );

  app.post(
    '/casino/baccarat',
    page(async (c, me) => {
      const body = await c.req.parseBody();
      const on = BAC_BETS.includes(body.on as BacBet) ? (body.on as BacBet) : undefined;
      if (!on) return c.redirect('/casino/baccarat?e=invalid');
      return after(c, 'baccarat', await playBaccarat(db, d.cfg(), me.session.userId, betOf(body), on, undefined, d.now()));
    }, { post: true }),
  );

  app.post(
    '/casino/slots',
    page(async (c, me) => {
      const body = await c.req.parseBody();
      const m = typeof body.m === 'string' && /^\d{1,2}$/.test(body.m) ? Number(body.m) : 1;
      const r = await playSlots(db, d.cfg(), me.session.userId, betOf(body), undefined, d.now(), m);
      return r.status === 'ok' || r.status === 'busy' ? after(c, 'slots', r) : c.redirect(`/casino/slots?m=${m}&e=${r.status}`);
    }, { post: true }),
  );

  app.post(
    '/casino/slots/:id',
    page(async (c, me) => {
      const body = await c.req.parseBody();
      // p=3,10,17（STOP を押したときのコマ・左から）か、assist=1（おまかせ）
      const pressed = body.assist === '1' ? 'assist' : typeof body.p === 'string' && /^\d{1,2},\d{1,2},\d{1,2}$/.test(body.p) ? body.p.split(',').map(Number) : undefined;
      if (!pressed) return c.redirect('/casino/slots?e=invalid');
      const row = await fresh(idOf(c), me, body);
      if (row === 'stale') return c.redirect('/casino/slots?e=conflict');
      if (!row) return c.redirect('/casino/slots?e=not_found');
      return after(c, 'slots', await aimSlots(db, row.id, me.session.userId, pressed, d.now()));
    }, { post: true }),
  );

  app.post(
    '/casino/chinchiro',
    page(async (c, me) => after(c, 'chinchiro', await playChinchiro(db, d.cfg(), me.session.userId, betOf(await c.req.parseBody()), undefined, d.now())), { post: true }),
  );

  app.post(
    '/casino/roulette',
    page(async (c, me) => {
      const body = await c.req.parseBody();
      // 盤から（いくつもの所: bets=red:100,n7:50）・前の形（on と bet）
      const stakes = typeof body.bets === 'string' && body.bets ? parseStakes(body.bets) : isRouletteBet(body.on) ? [{ on: body.on, amount: betOf(body) }] : null;
      if (!stakes) return c.redirect('/casino/roulette?e=invalid');
      return after(c, 'roulette', await playRoulette(db, d.cfg(), me.session.userId, stakes, undefined, d.now()));
    }, { post: true }),
  );

  app.post(
    '/casino/othello',
    page(async (c, me) => {
      const body = await c.req.parseBody();
      const level = isOthelloLevel(body.level) ? body.level : 'easy';
      const color = body.color === 'W' ? 'W' : 'B';
      return after(c, 'othello', await startOthello(db, d.cfg(), me.session.userId, betOf(body), level, color, undefined, d.now()));
    }, { post: true }),
  );
  app.post(
    '/casino/othello/:id',
    page(async (c, me) => {
      const body = await c.req.parseBody();
      const idx = body.idx === 'resign' ? 'resign' : typeof body.idx === 'string' && /^\d{1,2}$/.test(body.idx) ? Number(body.idx) : undefined;
      if (idx === undefined) return c.redirect('/casino/othello?e=invalid');
      const row = await fresh(idOf(c), me, body);
      if (row === 'stale') return c.redirect('/casino/othello?e=conflict');
      if (!row) return c.redirect('/casino/othello?e=not_found');
      return after(c, 'othello', await actOthello(db, row.id, me.session.userId, idx, undefined, d.now()));
    }, { post: true }),
  );

  // ───────── ⚔ メンバー対戦 ─────────

  const matchNames = (ms: { hostId: string; guestId: string | null; winnerId?: string | null }[]) => namesOf(db, ms.flatMap((m) => [m.hostId, m.guestId ?? '', m.winnerId ?? '']));
  const toRoom = (c: Context, r: MatchResult, id?: number) =>
    r.status === 'ok' ? c.redirect(`/casino/versus/${r.match.id}`) : c.redirect(id ? `/casino/versus/${id}?e=${r.status}` : `/casino/versus?e=${r.status}`);
  const versusOn = () => d.cfg().casino.games.includes('versus');

  app.get(
    '/casino/versus',
    page(async (c, me) => {
      if (!versusOn()) return c.redirect('/casino?e=game_off');
      await sweepMatches(db, d.now());
      const matches = await openMatches(db);
      const recent = await recentMatches(db, 8);
      return c.html(
        <VersusLobby
          me={me}
          casino={d.cfg().casino}
          matches={matches}
          recent={recent}
          names={await matchNames([...matches, ...recent])}
          mine={await myMatch(db, me.session.userId)}
          msg={casinoMsg(c.req.query('e'))}
        />,
      );
    }),
  );

  app.post(
    '/casino/versus',
    page(async (c, me) => {
      if (!versusOn()) return c.redirect('/casino?e=game_off');
      const body = await c.req.parseBody();
      const bet = typeof body.bet === 'string' && /^\d{1,9}$/.test(body.bet) ? Number(body.bet) : NaN;
      if (!Number.isInteger(bet)) return c.redirect('/casino/versus?e=bad_bet');
      const move = typeof body.moveSeconds === 'string' && /^\d{1,4}$/.test(body.moveSeconds) ? Number(body.moveSeconds) : MOVE_SECONDS;
      return toRoom(c, await createMatch(db, d.cfg(), me.session.userId, bet, d.now(), move));
    }, { post: true }),
  );

  app.get(
    '/casino/versus/:id',
    page(async (c, me) => {
      const id = idOf(c);
      const m = id ? await readMatch(db, id, d.now()) : undefined;
      if (!m) return c.redirect('/casino/versus?e=not_found');
      return c.html(<VersusRoom me={me} match={m} names={await matchNames([m])} msg={casinoMsg(c.req.query('e'))} now={d.now()} />);
    }),
  );

  /** 盤だけ（2 秒ごとに読み直す。残り秒も変わる） */
  app.get(
    '/casino/versus/:id/board',
    page(async (c, me) => {
      const id = idOf(c);
      const m = id ? await readMatch(db, id, d.now()) : undefined;
      if (!m) return c.body(null, 204);
      return c.html(<VersusBoard match={m} names={await matchNames([m])} me={me.session.userId} csrf={me.session.csrfToken} coin={me.coin} now={d.now()} />);
    }),
  );

  app.post(
    '/casino/versus/:id/join',
    page(async (c, me) => {
      const id = idOf(c);
      if (!id) return c.redirect('/casino/versus?e=not_found');
      const r = await joinMatch(db, d.cfg(), id, me.session.userId, d.now());
      return r.status === 'ok' ? toRoom(c, r) : c.redirect(`/casino/versus?e=${r.status}`);
    }, { post: true }),
  );

  app.post(
    '/casino/versus/:id/move',
    page(async (c, me) => {
      const id = idOf(c);
      const body = await c.req.parseBody();
      const idx = typeof body.idx === 'string' && /^\d{1,2}$/.test(body.idx) ? Number(body.idx) : -1;
      if (!id) return c.redirect('/casino/versus?e=not_found');
      const cur = await readMatch(db, id, d.now());
      const v = versionOf(body);
      if (cur && v !== undefined && v !== cur.version) return c.redirect(`/casino/versus/${id}?e=conflict`);
      const r = await moveMatch(db, id, me.session.userId, idx, d.now());
      return toRoom(c, r, id);
    }, { post: true }),
  );

  app.post(
    '/casino/versus/:id/cancel',
    page(async (c, me) => {
      const id = idOf(c);
      if (!id) return c.redirect('/casino/versus?e=not_found');
      const r = await cancelMatch(db, id, me.session.userId, d.now());
      return r.status === 'ok' ? c.redirect('/casino/versus') : c.redirect(`/casino/versus/${id}?e=${r.status}`);
    }, { post: true }),
  );

  app.post(
    '/casino/versus/:id/resign',
    page(async (c, me) => {
      const id = idOf(c);
      if (!id) return c.redirect('/casino/versus?e=not_found');
      return toRoom(c, await resignMatch(db, id, me.session.userId, d.now()), id);
    }, { post: true }),
  );

  // ───────── 👥 みんなで座る卓 ─────────

  const isKind = (k: string): k is TableKind => (TABLE_KINDS as readonly string[]).includes(k);
  const kindOn = (k: TableKind) => d.cfg().casino.games.includes(k);
  const who = (me: Me) => ({ id: me.session.userId, name: me.session.displayName.slice(0, 32) });
  /** フォームの値（チップの「好きな量」は bet に入れ直す） */
  const formOf = async (c: Context): Promise<Form> => {
    const body = (await c.req.parseBody({ all: true })) as Record<string, string | string[] | File>;
    const f: Form = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'string') f[k] = v;
      else if (Array.isArray(v)) f[k] = v.filter((x): x is string => typeof x === 'string');
    }
    if (f.bet === 'custom') f.bet = f.betCustom;
    return f;
  };
  const back = (c: Context, id: number, r: TableResult) => c.redirect(r.status === 'ok' ? `/casino/t/${id}` : `/casino/t/${id}?e=${r.status}`);

  app.get(
    '/casino/tables/:kind',
    page(async (c, me) => {
      const kind = c.req.param('kind') ?? '';
      if (kind === 'mahjong') return c.redirect(`/casino/jansou${c.req.query('e') ? `?e=${c.req.query('e')}` : ''}`);
      if (!isKind(kind) || !kindOn(kind)) return c.redirect('/casino?e=game_off');
      await sweepTables(db, d.cfg(), d.now());
      const extra =
        kind === 'keiba' ? (
          <KbLobbyExtra me={me} horses={await myHorses(db, me.session.userId)} price={d.cfg().casino.keibaHorsePrice} leading={await leadingOwners(db, monthStartJst(d.now()), 5)} />
        ) : undefined;
      return c.html(
        <TablesLobby
          me={me}
          kind={kind}
          casino={d.cfg().casino}
          tables={await openTables(db, kind)}
          mine={await myTable(db, me.session.userId)}
          msg={casinoMsg(c.req.query('e'))}
          extra={extra}
        />,
      );
    }),
  );

  // 🐴 馬主の部屋（みんなでダービー）
  app.get(
    '/casino/keiba/stable',
    page(async (c, me) => {
      if (!kindOn('keiba')) return c.redirect('/casino?e=game_off');
      const cfg = d.cfg().casino;
      const now = d.now();
      const horses = await Promise.all(
        (await myHorses(db, me.session.userId)).map(async (h) => ({ ...h, fatigueNow: fatigueNow(h.fatigue, h.fatigueAt, now), ...(h.breeding ? { foals: await foalsOf(db, h.id) } : {}) })),
      );
      return c.html(
        <KbStablePage
          me={me}
          horses={horses}
          price={cfg.keibaHorsePrice}
          max={cfg.keibaMaxOwned}
          trainPrice={cfg.keibaTrainPrice}
          silk={await ownerSilk(db, me.session.userId)}
          forSale={await horsesForSale(db)}
          leading={await leadingOwners(db, monthStartJst(now), 10)}
          msg={casinoMsg(c.req.query('e'))}
        />,
      );
    }),
  );
  const stableBack = (c: Context, code: string) => c.redirect(`/casino/keiba/stable?e=${code}`);
  app.post(
    '/casino/keiba/stable/buy',
    page(async (c, me) => {
      if (!kindOn('keiba')) return c.redirect('/casino?e=game_off');
      const cfg = d.cfg().casino;
      const f = await formOf(c);
      const r = await buyHorse(db, me.session.userId, typeof f.name === 'string' ? f.name : '', cfg.keibaHorsePrice, cfg.keibaMaxOwned);
      return stableBack(c, r.status === 'ok' ? 'horse_bought' : r.status === 'poor' ? 'poor' : `horse_${r.status}`);
    }, { post: true }),
  );
  app.post(
    '/casino/keiba/stable/:id/name',
    page(async (c, me) => {
      const id = Number(c.req.param('id'));
      const f = await formOf(c);
      const r = Number.isSafeInteger(id) ? await nameOwnHorse(db, me.session.userId, id, typeof f.name === 'string' ? f.name : '') : 'not_found';
      return stableBack(c, r === 'ok' ? 'horse_named' : r === 'not_found' ? 'not_found' : `horse_${r}`);
    }, { post: true }),
  );
  // 🎽 勝負服
  app.post(
    '/casino/keiba/stable/silk',
    page(async (c, me) => {
      const f = await formOf(c);
      const silk = { base: f.base, accent: f.accent, pattern: Number(f.pattern) };
      if (!isSilk(silk)) return stableBack(c, 'invalid');
      await setOwnerSilk(db, me.session.userId, silk);
      return stableBack(c, 'silk_saved');
    }, { post: true }),
  );
  // 💪 調教・🌿 放牧
  app.post(
    '/casino/keiba/stable/:id/train',
    page(async (c, me) => {
      const id = Number(c.req.param('id'));
      const r = Number.isSafeInteger(id) ? await trainHorse(db, me.session.userId, id, d.cfg().casino.keibaTrainPrice, d.now()) : 'not_found';
      return stableBack(c, r === 'ok' ? 'horse_trained' : r === 'poor' || r === 'not_found' ? r : `horse_${r}`);
    }, { post: true }),
  );
  app.post(
    '/casino/keiba/stable/:id/rest',
    page(async (c, me) => {
      const id = Number(c.req.param('id'));
      const ok = Number.isSafeInteger(id) && (await restHorse(db, me.session.userId, id, d.now()));
      return stableBack(c, ok ? 'horse_rested' : 'not_found');
    }, { post: true }),
  );
  // 💱 売りに出す・取り下げる・買う
  app.post(
    '/casino/keiba/stable/:id/sale',
    page(async (c, me) => {
      const id = Number(c.req.param('id'));
      const f = await formOf(c);
      const price = f.cancel ? null : Number(f.price);
      const ok = Number.isSafeInteger(id) && (await setSale(db, me.session.userId, id, price));
      return stableBack(c, ok ? (price === null ? 'horse_unsale' : 'horse_sale') : 'horse_bad_price');
    }, { post: true }),
  );
  app.post(
    '/casino/keiba/stable/buy/:id',
    page(async (c, me) => {
      const id = Number(c.req.param('id'));
      const r = Number.isSafeInteger(id) ? await buyFromOwner(db, me.session.userId, id, d.cfg().casino.keibaMaxOwned) : 'not_found';
      return stableBack(c, r === 'ok' ? 'horse_traded' : r === 'poor' || r === 'not_found' ? r : `horse_${r}`);
    }, { post: true }),
  );
  // 🌸 繁殖入り・🐣 産駒
  app.post(
    '/casino/keiba/stable/:id/breed',
    page(async (c, me) => {
      const id = Number(c.req.param('id'));
      const r = Number.isSafeInteger(id) ? await retireToBreed(db, me.session.userId, id, d.now()) : 'not_found';
      return stableBack(c, r === 'ok' ? 'horse_bred' : r === 'not_found' ? r : `horse_${r}`);
    }, { post: true }),
  );
  app.post(
    '/casino/keiba/stable/:id/foal',
    page(async (c, me) => {
      const id = Number(c.req.param('id'));
      const f = await formOf(c);
      const cfg = d.cfg().casino;
      const r = Number.isSafeInteger(id)
        ? await breedFoal(db, me.session.userId, id, typeof f.name === 'string' ? f.name : '', Math.floor(cfg.keibaHorsePrice / 2), cfg.keibaMaxOwned)
        : { status: 'not_found' as const };
      return stableBack(c, r.status === 'ok' ? 'horse_foal' : r.status === 'poor' || r.status === 'not_found' ? r.status : `horse_${r.status}`);
    }, { post: true }),
  );
  app.post(
    '/casino/keiba/stable/:id/retire',
    page(async (c, me) => {
      const id = Number(c.req.param('id'));
      const ok = Number.isSafeInteger(id) && (await retireOwnHorse(db, me.session.userId, id, d.now()));
      return stableBack(c, ok ? 'horse_retired' : 'not_found');
    }, { post: true }),
  );

  app.post(
    '/casino/tables/:kind',
    page(async (c, me) => {
      const kind = c.req.param('kind') ?? '';
      if (!isKind(kind) || !kindOn(kind)) return c.redirect('/casino?e=game_off');
      const r = await createTable(db, d.cfg(), kind, who(me), await formOf(c), d.now());
      return r.status === 'ok' && 'table' in r ? c.redirect(`/casino/t/${r.table.id}`) : c.redirect(`/casino/tables/${kind}?e=${r.status}`);
    }, { post: true }),
  );

  app.get(
    '/casino/t/:id',
    page(async (c, me) => {
      const id = idOf(c);
      const t = id ? await pollTable(db, d.cfg(), id, d.now()) : undefined;
      if (!t) return c.redirect('/casino?e=not_found');
      return c.html(<TablePage me={me} table={t} casino={d.cfg().casino} msg={casinoMsg(c.req.query('e'))} now={d.now().getTime()} />);
    }),
  );

  /** 2 秒ごと: 時間が来ていれば進めて、今の番号を返す（変わっていたら中身を読み直す） */
  app.get(
    '/casino/t/:id/poll',
    page(async (c) => {
      const id = idOf(c);
      const t = id ? await pollTable(db, d.cfg(), id, d.now()) : undefined;
      return c.json({ v: t?.version ?? -1, open: t?.status === 'open', now: d.now().getTime() });
    }),
  );

  app.get(
    '/casino/t/:id/frag',
    page(async (c, me) => {
      const id = idOf(c);
      const t = id ? await tableById(db, id) : undefined;
      if (!t) return c.body(null, 204);
      return c.html(<TableFrag table={t} me={me} casino={d.cfg().casino} now={d.now().getTime()} />);
    }),
  );

  app.post(
    '/casino/t/:id/join',
    page(async (c, me) => {
      const id = idOf(c);
      if (!id) return c.redirect('/casino?e=not_found');
      const t = await tableById(db, id);
      if (!t || !isKind(t.kind) || !kindOn(t.kind)) return c.redirect('/casino?e=game_off');
      return back(c, id, await joinTable(db, d.cfg(), id, who(me), await formOf(c), d.now()));
    }, { post: true }),
  );

  app.post(
    '/casino/t/:id/leave',
    page(async (c, me) => {
      const id = idOf(c);
      if (!id) return c.redirect('/casino?e=not_found');
      const t = await tableById(db, id);
      const r = await leaveTable(db, d.cfg(), id, me.session.userId, d.now());
      return r.status === 'ok' || r.status === 'not_found' ? c.redirect(`/casino/tables/${t?.kind ?? ''}`) : back(c, id, r);
    }, { post: true }),
  );

  app.post(
    '/casino/t/:id/act',
    page(async (c, me) => {
      const id = idOf(c);
      if (!id) return c.redirect('/casino?e=not_found');
      return back(c, id, await actTable(db, d.cfg(), id, me.session.userId, await formOf(c), d.now()));
    }, { post: true }),
  );
}

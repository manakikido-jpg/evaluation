import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { AdminSession } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { audit, listAudit } from '../services/audit.js';
import { eventsOf, getMember, homeStats, listMembers, namesOf, shuinHistory, type MemberListQuery } from '../services/members.js';
import { goshuinchoOf } from '../services/shuin.js';
import { recentActivity } from '../services/activity.js';
import { recentCoinTx, walletOf } from '../services/economy.js';
import { checkTarget, clearYaku, giveYaku, instantBan, kickMember, writeMemo, type Actor, type Denied, type ModCtx } from '../services/moderation.js';
import { activeYakuCount, memosOf, membersWithYaku, menzaifuUsed, yakuHistory } from '../services/yaku.js';
import type { DiscordActions } from '../lib/discordRest.js';
import type { DiscordApi } from './discordApi.js';
import { startOfTodayJst } from './format.js';
import { createSession, deleteSession, findSession, markChecked, randomToken, RECHECK_MS, safeEqual, SESSION_HOURS } from './sessions.js';
import { AuditPage, HomePage, LoginPage, MemberPage, MemberResults, MembersPage, NotFoundPage } from './views/pages.js';
import { ConfirmPage, FLASH, ModerationSection, YakuPage } from './views/moderation.js';

export type WebDeps = {
  db: Db;
  cfg: GuildConfig;
  api: DiscordApi;
  /** ロール変更・DM・BAN・キック（BOT のトークンで行う） */
  discord: DiscordActions;
  /** 例: https://shamusho.example.com（末尾の / なし） */
  baseUrl: string;
  now?: () => Date;
};

type Env = { Variables: { session: AdminSession } };

const SESSION_COOKIE = 'shamusho_session';
const STATE_COOKIE = 'shamusho_state';

const here = path.dirname(fileURLToPath(import.meta.url));
const readText = (p: string) => readFileSync(p, 'utf8');
const STATIC: Record<string, { body: string; type: string }> = {
  'style.css': { body: readText(path.join(here, 'public/style.css')), type: 'text/css; charset=utf-8' },
  'htmx.min.js': {
    body: readText(path.join(here, '../../node_modules/htmx.org/dist/htmx.min.js')),
    type: 'text/javascript; charset=utf-8',
  },
};

export function createWebApp(deps: WebDeps) {
  const { db, cfg, api } = deps;
  const now = deps.now ?? (() => new Date());
  const secure = deps.baseUrl.startsWith('https://');
  const redirectUri = `${deps.baseUrl}/auth/callback`;
  const app = new Hono<Env>();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'https://cdn.discordapp.com'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        formAction: ["'self'", 'https://discord.com'],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'same-origin',
    }),
  );

  app.onError((err, c) => {
    logger.error({ err, path: c.req.path }, 'web error');
    return c.text('エラーが発生しました。時間をおいてもう一度お試しください。', 500);
  });

  app.get('/healthz', (c) => c.text('ok'));
  app.get('/static/:file', (c) => {
    const f = STATIC[c.req.param('file')];
    if (!f) return c.notFound();
    return c.body(f.body, 200, { 'content-type': f.type, 'cache-control': 'public, max-age=3600' });
  });

  // ───────── ログイン ─────────

  app.get('/login', (c) => c.html(<LoginPage error={c.req.query('e')} />));

  app.get('/auth/discord', (c) => {
    const state = randomToken();
    setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure, sameSite: 'Lax', path: '/auth', maxAge: 600 });
    return c.redirect(api.authorizeUrl(state, redirectUri));
  });

  app.get('/auth/callback', async (c) => {
    const state = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: '/auth' });
    const code = c.req.query('code');
    if (!state || !code || !safeEqual(state, c.req.query('state') ?? '')) return c.redirect('/login?e=state');

    let user;
    let roles;
    try {
      const token = await api.exchangeCode(code, redirectUri);
      user = await api.me(token);
      roles = await api.memberRoles(cfg.guildId, user.id);
    } catch (err) {
      logger.warn({ err }, 'discord login failed');
      return c.redirect('/login?e=failed');
    }

    const level = roles ? adminLevelOf(cfg, roles) : undefined;
    if (!level) {
      await audit(db, { actorId: user.id, action: 'auth.denied', via: 'web' });
      return c.redirect('/login?e=forbidden');
    }
    const token = await createSession(db, user, level, now());
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_HOURS * 3600,
    });
    await audit(db, { actorId: user.id, action: 'auth.login', detail: { level }, via: 'web' });
    return c.redirect('/');
  });

  // ───────── ここから先はログイン必須 ─────────

  const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? await findSession(db, token, now()) : undefined;
    if (!session) return toLogin(c, token ? 'expired' : undefined);

    // 一定時間ごとに、今も神職・宮司のロールを持っているか Discord に確かめる
    if (now().getTime() - session.checkedAt.getTime() > RECHECK_MS) {
      let roles: string[] | null;
      try {
        roles = await api.memberRoles(cfg.guildId, session.userId);
      } catch (err) {
        logger.warn({ err }, 'role recheck failed');
        return c.text('Discord に接続できませんでした。時間をおいてもう一度お試しください。', 503);
      }
      const level = roles ? adminLevelOf(cfg, roles) : undefined;
      if (!level) {
        await deleteSession(db, session.id);
        await audit(db, { actorId: session.userId, action: 'auth.revoked', via: 'system' });
        deleteCookie(c, SESSION_COOKIE, { path: '/' });
        return toLogin(c, 'forbidden');
      }
      await markChecked(db, session.id, level, now());
      session.level = level;
    }
    c.set('session', session);
    await next();
  };

  const requireCsrf: MiddlewareHandler<Env> = async (c, next) => {
    const body = await c.req.parseBody();
    const sent = typeof body._csrf === 'string' ? body._csrf : (c.req.header('x-csrf-token') ?? '');
    if (!safeEqual(sent, c.get('session').csrfToken)) return c.text('不正なリクエストです（CSRF）。', 403);
    await next();
  };

  const toLogin = (c: Context<Env>, error?: string) => {
    const url = error ? `/login?e=${error}` : '/login';
    // htmx からのリクエストはページごと移動させる
    if (c.req.header('hx-request')) return c.body(null, 401, { 'hx-redirect': url });
    return c.redirect(url);
  };

  app.use('/', requireAdmin);
  app.use('/members', requireAdmin);
  app.use('/members/*', requireAdmin);
  app.use('/audit', requireAdmin);
  app.use('/yaku', requireAdmin);
  app.use('/logout', requireAdmin);

  app.post('/logout', requireCsrf, async (c) => {
    const s = c.get('session');
    await deleteSession(db, s.id);
    await audit(db, { actorId: s.userId, action: 'auth.logout', via: 'web' });
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.redirect('/login');
  });

  app.get('/', async (c) => {
    const t = now();
    const [base, recent, yakuRows] = await Promise.all([homeStats(db, startOfTodayJst(t)), listAudit(db, { limit: 10 }), membersWithYaku(db)]);
    const stats = { ...base, yaku: yakuRows.length };
    const names = await namesOf(db, recent.flatMap((a) => [a.actorId, a.targetId ?? '']).filter(Boolean));
    return c.html(<HomePage session={c.get('session')} stats={stats} recent={recent} names={names} now={t} />);
  });

  app.get('/members', async (c) => {
    const q = c.req.query();
    const rank = cfg.ranks.find((r) => r.key === q.rank);
    const query: MemberListQuery & { rank?: string } = {
      q: q.q?.slice(0, 100),
      rank: rank?.key,
      roleId: rank?.roleId,
      ageGroup: q.age === 'minor' || q.age === 'adult' || q.age === 'unknown' ? q.age : undefined,
      status: q.status === 'left' || q.status === 'all' ? q.status : 'active',
      inactiveDays: Number(q.inactive) > 0 ? Math.min(Number(q.inactive), 3650) : undefined,
      sort: q.sort === 'joined' || q.sort === 'active' || q.sort === 'name' ? q.sort : 'goen',
      page: Number(q.page) > 0 ? Math.floor(Number(q.page)) : 1,
    };
    const t = now();
    const result = await listMembers(db, query, t);
    if (c.req.header('hx-request')) return c.html(<MemberResults cfg={cfg} query={query} result={result} now={t} />);
    return c.html(<MembersPage session={c.get('session')} cfg={cfg} query={query} result={result} now={t} />);
  });

  app.get('/members/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.html(<NotFoundPage session={c.get('session')} />, 404);
    const member = await getMember(db, id);
    if (!member) return c.html(<NotFoundPage session={c.get('session')} />, 404);
    const session = c.get('session');
    const [card, history, events, audits, yakuRows, activeYaku, used, wallet, coinTx, activity, memoRows, denied] = await Promise.all([
      goshuinchoOf(db, id),
      shuinHistory(db, id),
      eventsOf(db, id),
      listAudit(db, { targetId: id, limit: 50 }),
      yakuHistory(db, id),
      activeYakuCount(db, id),
      menzaifuUsed(db, id),
      walletOf(db, id),
      recentCoinTx(db, id, 15),
      recentActivity(db, id, 14),
      memosOf(db, id),
      checkTarget(modCtx, actorOf(session), id),
    ]);
    const names = await namesOf(db, [
      ...history.received.map((r) => r.other),
      ...history.given.map((r) => r.other),
      ...audits.map((a) => a.actorId),
      ...yakuRows.flatMap((y) => [y.issuedBy, y.clearedBy ?? '']),
      ...memoRows.map((m) => m.authorId),
    ]);
    const flash = c.req.query('msg');
    return c.html(
      <MemberPage
        session={c.get('session')}
        cfg={cfg}
        member={member}
        card={card}
        history={history}
        events={events}
        audits={audits}
        names={names}
        now={now()}
        flash={flash && FLASH[flash] ? flash : undefined}
        moderation={
          <ModerationSection
            cfg={cfg}
            memberId={id}
            csrf={session.csrfToken}
            canModerate={!denied}
            deniedText={denied ? FLASH[`denied_${denied}`]?.text : undefined}
            yaku={yakuRows}
            activeYaku={activeYaku}
            menzaifuUsed={used}
            wallet={wallet}
            coinTx={coinTx}
            activity={activity}
            memos={memoRows}
            names={names}
          />
        }
      />,
    );
  });

  // ───────── 厄・BAN・キック・メモ ─────────

  const modCtx: ModCtx = { db, cfg, discord: deps.discord };
  const actorOf = (s: AdminSession): Actor => ({ id: s.userId, level: s.level === 'guji' ? 'guji' : 'shinshoku', via: 'web' });
  const back = (c: Context<Env>, id: string, msg: string) => c.redirect(`/members/${id}?msg=${msg}`);
  const deniedCode = (d: Denied) => `denied_${d}`;
  const field = (body: Record<string, unknown>, k: string, max = 300) =>
    (typeof body[k] === 'string' ? (body[k] as string) : '').trim().slice(0, max);
  const validId = (id: string) => /^\d{17,20}$/.test(id);

  app.use('/members/:id/*', requireCsrf);

  app.post('/members/:id/yaku', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const body = await c.req.parseBody();
    const reason = field(body, 'reason');
    const note = field(body, 'note');
    if (!cfg.moderation.yakuReasons.includes(reason) && reason !== 'その他') return back(c, id, 'invalid');
    if (reason === 'その他' && !note) return back(c, id, 'invalid');
    const text = note ? (reason === 'その他' ? note : `${reason}（${note}）`) : reason;
    const session = c.get('session');
    const r = await giveYaku(modCtx, actorOf(session), id, text, body.confirm === 'yes');
    if (r.status === 'denied') return back(c, id, deniedCode(r.reason));
    if (r.status === 'needs_confirm') {
      const target = await getMember(db, id);
      return c.html(
        <ConfirmPage
          session={session}
          title="厄 2 つ目（BAN）"
          message="この方にはすでに厄が 1 つあります。厄を付けると BAN になります。"
          targetName={target?.displayName ?? id}
          action={`/members/${id}/yaku`}
          fields={{ reason, note }}
          button="厄を付けて BAN する"
          backUrl={`/members/${id}`}
        />,
      );
    }
    if (r.status === 'banned') return back(c, id, r.banOk ? 'banned' : 'ban_failed');
    return back(c, id, r.dmSent ? 'warned' : 'warned_nodm');
  });

  app.post('/members/:id/yaku/clear', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const note = field(await c.req.parseBody(), 'note');
    if (!note) return back(c, id, 'invalid');
    const r = await clearYaku(modCtx, actorOf(c.get('session')), id, note);
    if (r.status === 'denied') return back(c, id, deniedCode(r.reason));
    return back(c, id, r.status === 'cleared' ? 'cleared' : 'no_yaku');
  });

  app.post('/members/:id/ban', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const body = await c.req.parseBody();
    const reason = field(body, 'reason');
    const note = field(body, 'note');
    if (!cfg.moderation.instantBanReasons.includes(reason)) return back(c, id, 'invalid');
    const session = c.get('session');
    if (body.confirm !== 'yes') {
      const denied = await checkTarget(modCtx, actorOf(session), id);
      if (denied) return back(c, id, deniedCode(denied));
      const target = await getMember(db, id);
      return c.html(
        <ConfirmPage
          session={session}
          title="一発 BAN"
          message="重大な違反として、厄を経ずに BAN します。本人には理由だけを DM で知らせます。"
          targetName={target?.displayName ?? id}
          action={`/members/${id}/ban`}
          fields={{ reason, note }}
          button="BAN する"
          backUrl={`/members/${id}`}
        />,
      );
    }
    const r = await instantBan(modCtx, actorOf(session), id, reason, note);
    if (r.status === 'denied') return back(c, id, deniedCode(r.reason));
    return back(c, id, r.banOk ? 'banned' : 'ban_failed');
  });

  app.post('/members/:id/kick', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const body = await c.req.parseBody();
    const reason = field(body, 'reason');
    if (!reason) return back(c, id, 'invalid');
    const session = c.get('session');
    if (body.confirm !== 'yes') {
      const denied = await checkTarget(modCtx, actorOf(session), id);
      if (denied) return back(c, id, deniedCode(denied));
      const target = await getMember(db, id);
      return c.html(
        <ConfirmPage
          session={session}
          title="キック"
          message="サーバーから退出させます（招待があればまた参加できます）。"
          targetName={target?.displayName ?? id}
          action={`/members/${id}/kick`}
          fields={{ reason }}
          button="キックする"
          backUrl={`/members/${id}`}
        />,
      );
    }
    const r = await kickMember(modCtx, actorOf(session), id, reason);
    if (r.status === 'denied') return back(c, id, deniedCode(r.reason));
    return back(c, id, r.kickOk ? 'kicked' : 'kick_failed');
  });

  app.post('/members/:id/memo', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const body = field(await c.req.parseBody(), 'body', 1000);
    if (!body) return back(c, id, 'invalid');
    const r = await writeMemo(modCtx, actorOf(c.get('session')), id, body);
    return back(c, id, r === 'ok' ? 'memo' : 'denied_not_found');
  });

  app.get('/yaku', async (c) => {
    const rows = await membersWithYaku(db);
    return c.html(<YakuPage session={c.get('session')} rows={rows} now={now()} />);
  });

  app.get('/audit', async (c) => {
    const rows = await listAudit(db, { limit: 200 });
    const names = await namesOf(db, rows.flatMap((a) => [a.actorId, a.targetId ?? '']).filter(Boolean));
    return c.html(<AuditPage session={c.get('session')} rows={rows} names={names} now={now()} />);
  });

  app.notFound((c) => c.html(<NotFoundPage />, 404));

  return app;
}

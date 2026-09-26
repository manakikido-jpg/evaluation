import { randomUUID } from 'node:crypto';
import { STATIC } from './assets.js';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { AdminSession } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { audit, listAudit } from '../services/audit.js';
import { eventsOf, getMember, homeStats, listMembers, namesOf, shuinHistory, type MemberListQuery } from '../services/members.js';
import { goshuinchoOf } from '../services/shuin.js';
import { recentActivity } from '../services/activity.js';
import { adminGrant, adminTake, currentMemberIds, grantJoinBonusToAll, recentCoinTx, validAdminAmount, walletOf } from '../services/economy.js';
import { checkTarget, clearYaku, giveYaku, instantBan, isBannedByEvents, kickMember, unbanMember, writeMemo, type Actor, type Denied, type ModCtx } from '../services/moderation.js';
import { activeYakuCount, memosOf, membersWithYaku, menzaifuUsed, yakuHistory } from '../services/yaku.js';
import type { DiscordActions } from '../lib/discordRest.js';
import type { DiscordApi } from './discordApi.js';
import { startOfTodayJst } from './format.js';
import { createSession, deleteSession, findSession, markChecked, randomToken, RECHECK_MS, safeEqual, SESSION_HOURS } from './sessions.js';

/** ロールの確かめ直しに失敗しても使い続けてよい時間 */
const RECHECK_GRACE_MS = 30 * 60_000;
import { StatsPage } from './views/stats.js';
import { isTrendRange, memberTrend } from '../services/stats.js';
import { AuditPage, HomePage, LoginPage, MemberPage, MemberResults, MembersPage, NotFoundPage } from './views/pages.js';
import { ConfirmPage, FLASH, ModerationSection, YakuPage } from './views/moderation.js';
import { ADMISSION_FLASH, ApplicationsPage, MemberAdmissionSection, OmairiPage, SettingsPage, SoudanListPage, SoudanPage } from './views/admission.js';
import { applicationsOf, getOmairi, omairiList, pendingApplications, recentDecidedApplications } from '../services/applications.js';
import { changeAgeGroup, closeSoudan, decide, decideOmairi, removeYoimairi, replySoudan, revealSoudanSender, type OmairiAction } from '../services/admission.js';
import { getSoudan, listSoudan, soudanMessagesOf } from '../services/soudan.js';
import { applyOverrides, overridesSchema, saveOverrides, type Overrides } from '../services/settings.js';
import {
  createNotice,
  deleteNotice,
  getNotice,
  guildChannelsCached,
  listNotices,
  moveNotice,
  noticeStatus,
  noticeVariables,
  isNoticeStyle,
  postableChannels,
  publishAll,
  publishNotice,
  renderNotice,
  repostChannel,
  seedChannelGuides,
  seedDefaultNotices,
  syncPostedNotices,
  updateNotice,
  type NoticeCtx,
} from '../services/notices.js';
import { NoticeDeletePage, NoticeEditPage, NoticePreview, NoticesPage, type NoticeGroup } from './views/notices.js';
import { ShopPage } from './views/shop.js';
import { ChannelsPage } from './views/channels.js';
import { listTextChannels, modeOf as channelModeOf, planMode as planChannelMode } from '../services/channels.js';
import {
  createItem as createShopItem,
  deleteItem as deleteShopItem,
  getItem as getShopItem,
  listItems as listShopItems,
  recentPurchases,
  updateItem as updateShopItem,
} from '../services/shop.js';
import type { GuildChannel } from '../lib/discordRest.js';

export type WebDeps = {
  db: Db;
  /** 設定（管理画面で変えた値を重ねたもの）。関数なら毎回読み直す */
  cfg: GuildConfig | (() => GuildConfig);
  /** 設定画面で保存したあとに呼ぶ（ConfigStore の読み直し） */
  onSettingsSaved?: () => Promise<void>;
  /** config/guild.json そのままの値（設定画面で「ファイルの値」として見せる） */
  fileCfg?: GuildConfig;
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



export function createWebApp(deps: WebDeps) {
  const { db, api } = deps;
  const getCfg: () => GuildConfig = typeof deps.cfg === 'function' ? deps.cfg : ((c: GuildConfig) => () => c)(deps.cfg);
  let cfg = getCfg();
  const now = deps.now ?? (() => new Date());
  const secure = deps.baseUrl.startsWith('https://');
  const redirectUri = `${deps.baseUrl}/auth/callback`;
  const app = new Hono<Env>();
  const mod = (): ModCtx => ({ db, cfg, discord: deps.discord });

  // リクエストごとに最新の設定を使う
  app.use(async (_c, next) => {
    cfg = getCfg();
    await next();
  });

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

  // 送れる大きさの上限（掲示の本文でも十分な 256KB）
  app.use(bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.text('送る内容が大きすぎます。', 413) }));

  // 管理画面の中身（相談・メモなど）をブラウザや共用 PC に残さない。htmx の部分表示と全体表示を取り違えないように
  app.use(async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/static/') && c.req.path !== '/healthz') {
      c.header('Cache-Control', 'no-store');
      c.header('Vary', 'HX-Request');
    }
  });

  app.onError((err, c) => {
    logger.error({ err, path: c.req.path }, 'web error');
    return c.text('エラーが発生しました。時間をおいてもう一度お試しください。', 500);
  });

  app.get('/healthz', (c) => c.text('ok'));
  app.get('/static/:file', (c) => {
    const name = c.req.param('file');
    const f = Object.hasOwn(STATIC, name) ? STATIC[name] : undefined;
    if (!f) return c.notFound();
    // 印（?v=）が今の中身と同じなら長く覚えてよい。印なし・古い印は短く
    const cache = c.req.query('v') === f.version ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
    return c.body(f.body, 200, { 'content-type': f.type, 'cache-control': cache });
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
      const [last] = await listAudit(db, { actorId: user.id, action: 'auth.denied', limit: 1 });
      if (!last || now().getTime() - last.at.getTime() > 3_600_000) await audit(db, { actorId: user.id, action: 'auth.denied', via: 'web' });
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
      let roles: string[] | null | undefined;
      try {
        roles = await api.memberRoles(cfg.guildId, session.userId);
      } catch (err) {
        logger.warn({ err }, 'role recheck failed');
        // Discord が混んでいる（429 など）とき: 少し前に確かめていれば、そのまま使える
        if (now().getTime() - session.checkedAt.getTime() > RECHECK_GRACE_MS) {
          return c.text('Discord に接続できませんでした。時間をおいてもう一度お試しください。', 503);
        }
        roles = undefined;
      }
      if (roles === undefined) {
        c.set('session', session);
        return next();
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
    if (c.req.method !== 'POST') return next();
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
  app.use('/members/*', requireAdmin);
  app.use('/audit', requireAdmin);
  app.use('/yaku', requireAdmin);
  app.use('/stats', requireAdmin);
  for (const p of ['/applications/*', '/omairi/*', '/soudan/*', '/settings/*', '/notices/*', '/shop/*', '/channels/*']) {
    app.use(p, requireAdmin);
    app.use(p, requireCsrf);
  }
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
    const [base, recent, yakuRows, pending, review, soudanOpen, trend] = await Promise.all([
      homeStats(db, startOfTodayJst(t)),
      listAudit(db, { limit: 10 }),
      membersWithYaku(db),
      pendingApplications(db),
      omairiList(db, ['review']),
      listSoudan(db, ['open']),
      memberTrend(db, '30d', t),
    ]);
    const stats = { ...base, yaku: yakuRows.length };
    const todo = { applications: pending.length, omairi: review.length, soudan: soudanOpen.length };
    const names = await namesOf(db, recent.flatMap((a) => [a.actorId, a.targetId ?? '']).filter(Boolean));
    return c.html(<HomePage session={c.get('session')} stats={stats} todo={todo} recent={recent} names={names} now={t} trend={trend} />);
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
    if (c.req.header('hx-request') && !c.req.header('hx-history-restore-request')) return c.html(<MemberResults cfg={cfg} query={query} result={result} now={t} />);
    return c.html(<MembersPage session={c.get('session')} cfg={cfg} query={query} result={result} now={t} />);
  });

  app.get('/members/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.html(<NotFoundPage session={c.get('session')} />, 404);
    const member = await getMember(db, id);
    if (!member) return c.html(<NotFoundPage session={c.get('session')} />, 404);
    const session = c.get('session');
    const [apps, omairiRow] = await Promise.all([applicationsOf(db, id), getOmairi(db, id)]);
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
      checkTarget(mod(), actorOf(session), id),
    ]);
    const names = await namesOf(db, [
      ...history.received.map((r) => r.other),
      ...history.given.map((r) => r.other),
      ...audits.map((a) => a.actorId),
      ...yakuRows.flatMap((y) => [y.issuedBy, y.clearedBy ?? '']),
      ...memoRows.map((m) => m.authorId),
      ...apps.map((a) => a.reviewedBy ?? ''),
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
        flash={flash && Object.hasOwn(FLASH, flash) ? flash : undefined}
        moderation={
          <>
          {flash && Object.hasOwn(ADMISSION_FLASH, flash) && !Object.hasOwn(FLASH, flash) && <p class={`flash ${ADMISSION_FLASH[flash]!.kind}`}>{ADMISSION_FLASH[flash]!.text}</p>}
          <MemberAdmissionSection
            session={session}
            cfg={cfg}
            memberId={id}
            ageGroup={member.ageGroup}
            roleIds={member.roleIds}
            omairi={omairiRow}
            applications={apps}
            names={names}
          />
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
            showUnban={session.level === 'guji' && isBannedByEvents(events)}
            coinsNonce={session.level === 'guji' && !member.isBot ? randomUUID() : undefined}
          />
          </>
        }
      />,
    );
  });

  // ───────── 推移（グラフ） ─────────

  app.get('/stats', async (c) => {
    const q = c.req.query('range');
    const range = isTrendRange(q) ? q : '30d';
    const buckets = await memberTrend(db, range, now());
    return c.html(<StatsPage session={c.get('session')} range={range} buckets={buckets} />);
  });

  // ───────── 厄・BAN・キック・メモ ─────────

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
    const r = await giveYaku(mod(), actorOf(session), id, text, body.confirm === 'yes');
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
    const r = await clearYaku(mod(), actorOf(c.get('session')), id, note);
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
      const denied = await checkTarget(mod(), actorOf(session), id);
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
    const r = await instantBan(mod(), actorOf(session), id, reason, note);
    if (r.status === 'denied') return back(c, id, deniedCode(r.reason));
    return back(c, id, r.banOk ? 'banned' : 'ban_failed');
  });

  app.post('/members/:id/unban', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const body = await c.req.parseBody();
    const note = field(body, 'note');
    const keep = body.keep === '0' ? 0 : body.keep === '1' ? 1 : undefined;
    if (keep === undefined || !note) return back(c, id, 'invalid');
    const r = await unbanMember(mod(), actorOf(c.get('session')), id, keep, note);
    if (r.status === 'forbidden') return back(c, id, 'unban_forbidden');
    if (r.status === 'failed') return back(c, id, 'unban_failed');
    if (r.status === 'not_banned') return back(c, id, 'unban_not_banned');
    return back(c, id, r.alreadyUnbanned ? 'unbanned_already' : 'unbanned');
  });

  app.post('/members/:id/kick', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const body = await c.req.parseBody();
    const reason = field(body, 'reason');
    if (!reason) return back(c, id, 'invalid');
    const session = c.get('session');
    if (body.confirm !== 'yes') {
      const denied = await checkTarget(mod(), actorOf(session), id);
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
    const r = await kickMember(mod(), actorOf(session), id, reason);
    if (r.status === 'denied') return back(c, id, deniedCode(r.reason));
    return back(c, id, r.kickOk ? 'kicked' : 'kick_failed');
  });

  const NONCE = /^[0-9a-f-]{36}$/;

  app.post('/members/:id/coins', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    if (!gujiOnly(c)) return back(c, id, 'coins_forbidden');
    const body = await c.req.parseBody();
    const amount = Number(body.amount);
    const note = field(body, 'note', 200);
    const nonce = typeof body.nonce === 'string' ? body.nonce : '';
    const mode = body.mode === 'take' ? 'take' : 'grant';
    if (!validAdminAmount(amount) || !note || !NONCE.test(nonce)) return back(c, id, 'coins_invalid');
    const m = await getMember(db, id);
    if (!m || m.isBot) return back(c, id, 'denied_not_found');
    const by = c.get('session').userId;
    if (mode === 'take') {
      const r = await adminTake(db, { memberId: id, amount, note, by, nonce });
      if (r.status === 'duplicate') return back(c, id, 'coins_dup');
      await audit(db, { actorId: by, targetId: id, action: 'coins.take', detail: { amount, taken: r.taken, note }, via: 'web' });
      return back(c, id, r.taken < amount ? 'coins_taken_short' : 'coins_taken');
    }
    const r = await adminGrant(db, { memberIds: [id], amount, note, by, nonce });
    if (r.status === 'duplicate') return back(c, id, 'coins_dup');
    await audit(db, { actorId: by, targetId: id, action: 'coins.grant', detail: { amount, note }, via: 'web' });
    if (body.dm !== 'yes') return back(c, id, 'coins_given_quiet');
    const e = cfg.economy;
    const sent = await deps.discord.sendDm(
      id,
      `${e.currencyEmoji} 咲楽ノ宮の社務所から、${e.currencyName}が **${amount.toLocaleString('ja-JP')} 枚** 届きました。\n> ${note}\n残高は \`/御朱印帳\` で見られます。`,
    );
    return back(c, id, sent ? 'coins_given' : 'coins_given_nodm');
  });

  app.post('/members/:id/memo', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const body = field(await c.req.parseBody(), 'body', 1000);
    if (!body) return back(c, id, 'invalid');
    const r = await writeMemo(mod(), actorOf(c.get('session')), id, body);
    return back(c, id, r === 'ok' ? 'memo' : 'denied_not_found');
  });

  app.get('/yaku', async (c) => {
    const rows = await membersWithYaku(db);
    return c.html(<YakuPage session={c.get('session')} rows={rows} now={now()} />);
  });


  // ───────── 年齢区分・宵参り（メンバー詳細から） ─────────

  app.post('/members/:id/age', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const age = field(await c.req.parseBody(), 'age');
    if (age !== 'minor' && age !== 'adult' && age !== 'unknown') return back(c, id, 'invalid');
    const r = await changeAgeGroup(mod(), actorOf(c.get('session')), id, age);
    return back(c, id, r === 'ok' ? 'age_changed' : r === 'forbidden' ? 'forbidden' : 'denied_not_found');
  });

  app.post('/members/:id/yoimairi/remove', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const reason = field(await c.req.parseBody(), 'reason');
    if (!reason) return back(c, id, 'invalid');
    const r = await removeYoimairi(mod(), actorOf(c.get('session')), id, reason);
    return back(c, id, r === 'ok' ? 'yoimairi_removed' : r === 'denied' ? 'denied_protected' : 'invalid');
  });

  // ───────── 申請 ─────────

  app.get('/applications', async (c) => {
    const [pending, decided] = await Promise.all([pendingApplications(db), recentDecidedApplications(db)]);
    const names = await namesOf(db, decided.map((d) => d.app.reviewedBy ?? ''));
    const flash = c.req.query('msg');
    return c.html(
      <ApplicationsPage session={c.get('session')} pending={pending} decided={decided} names={names} now={now()} flash={flash} />,
    );
  });

  app.post('/applications/:id/decide', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.notFound();
    const body = await c.req.parseBody();
    const approve = body.approve === 'yes';
    const r = await decide(mod(), actorOf(c.get('session')), id, approve, field(body, 'note'));
    const code = r.status === 'approved' || r.status === 'rejected' ? r.status : r.status === 'not_adult' ? 'not_adult' : 'already_decided';
    return c.redirect(`/applications?msg=${code}`);
  });

  // ───────── お参り期間 ─────────

  app.get('/omairi', async (c) => {
    const [review, ongoing] = await Promise.all([omairiList(db, ['review']), omairiList(db, ['ongoing'])]);
    return c.html(<OmairiPage session={c.get('session')} cfg={cfg} review={review} ongoing={ongoing} now={now()} flash={c.req.query('msg')} />);
  });

  app.post('/omairi/:memberId', async (c) => {
    const memberId = c.req.param('memberId');
    if (!validId(memberId)) return c.notFound();
    const body = await c.req.parseBody();
    const action = field(body, 'action');
    if (action !== 'extend' && action !== 'promote' && action !== 'remove') return c.redirect('/omairi?msg=invalid');
    // 退出（キック）は確認画面を通す
    if (action === 'remove' && body.confirm !== 'yes') {
      const target = await getMember(db, memberId);
      return c.html(
        <ConfirmPage
          session={c.get('session')}
          title="お参り期間の判定: 退出"
          message="お参り期間が終わった方を退出（キック）させます。本人には DM で知らせます。"
          targetName={target?.displayName ?? memberId}
          action={`/omairi/${memberId}`}
          fields={{ action: 'remove' }}
          button="退出にする"
          backUrl="/omairi"
        />,
      );
    }
    const r = await decideOmairi(mod(), actorOf(c.get('session')), memberId, action as OmairiAction, now());
    return c.redirect(`/omairi?msg=${r === 'ok' ? 'omairi_ok' : 'omairi_missing'}`);
  });

  // ───────── 相談 ─────────

  app.get('/soudan', async (c) => {
    const status = c.req.query('status') === 'done' ? 'done' : 'active';
    const rows = await listSoudan(db, status === 'done' ? ['done'] : ['open', 'in_progress']);
    const names = await namesOf(db, rows.map((r) => r.assigneeId ?? ''));
    return c.html(<SoudanListPage session={c.get('session')} rows={rows} status={status} names={names} now={now()} />);
  });

  const soudanPage = async (c: Context<Env>, id: number, extra: { revealed?: string; flash?: string } = {}) => {
    const s = await getSoudan(db, id);
    if (!s) return c.html(<NotFoundPage session={c.get('session')} />, 404);
    const messages = await soudanMessagesOf(db, id);
    const names = await namesOf(db, [...messages.map((m) => m.staffId ?? ''), extra.revealed ?? '']);
    return c.html(<SoudanPage session={c.get('session')} soudan={s} messages={messages} names={names} {...extra} />);
  };
  const soudanId = (c: Context<Env>) => {
    const id = Number(c.req.param('id'));
    return Number.isInteger(id) && id > 0 ? id : undefined;
  };

  app.get('/soudan/:id', async (c) => {
    const id = soudanId(c);
    if (!id) return c.notFound();
    return soudanPage(c, id, { flash: c.req.query('msg') });
  });

  app.post('/soudan/:id/reply', async (c) => {
    const id = soudanId(c);
    if (!id) return c.notFound();
    const body = field(await c.req.parseBody(), 'body', 1500);
    if (!body) return c.redirect(`/soudan/${id}?msg=invalid`);
    const r = await replySoudan(mod(), actorOf(c.get('session')), id, body);
    if (r.status === 'not_found') return c.notFound();
    return c.redirect(`/soudan/${id}?msg=${r.dmSent ? 'replied' : 'replied_nodm'}`);
  });

  app.post('/soudan/:id/done', async (c) => {
    const id = soudanId(c);
    if (!id) return c.notFound();
    await closeSoudan(mod(), actorOf(c.get('session')), id);
    return c.redirect(`/soudan/${id}?msg=soudan_done`);
  });

  app.post('/soudan/:id/reveal', async (c) => {
    const id = soudanId(c);
    if (!id) return c.notFound();
    const reason = field(await c.req.parseBody(), 'reason');
    if (!reason) return c.redirect(`/soudan/${id}?msg=invalid`);
    const r = await revealSoudanSender(mod(), actorOf(c.get('session')), id, reason);
    if (r === 'forbidden') return c.redirect(`/soudan/${id}?msg=forbidden`);
    if (r === 'not_found') return c.notFound();
    return soudanPage(c, id, { revealed: r });
  });

  // ───────── 設定（宮司のみ） ─────────

  const fileCfg = () => deps.fileCfg ?? cfg;
  const gujiOnly = (c: Context<Env>) => c.get('session').level === 'guji';

  app.get('/settings', (c) => {
    if (!gujiOnly(c)) return c.html(<NotFoundPage session={c.get('session')} />, 403);
    return c.html(<SettingsPage session={c.get('session')} cfg={cfg} fileCfg={fileCfg()} flash={c.req.query('msg')} coinsNonce={randomUUID()} />);
  });

  const longText = (v: unknown) => (typeof v === 'string' && v.trim() ? v.replace(/\r\n/g, '\n').trim().slice(0, 1000) : undefined);

  app.post('/settings', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const num = (k: string) => Number(typeof body[k] === 'string' ? body[k] : NaN);
    const raw = {
      economy: {
        currencyName: field(body, 'currencyName', 20),
        currencyEmoji: field(body, 'currencyEmoji', 10),
        menzaifuPrice: num('menzaifuPrice'),
        menzaifuMaxUses: num('menzaifuMaxUses'),
        voicePer10Min: num('voicePer10Min'),
        voiceDailyCap: num('voiceDailyCap'),
        shuinGive: num('shuinGive'),
        shuinReceive: num('shuinReceive'),
        omikujiBase: num('omikujiBase'),
        joinBonus: num('joinBonus'),
        giftMin: num('giftMin'),
        giftMax: num('giftMax'),
        giftDailyLimit: num('giftDailyLimit'),
        boostThanks: num('boostThanks'),
        boostDiscountPercent: num('boostDiscountPercent'),
      },
      boost: {
        // 空なら標準の文面に戻す
        announceText: longText(body.boostAnnounce),
        dmText: longText(body.boostDm),
      },
      ranks: Object.fromEntries(
        cfg.ranks.map((r) => [r.key, { weight: num(`rank.${r.key}.weight`), ...(r.auto ? { requiredGoen: num(`rank.${r.key}.requiredGoen`) } : {}) }]),
      ),
      omairi: { days: num('omairiDays'), extendDays: num('omairiExtendDays') },
      applications: { autoApproveAccountDays: num('autoApproveAccountDays'), kickOnReject: body.kickOnReject === 'yes' },
    };
    let overrides: Overrides;
    try {
      overrides = overridesSchema.parse(raw);
      applyOverrides(fileCfg(), overrides);
    } catch {
      return c.redirect('/settings?msg=settings_invalid');
    }
    const before = cfg;
    await saveOverrides(db, overrides, c.get('session').userId);
    await deps.onSettingsSaved?.();
    const after = applyOverrides(fileCfg(), overrides);
    // 投稿済みの掲示の数字（免罪符の値段など）も新しい値に書き換える
    const noticesUpdated = await syncPostedNotices({ db, cfg: after, discord: deps.discord }, before);
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'settings.update',
      detail: { economy: diff(before.economy, after.economy), omairi: diff(before.omairi, after.omairi), applications: diff(before.applications, after.applications), ranks: rankDiff(before, after) },
      via: 'web',
    });
    return c.redirect(noticesUpdated > 0 ? '/settings?msg=saved_notices' : '/settings?msg=saved');
  });

  app.post('/settings/join-bonus-all', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    if (body.confirm !== 'yes') return c.redirect('/settings');
    const r = await grantJoinBonusToAll(db, cfg.economy.joinBonus, cfg.ranks.map((x) => x.roleId));
    await audit(db, { actorId: c.get('session').userId, action: 'economy.join_bonus_all', detail: { amount: cfg.economy.joinBonus, ...r }, via: 'web' });
    return c.redirect('/settings?msg=bonus_given');
  });

  app.post('/settings/coins-all', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const amount = Number(body.amount);
    const note = field(body, 'note', 200);
    const nonce = typeof body.nonce === 'string' ? body.nonce : '';
    if (body.confirm !== 'yes' || !validAdminAmount(amount) || !note || !/^[0-9a-f-]{36}$/.test(nonce)) return c.redirect('/settings?msg=coins_invalid');
    const by = c.get('session').userId;
    const targets = await currentMemberIds(db, cfg.ranks.map((x) => x.roleId));
    const r = await adminGrant(db, { memberIds: targets, amount, note, by, nonce });
    if (r.status === 'duplicate') return c.redirect('/settings?msg=coins_dup');
    await audit(db, { actorId: by, action: 'coins.grant_all', detail: { amount, note, count: r.count }, via: 'web' });
    return c.redirect('/settings?msg=coins_all_given');
  });

  app.post('/settings/reset', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const before = cfg;
    await saveOverrides(db, overridesSchema.parse({}), c.get('session').userId);
    await deps.onSettingsSaved?.();
    await syncPostedNotices({ db, cfg: applyOverrides(fileCfg(), overridesSchema.parse({})), discord: deps.discord }, before);
    await audit(db, { actorId: c.get('session').userId, action: 'settings.reset', via: 'web' });
    return c.redirect('/settings?msg=saved');
  });

  // ───────── 掲示（宮司のみ） ─────────

  const noticeCtx = (): NoticeCtx => ({ db, cfg, discord: deps.discord });
  const loadChannels = async (fresh = false): Promise<GuildChannel[]> => {
    try {
      return await guildChannelsCached(deps.discord, cfg.guildId, fresh);
    } catch (err) {
      logger.warn({ err }, 'could not load guild channels');
      return [];
    }
  };
  const noticeId = (c: Context<Env>) => {
    const n = Number(c.req.param('id'));
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  };
  /** Discord に失敗したら、画面を壊さずに知らせる */
  const tryDiscord = async (c: Context<Env>, back: string, fn: () => Promise<string>) => {
    try {
      return c.redirect(`${back}?msg=${await fn()}`);
    } catch (err) {
      logger.warn({ err }, 'notice discord action failed');
      return c.redirect(`${back}?msg=discord_error`);
    }
  };

  app.use('/notices', async (c, next) => (gujiOnly(c) ? next() : c.html(<NotFoundPage session={c.get('session')} />, 403)));
  app.use('/notices/*', async (c, next) => (gujiOnly(c) ? next() : c.text('宮司のみできる操作です。', 403)));

  app.get('/notices', async (c) => {
    const channels = await loadChannels();
    const byId = new Map(channels.map((ch) => [ch.id, ch]));
    const groups: NoticeGroup[] = [];
    for (const n of await listNotices(db)) {
      let g = groups.find((x) => x.channelId === n.channelId);
      if (!g) groups.push((g = { channelId: n.channelId, channelName: byId.get(n.channelId)?.name ?? null, rows: [] }));
      const text = renderNotice(n.body, cfg, channels).text;
      const preview = renderNotice(n.body, cfg, channels, { forPreview: true });
      g.rows.push({ notice: n, preview: preview.text, length: text.length, status: noticeStatus(n, text), unknown: preview.unknown });
    }
    // Discord のチャンネルの並び順に合わせる
    const order = new Map(postableChannels(channels).map((ch, i) => [ch.id, i]));
    groups.sort((a, b) => (order.get(a.channelId) ?? 999) - (order.get(b.channelId) ?? 999));
    return c.html(<NoticesPage session={c.get('session')} groups={groups} flash={c.req.query('msg')} now={now()} />);
  });

  const editPage = async (c: Context<Env>, notice: Awaited<ReturnType<typeof getNotice>>, body: string, error?: string) => {
    const channels = await loadChannels();
    const preview = renderNotice(body, cfg, channels, { forPreview: true });
    const length = renderNotice(body, cfg, channels).text.length;
    return c.html(
      <NoticeEditPage
        session={c.get('session')}
        notice={notice}
        channels={postableChannels(channels)}
        channelName={notice ? (channels.find((ch) => ch.id === notice.channelId)?.name ?? null) : null}
        vars={noticeVariables(cfg)}
        preview={preview.text}
        length={length}
        unknown={preview.unknown}
        error={error}
      />,
    );
  };

  app.get('/notices/new', (c) => editPage(c, undefined, ''));

  app.post('/notices/preview', async (c) => {
    const body = await c.req.parseBody();
    const text = typeof body.body === 'string' ? body.body : '';
    const style = isNoticeStyle(body.style) ? body.style : 'embed';
    const channels = await loadChannels();
    const preview = renderNotice(text, cfg, channels, { forPreview: true });
    return c.html(<NoticePreview preview={preview.text} length={renderNotice(text, cfg, channels).text.length} unknown={preview.unknown} style={style} />);
  });

  app.post('/notices/seed', async (c) => {
    return tryDiscord(c, '/notices', async () => {
      const r = await seedDefaultNotices(noticeCtx(), c.get('session').userId);
      return r.missing.length ? 'seed_missing' : 'seeded';
    });
  });

  app.post('/notices/seed-guides', async (c) => {
    return tryDiscord(c, '/notices', async () => {
      const r = await seedChannelGuides(noticeCtx(), c.get('session').userId);
      return r.missing.length ? 'guides_missing' : r.created ? 'guides_seeded' : 'guides_none';
    });
  });

  app.post('/notices/publish-all', async (c) => {
    return tryDiscord(c, '/notices', async () => {
      const r = await publishAll(noticeCtx(), c.get('session').userId);
      return r.tooLong.length ? 'too_long' : r.pinFailed.length ? 'pin_failed' : 'published_all';
    });
  });

  app.post('/notices', async (c) => {
    const body = await c.req.parseBody();
    const channelId = typeof body.channelId === 'string' ? body.channelId : '';
    const title = field(body, 'title', 60);
    const text = typeof body.body === 'string' ? body.body.replace(/\r\n/g, '\n').trimEnd() : '';
    const channels = await loadChannels();
    if (!title || !text || !postableChannels(channels).some((ch) => ch.id === channelId)) return editPage(c, undefined, text, 'invalid');
    const style = isNoticeStyle(body.style) ? body.style : 'embed';
    const n = await createNotice(db, { channelId, title, body: text, style, pinned: body.pinned === 'yes', by: c.get('session').userId });
    if (body.then === 'publish') return tryDiscord(c, '/notices', () => publishNotice(noticeCtx(), n.id, c.get('session').userId));
    return c.redirect('/notices?msg=saved');
  });

  app.get('/notices/:id', async (c) => {
    const id = noticeId(c);
    const n = id ? await getNotice(db, id) : undefined;
    if (!n) return c.html(<NotFoundPage session={c.get('session')} />, 404);
    return editPage(c, n, n.body);
  });

  app.post('/notices/:id', async (c) => {
    const id = noticeId(c);
    const n = id ? await getNotice(db, id) : undefined;
    if (!n) return c.redirect('/notices');
    const body = await c.req.parseBody();
    const title = field(body, 'title', 60);
    const text = typeof body.body === 'string' ? body.body.replace(/\r\n/g, '\n').trimEnd() : '';
    if (!title || !text) return editPage(c, n, text || n.body, 'invalid');
    await updateNotice(db, n.id, {
      title,
      body: text,
      style: isNoticeStyle(body.style) ? body.style : undefined,
      pinned: body.pinned === 'yes',
      by: c.get('session').userId,
    });
    if (body.then === 'publish') return tryDiscord(c, '/notices', () => publishNotice(noticeCtx(), n.id, c.get('session').userId));
    return c.redirect('/notices?msg=saved');
  });

  app.post('/notices/:id/publish', async (c) => {
    const id = noticeId(c);
    if (!id || !(await getNotice(db, id))) return c.redirect('/notices');
    return tryDiscord(c, '/notices', () => publishNotice(noticeCtx(), id, c.get('session').userId));
  });

  app.post('/notices/:id/move', async (c) => {
    const id = noticeId(c);
    const body = await c.req.parseBody();
    if (id && (body.dir === 'up' || body.dir === 'down')) await moveNotice(db, id, body.dir);
    return c.redirect('/notices');
  });

  app.get('/notices/:id/delete', async (c) => {
    const id = noticeId(c);
    const n = id ? await getNotice(db, id) : undefined;
    if (!n) return c.redirect('/notices');
    const channels = await loadChannels();
    return c.html(<NoticeDeletePage session={c.get('session')} notice={n} channelName={channels.find((ch) => ch.id === n.channelId)?.name ?? null} />);
  });

  app.post('/notices/:id/delete', async (c) => {
    const id = noticeId(c);
    if (!id) return c.redirect('/notices');
    return tryDiscord(c, '/notices', async () => {
      await deleteNotice(noticeCtx(), id, c.get('session').userId);
      return 'deleted';
    });
  });

  app.post('/notices/channel/:channelId/repost', async (c) => {
    const body = await c.req.parseBody();
    const channelId = c.req.param('channelId');
    if (body.confirm !== 'yes' || !/^\d{17,20}$/.test(channelId)) return c.redirect('/notices');
    return tryDiscord(c, '/notices', async () => {
      const r = await repostChannel(noticeCtx(), channelId, c.get('session').userId);
      return r.tooLong.length ? 'too_long' : r.pinFailed.length ? 'pin_failed' : 'reposted_channel';
    });
  });

  // ───────── チャンネル（宮司のみ）: 説明と「書き込める／読むだけ」 ─────────

  app.use('/channels/*', async (c, next) => (gujiOnly(c) ? next() : c.html(<NotFoundPage session={c.get('session')} />, 403)));

  app.get('/channels', async (c) => {
    const channels = await loadChannels(true);
    const groups = listTextChannels(channels).map((g) => ({ category: g.category, items: g.items.map((ch) => ({ channel: ch, mode: channelModeOf(ch, cfg) })) }));
    return c.html(<ChannelsPage session={c.get('session')} groups={groups} flash={c.req.query('msg')} />);
  });

  app.post('/channels/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/channels');
    const body = await c.req.parseBody();
    const topic = typeof body.topic === 'string' ? body.topic.replace(/\r\n/g, '\n').trim() : undefined;
    const mode = body.mode === 'readonly' || body.mode === 'writable' ? body.mode : undefined;
    if (topic === undefined || topic.length > 1024 || !mode) return c.redirect('/channels?msg=invalid');
    const channel = (await loadChannels(true)).find((ch) => ch.id === id && (ch.type === 0 || ch.type === 5));
    if (!channel) return c.redirect('/channels');
    const changes: string[] = [];
    try {
      if ((channel.topic ?? '') !== topic) {
        await deps.discord.editChannel(id, { topic });
        changes.push('topic');
      }
      const plan = planChannelMode(channel, cfg, mode);
      for (const o of plan) await deps.discord.setChannelOverwrite(id, o, mode === 'readonly' ? '読むだけにした（管理画面）' : '書き込めるようにした（管理画面）');
      if (plan.length) changes.push('mode');
    } catch (err) {
      logger.warn({ err }, 'channel update failed');
      return c.redirect('/channels?msg=failed');
    }
    if (!changes.length) return c.redirect('/channels?msg=unchanged');
    await audit(db, { actorId: c.get('session').userId, action: 'channel.update', detail: { channelId: id, name: channel.name, topic: changes.includes('topic') ? topic : undefined, mode: changes.includes('mode') ? mode : undefined }, via: 'web' });
    return c.redirect('/channels?msg=saved');
  });

  // ───────── ショップ（宮司のみ） ─────────

  app.use('/shop/*', async (c, next) => (gujiOnly(c) ? next() : c.html(<NotFoundPage session={c.get('session')} />, 403)));

  const shopRoles = async () => {
    try {
      return await deps.discord.guildRoles(cfg.guildId);
    } catch (err) {
      logger.warn({ err }, 'could not load guild roles');
      return [];
    }
  };
  /** 品物のフォーム（空の日数は「ずっと」） */
  const shopFields = (body: Record<string, unknown>) => {
    const n = (k: string) => (typeof body[k] === 'string' && body[k] !== '' ? Number(body[k]) : undefined);
    const days = n('durationDays');
    return {
      name: field(body, 'name', 60),
      emoji: field(body, 'emoji', 10),
      description: field(body, 'description', 100),
      price: n('price'),
      durationDays: days === undefined ? null : days,
      position: n('position'),
    };
  };
  const validInt = (v: number | null | undefined, min: number) => v === undefined || v === null || (Number.isInteger(v) && v >= min && v <= 10_000_000);

  app.get('/shop', async (c) => {
    const [items, roles, purchases] = await Promise.all([listShopItems(db), shopRoles(), recentPurchases(db, 50)]);
    const names = await namesOf(db, purchases.flatMap((p) => [p.memberId, p.targetId ?? '']).filter(Boolean));
    return c.html(<ShopPage session={c.get('session')} items={items} roles={roles} purchases={purchases} names={names} economy={cfg.economy} flash={c.req.query('msg')} />);
  });

  app.post('/shop/items/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const item = Number.isSafeInteger(id) ? await getShopItem(db, id) : undefined;
    if (!item) return c.redirect('/shop');
    const body = await c.req.parseBody();
    const f = shopFields(body);
    if (!f.name || !validInt(f.price, 0) || !validInt(f.durationDays, 1) || !validInt(f.position, -1000)) return c.redirect('/shop?msg=invalid');
    await updateShopItem(db, id, {
      name: f.name,
      emoji: f.emoji,
      description: f.description,
      enabled: body.enabled === 'yes',
      ...(f.price !== undefined && item.kind !== 'menzaifu' && item.kind !== 'gift' ? { price: f.price } : {}),
      ...(item.kind === 'role' || item.kind === 'ema_pin' ? { durationDays: item.kind === 'ema_pin' ? (f.durationDays ?? 7) : f.durationDays } : {}),
      ...(f.position !== undefined ? { position: f.position } : {}),
    });
    await audit(db, { actorId: c.get('session').userId, action: 'shop.update', detail: { id, name: f.name, price: f.price, enabled: body.enabled === 'yes' }, via: 'web' });
    return c.redirect('/shop?msg=saved');
  });

  app.post('/shop/items', async (c) => {
    const body = await c.req.parseBody();
    const f = shopFields(body);
    const roleId = typeof body.roleId === 'string' ? body.roleId : '';
    const group = body.roleGroup === 'color' || body.roleGroup === 'title' ? body.roleGroup : null;
    if (!f.name || !/^\d{17,20}$/.test(roleId) || f.price === undefined || !validInt(f.price, 0) || !validInt(f.durationDays, 1)) return c.redirect('/shop?msg=invalid');
    const roles = await shopRoles();
    if (!roles.some((r) => r.id === roleId && !r.managed)) return c.redirect('/shop?msg=invalid');
    if ((await listShopItems(db)).some((i) => i.roleId === roleId)) return c.redirect('/shop?msg=role_taken');
    const items = await listShopItems(db);
    const item = await createShopItem(db, {
      kind: 'role',
      name: f.name,
      emoji: f.emoji,
      description: f.description,
      price: f.price,
      roleId,
      roleGroup: group,
      durationDays: f.durationDays,
      position: items.reduce((n, i) => Math.max(n, i.position), 0) + 1,
    });
    await audit(db, { actorId: c.get('session').userId, action: 'shop.create', detail: { id: item.id, name: f.name, roleId, price: f.price }, via: 'web' });
    return c.redirect('/shop?msg=created');
  });

  app.post('/shop/items/:id/delete', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.parseBody();
    const item = Number.isSafeInteger(id) ? await getShopItem(db, id) : undefined;
    // 決まった動きの品物（花吹雪など）は消さずに「販売しない」にする
    if (!item || item.kind !== 'role' || body.confirm !== 'yes') return c.redirect('/shop');
    await deleteShopItem(db, id);
    await audit(db, { actorId: c.get('session').userId, action: 'shop.delete', detail: { id, name: item.name }, via: 'web' });
    return c.redirect('/shop?msg=deleted');
  });

  app.get('/audit', async (c) => {
    const rows = await listAudit(db, { limit: 200 });
    const names = await namesOf(db, rows.flatMap((a) => [a.actorId, a.targetId ?? '']).filter(Boolean));
    return c.html(<AuditPage session={c.get('session')} rows={rows} names={names} now={now()} />);
  });

  app.notFound((c) => c.html(<NotFoundPage />, 404));

  return app;
}

/** 変わった項目だけ（操作の記録用） */
function diff<T extends Record<string, unknown>>(a: T, b: T): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(b)) if (a[k] !== b[k]) out[k] = [a[k], b[k]];
  return out;
}

function rankDiff(a: GuildConfig, b: GuildConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of b.ranks) {
    const old = a.ranks.find((x) => x.key === r.key);
    if (old && (old.weight !== r.weight || old.requiredGoen !== r.requiredGoen)) {
      out[r.key] = { weight: [old.weight, r.weight], requiredGoen: [old.requiredGoen, r.requiredGoen] };
    }
  }
  return out;
}

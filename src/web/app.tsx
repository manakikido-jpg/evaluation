import { randomUUID } from 'node:crypto';
import { channelsOf, dailyUsage, partnersOf, roomHistory, sinceDate, topPairs, usageByCategory, usageByMember } from '../services/voiceUsage.js';
import { MemberVoiceSection, VoicePage, type VoiceRange } from './views/voice.js';
import { inviteCountOf, inviterOf } from '../services/invites.js';
import { STATIC } from './assets.js';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { adminLevelOf, GACHA_TIERS, TICKET_KINDS, type GachaTier, type GuildConfig, type TicketKind } from '../config.js';
import {
  createPrize,
  deletePrize,
  deliverClaim,
  ensureGachaPrizes,
  gachaResetPreview,
  gachaStateOf,
  gachaStats,
  giftableShopItem,
  listClaims,
  listPrizes,
  PRIZE_KINDS,
  prizeChances,
  recentDraws,
  resetGacha,
  topPlayers,
  updatePrize,
  type PrizeInput,
  type PrizeKind,
} from '../services/gacha.js';
import { addTickets, emptyTickets, ticketHolders, ticketsOf, takeTickets, TICKET_LABEL } from '../services/tickets.js';
import { addCustom, createCustomTicket, customHolders, customHoldingsOf, customName, listCustomTickets, setCustomTicketEnabled, takeCustom } from '../services/customTickets.js';
import { GachaPage, GACHA_FLASH, MemberGachaSection } from './views/gacha.js';
import { addPresetPrizes, PRESET_ROLES, presetPrizes, type PresetRoleKey } from '../services/gachaPresets.js';
import { InterviewPage } from './views/interview.js';
import {
  DEFAULT_INTERVIEW_TEMPLATE,
  interviewChannelOf,
  interviewMessage,
  interviewSchema,
  jstParts,
  loadInterview,
  parseJstLocal,
  renderInterview,
  saveInterview,
} from '../services/interview.js';
import type { Db } from '../db/client.js';
import type { AdminSession } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { audit, listAudit } from '../services/audit.js';
import { eventsOf, getMember, homeStats, listMembers, membersWithRole, namesOf, roleMemberCounts, shuinHistory, type MemberListQuery } from '../services/members.js';
import { goshuinchoOf } from '../services/shuin.js';
import { jstDate, recentActivity } from '../services/activity.js';
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
import { RecentUpdates, UpdatesPage } from './views/updates.js';
import type { SessionView } from './views/layout.js';
import { unseenChanges } from '../changelog.js';
import { markChangesSeen, seenChangeId } from '../services/updates.js';
import { isTrendRange, memberTrend } from '../services/stats.js';
import { AuditPage, HomePage, LoginPage, MemberPage, MemberResults, MembersPage, NotFoundPage } from './views/pages.js';
import { ConfirmPage, FLASH, ModerationSection, YakuPage } from './views/moderation.js';
import { ADMISSION_FLASH, ApplicationsPage, MemberAdmissionSection, OmairiPage, SettingsPage, SoudanListPage, SoudanPage } from './views/admission.js';
import { applicationsOf, getOmairi, omairiList, pendingApplications, recentDecidedApplications } from '../services/applications.js';
import { changeAgeGroup, closeSoudan, decide, decideOmairi, removeYoimairi, replySoudan, revealSoudanSender, type OmairiAction } from '../services/admission.js';
import { getSoudan, listSoudan, soudanMessagesOf } from '../services/soudan.js';
import { applyOverrides, loadOverrides, overridesSchema, saveOverrides, type Overrides } from '../services/settings.js';
import {
  createNotice,
  deleteNotice,
  getNotice,
  findChannel,
  guildChannelsCached,
  listNotices,
  moveNotice,
  noticeStatus,
  noticeVariables,
  detectImage,
  isImagePosition,
  isNoticeStyle,
  NOTICE_IMAGE_MAX,
  getNoticeImage,
  mentionLabel,
  mentionValue,
  parseMention,
  postableChannels,
  removeNoticeImage,
  setNoticeImage,
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
import { giftAnnouncement, giftItemLabel, giftTargets, giftToAll, parseGiftItem, recentGifts, validGiftCount } from '../services/gifts.js';
import { balanceDistribution, bigTransactions, economyOverview, rangeStart, shopSales } from '../services/economyStats.js';
import { EconomyPage } from './views/economy.js';
import { createTerm, deleteTerm, getTerm, GLOSSARY_CHANNEL, listTerms, moveTerm, seedDefaultTerms, setTermEnabled, syncGlossaryNotices, updateTerm, type TermInput } from '../services/glossary.js';
import { isGlossaryCategory } from '../services/glossaryDefaults.js';
import { GlossaryPage } from './views/glossary.js';
import { NoticeDeletePage, NoticeEditPage, NoticePreview, NoticesPage, type NoticeGroup } from './views/notices.js';
import { ShopPage } from './views/shop.js';
import { ChannelsPage } from './views/channels.js';
import { RolePage, RolesPage } from './views/roles.js';
import { MarketPage } from './views/market.js';
import { closeListing, recentListings, recentOrders, refundOrder, releaseOrder } from '../services/market.js';
import { listingCard } from '../discord/market.js';
import { ADMINISTRATOR, botTopPosition, mergePermissions, permDiff, permsOf, roleKind } from '../services/roles.js';
import {
  channelsInUse,
  cleanChannelName,
  cleanNewChannelName,
  isChannelVisibility,
  isText,
  listTextChannels,
  modeOf as channelModeOf,
  overwritesFor,
  planMode as planChannelMode,
  planMove as planMoveChannel,
  planParent as planParentChannel,
  type ChannelPositionPlan,
} from '../services/channels.js';
import {
  createItem as createShopItem,
  deleteItem as deleteShopItem,
  getItem as getShopItem,
  listItems as listShopItems,
  recentPurchases,
  updateItem as updateShopItem,
} from '../services/shop.js';
import type { GuildChannel, GuildRole, RolePatch } from '../lib/discordRest.js';

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
  /** BOT のユーザー ID（＝ DISCORD_CLIENT_ID）。ロールのページで、BOT が変えられないロールを見分ける */
  botId?: string;
  now?: () => Date;
};

type Env = { Variables: { session: SessionView } };

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
        // blob: 掲示の写真を選んだとき、送る前にプレビューに出す
        imgSrc: ["'self'", 'blob:', 'https://cdn.discordapp.com'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        formAction: ["'self'", 'https://discord.com'],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'same-origin',
    }),
  );

  // 送れる大きさの上限（掲示の本文でも十分な 256KB）
  const smallBody = bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.text('送る内容が大きすぎます。', 413) });
  // 掲示の写真だけは大きめに（写真の上限 8MB ＋ 本文）
  const noticeBody = bodyLimit({ maxSize: 9 * 1024 * 1024, onError: (c) => c.text('写真が大きすぎます（8MB まで）。', 413) });
  app.use((c, next) => (c.req.method === 'POST' && /^\/notices(?:\/\d+)?$/.test(c.req.path) ? noticeBody(c, next) : smallBody(c, next)));

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
        c.set('session', await withUpdates(session));
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
    c.set('session', await withUpdates(session));
    await next();
  };

  /** メニューの「更新履歴」に、まだ読んでいない更新の数を出す */
  const withUpdates = async (s: AdminSession): Promise<SessionView> => ({ ...s, updatesUnseen: unseenChanges(await seenChangeId(db, s.userId)).length });

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
  app.use('/economy', requireAdmin);
  app.use('/glossary', requireAdmin);
  app.use('/voice', requireAdmin);
  app.use('/updates', requireAdmin);
  app.use('/roles', requireAdmin);
  app.use('/market', requireAdmin);
  app.use('/gacha', requireAdmin);
  app.use('/interview', requireAdmin);
  for (const p of ['/applications/*', '/omairi/*', '/soudan/*', '/settings/*', '/notices/*', '/shop/*', '/channels/*', '/roles/*', '/market/*', '/gacha/*', '/interview/*']) {
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
    const since30 = sinceDate(now(), 30);
    const [apps, omairiRow, invitedBy, inviteCount, vcChannels, vcPartners] = await Promise.all([
      applicationsOf(db, id),
      getOmairi(db, id),
      inviterOf(db, id),
      inviteCountOf(db, id),
      channelsOf(db, id, since30),
      partnersOf(db, id, since30),
    ]);
    const vcDaily = await dailyUsage(db, since30, jstDate(now()), { memberId: id });
    const [gState, gTickets, gDraws, gCustom, gCustomTickets] = await Promise.all([
      gachaStateOf(db, id),
      ticketsOf(db, id),
      recentDraws(db, { memberId: id, limit: 15 }),
      customHoldingsOf(db, id),
      listCustomTickets(db),
    ]);
    const gRoleNames = gDraws.some((d) => d.roleId) ? await roleNameMap() : new Map<string, string>();
    const vcByCategory = (await usageByMember(db, since30)).find((m) => m.memberId === id);
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
      invitedBy ?? '',
      ...vcPartners.map((p) => p.memberId),
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
          <MemberVoiceSection
            daily={vcDaily}
            total={vcByCategory?.total ?? 0}
            byCategory={vcByCategory?.byCategory ?? []}
            channels={vcChannels}
            partners={vcPartners}
            names={names}
          />
          <MemberAdmissionSection
            session={session}
            cfg={cfg}
            memberId={id}
            ageGroup={member.ageGroup}
            roleIds={member.roleIds}
            omairi={omairiRow}
            applications={apps}
            names={names}
            invitedBy={invitedBy}
            inviteCount={inviteCount}
          />
          <MemberGachaSection
            session={session}
            memberId={id}
            gacha={cfg.gacha}
            state={gState}
            tickets={gTickets}
            custom={gCustom}
            customTickets={gCustomTickets}
            draws={gDraws}
            roleNames={gRoleNames}
            flash={flash && Object.hasOwn(GACHA_FLASH, flash) ? flash : undefined}
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

  // ───────── 更新履歴 ─────────

  app.get('/updates', async (c) => {
    const s = c.get('session');
    const unseenIds = new Set(unseenChanges(await seenChangeId(db, s.userId)).map((e) => e.id));
    await markChangesSeen(db, s.userId);
    // このページを開いたら読んだことにする（メニューの印も消す）
    return c.html(<UpdatesPage session={{ ...s, updatesUnseen: 0 }} unseenIds={unseenIds} />);
  });

  // ───────── 推移（グラフ） ─────────

  // 通話の記録（浮上時間）: 人ごと・カテゴリごと・よくいっしょにいる 2 人・自分の通話部屋
  app.get('/voice', async (c) => {
    const d = Number(c.req.query('days'));
    const days: VoiceRange = d === 7 || d === 90 ? d : 30;
    const cat = c.req.query('cat');
    const t = now();
    const since = sinceDate(t, days);
    const catId = cat && /^(\d{17,20}|none)$/.test(cat) ? cat : undefined;
    const [categories, members, pairs, rooms, channels, daily] = await Promise.all([
      usageByCategory(db, since),
      usageByMember(db, since),
      topPairs(db, since),
      roomHistory(db, new Date(t.getTime() - days * 86_400_000)),
      loadChannels(),
      dailyUsage(db, since, jstDate(t), catId ? { categoryId: catId } : {}),
    ]);
    const names = await namesOf(db, [...members.map((m) => m.memberId), ...pairs.flatMap((p) => [p.memberA, p.memberB]), ...rooms.map((r) => r.ownerId ?? '')]);
    const hubNames = new Map(cfg.tempVoice.hubs.map((h) => [h.channelId, channels.find((ch) => ch.id === h.channelId)?.name ?? h.name]));
    return c.html(
      <VoicePage
        session={c.get('session')}
        days={days}
        category={catId}
        daily={daily}
        categories={categories}
        members={members}
        pairs={pairs}
        rooms={rooms}
        hubNames={hubNames}
        names={names}
      />,
    );
  });

  app.get('/stats', async (c) => {
    const q = c.req.query('range');
    const range = isTrendRange(q) ? q : '30d';
    const buckets = await memberTrend(db, range, now());
    return c.html(<StatsPage session={c.get('session')} range={range} buckets={buckets} />);
  });

  /** 経済: 銭の流れ・鯖の収入・持っている量のかたより */
  app.get('/economy', async (c) => {
    const q = c.req.query('range');
    const range = isTrendRange(q) ? q : '30d';
    const t = now();
    const since = rangeStart(range, t);
    const [overview, dist, big, sales] = await Promise.all([economyOverview(db, range, t), balanceDistribution(db), bigTransactions(db, since), shopSales(db, since)]);
    const names = await namesOf(db, [...dist.top.map((x) => x.memberId), ...big.map((x) => x.memberId)]);
    return c.html(<EconomyPage session={c.get('session')} cfg={cfg} range={range} overview={overview} dist={dist} big={big} sales={sales} names={names} />);
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

  // 券を渡す・減らす（宮司のみ）
  app.post('/members/:id/tickets', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const to = (msg: string) => c.redirect(`/members/${id}?msg=${msg}#sec-gacha`);
    if (!gujiOnly(c)) return to('tickets_forbidden');
    const body = await c.req.parseBody();
    const kindRaw = typeof body.kind === 'string' ? body.kind : '';
    const count = Number(body.count);
    const note = field(body, 'note', 200);
    // 自由な券（custom:<id>）
    const customTicket = kindRaw.startsWith('custom:') ? (await listCustomTickets(db)).find((x) => `custom:${x.id}` === kindRaw) : undefined;
    const kind = kindRaw as TicketKind;
    if ((!customTicket && !TICKET_KINDS.includes(kind)) || !Number.isInteger(count) || count < 1 || count > 100 || !note) return to('tickets_invalid');
    const m = await getMember(db, id);
    if (!m || m.isBot) return back(c, id, 'denied_not_found');
    const by = c.get('session').userId;
    if (customTicket) {
      if (body.mode === 'take') {
        const taken = await takeCustom(db, id, customTicket.id, count);
        await audit(db, { actorId: by, targetId: id, action: 'tickets.take', detail: { custom: customTicket.id, name: customTicket.name, count, taken, note }, via: 'web' });
        return to(taken === 0 ? 'tickets_none' : taken < count ? 'tickets_taken_short' : 'tickets_taken');
      }
      await addCustom(db, id, customTicket.id, count);
      await audit(db, { actorId: by, targetId: id, action: 'tickets.grant', detail: { custom: customTicket.id, name: customTicket.name, count, note }, via: 'web' });
      if (body.dm !== 'yes') return to('tickets_given_quiet');
      const sent = await deps.discord.sendDm(
        id,
        `🎟 咲楽ノ宮の社務所から、${customName(customTicket)} が **${count} 枚** 届きました。\n> ${note}\n${customTicket.note ? `${customTicket.note}\n` : ''}\`/物御籤\` の「🎟 券を使う」から使えます。`,
      );
      return to(sent ? 'tickets_given' : 'tickets_given_nodm');
    }
    const t = TICKET_LABEL[kind];
    if (body.mode === 'take') {
      const taken = await takeTickets(db, id, kind, count);
      await audit(db, { actorId: by, targetId: id, action: 'tickets.take', detail: { kind, count, taken, note }, via: 'web' });
      return to(taken === 0 ? 'tickets_none' : taken < count ? 'tickets_taken_short' : 'tickets_taken');
    }
    await addTickets(db, id, kind, count);
    await audit(db, { actorId: by, targetId: id, action: 'tickets.grant', detail: { kind, count, note }, via: 'web' });
    if (body.dm !== 'yes') return to('tickets_given_quiet');
    const sent = await deps.discord.sendDm(
      id,
      `🎟 咲楽ノ宮の社務所から、${t.emoji}${t.name} が **${count} 枚** 届きました。\n> ${note}\n${t.note}。持っている券は、自分のプロフィールで見られます。`,
    );
    return to(sent ? 'tickets_given' : 'tickets_given_nodm');
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

  /** ニックネームを変える（空で元の名前に戻す）。自分より上の運営・BOT などは変えない */
  app.post('/members/:id/nickname', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.notFound();
    const nick = field(await c.req.parseBody(), 'nickname', 32);
    const actor = actorOf(c.get('session'));
    if (id !== actor.id && (await checkTarget(mod(), actor, id))) return back(c, id, 'denied_protected');
    const member = await getMember(db, id);
    if (!member) return back(c, id, 'denied_not_found');
    try {
      await deps.discord.setNickname(cfg.guildId, id, nick, '管理画面（ニックネーム）');
    } catch (err) {
      logger.warn({ err }, 'nickname change failed');
      return back(c, id, 'nickname_failed');
    }
    await audit(db, { actorId: actor.id, targetId: id, action: 'member.nickname', detail: { from: member.displayName, to: nick || '（元の名前）' }, via: 'web' });
    return back(c, id, 'nickname_changed');
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
    const inviters = pending.map((p) => p.app.answers.inviter);
    const names = await namesOf(db, [...decided.map((d) => d.app.reviewedBy ?? ''), ...inviters.filter((x): x is string => typeof x === 'string')]);
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

  app.get('/settings', async (c) => {
    if (!gujiOnly(c)) return c.html(<NotFoundPage session={c.get('session')} />, 403);
    const channels = await loadChannels();
    const catName = (id: string | null) => channels.find((c) => c.id === id)?.name;
    const textChannels = listTextChannels(channels).flatMap((g) => g.items);
    const roles = ((await loadRoles()) ?? []).filter((r) => r.id !== cfg.guildId && !r.managed);
    return c.html(
      <SettingsPage
        session={c.get('session')}
        cfg={cfg}
        fileCfg={fileCfg()}
        flash={c.req.query('msg')}
        at={c.req.query('at')}
        coinsNonce={randomUUID()}
        textChannels={textChannels.map((ch) => ({ id: ch.id, name: ch.name, ...(catName(ch.parent_id) ? { category: catName(ch.parent_id)! } : {}) }))}
        roles={roles.map((r) => ({ id: r.id, name: r.name }))}
        gachaStats={await gachaStats(db)}
      />,
    );
  });

  const longText = (v: unknown) => (typeof v === 'string' && v.trim() ? v.replace(/\r\n/g, '\n').trim().slice(0, 1000) : undefined);

  app.post('/settings', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody({ all: true });
    // 項目の下の「保存する」で押したときは、その項目に戻る
    const at = typeof body.at === 'string' && /^[a-z]{1,20}$/.test(body.at) ? body.at : '';
    const backTo = (msg: string) => (at ? `/settings?msg=${msg}&at=${at}#sec-${at}` : `/settings?msg=${msg}`);
    const num = (k: string) => Number(typeof body[k] === 'string' ? body[k] : NaN);
    // チェックボックスの ID（いくつでも）
    const ids = (k: string) => (body[k] === undefined ? [] : Array.isArray(body[k]) ? body[k] : [body[k]]).filter((v): v is string => typeof v === 'string' && validId(v));
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
        boostDiscountPercent: num('boostDiscountPercent'),
        coreTimePercent: num('coreTimePercent'),
        onboardingReward: num('onboardingReward'),
        inviteReward: num('inviteReward'),
        inviteActiveReward: num('inviteActiveReward'),
        inviteActiveDays: num('inviteActiveDays'),
      },
      rooms: {
        ...Object.fromEntries(
          (['once', 'hourly'] as const).map((plan) => [
            plan,
            Object.fromEntries((['public', 'invite', 'secret', 'twoshot'] as const).map((k) => [k, num(`room.${plan}.${k}`)])),
          ]),
        ),
        boosterDiscountPercent: num('roomBoosterDiscount'),
      },
      market: { feePercent: num('marketFee'), autoReleaseDays: num('marketAutoRelease') },
      ...(typeof body.vcClearDelay === 'string' ? { voiceChat: { clearWhenEmpty: body.vcClear === 'yes', delayMinutes: num('vcClearDelay') } } : {}),
      ...(typeof body.bellCooldown === 'string'
        ? {
            bell: {
              channelId: field(body, 'bellChannel', 20) || null,
              cooldownMinutes: num('bellCooldown'),
              mentionStaff: body.bellMention === 'yes',
              roleIds: ids('bellRoles'),
              channelIds: ids('bellChannels'),
            },
          }
        : {}),
      // 物御籤は「物御籤」のページで変える（ここでは今の値を残す）
      gacha: (await loadOverrides(db)).gacha,
      // 自動で増える通話（フォームにあるときだけ。名前が空の行は使わない）
      ...(typeof body['vg.0.name'] === 'string'
        ? {
            voiceGroups: [...Array(10).keys()].flatMap((i) => {
              const name = field(body, `vg.${i}.name`, 50);
              return name ? [{ name, min: num(`vg.${i}.min`), max: num(`vg.${i}.max`) }] : [];
            }),
          }
        : {}),
      coreTime: {
        slots: [0, 1, 2, 3, 4, 5, 6].flatMap((day) => {
          const start = field(body, `ct.${day}.start`, 5);
          const end = field(body, `ct.${day}.end`, 5);
          // 終わりの 00:00 は 24 時
          return start && end ? [{ day, start, end: end === '00:00' ? '24:00' : end }] : [];
        }),
        noticeDayBefore: field(body, 'ctNoticeDayBefore', 5),
        noticeMinutesBefore: num('ctNoticeMinutesBefore'),
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
      return c.redirect(backTo('settings_invalid'));
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
    return c.redirect(backTo(noticesUpdated > 0 ? 'saved_notices' : 'saved'));
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

  /** メンションに選べるロール（@everyone と BOT などの自動のロールはのぞく） */
  const mentionableRoles = async () => ((await loadRoles()) ?? []).filter((r) => r.id !== cfg.guildId && !r.managed).map((r) => ({ id: r.id, name: r.name }));
  /** 画面で選んだメンション。ロールを読めなかったときは、前に選んでいたロールだけ残す */
  const mentionFrom = async (body: Record<string, unknown>, before?: string) => {
    const picked = (body.mentionRoles === undefined ? [] : Array.isArray(body.mentionRoles) ? body.mentionRoles : [body.mentionRoles]).filter(
      (v): v is string => typeof v === 'string' && validId(v),
    );
    const roles = await loadRoles();
    const prev = parseMention(before);
    const valid = roles ? new Set(roles.filter((r) => r.id !== cfg.guildId && !r.managed).map((r) => r.id)) : new Set(prev.kind === 'roles' ? prev.roleIds : []);
    return { value: mentionValue(body.mentionKind, picked, valid), roles };
  };

  /** 選んだ写真（なければ undefined）。大きすぎ・写真でないものは知らせる */
  const imageUpload = async (body: Record<string, unknown>): Promise<Uint8Array | 'too_big' | 'bad_type' | undefined> => {
    const f = Array.isArray(body.image) ? body.image[0] : body.image;
    if (!(f instanceof File) || f.size === 0) return undefined;
    if (f.size > NOTICE_IMAGE_MAX) return 'too_big';
    const data = new Uint8Array(await f.arrayBuffer());
    return detectImage(data) ? data : 'bad_type';
  };

  app.get('/notices', async (c) => {
    const [channels, roles] = await Promise.all([loadChannels(), loadRoles()]);
    const roleName = (id: string) => roles?.find((r) => r.id === id)?.name;
    const byId = new Map(channels.map((ch) => [ch.id, ch]));
    const groups: NoticeGroup[] = [];
    for (const n of await listNotices(db)) {
      let g = groups.find((x) => x.channelId === n.channelId);
      if (!g) groups.push((g = { channelId: n.channelId, channelName: byId.get(n.channelId)?.name ?? null, rows: [] }));
      const text = renderNotice(n.body, cfg, channels).text;
      const preview = renderNotice(n.body, cfg, channels, { forPreview: true });
      g.rows.push({
        notice: n,
        preview: preview.text,
        length: text.length,
        status: noticeStatus(n, text),
        unknown: preview.unknown,
        mention: mentionLabel(n.mention, roleName),
      });
    }
    // Discord のチャンネルの並び順に合わせる
    const order = new Map(postableChannels(channels).map((ch, i) => [ch.id, i]));
    groups.sort((a, b) => (order.get(a.channelId) ?? 999) - (order.get(b.channelId) ?? 999));
    return c.html(<NoticesPage session={c.get('session')} groups={groups} flash={c.req.query('msg')} now={now()} />);
  });

  const editPage = async (c: Context<Env>, notice: Awaited<ReturnType<typeof getNotice>>, body: string, error?: string) => {
    const [channels, roles] = await Promise.all([loadChannels(), mentionableRoles()]);
    const preview = renderNotice(body, cfg, channels, { forPreview: true });
    const length = renderNotice(body, cfg, channels).text.length;
    return c.html(
      <NoticeEditPage
        session={c.get('session')}
        notice={notice}
        channels={postableChannels(channels)}
        channelName={notice ? (channels.find((ch) => ch.id === notice.channelId)?.name ?? null) : null}
        roles={roles}
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
    const body = await c.req.parseBody({ all: true });
    const text = typeof body.body === 'string' ? body.body : '';
    const style = isNoticeStyle(body.style) ? body.style : 'embed';
    const [channels, mention] = await Promise.all([loadChannels(), mentionFrom(body)]);
    const preview = renderNotice(text, cfg, channels, { forPreview: true });
    const label = mentionLabel(mention.value, (id) => mention.roles?.find((r) => r.id === id)?.name);
    // 保存済みの写真（外すにチェックがなければ）。新しく選んだ写真は画面の JS が出す
    const id = typeof body.noticeId === 'string' ? Number(body.noticeId) : 0;
    const saved = id > 0 && body.removeImage !== 'yes' ? await getNotice(db, id) : undefined;
    const image = { url: saved?.imageHash ? `/notices/${saved.id}/image?v=${saved.imageHash}` : undefined, position: isImagePosition(body.imagePosition) ? body.imagePosition : 'bottom' };
    return c.html(
      <NoticePreview
        preview={preview.text}
        length={renderNotice(text, cfg, channels).text.length}
        unknown={preview.unknown}
        style={style}
        mention={label}
        image={image}
        slot
      />,
    );
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
      return r.missing.length ? 'guides_missing' : r.created || r.updated ? 'guides_seeded' : 'guides_none';
    });
  });

  app.post('/notices/publish-all', async (c) => {
    return tryDiscord(c, '/notices', async () => {
      const r = await publishAll(noticeCtx(), c.get('session').userId);
      return r.tooLong.length ? 'too_long' : r.pinFailed.length ? 'pin_failed' : 'published_all';
    });
  });

  app.post('/notices', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const channelId = typeof body.channelId === 'string' ? body.channelId : '';
    const title = field(body, 'title', 60);
    const text = typeof body.body === 'string' ? body.body.replace(/\r\n/g, '\n').trimEnd() : '';
    const channels = await loadChannels();
    if (!title || !text || !postableChannels(channels).some((ch) => ch.id === channelId)) return editPage(c, undefined, text, 'invalid');
    const style = isNoticeStyle(body.style) ? body.style : 'embed';
    const { value: mention } = await mentionFrom(body);
    const upload = await imageUpload(body);
    if (upload === 'too_big' || upload === 'bad_type') return editPage(c, undefined, text, `image_${upload}`);
    const n = await createNotice(db, {
      channelId,
      title,
      body: text,
      style,
      pinned: body.pinned === 'yes',
      sticky: body.sticky === 'yes',
      mention,
      imagePosition: isImagePosition(body.imagePosition) ? body.imagePosition : undefined,
      by: c.get('session').userId,
    });
    if (upload) await setNoticeImage(db, n.id, upload, c.get('session').userId);
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
    const body = await c.req.parseBody({ all: true });
    const title = field(body, 'title', 60);
    const text = typeof body.body === 'string' ? body.body.replace(/\r\n/g, '\n').trimEnd() : '';
    if (!title || !text) return editPage(c, n, text || n.body, 'invalid');
    const upload = await imageUpload(body);
    if (upload === 'too_big' || upload === 'bad_type') return editPage(c, n, text, `image_${upload}`);
    await updateNotice(db, n.id, {
      title,
      body: text,
      style: isNoticeStyle(body.style) ? body.style : undefined,
      pinned: body.pinned === 'yes',
      sticky: body.sticky === 'yes',
      // 古い画面（メンションの欄がない）から送られたときは変えない
      mention: body.mentionKind === undefined ? undefined : (await mentionFrom(body, n.mention)).value,
      imagePosition: isImagePosition(body.imagePosition) ? body.imagePosition : undefined,
      by: c.get('session').userId,
    });
    if (upload) await setNoticeImage(db, n.id, upload, c.get('session').userId);
    else if (body.removeImage === 'yes' && n.imageHash) await removeNoticeImage(db, n.id, c.get('session').userId);
    if (body.then === 'publish') return tryDiscord(c, '/notices', () => publishNotice(noticeCtx(), n.id, c.get('session').userId));
    return c.redirect('/notices?msg=saved');
  });

  /** 掲示の写真（管理画面のプレビュー用。宮司だけ） */
  app.get('/notices/:id/image', async (c) => {
    const id = noticeId(c);
    const img = id ? await getNoticeImage(db, id) : undefined;
    if (!img) return c.notFound();
    return c.body(Buffer.from(img.data), 200, { 'content-type': img.contentType, 'x-content-type-options': 'nosniff' });
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

  // ───────── 用語集（見るのは神職も・直すのは宮司） ─────────

  app.use('/glossary/*', requireAdmin, requireCsrf);
  // 見るのは神職も（'/glossary/*' は '/glossary' にも当たるので、変える操作だけ宮司に）
  app.use('/glossary/*', async (c, next) => (c.req.method !== 'POST' || gujiOnly(c) ? next() : c.text('宮司のみできる操作です。', 403)));

  app.get('/glossary', async (c) => {
    const [terms, channels] = await Promise.all([listTerms(db), loadChannels().catch(() => [] as GuildChannel[])]);
    const edit = Number(c.req.query('edit'));
    return c.html(
      <GlossaryPage
        session={c.get('session')}
        terms={terms}
        coin={cfg.economy.currencyName}
        flash={c.req.query('msg')}
        render={(s) => renderNotice(s, cfg, channels, { forPreview: true }).text}
        hasChannel={Boolean(findChannel(channels, GLOSSARY_CHANNEL))}
        editId={Number.isInteger(edit) && edit > 0 ? edit : undefined}
      />,
    );
  });

  const termInput = (body: Record<string, unknown>): TermInput | undefined => {
    const category = body.category;
    const term = field(body, 'term', 40);
    const description = field(body, 'description', 300);
    if (!isGlossaryCategory(category) || !term || !description) return undefined;
    return { category, term, description, reading: field(body, 'reading', 40), emoji: field(body, 'emoji', 16), aliases: field(body, 'aliases', 100) };
  };
  const termId = (c: Context<Env>) => {
    const id = Number(c.req.param('id'));
    return Number.isInteger(id) && id > 0 ? id : undefined;
  };

  app.post('/glossary', async (c) => {
    const input = termInput(await c.req.parseBody());
    if (!input) return c.redirect('/glossary?msg=invalid#glossary-add');
    const t = await createTerm(db, input, c.get('session').userId);
    return c.redirect(`/glossary?msg=added#term-${t.id}`);
  });

  app.post('/glossary/seed', async (c) => {
    const n = await seedDefaultTerms(db, c.get('session').userId);
    return c.redirect(`/glossary?msg=${n ? 'seeded' : 'seeded_none'}`);
  });

  app.post('/glossary/sync', async (c) => {
    try {
      const r = await syncGlossaryNotices(noticeCtx(), c.get('session').userId);
      return c.redirect(`/glossary?msg=${r.noShikitari && r.noChannel ? 'synced_none' : r.noChannel ? 'synced_nochannel' : 'synced'}`);
    } catch (err) {
      logger.warn({ err }, 'glossary sync failed');
      return c.redirect('/glossary?msg=discord_error');
    }
  });

  /** #用語集 を作る（#しきたり と同じカテゴリ・同じ見える範囲で、読むだけ） */
  app.post('/glossary/channel', async (c) => {
    const channels = await loadChannels(true).catch(() => undefined);
    if (!channels) return c.redirect('/glossary?msg=discord_error');
    if (findChannel(channels, GLOSSARY_CHANNEL)) return c.redirect('/glossary?msg=channel_exists');
    const shikitari = findChannel(channels, 'しきたり');
    const parent = shikitari?.parent_id ? channels.find((ch) => ch.id === shikitari.parent_id && ch.type === 4) : undefined;
    if (!shikitari || !parent) return c.redirect('/glossary?msg=channel_failed');
    try {
      const created = await deps.discord.createChannel(
        cfg.guildId,
        {
          name: GLOSSARY_CHANNEL,
          type: 0,
          parent_id: parent.id,
          topic: '言葉の意味（/用語 でも調べられます）',
          permission_overwrites: overwritesFor(cfg, { visibility: 'category', roleIds: [], readOnly: true, botId: deps.botId, parent }),
        },
        '管理画面（用語集）',
      );
      await audit(db, { actorId: c.get('session').userId, action: 'channel.create', detail: { channelId: created.id, name: GLOSSARY_CHANNEL }, via: 'web' });
      await guildChannelsCached(deps.discord, cfg.guildId, true).catch(() => undefined);
      return c.redirect('/glossary?msg=channel_created');
    } catch (err) {
      logger.warn({ err }, 'glossary channel create failed');
      return c.redirect('/glossary?msg=channel_failed');
    }
  });

  app.post('/glossary/:id', async (c) => {
    const id = termId(c);
    const input = termInput(await c.req.parseBody());
    if (!id || !(await getTerm(db, id))) return c.redirect('/glossary');
    if (!input) return c.redirect(`/glossary?msg=invalid&edit=${id}#term-${id}`);
    await updateTerm(db, id, input, c.get('session').userId);
    return c.redirect(`/glossary?msg=saved#term-${id}`);
  });

  app.post('/glossary/:id/move', async (c) => {
    const id = termId(c);
    const body = await c.req.parseBody();
    if (id && (body.dir === 'up' || body.dir === 'down')) await moveTerm(db, id, body.dir);
    return c.redirect(`/glossary#term-${id ?? ''}`);
  });

  app.post('/glossary/:id/toggle', async (c) => {
    const id = termId(c);
    const t = id ? await getTerm(db, id) : undefined;
    if (t) await setTermEnabled(db, t.id, !t.enabled);
    return c.redirect(`/glossary?msg=toggled#term-${id ?? ''}`);
  });

  app.post('/glossary/:id/delete', async (c) => {
    const id = termId(c);
    if (id) await deleteTerm(db, id, c.get('session').userId);
    return c.redirect('/glossary?msg=deleted');
  });

  // ───────── チャンネル（宮司のみ）: 名前・説明と「書き込める／読むだけ」 ─────────

  app.use('/channels/*', async (c, next) => (gujiOnly(c) ? next() : c.html(<NotFoundPage session={c.get('session')} />, 403)));

  app.get('/channels', async (c) => {
    const [channels, roles] = await Promise.all([loadChannels(true), loadRoles()]);
    const groups = listTextChannels(channels).map((g) => ({ ...g, items: g.items.map((ch) => ({ channel: ch, mode: channelModeOf(ch, cfg) })) }));
    // プライベートで選べるロール（@everyone・BOT などの自動のロールはのぞく）
    const pickable = (roles ?? []).filter((r) => r.id !== cfg.guildId && !r.managed);
    return c.html(<ChannelsPage session={c.get('session')} groups={groups} flash={c.req.query('msg')} roles={pickable} inUse={channelsInUse(cfg)} />);
  });

  /** 通話の人数の上限（0〜99。0 = なし）。おかしければ undefined */
  const userLimitOf = (v: string): number | undefined => {
    const n = Number(v.trim() || '0');
    return Number.isInteger(n) && n >= 0 && n <= 99 ? n : undefined;
  };

  /** 新しいチャンネル・カテゴリを作る */
  app.post('/channels/new', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const one = (k: string) => (Array.isArray(body[k]) ? body[k][0] : body[k]);
    const kind = one('kind');
    const type = kind === 'text' ? 0 : kind === 'voice' ? 2 : kind === 'category' ? 4 : undefined;
    const name = cleanNewChannelName(one('name'));
    const visibility = one('visibility');
    const roleIds = (body.roles === undefined ? [] : Array.isArray(body.roles) ? body.roles : [body.roles]).filter((v): v is string => typeof v === 'string' && /^\d{17,20}$/.test(v));
    const topicRaw = one('topic');
    const topic = typeof topicRaw === 'string' ? topicRaw.trim().slice(0, 1024) : '';
    if (type === undefined || !name || !isChannelVisibility(visibility)) return c.redirect('/channels?msg=create_invalid#new-channel');
    const channels = await loadChannels(true);
    const parentId = type === 4 ? '' : String(one('parent') ?? '');
    const parent = parentId ? channels.find((ch) => ch.id === parentId && ch.type === 4) : undefined;
    if ((parentId && !parent) || (visibility === 'category' && !parent) || (visibility === 'private' && !roleIds.length)) {
      return c.redirect('/channels?msg=create_invalid#new-channel');
    }
    const permission_overwrites = overwritesFor(cfg, { visibility, roleIds, readOnly: type === 0 && one('readOnly') === 'yes', botId: deps.botId, parent });
    const limitRaw = one('userLimit');
    const user_limit = type === 2 && typeof limitRaw === 'string' && limitRaw !== '' ? userLimitOf(limitRaw) : 0;
    if (user_limit === undefined) return c.redirect('/channels?msg=create_invalid#new-channel');
    let created: GuildChannel;
    try {
      created = await deps.discord.createChannel(
        cfg.guildId,
        { name, type, ...(parent ? { parent_id: parent.id } : {}), ...(type === 0 && topic ? { topic } : {}), ...(user_limit ? { user_limit } : {}), permission_overwrites },
        '管理画面（チャンネルを作る）',
      );
    } catch (err) {
      logger.warn({ err }, 'channel create failed');
      return c.redirect('/channels?msg=failed#new-channel');
    }
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'channel.create',
      detail: { channelId: created.id, name, kind, visibility, ...(visibility === 'private' ? { roleIds } : {}), ...(parent ? { parent: parent.name } : {}) },
      via: 'web',
    });
    return c.redirect(`/channels?msg=created#${type === 4 ? 'cat' : 'ch'}-${created.id}`);
  });

  /** 並べ替え（▲▼）・ほかのカテゴリへ移す */
  app.post('/channels/:id/move', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/channels');
    const body = await c.req.parseBody();
    const channels = await loadChannels(true);
    const channel = channels.find((ch) => ch.id === id);
    if (!channel) return c.redirect('/channels');
    const anchor = `#${channel.type === 4 ? 'cat' : 'ch'}-${id}`;
    let plan: ChannelPositionPlan = [];
    let to: string | undefined;
    if (body.dir === 'up' || body.dir === 'down') {
      plan = planMoveChannel(channels, id, body.dir);
    } else if (typeof body.parent === 'string') {
      const parentId = body.parent === 'none' ? null : body.parent;
      plan = planParentChannel(channels, id, parentId, body.sync === 'yes');
      to = parentId ? (channels.find((ch) => ch.id === parentId)?.name ?? parentId) : 'カテゴリなし';
    }
    if (!plan.length) return c.redirect(`/channels?msg=unchanged${anchor}`);
    try {
      await deps.discord.reorderChannels(cfg.guildId, plan, '管理画面（チャンネルの並び）');
    } catch (err) {
      logger.warn({ err }, 'channel reorder failed');
      return c.redirect(`/channels?msg=failed${anchor}`);
    }
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'channel.move',
      detail: { channelId: id, name: channel.name, ...(to ? { to, sync: body.sync === 'yes' } : { dir: body.dir }) },
      via: 'web',
    });
    return c.redirect(`/channels?msg=moved${anchor}`);
  });

  /** チャンネル・カテゴリを消す（名前を入力して確認。BOT が使っているもの・中身のあるカテゴリは消さない） */
  app.post('/channels/:id/delete', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/channels');
    const body = await c.req.parseBody();
    const channels = await loadChannels(true);
    const channel = channels.find((ch) => ch.id === id);
    if (!channel) return c.redirect('/channels');
    const back = (msg: string) => c.redirect(`/channels?msg=${msg}#${channel.type === 4 ? 'cat' : 'ch'}-${id}`);
    if (channelsInUse(cfg).has(id)) return back('in_use');
    if (channel.type === 4 && channels.some((ch) => ch.parent_id === id)) return back('has_children');
    if (typeof body.confirmName !== 'string' || body.confirmName.trim() !== channel.name) return back('confirm_name');
    try {
      await deps.discord.deleteChannel(id, '管理画面（チャンネルを消す）');
    } catch (err) {
      logger.warn({ err }, 'channel delete failed');
      return back('failed');
    }
    await audit(db, { actorId: c.get('session').userId, action: 'channel.delete', detail: { channelId: id, name: channel.name, type: channel.type }, via: 'web' });
    return c.redirect('/channels?msg=deleted');
  });

  app.post('/channels/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/channels');
    const body = await c.req.parseBody();
    const topic = typeof body.topic === 'string' ? body.topic.replace(/\r\n/g, '\n').trim() : undefined;
    const mode = body.mode === 'readonly' || body.mode === 'writable' ? body.mode : undefined;
    // 名前は、送られてきたときだけ変える
    const name = body.name === undefined ? undefined : cleanChannelName(body.name);
    if (topic === undefined || topic.length > 1024 || !mode || (body.name !== undefined && !name)) return c.redirect('/channels?msg=invalid');
    const channel = (await loadChannels(true)).find((ch) => ch.id === id && isText(ch));
    if (!channel) return c.redirect('/channels');
    const changes: string[] = [];
    try {
      const patch: { topic?: string; name?: string; nsfw?: boolean } = {};
      if ((channel.topic ?? '') !== topic) patch.topic = topic;
      if (name && name !== channel.name) patch.name = name;
      // 年齢制限のチェックは、フォームにあるときだけ（ない古いフォームでは変えない）
      if (body.nsfwField === '1' && (body.nsfw === 'yes') !== Boolean(channel.nsfw)) patch.nsfw = body.nsfw === 'yes';
      if (Object.keys(patch).length) {
        await deps.discord.editChannel(id, patch);
        changes.push(...Object.keys(patch));
      }
      const plan = planChannelMode(channel, cfg, mode);
      for (const o of plan) await deps.discord.setChannelOverwrite(id, o, mode === 'readonly' ? '読むだけにした（管理画面）' : '書き込めるようにした（管理画面）');
      if (plan.length) changes.push('mode');
    } catch (err) {
      logger.warn({ err }, 'channel update failed');
      return c.redirect('/channels?msg=failed');
    }
    if (!changes.length) return c.redirect('/channels?msg=unchanged');
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'channel.update',
      detail: {
        channelId: id,
        name: channel.name,
        newName: changes.includes('name') ? name : undefined,
        topic: changes.includes('topic') ? topic : undefined,
        nsfw: changes.includes('nsfw') ? body.nsfw === 'yes' : undefined,
        mode: changes.includes('mode') ? mode : undefined,
      },
      via: 'web',
    });
    return c.redirect('/channels?msg=saved');
  });

  /** カテゴリ・通話の名前だけ変える */
  app.post('/channels/:id/name', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/channels');
    const body = await c.req.parseBody();
    const name = cleanChannelName(body.name);
    if (!name) return c.redirect('/channels?msg=invalid');
    const channel = (await loadChannels(true)).find((ch) => ch.id === id);
    if (!channel) return c.redirect('/channels');
    const patch: { name?: string; nsfw?: boolean; user_limit?: number } = {};
    if (channel.name !== name) patch.name = name;
    // 通話の年齢制限（カテゴリには付けられない）
    if (body.ageGateField === '1' && channel.type !== 4 && (body.nsfw === 'yes') !== Boolean(channel.nsfw)) patch.nsfw = body.nsfw === 'yes';
    // 通話の人数の上限（0 = なし。Discord は 99 まで）
    if (typeof body.userLimit === 'string' && channel.type === 2) {
      const limit = userLimitOf(body.userLimit);
      if (limit === undefined) return c.redirect(`/channels?msg=invalid#ch-${id}`);
      if (limit !== (channel.user_limit ?? 0)) patch.user_limit = limit;
    }
    if (!Object.keys(patch).length) return c.redirect('/channels?msg=unchanged');
    try {
      await deps.discord.editChannel(id, patch);
    } catch (err) {
      logger.warn({ err }, 'channel rename failed');
      return c.redirect('/channels?msg=failed');
    }
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'channel.update',
      detail: { channelId: id, name: channel.name, newName: patch.name, nsfw: patch.nsfw, userLimit: patch.user_limit },
      via: 'web',
    });
    return c.redirect('/channels?msg=saved');
  });

  // ───────── ロール（宮司のみ）: 一覧・権限の確認と変更・持っている人 ─────────

  app.use('/roles', async (c, next) => (gujiOnly(c) ? next() : c.html(<NotFoundPage session={c.get('session')} />, 403)));
  app.use('/roles/*', async (c, next) => (gujiOnly(c) ? next() : c.html(<NotFoundPage session={c.get('session')} />, 403)));

  /** ロールの名前（Discord から読めなければ空） */
  const roleNameMap = async () => new Map(((await loadRoles()) ?? []).map((r) => [r.id, r.name]));

  const loadRoles = async (): Promise<GuildRole[] | undefined> => {
    try {
      return (await deps.discord.guildRoles(cfg.guildId)).sort((a, b) => b.position - a.position);
    } catch (err) {
      logger.warn({ err }, 'could not load guild roles');
      return undefined;
    }
  };
  /** BOT からは変えられない（BOT のロール以上・自動のロール） */
  /** 招待を作成 */
  const CREATE_INVITE = 1n;
  /** ニックネームの変更（自分の） */
  const CHANGE_NICKNAME = 1n << 26n;
  const roleLocked = (role: GuildRole, all: GuildRole[]) => role.managed || (role.id !== cfg.guildId && role.position >= botTopPosition(all, deps.botId));

  app.get('/roles', async (c) => {
    const roles = await loadRoles();
    const { counts, total } = await roleMemberCounts(db);
    const rows = (roles ?? []).map((role) => ({
      role,
      kind: roleKind(cfg, role),
      members: role.id === cfg.guildId ? total : (counts.get(role.id) ?? 0),
      locked: roleLocked(role, roles ?? []),
    }));
    return c.html(<RolesPage session={c.get('session')} rows={rows} flash={c.req.query('msg')} loadFailed={!roles} />);
  });

  app.get('/roles/:id', async (c) => {
    const roles = await loadRoles();
    const role = roles?.find((r) => r.id === c.req.param('id'));
    if (!roles || !role) return c.html(<NotFoundPage session={c.get('session')} />, 404);
    const isEveryone = role.id === cfg.guildId;
    return c.html(
      <RolePage
        session={c.get('session')}
        role={role}
        kind={roleKind(cfg, role)}
        locked={roleLocked(role, roles)}
        inUse={Boolean(roleKind(cfg, role)) || (await roleUsedByShop(role.id))}
        isEveryone={isEveryone}
        members={isEveryone ? [] : await membersWithRole(db, role.id)}
        flash={c.req.query('msg')}
      />,
    );
  });

  /** ロールを作る（いちばん下にできる。権限はなしで作って、あとからロールのページで付ける） */
  app.post('/roles/new', async (c) => {
    const body = await c.req.parseBody();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const colorRaw = typeof body.color === 'string' ? body.color : '';
    if (!name || name.length > 100 || (body.noColor !== 'yes' && !/^#[0-9a-f]{6}$/i.test(colorRaw))) return c.redirect('/roles?msg=invalid#new-role');
    const patch: RolePatch = {
      name,
      color: body.noColor === 'yes' ? 0 : parseInt(colorRaw.slice(1), 16),
      hoist: body.hoist === 'yes',
      mentionable: body.mentionable === 'yes',
      permissions: '0',
    };
    let role: GuildRole;
    try {
      role = await deps.discord.createRole(cfg.guildId, patch, '管理画面（ロールを作る）');
    } catch (err) {
      logger.warn({ err }, 'role create failed');
      return c.redirect('/roles?msg=failed#new-role');
    }
    await audit(db, { actorId: c.get('session').userId, action: 'role.create', detail: { roleId: role.id, name }, via: 'web' });
    return c.redirect(`/roles/${role.id}?msg=created`);
  });

  /** ロールを消す（名前を入力して確認。BOT が使っているロール・🔒 のロールは消さない） */
  app.post('/roles/:id/delete', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/roles');
    const back = (msg: string) => c.redirect(`/roles/${id}?msg=${msg}`);
    const body = await c.req.parseBody();
    const roles = await loadRoles();
    const role = roles?.find((r) => r.id === id);
    if (!roles || !role || id === cfg.guildId) return c.redirect('/roles');
    if (roleLocked(role, roles)) return back('locked');
    if (roleKind(cfg, role) || (await roleUsedByShop(id))) return back('in_use');
    if (typeof body.confirmName !== 'string' || body.confirmName.trim() !== role.name) return back('confirm_name');
    try {
      await deps.discord.deleteRole(cfg.guildId, id, '管理画面（ロールを消す）');
    } catch (err) {
      logger.warn({ err }, 'role delete failed');
      return back('failed');
    }
    await audit(db, { actorId: c.get('session').userId, action: 'role.delete', detail: { roleId: id, name: role.name }, via: 'web' });
    return c.redirect('/roles?msg=deleted');
  });

  /** 授与所の品物で使っているロールか */
  const roleUsedByShop = async (roleId: string) => (await listShopItems(db)).some((i) => i.roleId === roleId);

  /** 招待リンクを作れるのを BOT だけにする: @everyone と（🔒 以外の）ロールから「招待を作成」を外す */
  app.post('/roles/invites-bot-only', async (c) => {
    const body = await c.req.parseBody();
    if (body.confirm !== 'yes') return c.redirect('/roles?msg=need_confirm_all');
    const roles = await loadRoles();
    if (!roles) return c.redirect('/roles?msg=failed');
    const targets = roles.filter((r) => !roleLocked(r, roles) && (BigInt(r.permissions ?? '0') & CREATE_INVITE) !== 0n);
    const done: string[] = [];
    let failed = 0;
    for (const r of targets) {
      try {
        await deps.discord.editRole(cfg.guildId, r.id, { permissions: (BigInt(r.permissions ?? '0') & ~CREATE_INVITE).toString() }, '管理画面（招待リンクは BOT だけ）');
        done.push(r.name);
      } catch (err) {
        logger.warn({ err, roleId: r.id }, 'role invite permission update failed');
        failed++;
      }
    }
    if (done.length) await audit(db, { actorId: c.get('session').userId, action: 'role.invites_bot_only', detail: { count: done.length, roles: done }, via: 'web' });
    return c.redirect(`/roles?msg=${failed ? 'failed_some' : done.length ? 'invites_bot_only' : 'unchanged'}`);
  });

  /** ニックネームを自分で変えられないようにする: @everyone と（🔒 以外の）ロールから「ニックネームの変更」を外す */
  app.post('/roles/nickname-lock', async (c) => {
    const body = await c.req.parseBody();
    if (body.confirm !== 'yes') return c.redirect('/roles?msg=need_confirm_all');
    const roles = await loadRoles();
    if (!roles) return c.redirect('/roles?msg=failed');
    const targets = roles.filter((r) => !roleLocked(r, roles) && (BigInt(r.permissions ?? '0') & CHANGE_NICKNAME) !== 0n);
    const done: string[] = [];
    let failed = 0;
    for (const r of targets) {
      try {
        await deps.discord.editRole(cfg.guildId, r.id, { permissions: (BigInt(r.permissions ?? '0') & ~CHANGE_NICKNAME).toString() }, '管理画面（ニックネームは自分で変えられない）');
        done.push(r.name);
      } catch (err) {
        logger.warn({ err, roleId: r.id }, 'role nickname permission update failed');
        failed++;
      }
    }
    if (done.length) await audit(db, { actorId: c.get('session').userId, action: 'role.nickname_lock', detail: { count: done.length, roles: done }, via: 'web' });
    return c.redirect(`/roles?msg=${failed ? 'failed_some' : done.length ? 'nickname_locked' : 'unchanged'}`);
  });

  /** すべてのロールの「誰でも @ で呼べる」をまとめて ON / OFF（@everyone・🔒 のロールはのぞく） */
  app.post('/roles/mentionable-all', async (c) => {
    const body = await c.req.parseBody();
    const on = body.mentionable === 'on';
    if (!on && body.mentionable !== 'off') return c.redirect('/roles');
    if (body.confirm !== 'yes') return c.redirect('/roles?msg=need_confirm_all');
    const roles = await loadRoles();
    if (!roles) return c.redirect('/roles?msg=failed');
    const targets = roles.filter((r) => r.id !== cfg.guildId && !roleLocked(r, roles) && Boolean(r.mentionable) !== on);
    const done: string[] = [];
    let failed = 0;
    for (const r of targets) {
      try {
        await deps.discord.editRole(cfg.guildId, r.id, { mentionable: on }, '管理画面（ロール: まとめて @ で呼べる）');
        done.push(r.name);
      } catch (err) {
        logger.warn({ err, roleId: r.id }, 'role mentionable update failed');
        failed++;
      }
    }
    if (done.length) {
      await audit(db, { actorId: c.get('session').userId, action: 'role.mentionable_all', detail: { mentionable: on, count: done.length, roles: done }, via: 'web' });
    }
    return c.redirect(`/roles?msg=${failed ? 'failed_some' : done.length ? (on ? 'mentionable_on' : 'mentionable_off') : 'unchanged'}`);
  });

  app.post('/roles/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/roles');
    const back = (msg: string) => c.redirect(`/roles/${id}?msg=${msg}`);
    const roles = await loadRoles();
    const role = roles?.find((r) => r.id === id);
    if (!roles || !role) return c.redirect('/roles');
    if (roleLocked(role, roles)) return back('locked');
    const body = await c.req.parseBody({ all: true });
    const one = (k: string) => (Array.isArray(body[k]) ? body[k][0] : body[k]);
    const permsRaw = body.perm === undefined ? [] : Array.isArray(body.perm) ? body.perm : [body.perm];
    const selected = permsRaw.map((v) => Number(v)).filter((n) => Number.isInteger(n));
    const before = permsOf(role);
    const after = mergePermissions(before, selected);
    // 管理者を新しく付けるときは確認
    if ((after & ADMINISTRATOR) !== 0n && (before & ADMINISTRATOR) === 0n && one('confirmAdmin') !== 'yes') return back('need_confirm');
    const patch: RolePatch = {};
    if (after !== before) patch.permissions = after.toString();
    if (id !== cfg.guildId) {
      const name = typeof one('name') === 'string' ? (one('name') as string).trim() : '';
      const colorRaw = typeof one('color') === 'string' ? (one('color') as string) : '';
      if (!name || name.length > 100 || (one('noColor') !== 'yes' && !/^#[0-9a-f]{6}$/i.test(colorRaw))) return back('invalid');
      const color = one('noColor') === 'yes' ? 0 : parseInt(colorRaw.slice(1), 16);
      if (name !== role.name) patch.name = name;
      if (color !== role.color) patch.color = color;
      const hoist = one('hoist') === 'yes';
      const mentionable = one('mentionable') === 'yes';
      if (hoist !== Boolean(role.hoist)) patch.hoist = hoist;
      if (mentionable !== Boolean(role.mentionable)) patch.mentionable = mentionable;
    }
    if (!Object.keys(patch).length) return back('unchanged');
    try {
      await deps.discord.editRole(cfg.guildId, id, patch, '管理画面（ロール）');
    } catch (err) {
      logger.warn({ err }, 'role update failed');
      return back('failed');
    }
    const diff = permDiff(before, after);
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'role.update',
      detail: { roleId: id, name: role.name, ...(patch.name ? { newName: patch.name } : {}), ...(diff.added.length ? { added: diff.added } : {}), ...(diff.removed.length ? { removed: diff.removed } : {}) },
      via: 'web',
    });
    return back('saved');
  });

  // ───────── 市場（神職・宮司）: 問題ありの取引・出品の取り下げ ─────────

  // ───────── 面談告知 ─────────

  /** 次のちょうどの時刻（日本時間の 2026-09-28T21:00） */
  const nextHourJst = () => {
    const j = new Date(Math.ceil((now().getTime() + 9 * 3_600_000) / 3_600_000) * 3_600_000);
    return j.toISOString().slice(0, 16);
  };

  app.get('/interview', async (c) => {
    const [st, channels, guildRoles, history] = await Promise.all([loadInterview(db), loadChannels(), loadRoles(), listAudit(db, { action: 'interview.post', limit: 20 })]);
    const catName = (id: string | null) => channels.find((ch) => ch.id === id)?.name;
    const textChannels = listTextChannels(channels).flatMap((g) => g.items);
    const names = await namesOf(db, history.map((h) => h.actorId));
    const at = parseJstLocal(nextHourJst())!;
    return c.html(
      <InterviewPage
        session={c.get('session')}
        settings={st}
        channelName={interviewChannelOf(st, channels)?.name}
        textChannels={textChannels.map((ch) => ({ id: ch.id, name: ch.name, ...(catName(ch.parent_id) ? { category: catName(ch.parent_id)! } : {}) }))}
        roles={(guildRoles ?? []).filter((r) => r.id !== cfg.guildId && !r.managed).map((r) => ({ id: r.id, name: r.name }))}
        defaultAt={nextHourJst()}
        preview={interviewMessage(st, renderInterview(st.template, { at, place: '🔊 拝殿', note: '（ここに一言）' })).content ?? ''}
        history={history}
        names={names}
        flash={c.req.query('msg')}
      />,
    );
  });

  app.post('/interview/post', async (c) => {
    const body = await c.req.parseBody();
    const at = typeof body.at === 'string' ? parseJstLocal(body.at) : undefined;
    if (!at) return c.redirect('/interview?msg=invalid');
    const st = await loadInterview(db);
    const channel = interviewChannelOf(st, await loadChannels(true));
    if (!channel) return c.redirect('/interview?msg=no_channel');
    const text = renderInterview(st.template, { at, place: field(body, 'place', 100), note: typeof body.note === 'string' ? body.note.slice(0, 500) : '' });
    try {
      await deps.discord.sendMessage(channel.id, interviewMessage(st, text));
    } catch (err) {
      logger.warn({ err }, 'interview post failed');
      return c.redirect('/interview?msg=failed');
    }
    const p = jstParts(at);
    await audit(db, { actorId: c.get('session').userId, action: 'interview.post', detail: { channelId: channel.id, at: at.toISOString(), label: `${p.date} ${p.time}` }, via: 'web' });
    return c.redirect('/interview?msg=posted');
  });

  app.post('/interview/settings', async (c) => {
    const body = await c.req.parseBody();
    const channelId = typeof body.channelId === 'string' && validId(body.channelId) ? body.channelId : undefined;
    const roleId = typeof body.roleId === 'string' && validId(body.roleId) ? body.roleId : undefined;
    const template = body.reset === 'yes' ? DEFAULT_INTERVIEW_TEMPLATE : typeof body.template === 'string' ? body.template.replace(/\r\n/g, '\n').trim() : '';
    const parsed = interviewSchema.safeParse({ ...(channelId ? { channelId } : {}), ...(roleId ? { roleId } : {}), template, mention: body.mention });
    if (!parsed.success || (parsed.data.mention === 'role' && !parsed.data.roleId)) return c.redirect('/interview?msg=settings_invalid');
    await saveInterview(db, parsed.data, c.get('session').userId);
    await audit(db, { actorId: c.get('session').userId, action: 'interview.settings', detail: { channelId, mention: parsed.data.mention }, via: 'web' });
    return c.redirect('/interview?msg=saved');
  });

  // ───────── 物御籤 ─────────

  app.get('/gacha', async (c) => {
    await ensureGachaPrizes(db, cfg.gacha);
    const [stats, draws, tops, players, holders, prizes, items, guildRoles, claims, customs, cHolders] = await Promise.all([
      gachaStats(db),
      recentDraws(db, { limit: 100 }),
      recentDraws(db, { limit: 20, topOnly: true }),
      topPlayers(db),
      ticketHolders(db),
      listPrizes(db),
      listShopItems(db),
      loadRoles(),
      listClaims(db),
      listCustomTickets(db),
      customHolders(db),
    ]);
    const names = await namesOf(db, [
      ...draws.map((d) => d.memberId),
      ...tops.map((d) => d.memberId),
      ...players.map((p) => p.memberId),
      ...holders.map((h) => h.memberId),
      ...claims.flatMap((cl) => [cl.memberId, cl.deliveredBy ?? '']),
      ...cHolders.map((h) => h.memberId),
    ]);
    const roles = (guildRoles ?? []).filter((r) => r.id !== cfg.guildId && !r.managed);
    const reset = gujiOnly(c) ? await gachaResetPreview(db) : undefined;
    const gift = gujiOnly(c)
      ? {
          nonce: randomUUID(),
          targets: (await giftTargets(db, cfg.ranks.map((x) => x.roleId))).length,
          channels: postableChannels(await loadChannels().catch(() => [])),
          recent: await recentGifts(db),
        }
      : undefined;
    return c.html(
      <GachaPage
        session={c.get('session')}
        gacha={cfg.gacha}
        coinName={cfg.economy.currencyName}
        coinEmoji={cfg.economy.currencyEmoji}
        stats={stats}
        prizes={prizes}
        claims={claims}
        customTickets={customs}
        customHolders={cHolders}
        shopItems={items.filter(giftableShopItem)}
        roles={roles.map((r) => ({ id: r.id, name: r.name }))}
        draws={draws}
        tops={tops}
        players={players}
        holders={[
          ...holders,
          ...[...new Set(cHolders.map((h) => h.memberId))].filter((id) => !holders.some((h) => h.memberId === id)).map((memberId) => ({ memberId, tickets: emptyTickets() })),
        ]}
        names={names}
        roleNames={new Map((guildRoles ?? []).map((r) => [r.id, r.name]))}
        flash={c.req.query('msg')}
        gift={gift}
        {...(reset
          ? {
              reset: {
                members: reset.length,
                draws: reset.reduce((n, m) => n + m.draws, 0),
                refund: reset.reduce((n, m) => n + m.refund, 0),
                coins: reset.reduce((n, m) => n + m.coins, 0),
                tickets: reset.reduce((n, m) => n + [...Object.values(m.tickets), ...Object.values(m.custom)].reduce((a, b) => a + (b ?? 0), 0), 0),
                roles: reset.reduce((n, m) => n + m.roleIds.length, 0),
              },
            }
          : {})}
      />,
    );
  });

  /** 物御籤の設定（値段・天井・出やすさ・ON/OFF）を保存する。おかしければ false */
  const saveGacha = async (c: Context<Env>, patch: Partial<GuildConfig['gacha']>): Promise<boolean> => {
    const current = await loadOverrides(db);
    let overrides: Overrides;
    try {
      overrides = overridesSchema.parse({ ...current, gacha: { ...cfg.gacha, ...patch } });
      applyOverrides(fileCfg(), overrides);
    } catch {
      return false;
    }
    await saveOverrides(db, overrides, c.get('session').userId);
    await deps.onSettingsSaved?.();
    await audit(db, { actorId: c.get('session').userId, action: 'gacha.settings', detail: patch, via: 'web' });
    return true;
  };
  const gachaBack = (c: Context<Env>, msg: string, at = 'gacha-basic') => c.redirect(`/gacha?msg=${msg}#${at}`);

  // 物御籤をリセット: 引いた分の銭を返し、出たものを取り上げる（宮司のみ・「リセット」と入れる）
  app.post('/gacha/reset', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    if (typeof body.confirm !== 'string' || body.confirm.trim() !== 'リセット') return gachaBack(c, 'gacha_reset_confirm', 'gacha-reset');
    const r = await resetGacha(db, now());
    let rolesRemoved = 0;
    for (const x of r.removeRoles) {
      const ok = await deps.discord
        .removeRole(cfg.guildId, x.memberId, x.roleId, '物御籤のリセット')
        .then(() => true)
        .catch((err: unknown) => (logger.warn({ err, ...x }, 'gacha reset role remove failed'), false));
      if (ok) rolesRemoved++;
    }
    if (body.dm === 'yes') {
      const e = cfg.economy;
      for (const m of r.perMember) {
        const parts = [
          `🎁 咲楽ノ宮の物御籤をリセットしました。`,
          `引いた分の ${e.currencyEmoji}${e.currencyName} ${m.refund.toLocaleString('ja-JP')} 枚をお返ししました。`,
          m.coinsTaken || m.ticketsTaken || m.roles ? `物御籤で出たもの（${[m.coinsTaken ? `${e.currencyName} ${m.coinsTaken} 枚` : '', m.ticketsTaken ? `券 ${m.ticketsTaken} 枚` : '', m.roles ? `ロール ${m.roles} 個` : ''].filter(Boolean).join('・')}）は、返していただきました。` : '',
        ];
        await deps.discord.sendDm(m.memberId, parts.filter(Boolean).join('\n')).catch(() => false);
      }
    }
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'gacha.reset',
      detail: { members: r.members, draws: r.draws, refunded: r.refunded, coinsTaken: r.coinsTaken, ticketsTaken: r.ticketsTaken, roles: r.removeRoles.length, rolesRemoved },
      via: 'web',
    });
    return gachaBack(c, 'gacha_reset', 'gacha-basic');
  });

  // おすすめの中身をまとめて足す（限定ロールがなければ作る）
  app.post('/gacha/presets', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const existing = (await loadRoles()) ?? [];
    const roles: Partial<Record<PresetRoleKey, string>> = {};
    let rolesCreated = 0;
    for (const r of PRESET_ROLES) {
      const found = existing.find((x) => x.name === r.name);
      if (found) {
        roles[r.key] = found.id;
        continue;
      }
      try {
        const made = await deps.discord.createRole(cfg.guildId, { name: r.name, color: r.color, hoist: false, mentionable: false, permissions: '0' }, '物御籤のおすすめの中身');
        roles[r.key] = made.id;
        rolesCreated++;
      } catch (err) {
        logger.warn({ err, name: r.name }, 'preset role create failed');
      }
    }
    const shopColors = (await listShopItems(db)).filter((i) => giftableShopItem(i) && i.roleGroup === 'color' && i.durationDays && !i.boosterOnly);
    await ensureGachaPrizes(db, cfg.gacha);
    const added = await addPresetPrizes(db, presetPrizes(roles, shopColors));
    await audit(db, { actorId: c.get('session').userId, action: 'gacha.presets', detail: { added, rolesCreated }, via: 'web' });
    return c.redirect(`/gacha?msg=presets&added=${added}&roles=${rolesCreated}#gacha-prizes`);
  });

  // 自由な券を作る・ON/OFF
  /** 🎁 全員にプレゼント（宮司だけ） */
  app.post('/gacha/gift', async (c) => {
    const to = (msg: string) => c.redirect(`/gacha?msg=${msg}#gacha-gift`);
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const item = await parseGiftItem(db, body.item);
    const count = Number(body.count);
    const note = field(body, 'note', 200);
    const nonce = typeof body.nonce === 'string' ? body.nonce : '';
    const roleId = typeof body.roleId === 'string' && validId(body.roleId) ? body.roleId : undefined;
    if (body.confirm !== 'yes' || !item || !validGiftCount(item, count) || !note || !/^[0-9a-f-]{36}$/.test(nonce)) return to('gift_invalid');
    const targets = await giftTargets(db, cfg.ranks.map((x) => x.roleId), roleId);
    if (targets.length === 0) return to('gift_none');
    const by = c.get('session').userId;
    const label = giftItemLabel(item, { name: cfg.economy.currencyName, emoji: cfg.economy.currencyEmoji });
    const r = await giftToAll(db, { item, label, count, note, memberIds: targets, roleId, by, nonce });
    if (r.status === 'duplicate') return to('gift_dup');
    if (r.status !== 'ok') return to('gift_invalid');
    await audit(db, { actorId: by, action: 'gift.all', detail: { gift: r.batch.id, item: r.batch.item, label, count, note, roleId, recipients: targets.length }, via: 'web' });
    // チャンネルでお知らせ（任意）
    const announce = typeof body.announce === 'string' && validId(body.announce) ? body.announce : undefined;
    if (!announce) return to('gift_given');
    const roleName = roleId ? (await loadRoles())?.find((x) => x.id === roleId)?.name : undefined;
    const ping = body.everyone === 'yes';
    const head = ping ? (roleId ? `<@&${roleId}>\n` : '@everyone\n') : '';
    const howToUse = item.kind === 'coins' ? '' : '\n-# `/物御籤` の「🎟 券を使う」から使えます（持っている券は `/残高` で見られます）';
    try {
      await deps.discord.sendMessage(announce, {
        content: `${head}${giftAnnouncement(label, count, note, '枚', roleName)}${howToUse}`,
        allowed_mentions: ping ? (roleId ? { parse: [], roles: [roleId] } : { parse: ['everyone'] }) : { parse: [] },
      });
      return to('gift_announced');
    } catch (err) {
      logger.warn({ err }, 'gift announce failed');
      return to('gift_announce_failed');
    }
  });

  app.post('/gacha/custom', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const name = field(body, 'name', 40);
    if (!name) return gachaBack(c, 'custom_invalid', 'gacha-custom');
    const t = await createCustomTicket(db, { emoji: field(body, 'emoji', 16) || '🎟', name, note: field(body, 'note', 200) });
    await audit(db, { actorId: c.get('session').userId, action: 'gacha.custom_create', detail: { id: t.id, name }, via: 'web' });
    return gachaBack(c, 'custom_created', 'gacha-custom');
  });

  app.post('/gacha/custom/:id/toggle', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const t = (await listCustomTickets(db)).find((x) => x.id === Number(c.req.param('id')));
    if (!t) return gachaBack(c, 'prize_not_found', 'gacha-custom');
    await setCustomTicketEnabled(db, t.id, !t.enabled);
    await audit(db, { actorId: c.get('session').userId, action: 'gacha.custom_toggle', detail: { id: t.id, enabled: !t.enabled }, via: 'web' });
    return gachaBack(c, 'custom_toggled', 'gacha-custom');
  });

  // 運営が渡す賞品を渡した
  app.post('/gacha/claims/:id/done', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id)) return gachaBack(c, 'claim_done_already', 'gacha-claims');
    const row = await deliverClaim(db, id, c.get('session').userId, now());
    if (!row) return gachaBack(c, 'claim_done_already', 'gacha-claims');
    await audit(db, { actorId: c.get('session').userId, targetId: row.memberId, action: 'gacha.claim_done', detail: { id, label: row.label }, via: 'web' });
    return gachaBack(c, 'claim_done', 'gacha-claims');
  });

  app.post('/gacha/toggle', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const enabled = (await c.req.parseBody()).enabled === 'yes';
    return gachaBack(c, (await saveGacha(c, { enabled })) ? (enabled ? 'gacha_on' : 'gacha_off') : 'gacha_invalid');
  });

  app.post('/gacha/settings', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const num = (k: string) => Number(typeof body[k] === 'string' && body[k] !== '' ? body[k] : NaN);
    const patch = {
      price: num('price'),
      pity: num('pity'),
      ...(typeof body.share === 'string' ? { share: num('share') } : {}),
      // 送られなかった運勢は、いまの値のまま
      rates: Object.fromEntries(GACHA_TIERS.map((t) => [t, body[`rate.${t}`] === undefined ? cfg.gacha.rates[t] : num(`rate.${t}`)])) as GuildConfig['gacha']['rates'],
    };
    return gachaBack(c, (await saveGacha(c, patch)) ? 'gacha_saved' : 'gacha_invalid');
  });

  /** 中身の枚数・重み（おかしければ undefined） */
  const prizeNumbers = (body: Record<string, unknown>, kind: PrizeKind) => {
    const n = (k: string) => (typeof body[k] === 'string' && body[k] !== '' ? Number(body[k]) : NaN);
    const weight = n('weight');
    const amount = kind === 'ticket' || kind === 'coins' || kind === 'custom' ? n('amount') : 1;
    const maxAmount = kind === 'coins' ? 1_000_000 : 100;
    if (!Number.isInteger(weight) || weight < 1 || weight > 1_000_000 || !Number.isInteger(amount) || amount < 1 || amount > maxAmount) return undefined;
    // 特別な賞品の残り（空はいくらでも）
    const stockRaw = typeof body.stock === 'string' ? body.stock.trim() : '';
    const stock = stockRaw === '' ? null : Number(stockRaw);
    if (kind === 'special' && stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 1000)) return undefined;
    return { weight, amount, fallback: body.fallback === 'yes', ...(kind === 'special' ? { stock } : {}) };
  };

  app.post('/gacha/prizes', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const tier = body.tier as GachaTier;
    const kind = body.kind as PrizeKind;
    if (!GACHA_TIERS.includes(tier) || !PRIZE_KINDS.includes(kind)) return gachaBack(c, 'prize_invalid', 'gacha-add');
    const nums = prizeNumbers(body, kind);
    if (!nums) return gachaBack(c, 'prize_invalid', 'gacha-add');
    const input: PrizeInput = { tier, kind, ...nums };
    // 🎍 期間限定（日本時間の日付。最後の日は、その日の終わりまで）
    const day = (k: string, add = 0) => {
      const v = typeof body[k] === 'string' ? (body[k] as string) : '';
      const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? parseJstLocal(`${v}T00:00`) : undefined;
      return d ? new Date(d.getTime() + add * 86_400_000) : undefined;
    };
    const startsAt = day('startsOn');
    const endsAt = day('endsOn', 1);
    if (startsAt && endsAt && endsAt <= startsAt) return gachaBack(c, 'prize_invalid', 'gacha-add');
    if (startsAt) input.startsAt = startsAt;
    if (endsAt) input.endsAt = endsAt;
    if (kind === 'zodiac') {
      const roleId = typeof body.roleId === 'string' ? body.roleId : '';
      if (roleId && validId(roleId) && roleId !== cfg.guildId) input.roleId = roleId;
    } else if (kind === 'role') {
      const roleId = typeof body.roleId === 'string' ? body.roleId : '';
      if (!validId(roleId) || roleId === cfg.guildId) return gachaBack(c, 'prize_invalid', 'gacha-add');
      input.roleId = roleId;
    } else if (kind === 'ticket') {
      if (!TICKET_KINDS.includes(body.ticket as TicketKind)) return gachaBack(c, 'prize_invalid', 'gacha-add');
      input.ticket = body.ticket as TicketKind;
    } else if (kind === 'shop') {
      const item = await getShopItem(db, Number(body.shopItemId));
      if (!item || !giftableShopItem(item)) return gachaBack(c, 'prize_invalid', 'gacha-add');
      input.shopItemId = item.id;
    } else if (kind === 'special') {
      const label = field(body, 'label', 100);
      if (!label) return gachaBack(c, 'prize_invalid', 'gacha-add');
      input.label = label;
    } else if (kind === 'custom') {
      const t = (await listCustomTickets(db)).find((x) => x.id === Number(body.customTicketId));
      if (!t) return gachaBack(c, 'prize_invalid', 'gacha-add');
      input.customTicketId = t.id;
    }
    const row = await createPrize(db, input);
    await audit(db, { actorId: c.get('session').userId, action: 'gacha.prize_add', detail: { ...input, id: row.id }, via: 'web' });
    return gachaBack(c, 'prize_added', 'gacha-prizes');
  });

  const prizeId = (c: Context<Env>) => {
    const id = Number(c.req.param('id'));
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  };

  // 出る確率（%）で決める: 運勢の出やすさ = その運勢の中身の % の合計、重み = % に比例（0% は OFF）
  app.post('/gacha/prizes/rates', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const prizes = await listPrizes(db);
    const chances = prizeChances(cfg.gacha, prizes);
    const edits: { prize: (typeof prizes)[number]; pct: number }[] = [];
    for (const p of prizes) {
      const v = body[`pct.${p.id}`];
      if ((chances.get(p.id) ?? 0) <= 0 || typeof v !== 'string' || v.trim() === '') continue;
      const pct = Number(v);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return gachaBack(c, 'prize_rates_invalid', 'gacha-prizes');
      edits.push({ prize: p, pct });
    }
    if (!edits.length || edits.every((e) => e.pct === 0)) return gachaBack(c, 'prize_rates_invalid', 'gacha-prizes');
    const rates = { ...cfg.gacha.rates };
    for (const t of GACHA_TIERS) {
      const inTier = edits.filter((e) => e.prize.tier === t);
      if (inTier.length) rates[t] = Math.round(inTier.reduce((n, e) => n + e.pct, 0) * 10000) / 10000;
    }
    if (!(await saveGacha(c, { rates }))) return gachaBack(c, 'prize_rates_invalid', 'gacha-prizes');
    for (const e of edits) {
      await updatePrize(db, e.prize.id, e.pct > 0 ? { weight: Math.max(1, Math.round(e.pct * 10000)) } : { enabled: false });
    }
    await audit(db, { actorId: c.get('session').userId, action: 'gacha.prize_rates', detail: { rates, prizes: edits.map((e) => ({ id: e.prize.id, pct: e.pct })) }, via: 'web' });
    return gachaBack(c, 'prize_rates', 'gacha-prizes');
  });

  // まとめて: 選んだ中身を ON・OFF・削除 / 全部を ON・OFF（/gacha/prizes/:id より先に）
  app.post('/gacha/prizes/bulk', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody({ all: true });
    const action = typeof body.action === 'string' ? body.action : '';
    const all = await listPrizes(db);
    const picked = (body.ids === undefined ? [] : Array.isArray(body.ids) ? body.ids : [body.ids]).map((v) => Number(v));
    const targets = action === 'all_on' || action === 'all_off' ? all : all.filter((p) => picked.includes(p.id));
    if (!['on', 'off', 'delete', 'all_on', 'all_off'].includes(action)) return gachaBack(c, 'prize_invalid', 'gacha-prizes');
    if (!targets.length) return gachaBack(c, 'prize_bulk_none', 'gacha-prizes');
    for (const p of targets) {
      if (action === 'delete') await deletePrize(db, p.id);
      else await updatePrize(db, p.id, { enabled: action === 'on' || action === 'all_on' });
    }
    await audit(db, { actorId: c.get('session').userId, action: 'gacha.prize_bulk', detail: { action, ids: targets.map((p) => p.id) }, via: 'web' });
    return gachaBack(c, 'prize_bulk', 'gacha-prizes');
  });

  app.post('/gacha/prizes/:id', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const id = prizeId(c);
    const row = id ? (await listPrizes(db)).find((p) => p.id === id) : undefined;
    if (!row) return gachaBack(c, 'prize_not_found', 'gacha-prizes');
    const nums = prizeNumbers(await c.req.parseBody(), row.kind);
    if (!nums) return gachaBack(c, 'prize_invalid', 'gacha-prizes');
    await updatePrize(db, row.id, nums);
    await audit(db, { actorId: c.get('session').userId, action: 'gacha.prize_update', detail: { id: row.id, ...nums }, via: 'web' });
    return gachaBack(c, 'prize_saved', 'gacha-prizes');
  });

  app.post('/gacha/prizes/:id/toggle', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const id = prizeId(c);
    const row = id ? (await listPrizes(db)).find((p) => p.id === id) : undefined;
    if (!row) return gachaBack(c, 'prize_not_found', 'gacha-prizes');
    await updatePrize(db, row.id, { enabled: !row.enabled });
    await audit(db, { actorId: c.get('session').userId, action: 'gacha.prize_toggle', detail: { id: row.id, enabled: !row.enabled }, via: 'web' });
    return gachaBack(c, row.enabled ? 'prize_off' : 'prize_on', 'gacha-prizes');
  });

  app.post('/gacha/prizes/:id/delete', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const id = prizeId(c);
    const row = id ? await deletePrize(db, id) : undefined;
    if (!row) return gachaBack(c, 'prize_not_found', 'gacha-prizes');
    await audit(db, { actorId: c.get('session').userId, action: 'gacha.prize_delete', detail: { ...row }, via: 'web' });
    return gachaBack(c, 'prize_deleted', 'gacha-prizes');
  });

  app.get('/market', async (c) => {
    const [orders, listings] = await Promise.all([recentOrders(db), recentListings(db)]);
    const names = await namesOf(db, [...orders.flatMap((o) => [o.buyerId, o.sellerId]), ...listings.map((l) => l.sellerId)]);
    return c.html(<MarketPage session={c.get('session')} orders={orders} listings={listings} names={names} feePercent={cfg.market.feePercent} flash={c.req.query('msg')} />);
  });

  app.post('/market/orders/:id/:action', async (c) => {
    const id = Number(c.req.param('id'));
    const action = c.req.param('action');
    if (!Number.isSafeInteger(id) || (action !== 'refund' && action !== 'release')) return c.redirect('/market');
    const by = c.get('session').userId;
    const o = action === 'refund' ? await refundOrder(db, id, by) : await releaseOrder(db, id, by);
    if (!o) return c.redirect('/market?msg=done_already');
    await audit(db, { actorId: by, targetId: action === 'refund' ? o.buyerId : o.sellerId, action: `market.${action}`, detail: { orderId: id, price: o.price }, via: 'web' });
    const e = cfg.economy;
    await deps.discord.sendDm(o.buyerId, action === 'refund' ? `🏪 取引 #${id} は運営の判断で返金しました（${e.currencyEmoji} ${o.price} 枚）。` : `🏪 取引 #${id} は運営の判断で完了にしました。`);
    await deps.discord.sendDm(o.sellerId, action === 'refund' ? `🏪 取引 #${id} は運営の判断で、買った方に返金しました。` : `🏪 取引 #${id} は運営の判断で完了にしました（${e.currencyEmoji} ${o.price - o.fee} 枚をお渡ししました）。`);
    return c.redirect(`/market?msg=${action === 'refund' ? 'refunded' : 'released'}`);
  });

  app.post('/market/listings/:id/remove', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id)) return c.redirect('/market');
    const l = await closeListing(db, id, 'staff');
    if (!l) return c.redirect('/market?msg=done_already');
    // Discord のカードも「受付終了」に
    if (l.channelId && l.messageId) await deps.discord.editMessage(l.channelId, l.messageId, listingCard(l, cfg) as never).catch(() => undefined);
    await audit(db, { actorId: c.get('session').userId, targetId: l.sellerId, action: 'market.close', detail: { listingId: id, by: 'removed' }, via: 'web' });
    return c.redirect('/market?msg=removed');
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
      ...(item.kind !== 'menzaifu' && item.kind !== 'gift' ? { boosterOnly: body.boosterOnly === 'yes' } : {}),
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
      boosterOnly: body.boosterOnly === 'yes',
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

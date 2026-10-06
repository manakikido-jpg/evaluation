import { atDayPicks } from '../services/casino/slotAtPlay.js';
import { artUrls, AT_ART_SLOTS, deleteArt, isArtKey, loadArt, saveArt } from '../services/casino/slotArt.js';
import { activityStats, genderNow, genderTrend } from '../services/genderStats.js';
import { addIdeaComment, addIdeaFiles, canEditIdea, createIdea, deleteIdea, deleteIdeaComment, deleteIdeaFile, getIdea, getIdeaFile, ideaCounts, ideaFilesZip, isIdeaKind, isIdeaStatus, listIdeas, setIdeaPinned, setIdeaStatus, toggleIdeaVote, updateIdea, type IdeaKind } from '../services/ideas.js';
import { IdeaPage, IdeasPage } from './views/ideas.js';
import { deleteOmikujiArt, deleteSlipBg, isOmikujiArtNo, isSlipBgKey, loadOmikujiArt, loadSlipBg, omikujiArtHashes, saveOmikujiArt, saveSlipBg, SLIP_BG_KEYS, slipBgHashes } from '../services/omikujiArt.js';
import { fortuneOf, omikujiSayings, specialIndex } from '../services/omikuji.js';
import { renderSlip } from '../services/omikujiSlip.js';
import { trialUnei } from '../services/omikujiTrial.js';
import { aiStats } from '../services/casino/aiStats.js';
import { FORTUNE_KEYS, toneOf, TONES, type FortuneKey } from '../omikujiTexts.js';
import { openBells } from '../services/opsWatch.js';
import { createHash, randomUUID } from 'node:crypto';
import { channelsOf, dailyUsage, partnersOf, roomHistory, sinceDate, topPairs, usageByCategory, usageByMember } from '../services/voiceUsage.js';
import { MemberVoiceSection, VoicePage, type VoiceRange } from './views/voice.js';
import { inviteCountOf, inviterOf, knownLinkCodes, liveLinks, recentInviteJoins, revokeLink } from '../services/invites.js';
import { AT_FILE_ART, STATIC } from './assets.js';
import { allRoleTemplates, deleteRoleTemplate, findRoleTemplate, saveRoleTemplate } from '../services/roleTemplates.js';
import { mountCasino } from './casino.js';
import { CasinoAdminPage, CASINO_RANGES, type CasinoRange } from './views/casinoAdmin.js';
import { casinoPlayers, casinoStats } from '../services/casino/casino.js';
import { casinoDaily, slotSettingStats } from '../services/casino/report.js';
import { applies, isCell, listTemplates, MATRIX_PERMS, planCells, saveTemplates, templateChanges, templateFits, templateSchema } from '../services/permMatrix.js';
import { PermMatrixPage, PermRolesPage, PermTemplatesPage } from './views/permMatrix.js';
import { resetState, runDemotions, startEvaluationReset, undoShuinReset } from '../services/evalReset.js';
import { panelMessage } from '../discord/panels.js';
import { NOTIFY_LABEL, notifyCounts, notifyReady, notifySetupState, pingRoleIds, runNotifySetup, startNotifySetup } from '../services/notify.js';
import { dayPicks, slotFloorData } from '../services/casino/slotFloor.js';
import { matchStats, recentMatches } from '../services/casino/versus.js';
import { CASINO_GAMES, OMIKUJI_LINE_MAX, OMIKUJI_SPECIAL_MAX, omikujiSpecialSchema, omikujiTextsSchema, opsWatchSchema, type CasinoGame } from '../config.js';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { adminLevelOf, webAccessOf, webAccessEntries, webPageOf, WEB_PAGES, WEB_PAGE_KEYS, type WebAccessEntry, GACHA_TIERS, TICKET_KINDS, type GachaTier, type GuildConfig, type TicketKind } from '../config.js';
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
import { InterviewPage, InterviewPreview, type DayChip } from './views/interview.js';
import {
  cancelInterview,
  createInterview,
  DEFAULT_REMINDER_TEMPLATE,
  DEFAULT_TEMPLATES,
  getInterview,
  interviewChannelOf,
  interviewSchema,
  jstParts,
  listInterviews,
  loadInterview,
  parseJstLocal,
  placeOf,
  postInterview,
  renderInterview,
  saveInterview,
  updateInterview,
  type InterviewSettings,
} from '../services/interview.js';
import type { Db } from '../db/client.js';
import type { AdminSession } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { audit, listAudit } from '../services/audit.js';
import { eventsOf, findMemberByNameOrId, getMember, memberDiff, recentLeaves, homeStats, isMemberSort, listMembers, membersWithRole, namesOf, roleMemberCounts, searchMembersWithoutRole, setMemberRole, shuinHistory, type MemberListQuery } from '../services/members.js';
import { goshuinchoOf } from '../services/shuin.js';
import { jstDate, recentActivity } from '../services/activity.js';
import { adminGrant, adminTake, currentMemberIds, grantJoinBonusToAll, recentCoinTx, validAdminAmount, walletOf } from '../services/economy.js';
import { checkTarget, clearYaku, giveYaku, instantBan, isBannedByEvents, kickMember, unbanMember, writeMemo, type Actor, type Denied, type ModCtx } from '../services/moderation.js';
import { activeYakuCount, memosOf, membersWithYaku, menzaifuUsed, yakuHistory } from '../services/yaku.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { DiscordHttpError } from '../lib/discordRest.js';
import type { DiscordApi } from './discordApi.js';
import { startOfTodayJst } from './format.js';
import { accountAccess, accountUserId, checkLogin, createAccount, deleteAccount, getAccount, listAccounts, normalizeLoginId, resetPassword, setDisabled, updateAccount } from '../services/webAccounts.js';
import { createSession, deleteSession, findSession, markChecked, randomToken, recheckAllSessions, RECHECK_MS, safeEqual, SESSION_HOURS } from './sessions.js';

/** ロールの確かめ直しに失敗しても使い続けてよい時間 */
const RECHECK_GRACE_MS = 30 * 60_000;
import { isStatsView, StatsPage } from './views/stats.js';
import { RecentUpdates, UpdatesPage } from './views/updates.js';
import type { SessionView } from './views/layout.js';
import { CHANGELOG, LATEST_CHANGE_ID, unseenChanges } from '../changelog.js';
import { markChangesSeen, seenChangeId } from '../services/updates.js';
import { inScope, loadUpdateNews, newsChannelOf, postNews, saveUpdateNews } from '../services/updateNews.js';
import { addDays, isTrendRange, memberTrend, parseSpan, previousSpan, SPAN_MAX_DAYS, unitOf, type TrendRange, type TrendSpan } from '../services/stats.js';
import { AuditPage, HomePage, LeftFeed, LoginPage, MemberDiffBody, MemberDiffPage, MemberPage, MemberResults, MembersPage, NotFoundPage } from './views/pages.js';
import { ConfirmPage, FLASH, ModerationSection, YakuPage } from './views/moderation.js';
import { AccountIssuedPage, ADMISSION_FLASH, ApplicationsPage, MemberAdmissionSection, OmairiPage, SettingsPage, SoudanListPage, SoudanPage } from './views/admission.js';
import { applicationsOf, getOmairi, omairiList, pendingApplications, recentDecidedApplications } from '../services/applications.js';
import { changeAgeGroup, closeSoudan, decide, decideOmairi, removeYoimairi, replySoudan, revealSoudanSender, type OmairiAction } from '../services/admission.js';
import { getSoudan, listSoudan, soudanMessagesOf } from '../services/soudan.js';
import { applyOverrides, loadOverrides, overridesSchema, saveOverrides, type Overrides } from '../services/settings.js';
import {
  createNotice,
  deleteNotice,
  getNotice,
  guildChannelsCached,
  listNotices,
  moveNotice,
  noticeStatus,
  noticeVariables,
  detectImage,
  addShuinButtonsToCategory,
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
import {
  applyGiftRoles,
  applyNarrowRoles,
  endOfJstDay,
  getGift,
  giftableRole,
  giftAnnouncement,
  giftItemLabel,
  giftTargets,
  giftToAll,
  giftUnit,
  narrowGift,
  narrowTargets,
  parseGiftItem,
  parseGiftRole,
  recentGifts,
  validGiftCount,
} from '../services/gifts.js';
import { currentBoosters, recentBoostMessages } from '../services/boost.js';
import { addHorse, cleanName as cleanHorseName, listHorses, renameHorse, setRetired } from '../services/casino/keibaStable.js';
import { balanceDistribution, bigTransactions, economyOverview, rangeStart, shopSales } from '../services/economyStats.js';
import { EconomyPage, MemberLedgerPage } from './views/economy.js';
import { cancelEvent, createEvent, EVENT_TICKET_MAX, isEventKind, isTicketKind, listEvents, validEventValue } from '../services/economyEvents.js';
import { gachaLedger, memberLedger, priceGuide, recentAlerts, suspectPairs } from '../services/economyWatch.js';
import {
  createTerm,
  deleteTerm,
  getTerm,
  GLOSSARY_CHANNEL,
  glossaryChannelsOf,
  listTerms,
  loadGlossaryPlaces,
  moveTerm,
  saveGlossaryPlaces,
  seedDefaultTerms,
  setTermEnabled,
  syncGlossaryNotices,
  updateTerm,
  type TermInput,
} from '../services/glossary.js';
import { isGlossaryCategory } from '../services/glossaryDefaults.js';
import { GlossaryPage } from './views/glossary.js';
import { MeetingEditPage, MeetingViewPage, MinutesPage } from './views/minutes.js';
import { TempPage } from './views/temp.js';
import { InvitesPage } from './views/invites.js';
import { hourlyHubOf, vipCategoryOf, vipHubOverwrites, VIP_COLOR, VIP_HUB_NAME, VIP_ROLE_NAME } from '../services/vip.js';
import { activeGrants, activeMemberNames, durationMinutes, endGrant, endedGrants, extendGrant, findActiveMember, getGrant, grantPerm, grantRole, isPermPreset, memberRoleIdsOf } from '../services/tempGrants.js';
import { staffRoleIds } from '../services/meetings.js';
import {
  countOpenTodos,
  createMeeting,
  deleteMeeting,
  getMeeting,
  listMeetings,
  loadVoiceNow,
  openTodos,
  pickablePeople,
  postSummary,
  toggleTodo,
  updateMeeting,
  type MeetingInput,
  type TodoInput,
} from '../services/meetings.js';
import { CommandsPage } from './views/commands.js';
import { commandList } from '../services/commandList.js';
import { commandDefinitions } from '../discord/commands.js';
import { ADMIN_RANK_KEYS, firstAutoKeyOf, RanksPage } from './views/ranks.js';
import { NoticeDeletePage, NoticeEditPage, NoticePreview, NoticesPage, type NoticeGroup } from './views/notices.js';
import { ShopPage } from './views/shop.js';
import { isTri, overwriteRows, permKeysFor, planOverwrites, sameOverwrites, whoCanView, type WantedOverwrite } from '../services/channelPerms.js';
import { ChannelEditPage, type ChannelPermView, ChannelNewPage, ChannelsPage, type ChannelInfo } from './views/channels.js';
import { RolePage, RolesPage } from './views/roles.js';
import { MarketPage } from './views/market.js';
import { closeListing, closeRequest, recentListings, recentOrders, recentRequests, refundOrder, releaseOrder } from '../services/market.js';
import { listingCard, requestCard } from '../discord/market.js';
import { entryMessage, postBoardPanel, postCard } from '../discord/board.js';
import { BoardPage } from './views/board.js';
import { CastPage } from './views/cast.js';
import { refreshCastPanel } from '../discord/cast.js';
import { castStats, deleteMenuImage, listCasts, loadCastConfig, loadMenuImage, monthStart, recentSessions, resolveSession, saveCastConfig, saveMenuImage, setCastStatus } from '../services/cast.js';
import { closePost, completeEntry, entriesFor, entriesOf, getEntry, getPost, loadBoardPlace, recentPosts, refundEntry, saveBoardPlace } from '../services/board.js';
import { ADMINISTRATOR, botTopPosition, dangerLabels, mergePermissions, permDiff, permsOf, roleKind } from '../services/roles.js';
import {
  channelsInUse,
  cleanChannelName,
  cleanNewChannelName,
  isChannelVisibility,
  isRestricted,
  isText,
  isVoice as isVoiceChannel,
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
  /** Discord でログインできるか（止めると ID とパスワードだけ。省略時はできる） */
  discordLogin?: boolean;
  /** 秘密の入口（/enter/この文字）。決めると、ここを通った人にだけログイン画面を出す（ほかは「見つかりません」） */
  entryKey?: string;
  now?: () => Date;
};

type Env = { Variables: { session: SessionView } };

const SESSION_COOKIE = 'shamusho_session';
const STATE_COOKIE = 'shamusho_state';
/** 秘密の入口を通った印 */
const ENTRY_COOKIE = 'shamusho_entry';
/** ログインの画面の CSRF */
const LOGIN_COOKIE = 'shamusho_login';
/** 同じところから続けて間違えたら、しばらく止める（アカウントごとのロックとは別に） */
const IP_LOCK = { tries: 20, minutes: 15 } as const;



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
  // 🦊 AT 機の絵（1 枚 4MB まで。まとめて保存するときは全部で 100MB まで）
  const artBody = bodyLimit({ maxSize: 5 * 1024 * 1024, onError: (c) => c.text('絵が大きすぎます（4MB まで）。', 413) });
  const artsBody = bodyLimit({ maxSize: 100 * 1024 * 1024, onError: (c) => c.text('一度に送る絵が多すぎます（全部で 100MB まで）。何回かに分けて保存してください。', 413) });
  // 💡 アイデア・共有の写真・ファイル（1 つ 10MB・1 回 10 個まで）
  const ideaBody = bodyLimit({ maxSize: 105 * 1024 * 1024, onError: (c) => c.text('一度に送るファイルが大きすぎます（1 つ 10MB・全部で 100MB まで）。', 413) });
  app.use((c, next) =>
    c.req.method !== 'POST'
      ? smallBody(c, next)
      : /^\/notices(?:\/\d+)?$/.test(c.req.path)
        ? noticeBody(c, next)
        : c.req.path === '/economy/casino/art' || c.req.path === '/settings/omikuji-special' || c.req.path === '/settings/omikuji-texts'
          ? artsBody(c, next)
          : /^\/ideas(?:\/\d+\/(?:edit|comments))?$/.test(c.req.path)
            ? ideaBody(c, next)
          : /^\/economy\/casino\/art\/[a-z0-9-]+$/.test(c.req.path)
            ? artBody(c, next)
            : smallBody(c, next),
  );

  // 管理画面の中身（相談・メモなど）をブラウザや共用 PC に残さない。htmx の部分表示と全体表示を取り違えないように
  app.use(async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/static/') && !c.req.path.startsWith('/casino/art/') && c.req.path !== '/healthz') {
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

  // 🦊 AT 機の絵（運営が入れたもの）。印（?v=）が今の絵と同じなら長く覚えてよい
  app.get('/casino/art/:key', async (c) => {
    const key = c.req.param('key');
    if (!isArtKey(key)) return c.notFound();
    const art = await loadArt(db, key);
    if (!art) return c.notFound();
    const cache = c.req.query('v') === art.hash ? 'public, max-age=31536000, immutable' : 'public, max-age=60';
    return c.body(Buffer.from(art.data), 200, { 'content-type': art.contentType, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  });

  // ───────── ログイン ─────────

  const discordLogin = deps.discordLogin ?? true;
  const entryMark = deps.entryKey ? createHash('sha256').update(`entry:${deps.entryKey}`).digest('hex') : undefined;
  /** 秘密の入口を通ったか（入口を決めていなければ、いつでも通す） */
  const hasEntry = (c: Context) => !entryMark || safeEqual(getCookie(c, ENTRY_COOKIE) ?? '', entryMark);
  const hidden = (c: Context) => c.text('Not Found', 404);

  app.get('/enter/:key', (c) => {
    if (!deps.entryKey || !entryMark || !safeEqual(c.req.param('key'), deps.entryKey)) return hidden(c);
    setCookie(c, ENTRY_COOKIE, entryMark, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 30 * 86_400 });
    return c.redirect('/login');
  });

  app.get('/login', (c) => {
    if (!hasEntry(c)) return hidden(c);
    const csrf = randomToken();
    setCookie(c, LOGIN_COOKIE, csrf, { httpOnly: true, secure, sameSite: 'Strict', path: '/login', maxAge: 1800 });
    return c.html(<LoginPage error={c.req.query('e')} discord={discordLogin} csrf={csrf} />);
  });

  // 同じところ（IP）からの失敗を数える
  const ipFails = new Map<string, { count: number; until: number }>();
  const ipOf = (c: Context) => (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'local';

  app.post('/login', async (c) => {
    if (!hasEntry(c)) return hidden(c);
    const body = await c.req.parseBody();
    const sent = typeof body._csrf === 'string' ? body._csrf : '';
    if (!safeEqual(sent, getCookie(c, LOGIN_COOKIE) ?? '')) return c.redirect('/login?e=state');
    const ip = ipOf(c);
    const t = now().getTime();
    const f = ipFails.get(ip);
    if (f && f.until > t && f.count >= IP_LOCK.tries) return c.redirect('/login?e=locked');
    const loginId = typeof body.loginId === 'string' ? body.loginId.slice(0, 64) : '';
    const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    const r = await checkLogin(db, loginId, password, now());
    if (r.status !== 'ok') {
      const cur = f && f.until > t ? f : { count: 0, until: t + IP_LOCK.minutes * 60_000 };
      cur.count++;
      ipFails.set(ip, cur);
      if (ipFails.size > 5000) for (const [k, v] of ipFails) if (v.until <= t) ipFails.delete(k);
      await audit(db, { actorId: `login:${normalizeLoginId(loginId).slice(0, 32) || '?'}`, action: 'auth.denied', detail: { reason: r.status, ip }, via: 'web' });
      return c.redirect(`/login?e=${r.status === 'locked' ? 'locked' : r.status === 'disabled' ? 'disabled' : 'wrong'}`);
    }
    ipFails.delete(ip);
    const access = accountAccess(r.account)!;
    const token = await createSession(db, { id: accountUserId(r.account), username: r.account.loginId, displayName: r.account.name, avatarUrl: null }, access, now(), r.account.id);
    deleteCookie(c, LOGIN_COOKIE, { path: '/login' });
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: SESSION_HOURS * 3600 });
    await audit(db, { actorId: accountUserId(r.account), action: 'auth.login', detail: { account: r.account.loginId, level: access.level, ...(access.pages ? { pages: access.pages } : {}) }, via: 'web' });
    return c.redirect('/');
  });

  // Discord でのログイン（止めているときは「見つかりません」）
  app.use('/auth/*', async (c, next) => (discordLogin && hasEntry(c) ? next() : hidden(c)));

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

    const access = roles ? webAccessOf(cfg, user.id, roles) : undefined;
    if (!access) {
      const [last] = await listAudit(db, { actorId: user.id, action: 'auth.denied', limit: 1 });
      if (!last || now().getTime() - last.at.getTime() > 3_600_000) await audit(db, { actorId: user.id, action: 'auth.denied', via: 'web' });
      return c.redirect('/login?e=forbidden');
    }
    const token = await createSession(db, user, access, now());
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_HOURS * 3600,
    });
    await audit(db, { actorId: user.id, action: 'auth.login', detail: { level: access.level, ...(access.pages ? { pages: access.pages } : {}) }, via: 'web' });
    return c.redirect('/');
  });

  // ───────── 🎰 カジノ（メンバーが Discord でログイン。秘密の入口は要らない） ─────────
  mountCasino(app, { db, api, cfg: () => cfg, baseUrl: deps.baseUrl, secure, now });

  // ───────── ここから先はログイン必須 ─────────

  const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? await findSession(db, token, now()) : undefined;
    if (!session) return toLogin(c, token ? 'expired' : undefined);

    // ID とパスワードのアカウント: 止めた・消した・ページを変えたら、次に開いたときから
    if (session.accountId !== null && now().getTime() - session.checkedAt.getTime() > RECHECK_MS) {
      const account = await getAccount(db, session.accountId);
      const access = account ? accountAccess(account) : undefined;
      if (!account || !access) {
        await deleteSession(db, session.id);
        await audit(db, { actorId: session.userId, action: 'auth.revoked', via: 'system' });
        deleteCookie(c, SESSION_COOKIE, { path: '/' });
        return toLogin(c, 'forbidden');
      }
      await markChecked(db, session.id, access, now());
      session.level = access.level;
      session.pages = access.pages;
      session.username = account.name;
    }
    // 一定時間ごとに、今も神職・宮司のロールを持っているか Discord に確かめる
    if (session.accountId === null && now().getTime() - session.checkedAt.getTime() > RECHECK_MS) {
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
      const access = roles ? webAccessOf(cfg, session.userId, roles) : undefined;
      if (!access) {
        await deleteSession(db, session.id);
        await audit(db, { actorId: session.userId, action: 'auth.revoked', via: 'system' });
        deleteCookie(c, SESSION_COOKIE, { path: '/' });
        return toLogin(c, 'forbidden');
      }
      await markChecked(db, session.id, access, now());
      session.level = access.level;
      session.pages = access.pages;
    }
    c.set('session', await withUpdates(session));
    // 見られるページを選ばれている人は、ほかのページに入れない（ホームがなければ最初のページへ）
    const page = webPageOf(c.req.path);
    if (page && session.pages && !session.pages.includes(page)) {
      const first = WEB_PAGES.find((p) => session.pages!.includes(p.key));
      if (page === 'home' && c.req.method === 'GET') return c.redirect(first?.href ?? '/updates');
      if (c.req.method !== 'GET') return c.text('このページは開けません。', 403);
      return c.html(<NotFoundPage session={c.get('session')} />, 403);
    }
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
    // 秘密の入口を通っていない人には、ここがあることも見せない
    if (!hasEntry(c)) return hidden(c);
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
  app.use('/economy/*', requireAdmin);
  app.use('/glossary', requireAdmin);
  app.use('/commands', requireAdmin);
  app.use('/minutes', requireAdmin);
  app.use('/temp', requireAdmin);
  app.use('/invites', requireAdmin);
  app.use('/board', requireAdmin);
  app.use('/cast', requireAdmin);
  app.use('/voice', requireAdmin);
  app.use('/updates', requireAdmin);
  app.use('/roles', requireAdmin);
  app.use('/ranks', requireAdmin);
  app.use('/market', requireAdmin);
  app.use('/gacha', requireAdmin);
  app.use('/interview', requireAdmin);
  app.use('/ideas', requireAdmin);
  app.use('/ideas', requireCsrf);
  for (const p of ['/ideas/*', '/applications/*', '/omairi/*', '/soudan/*', '/settings/*', '/notices/*', '/shop/*', '/channels/*', '/roles/*', '/ranks/*', '/updates/*', '/commands/*', '/minutes/*', '/temp/*', '/invites/*', '/board/*', '/cast/*', '/market/*', '/gacha/*', '/interview/*']) {
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
    const todo = { applications: pending.length, omairi: review.length, soudan: soudanOpen.length, meetingTodos: await countOpenTodos(db), bells: await openBells(db) };
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
      sort: isMemberSort(q.sort) ? q.sort : 'goen',
      dir: q.dir === 'asc' || q.dir === 'desc' ? q.dir : undefined,
      page: Number(q.page) > 0 ? Math.floor(Number(q.page)) : 1,
    };
    const t = now();
    const result = await listMembers(db, query, t, cfg.ranks);
    if (c.req.header('hx-request') && !c.req.header('hx-history-restore-request')) return c.html(<MemberResults cfg={cfg} query={query} result={result} now={t} />);
    return c.html(<MembersPage session={c.get('session')} cfg={cfg} query={query} result={result} now={t} />);
  });

  // 👥 人数の差（ある時点と今）。popup=1 ならポップアップの中身だけ
  app.get('/members/diff', async (c) => {
    const t = now();
    const since = c.req.query('since') ?? '';
    const at = c.req.query('at') ?? '';
    const presets: Record<string, [Date, string]> = {
      today: [startOfTodayJst(t), '今日の 0 時'],
      '24h': [new Date(t.getTime() - 86_400_000), '24 時間前'],
      '7d': [new Date(t.getTime() - 7 * 86_400_000), '7 日前'],
      '30d': [new Date(t.getTime() - 30 * 86_400_000), '30 日前'],
    };
    const custom = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? new Date(`${at}:00+09:00`) : undefined;
    const useCustom = custom && !Number.isNaN(custom.getTime()) && custom < t && custom.getTime() > t.getTime() - 400 * 86_400_000;
    const key = useCustom ? 'custom' : Object.hasOwn(presets, since) ? since : 'today';
    const [from, label] = useCustom ? [custom!, `${at.replace('T', ' ')}`] : presets[key]!;
    const diff = await memberDiff(db, from);
    if (c.req.query('popup') === '1') {
      return c.html(
        <div>
          <h2>👥 {label}から今までの人数</h2>
          <MemberDiffBody diff={diff} cfg={cfg} now={t} label={label} />
          <p class="more">
            <a href={`/members/diff?since=${key === 'custom' ? 'today' : key}`}>ほかの日時とくらべる →</a>
          </p>
        </div>,
      );
    }
    return c.html(<MemberDiffPage session={c.get('session')} diff={diff} cfg={cfg} now={t} since={key} at={useCustom ? at : undefined} label={label} />);
  });

  // 🚪 最近抜けた人（ホームのカード。30 秒ごとに読み直す）
  app.get('/members/left', async (c) => c.html(<LeftFeed cfg={cfg} rows={await recentLeaves(db, 15)} now={now()} />));

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

  // ───────── 📓 議事録（神職・宮司。消すのは宮司だけ） ─────────

  const nameFn = async (ids: string[]) => {
    const names = await namesOf(db, ids);
    return (id: string) => names.get(id) ?? id;
  };
  /** 通話チャンネル（カテゴリの順・カテゴリ名つき） */
  const voiceChannelsOf = (channels: GuildChannel[]) => {
    const cats = new Map(channels.filter((ch) => ch.type === 4).map((ch) => [ch.id, ch]));
    const catPos = (ch: GuildChannel) => (ch.parent_id ? (cats.get(ch.parent_id)?.position ?? 0) + 1 : 0);
    return channels
      .filter((ch) => ch.type === 2 || ch.type === 13)
      .sort((a, b) => catPos(a) - catPos(b) || a.position - b.position)
      .map((ch) => ({ id: ch.id, name: ch.name, category: ch.parent_id ? (cats.get(ch.parent_id)?.name ?? null) : null }));
  };
  const textChannelsOf = (channels: GuildChannel[]) => postableChannels(channels).filter((ch) => ch.type === 0 || ch.type === 5);

  // ───────── 💡 アイデア・共有（運営どうし） ─────────

  const ideaWho = (c: Context<Env>) => ({ userId: c.get('session').userId, guji: c.get('session').level === 'guji' });
  const ideaId = (c: Context<Env>) => {
    const n = Number(c.req.param('id'));
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  };
  /** 戻り先（/ideas から始まるものだけ） */
  const ideaBack = (v: unknown, fallback: string) => (typeof v === 'string' && /^\/ideas(?:[/?][^\s]*)?$/.test(v) && !v.startsWith('//') ? v : fallback);

  app.get('/ideas', async (c) => {
    const k = c.req.query('kind');
    const st = c.req.query('status');
    const kind = isIdeaKind(k) ? k : undefined;
    const status = st === 'open' || isIdeaStatus(st) ? st : undefined;
    const q = (c.req.query('q') ?? '').slice(0, 100);
    const [list, counts] = await Promise.all([listIdeas(db, c.get('session').userId, { kind, status, q }), ideaCounts(db)]);
    const name = await nameFn(list.map((i) => i.createdBy));
    return c.html(<IdeasPage session={c.get('session')} ideas={list} counts={counts} name={name} kind={kind} status={status} q={q || undefined} flash={c.req.query('msg')} />);
  });

  /** 送られた写真・ファイル（name="files"。いくつでも） */
  const ideaUploads = async (body: Record<string, unknown>) => {
    const v = body.files;
    const list = (Array.isArray(v) ? v : [v]).filter((f): f is File => f instanceof File && f.size > 0);
    return Promise.all(list.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  };
  const one = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '');

  app.post('/ideas', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const kind = isIdeaKind(one(body.kind)) ? (one(body.kind) as IdeaKind) : 'idea';
    const row = await createIdea(db, { kind, title: one(body.title), body: one(body.body), by: c.get('session').userId });
    if (!row) return c.redirect('/ideas?msg=invalid');
    const files = await addIdeaFiles(db, row.id, null, await ideaUploads(body), c.get('session').userId);
    await audit(db, { actorId: c.get('session').userId, action: 'idea.create', detail: { id: row.id, kind, title: row.title, files: files.saved }, via: 'web' });
    return c.redirect(`/ideas/${row.id}?msg=${files.rejected.length ? 'files_rejected' : 'created'}`);
  });

  app.get('/ideas/:id', async (c) => {
    const found = await getIdea(db, ideaId(c), c.get('session').userId);
    if (!found) return c.html(<NotFoundPage session={c.get('session')} />, 404);
    const name = await nameFn([found.idea.createdBy, found.idea.updatedBy, ...found.comments.map((x) => x.by), ...found.voters]);
    return c.html(
      <IdeaPage
        session={c.get('session')}
        idea={found.idea}
        comments={found.comments}
        voters={found.voters}
        files={found.files}
        name={name}
        canEdit={canEditIdea(found.idea, ideaWho(c))}
        edit={c.req.query('edit') === '1'}
        flash={c.req.query('msg')}
      />,
    );
  });

  app.post('/ideas/:id/edit', async (c) => {
    const id = ideaId(c);
    const found = await getIdea(db, id, c.get('session').userId);
    if (!found) return c.redirect('/ideas');
    if (!canEditIdea(found.idea, ideaWho(c))) return c.redirect(`/ideas/${id}?msg=forbidden`);
    const body = await c.req.parseBody({ all: true });
    const kind = isIdeaKind(one(body.kind)) ? (one(body.kind) as IdeaKind) : (found.idea.kind as IdeaKind);
    const ok = await updateIdea(db, id, { kind, title: one(body.title), body: one(body.body), by: c.get('session').userId });
    if (!ok) return c.redirect(`/ideas/${id}?edit=1&msg=invalid`);
    const files = await addIdeaFiles(db, id, null, await ideaUploads(body), c.get('session').userId);
    await audit(db, { actorId: c.get('session').userId, action: 'idea.edit', detail: { id, files: files.saved }, via: 'web' });
    return c.redirect(`/ideas/${id}?msg=${files.rejected.length ? 'files_rejected' : 'saved'}`);
  });

  app.post('/ideas/:id/status', async (c) => {
    const id = ideaId(c);
    const body = await c.req.parseBody();
    if (!isIdeaStatus(body.status)) return c.redirect(`/ideas/${id}`);
    const row = await setIdeaStatus(db, id, body.status, c.get('session').userId);
    if (!row) return c.redirect('/ideas');
    await audit(db, { actorId: c.get('session').userId, action: 'idea.status', detail: { id, title: row.title, status: body.status }, via: 'web' });
    return c.redirect(`/ideas/${id}?msg=status`);
  });

  app.post('/ideas/:id/pin', async (c) => {
    const id = ideaId(c);
    const body = await c.req.parseBody();
    await setIdeaPinned(db, id, body.pinned === 'yes', c.get('session').userId);
    return c.redirect(`/ideas/${id}`);
  });

  app.post('/ideas/:id/vote', async (c) => {
    const id = ideaId(c);
    const body = await c.req.parseBody();
    await toggleIdeaVote(db, id, c.get('session').userId);
    return c.redirect(ideaBack(body.back, `/ideas/${id}`));
  });

  app.post('/ideas/:id/comments', async (c) => {
    const id = ideaId(c);
    const body = await c.req.parseBody({ all: true });
    const uploads = await ideaUploads(body);
    // 写真・ファイルだけのコメントも OK
    const row = await addIdeaComment(db, id, one(body.body), c.get('session').userId, { allowEmpty: uploads.length > 0 });
    if (!row) return c.redirect(`/ideas/${id}#comments`);
    const files = await addIdeaFiles(db, id, row.id, uploads, c.get('session').userId);
    return c.redirect(`/ideas/${id}?msg=${files.rejected.length ? 'files_rejected' : 'commented'}#comments`);
  });

  // 📎 写真はそのまま見られる（?dl=1 でダウンロード）。写真でないものはいつもダウンロード
  app.get('/ideas/files/:id', async (c) => {
    const f = await getIdeaFile(db, ideaId(c));
    if (!f) return c.notFound();
    const image = f.contentType.startsWith('image/');
    const dl = !image || c.req.query('dl') === '1';
    return c.body(new Uint8Array(f.data), 200, {
      'content-type': f.contentType,
      'content-disposition': `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    });
  });
  app.get('/ideas/:id/files.zip', async (c) => {
    const id = ideaId(c);
    const z = await ideaFilesZip(db, id);
    if (!z) return c.notFound();
    return c.body(new Uint8Array(z), 200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="idea-${id}.zip"`,
      'x-content-type-options': 'nosniff',
    });
  });
  app.post('/ideas/files/:id/delete', async (c) => {
    const ideaOf = await deleteIdeaFile(db, ideaId(c), ideaWho(c));
    if (ideaOf) await audit(db, { actorId: c.get('session').userId, action: 'idea.file_delete', detail: { id: ideaOf, file: ideaId(c) }, via: 'web' });
    return c.redirect(ideaOf ? `/ideas/${ideaOf}?msg=file_deleted` : '/ideas?msg=forbidden');
  });

  app.post('/ideas/comments/:id/delete', async (c) => {
    const ideaOf = await deleteIdeaComment(db, ideaId(c), ideaWho(c));
    return c.redirect(ideaOf ? `/ideas/${ideaOf}?msg=deleted#comments` : '/ideas?msg=forbidden');
  });

  app.post('/ideas/:id/delete', async (c) => {
    const id = ideaId(c);
    const found = await getIdea(db, id, c.get('session').userId);
    if (!found) return c.redirect('/ideas');
    if (!canEditIdea(found.idea, ideaWho(c))) return c.redirect(`/ideas/${id}?msg=forbidden`);
    await deleteIdea(db, id);
    await audit(db, { actorId: c.get('session').userId, action: 'idea.delete', detail: { id, title: found.idea.title }, via: 'web' });
    return c.redirect('/ideas?msg=deleted');
  });

  app.get('/minutes', async (c) => {
    const q = c.req.query('q');
    const [list, open] = await Promise.all([listMeetings(db, { q }), openTodos(db)]);
    const name = await nameFn(open.map((t) => t.assigneeId ?? ''));
    return c.html(<MinutesPage session={c.get('session')} meetings={list} open={open} name={name} q={q} flash={c.req.query('msg')} now={now()} />);
  });

  const minutesEdit = async (c: Context<Env>, found?: Awaited<ReturnType<typeof getMeeting>>) => {
    const [channels, voiceNow] = await Promise.all([loadChannels().catch(() => [] as GuildChannel[]), loadVoiceNow(db, now())]);
    const picked = voiceNow.find((v) => v.id === c.req.query('voice'));
    const prefill = picked ? { placeChannelId: picked.id, attendees: picked.memberIds } : undefined;
    const extra = [...(found?.meeting.attendees ?? []), ...(found?.todos.map((t) => t.assigneeId ?? '') ?? []), ...(picked?.memberIds ?? [])].filter(Boolean);
    return c.html(
      <MeetingEditPage
        session={c.get('session')}
        meeting={found?.meeting}
        todos={found?.todos ?? []}
        people={await pickablePeople(db, cfg, extra)}
        voiceChannels={voiceChannelsOf(channels)}
        voiceNow={voiceNow}
        prefill={prefill}
        flash={c.req.query('msg')}
        now={now()}
      />,
    );
  };

  app.get('/minutes/new', (c) => minutesEdit(c));

  /** フォームから会議とやることを読む（おかしければ undefined） */
  const meetingFrom = async (c: Context<Env>): Promise<{ input: MeetingInput; todos: TodoInput[] } | undefined> => {
    const body = await c.req.parseBody({ all: true });
    const one = (k: string) => (Array.isArray(body[k]) ? body[k][0] : body[k]);
    const text = (k: string, max: number) => {
      const v = one(k);
      return typeof v === 'string' ? v.replace(/\r\n/g, '\n').slice(0, max) : '';
    };
    const title = text('title', 100).trim();
    const at = one('heldAt');
    const heldAt = typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? new Date(`${at}:00+09:00`) : undefined;
    if (!title || !heldAt || Number.isNaN(heldAt.getTime())) return undefined;
    const ids = (v: unknown) => (v === undefined ? [] : Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && validId(x));
    const place = one('placeChannelId');
    const rows = Math.min(Number(one('todoRows')) || 0, 100);
    const todos: TodoInput[] = [];
    for (let i = 0; i < rows; i++) {
      const id = Number(one(`todo.${i}.id`));
      const assignee = one(`todo.${i}.assignee`);
      const due = one(`todo.${i}.due`);
      todos.push({
        id: Number.isInteger(id) && id > 0 ? id : undefined,
        body: text(`todo.${i}.body`, 200),
        assigneeId: typeof assignee === 'string' && validId(assignee) ? assignee : null,
        due: typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
        done: one(`todo.${i}.done`) === 'yes',
      });
    }
    return {
      input: {
        title,
        heldAt,
        placeChannelId: typeof place === 'string' && validId(place) ? place : null,
        attendees: [...new Set(ids(body.attendees))].slice(0, 100),
        agenda: text('agenda', 4000),
        notes: text('notes', 20000),
        decisions: text('decisions', 4000),
      },
      todos,
    };
  };

  app.post('/minutes', async (c) => {
    const got = await meetingFrom(c);
    if (!got) return c.redirect('/minutes/new?msg=invalid');
    const m = await createMeeting(db, got.input, got.todos, c.get('session').userId, now());
    return c.redirect(`/minutes/${m.id}?msg=created`);
  });

  const meetingId = (c: Context<Env>) => {
    const id = Number(c.req.param('id'));
    return Number.isInteger(id) && id > 0 ? id : undefined;
  };

  app.get('/minutes/:id', async (c) => {
    const id = meetingId(c);
    const found = id ? await getMeeting(db, id) : undefined;
    if (!found) return c.html(<NotFoundPage session={c.get('session')} />, 404);
    const { meeting: m, todos } = found;
    const channels = await loadChannels().catch(() => [] as GuildChannel[]);
    const texts = textChannelsOf(channels);
    // 前に出したチャンネル、なければ名前に「議事録」「会議」「運営」を含むチャンネル
    const guess = m.postedChannelId ?? (texts.find((ch) => /議事録|会議/.test(ch.name)) ?? texts.find((ch) => ch.name.includes('運営')))?.id;
    const name = await nameFn([...m.attendees, ...todos.map((t) => t.assigneeId ?? ''), m.updatedBy]);
    return c.html(
      <MeetingViewPage
        session={c.get('session')}
        meeting={m}
        todos={todos}
        name={name}
        placeName={m.placeChannelId ? (channels.find((ch) => ch.id === m.placeChannelId)?.name ?? '（見つからない通話）') : undefined}
        channels={texts}
        defaultChannelId={guess}
        flash={c.req.query('msg')}
        now={now()}
      />,
    );
  });

  app.get('/minutes/:id/edit', async (c) => {
    const id = meetingId(c);
    const found = id ? await getMeeting(db, id) : undefined;
    if (!found) return c.html(<NotFoundPage session={c.get('session')} />, 404);
    return minutesEdit(c, found);
  });

  app.post('/minutes/:id', async (c) => {
    const id = meetingId(c);
    if (!id || !(await getMeeting(db, id))) return c.redirect('/minutes');
    const got = await meetingFrom(c);
    if (!got) return c.redirect(`/minutes/${id}/edit?msg=invalid`);
    await updateMeeting(db, id, got.input, got.todos, c.get('session').userId, now());
    return c.redirect(`/minutes/${id}?msg=saved`);
  });

  app.post('/minutes/:id/delete', async (c) => {
    const id = meetingId(c);
    if (!id) return c.redirect('/minutes');
    if (!gujiOnly(c)) return c.redirect(`/minutes/${id}?msg=forbidden`);
    const body = await c.req.parseBody();
    if (body.confirm !== 'yes') return c.redirect(`/minutes/${id}`);
    await deleteMeeting(db, id, c.get('session').userId);
    return c.redirect('/minutes?msg=deleted');
  });

  app.post('/minutes/:id/post', async (c) => {
    const id = meetingId(c);
    if (!id) return c.redirect('/minutes');
    const body = await c.req.parseBody();
    const channels = await loadChannels(true).catch(() => [] as GuildChannel[]);
    const ch = textChannelsOf(channels).find((x) => x.id === body.channelId);
    if (!ch) return c.redirect(`/minutes/${id}?msg=post_invalid`);
    try {
      const r = await postSummary({ db, discord: deps.discord }, id, ch.id, c.get('session').userId, { url: `${deps.baseUrl}/minutes/${id}`, now: now() });
      return c.redirect(`/minutes/${id}?msg=${r ?? 'post_failed'}`);
    } catch (err) {
      logger.warn({ err }, 'meeting summary post failed');
      return c.redirect(`/minutes/${id}?msg=post_failed`);
    }
  });

  app.post('/minutes/todos/:id/toggle', async (c) => {
    const id = meetingId(c);
    const body = await c.req.parseBody();
    if (id) await toggleTodo(db, id, c.get('session').userId, now());
    const back = typeof body.back === 'string' ? /^meeting:(\d+)$/.exec(body.back) : null;
    return c.redirect(back ? `/minutes/${back[1]}?msg=toggled` : '/minutes?msg=toggled');
  });

  // ───────── ⏳ 一時的なロール・権限（神職・宮司。危ないロールは宮司だけ） ─────────

  const tempCtx = () => ({ db, cfg, discord: deps.discord });

  app.get('/temp', async (c) => {
    const [active, ended, channels, roles] = await Promise.all([activeGrants(db), endedGrants(db, 50), loadChannels().catch(() => [] as GuildChannel[]), loadRoles()]);
    const all = [...active, ...ended];
    const names = await namesOf(db, [...all.map((g) => g.memberId), ...all.map((g) => g.grantedBy)]);
    const roleName = new Map((roles ?? []).map((r) => [r.id, r.name]));
    const chName = new Map(channels.map((ch) => [ch.id, ch.name]));
    const top = botTopPosition(roles ?? [], deps.botId);
    const staff = staffRoleIds(cfg);
    const pickRoles = (roles ?? [])
      .filter((r) => r.id !== cfg.guildId && !r.managed && r.position < top)
      .map((r) => ({ id: r.id, name: r.name, guji: dangerLabels(permsOf(r)).length > 0 || staff.has(r.id) }));
    const cats = new Map(channels.filter((ch) => ch.type === 4).map((ch) => [ch.id, ch]));
    const catPos = (ch: GuildChannel) => (ch.parent_id ? (cats.get(ch.parent_id)?.position ?? 0) + 1 : 0);
    const pickChannels = channels
      .filter((ch) => ch.type !== 4)
      .sort((a, b) => catPos(a) - catPos(b) || Number(a.type === 2 || a.type === 13) - Number(b.type === 2 || b.type === 13) || a.position - b.position)
      .map((ch) => ({ id: ch.id, name: ch.name, category: ch.parent_id ? (cats.get(ch.parent_id)?.name ?? null) : null, voice: ch.type === 2 || ch.type === 13 }));
    const members = await activeMemberNames(db);
    const prefill = c.req.query('member');
    return c.html(
      <TempPage
        session={c.get('session')}
        active={active}
        ended={ended}
        lookup={{ member: (id) => names.get(id) ?? id, role: (id) => roleName.get(id) ?? '（消えたロール）', channel: (id) => chName.get(id) ?? '（消えたチャンネル）' }}
        roles={pickRoles}
        channels={pickChannels}
        members={members}
        prefillMember={prefill ? (members.find((m) => m.id === prefill)?.name ?? prefill) : undefined}
        flash={c.req.query('msg')}
        now={now()}
      />,
    );
  });

  app.post('/temp', async (c) => {
    const body = await c.req.parseBody();
    const s = c.get('session');
    const minutes = durationMinutes(body.for);
    if (!minutes || typeof body.member !== 'string') return c.redirect('/temp?msg=invalid#temp-give');
    const memberId = await findActiveMember(db, body.member);
    if (!memberId) return c.redirect('/temp?msg=no_member#temp-give');
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
    let status: string;
    if (body.kind === 'perm') {
      if (typeof body.channelId !== 'string' || !isPermPreset(body.preset)) return c.redirect('/temp?msg=invalid#temp-give');
      const channels = await loadChannels(true).catch(() => [] as GuildChannel[]);
      status = (await grantPerm(tempCtx(), { memberId, channelId: body.channelId, preset: body.preset, minutes, reason, by: s.userId, byLevel: s.level === 'guji' ? 'guji' : 'shinshoku', channels, now: now() })).status;
    } else {
      if (typeof body.roleId !== 'string' || !body.roleId) return c.redirect('/temp?msg=invalid#temp-give');
      const roles = (await loadRoles()) ?? [];
      status = (await grantRole(tempCtx(), { memberId, roleId: body.roleId, minutes, reason, by: s.userId, byLevel: s.level === 'guji' ? 'guji' : 'shinshoku', roles, memberRoleIds: await memberRoleIdsOf(db, memberId), botId: deps.botId, now: now() })).status;
    }
    return c.redirect(`/temp?msg=${status}${status === 'granted' || status === 'extended' ? '' : '#temp-give'}`);
  });

  const grantId = (c: Context<Env>) => {
    const id = Number(c.req.param('id'));
    return Number.isInteger(id) && id > 0 ? id : undefined;
  };

  app.post('/temp/:id/extend', async (c) => {
    const id = grantId(c);
    const body = await c.req.parseBody();
    const minutes = durationMinutes(body.for);
    if (!id || !minutes) return c.redirect('/temp');
    const ok = await extendGrant(tempCtx(), id, minutes, c.get('session').userId);
    return c.redirect(`/temp?msg=${ok ? 'extended' : 'ended_already'}`);
  });

  // 🔗 招待: だれのリンクか・だれがだれを招待したか（Discord の設定では BOT のリンクは全部「BOT」と出るので）
  app.get('/invites', async (c) => {
    const [joins, links, known] = await Promise.all([recentInviteJoins(db, 200), liveLinks(db), knownLinkCodes(db)]);
    const discordInvites = deps.discord.guildInvites ? await deps.discord.guildInvites(cfg.guildId).catch(() => null) : null;
    const others = discordInvites ? discordInvites.filter((i) => !known.has(i.code) && !i.inviter?.bot && (!deps.botId || i.inviter?.id !== deps.botId)) : null;
    const uses = new Map((discordInvites ?? []).map((i) => [i.code, i.uses ?? 0]));
    // Discord で消されていた BOT のリンクは出さない（読めたときだけ）
    const alive = discordInvites ? links.filter((l) => uses.has(l.code)) : links;
    const names = await namesOf(db, [...joins.flatMap((j) => [j.memberId, j.inviterId]), ...alive.flatMap((l) => [l.inviterId, l.createdBy ?? ''])].filter(Boolean));
    return c.html(
      <InvitesPage
        session={c.get('session')}
        joins={joins}
        links={alive}
        others={others}
        uses={uses}
        name={(id) => names.get(id) ?? id}
        flash={c.req.query('msg')}
        now={now()}
      />,
    );
  });

  app.post('/invites/:code/delete', async (c) => {
    const code = c.req.param('code');
    if (!/^[\w-]{2,40}$/.test(code) || !deps.discord.deleteInvite) return c.redirect('/invites?msg=invalid');
    const s = c.get('session');
    try {
      await deps.discord.deleteInvite(code, `社務所Web で招待リンクを消す（${s.userId}）`);
    } catch (err) {
      // もう Discord になければ、記録だけ直す
      if (!(err instanceof DiscordHttpError && err.status === 404)) return c.redirect('/invites?msg=failed');
    }
    await revokeLink(db, code, now());
    await audit(db, { actorId: s.userId, action: 'invite.delete', detail: { code }, via: 'web' });
    return c.redirect('/invites?msg=deleted');
  });

  app.post('/temp/:id/revoke', async (c) => {
    const id = grantId(c);
    const g = id ? await getGrant(db, id) : undefined;
    if (!g || g.endedAt) return c.redirect('/temp?msg=ended_already');
    const r = await endGrant(tempCtx(), g, c.get('session').userId, 'revoked', now());
    return c.redirect(`/temp?msg=${r === 'ended' ? 'revoked' : 'failed'}`);
  });

  // ───────── ⌨ コマンドのまとめ（見るのはだれでも・掲示を作るのは宮司） ─────────

  app.get('/commands', async (c) => {
    const s = c.get('session');
    const channels = s.level === 'guji' ? postableChannels(await loadChannels().catch(() => [] as GuildChannel[])).filter((ch) => ch.type === 0 || ch.type === 5) : undefined;
    return c.html(<CommandsPage session={s} list={commandList(commandDefinitions(cfg))} channels={channels} flash={c.req.query('msg')} />);
  });

  /** メンバー向けのコマンドのまとめを掲示にする */
  app.post('/commands/notice', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const channels = await loadChannels(true).catch(() => [] as GuildChannel[]);
    const ch = channels.find((x) => x.id === body.channelId && (x.type === 0 || x.type === 5));
    if (!ch) return c.redirect('/commands?msg=notice_invalid');
    const n = await createNotice(db, {
      channelId: ch.id,
      title: 'コマンドのまとめ',
      body: '# ⌨ コマンドのまとめ\n`/` を打つと BOT のコマンドが出てきます。\n\n{コマンド一覧}\n\n-# 名前を右クリック（スマホは長押し）→「アプリ」→「プロフィール」でも御朱印帳が見られます',
      by: c.get('session').userId,
    });
    return c.redirect(`/notices/${n.id}?msg=commands_notice`);
  });

  // ───────── 更新履歴 ─────────

  app.get('/updates', async (c) => {
    const s = c.get('session');
    const unseenIds = new Set(unseenChanges(await seenChangeId(db, s.userId)).map((e) => e.id));
    await markChangesSeen(db, s.userId);
    let news: Parameters<typeof UpdatesPage>[0]['news'];
    if (s.level === 'guji') {
      const [settings, channels] = await Promise.all([loadUpdateNews(db), loadChannels().catch(() => [] as GuildChannel[])]);
      news = { settings, channels: postableChannels(channels).filter((ch) => ch.type === 0 || ch.type === 5), currentChannel: newsChannelOf(settings, channels)?.name };
    }
    // このページを開いたら読んだことにする（メニューの印も消す）
    return c.html(<UpdatesPage session={{ ...s, updatesUnseen: 0 }} unseenIds={unseenIds} flash={c.req.query('msg')} news={news} />);
  });

  /** 📰 更新速報の設定（宮司） */
  app.post('/updates/news', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const prev = await loadUpdateNews(db);
    const channelId = typeof body.channelId === 'string' && validId(body.channelId) ? body.channelId : undefined;
    const enabled = body.enabled === 'yes';
    await saveUpdateNews(
      db,
      // 自動にしたときは今の最新から（前の更新を全部出さない）
      { enabled, channelId, scope: body.scope === 'all' ? 'all' : 'discord', lastId: prev.lastId ?? (enabled ? LATEST_CHANGE_ID : undefined) },
      c.get('session').userId,
    );
    await audit(db, { actorId: c.get('session').userId, action: 'updates.news_settings', detail: { enabled, channelId: channelId ?? null, scope: body.scope }, via: 'web' });
    return c.redirect('/updates?msg=news_saved#update-news');
  });

  /** 📰 更新速報に今出す（1 つ、または 1 日分） */
  app.post('/updates/news/post', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const s = await loadUpdateNews(db);
    const entries =
      typeof body.id === 'string'
        ? CHANGELOG.filter((e) => e.id === body.id)
        : typeof body.date === 'string'
          ? CHANGELOG.filter((e) => e.date === body.date && inScope(e, s.scope))
          : [];
    if (!entries.length) return c.redirect('/updates?msg=news_none#update-news');
    try {
      const n = await postNews({ db, discord: deps.discord, channels: await loadChannels(true) }, entries, c.get('session').userId);
      return c.redirect(`/updates?msg=${n === undefined ? 'news_nochannel' : 'news_posted'}#update-news`);
    } catch (err) {
      logger.warn({ err }, 'update news post failed');
      return c.redirect('/updates?msg=news_failed#update-news');
    }
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
    const t = now();
    const q = c.req.query('range');
    // 日付で選んだ期間（おかしければ 30 日）
    const custom = c.req.query('from') ? parseSpan(c.req.query('from'), c.req.query('to'), t) : undefined;
    const range = custom ? ('custom' as const) : isTrendRange(q) ? q : '30d';
    const span: TrendSpan = custom ?? (range as TrendRange);
    const v = c.req.query('view');
    const view = isStatsView(v) ? v : 'overview';
    const buckets = await memberTrend(db, span, t);
    // すぐ前の、同じ長さの期間（くらべる用）
    const before = previousSpan(buckets);
    const [prevTrend, gender, prevGender, genderToday, activity, prevActivity] = await Promise.all([
      view === 'overview' ? memberTrend(db, before, t) : undefined,
      view === 'gender' ? genderTrend(db, cfg, span, t) : undefined,
      view === 'gender' ? genderTrend(db, cfg, before, t) : undefined,
      view === 'gender' ? genderNow(db, cfg, t) : undefined,
      view === 'active' ? activityStats(db, cfg, span, t) : undefined,
      view === 'active' ? activityStats(db, cfg, before, t) : undefined,
    ]);
    const add = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const sexSum = (list: { male: number; female: number; unknown: number }[]) => list.reduce((a, c) => ({ male: a.male + c.male, female: a.female + c.female, unknown: a.unknown + c.unknown }), { male: 0, female: 0, unknown: 0 });
    const total = (c: { male: number; female: number; unknown: number }) => c.male + c.female + c.unknown;
    const prev = {
      ...(prevTrend
        ? {
            overview: {
              members: prevTrend.at(-1)?.members ?? 0,
              joined: add(prevTrend.map((x) => x.joined)),
              left: add(prevTrend.map((x) => x.left)),
              shuin: add(prevTrend.map((x) => x.shuin)),
              messages: add(prevTrend.map((x) => x.messages)),
              vcMinutes: add(prevTrend.map((x) => x.vcMinutes)),
            },
          }
        : {}),
      ...(prevGender ? { gender: { members: prevGender.at(-1)!.members, joined: sexSum(prevGender.map((x) => x.joined)) } } : {}),
      ...(prevActivity
        ? {
            active: {
              people: add(prevActivity.buckets.map((x) => total(x.people))),
              vcMinutes: add(prevActivity.buckets.map((x) => total(x.vcMinutes))),
              messages: add(prevActivity.buckets.map((x) => total(x.messages))),
            },
          }
        : {}),
    };
    const today = jstDate(t);
    return c.html(
      <StatsPage
        session={c.get('session')}
        range={range}
        span={{ from: buckets[0]!.from, to: buckets.at(-1)!.to }}
        unit={unitOf(span)}
        view={view}
        buckets={buckets}
        gender={gender}
        genderNow={genderToday}
        activity={activity}
        prev={prev}
        today={today}
        minDate={addDays(today, -SPAN_MAX_DAYS + 1)}
      />,
    );
  });

  /** 経済: 銭の流れ・鯖の収入・持っている量のかたより */
  app.get('/economy', async (c) => {
    const q = c.req.query('range');
    const range = isTrendRange(q) ? q : '30d';
    const t = now();
    const since = rangeStart(range, t);
    const [overview, dist, big, sales, suspects, guide, gacha, alerts, events, channels] = await Promise.all([
      economyOverview(db, range, t),
      balanceDistribution(db),
      bigTransactions(db, since),
      shopSales(db, since),
      suspectPairs(db, cfg, since),
      priceGuide(db, cfg, t),
      gachaLedger(db, since, t),
      recentAlerts(db, 20),
      listEvents(db),
      loadChannels().catch(() => [] as GuildChannel[]),
    ]);
    const names = await namesOf(db, [
      ...dist.top.map((x) => x.memberId),
      ...big.map((x) => x.memberId),
      ...suspects.flatMap((x) => [x.fromId, x.toId]),
      ...alerts.map((x) => x.memberId ?? ''),
    ]);
    return c.html(
      <EconomyPage
        session={c.get('session')}
        cfg={cfg}
        range={range}
        overview={overview}
        dist={dist}
        big={big}
        sales={sales}
        names={names}
        watch={{ suspects, guide, gacha, alerts, events, channels: postableChannels(channels), now: t }}
        flash={c.req.query('msg')}
      />,
    );
  });

  /** 1 人ずつの収支 */
  app.get('/economy/members/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.notFound();
    const q = c.req.query('range');
    const range = isTrendRange(q) && q !== '1y' ? q : '30d';
    const t = now();
    const ledger = await memberLedger(db, id, rangeStart(range, t), t);
    const names = await namesOf(db, [id, ...ledger.partners.map((p) => p.memberId)]);
    return c.html(<MemberLedgerPage session={c.get('session')} cfg={cfg} memberId={id} range={range} ledger={ledger} names={names} />);
  });

  // 変える操作（イベント・見守りの設定）は宮司だけ
  app.use('/economy/*', requireCsrf);
  app.use('/economy/*', async (c, next) => (c.req.method !== 'POST' || gujiOnly(c) ? next() : c.text('宮司のみできる操作です。', 403)));

  /** 🎉 期間限定イベントを作る（始まり・終わりは日本時間の datetime-local） */
  app.post('/economy/events', async (c) => {
    const body = await c.req.parseBody();
    const kind = body.kind;
    const value = Number(body.value);
    const title = field(body, 'title', 60);
    const jst = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00+09:00`) : undefined);
    const startsAt = jst(body.startsAt);
    const endsAt = jst(body.endsAt);
    const announce = typeof body.announce === 'string' && /^\d{17,20}$/.test(body.announce) ? body.announce : undefined;
    const ticket = isTicketKind(body.ticket) ? body.ticket : 'gacha_free';
    const ticketCount = body.ticketCount === undefined ? 1 : Number(body.ticketCount);
    if (!isEventKind(kind) || !validEventValue(kind, value) || !title || !startsAt || !endsAt || endsAt <= startsAt || endsAt <= now()) {
      return c.redirect('/economy?msg=event_invalid#economy-events');
    }
    if (kind === 'voice_ticket' && !(Number.isInteger(ticketCount) && ticketCount >= 1 && ticketCount <= EVENT_TICKET_MAX)) {
      return c.redirect('/economy?msg=event_invalid#economy-events');
    }
    await createEvent(db, { kind, value, title, startsAt, endsAt, announceChannelId: announce, ticket, ticketCount }, c.get('session').userId);
    await deps.onSettingsSaved?.();
    return c.redirect('/economy?msg=event_created#economy-events');
  });

  app.post('/economy/events/:id/cancel', async (c) => {
    const id = Number(c.req.param('id'));
    if (Number.isInteger(id) && id > 0) await cancelEvent(db, id, c.get('session').userId, now());
    await deps.onSettingsSaved?.();
    return c.redirect('/economy?msg=event_cancelled#economy-events');
  });

  /** 🎰 カジノ（収支と設定） */
  app.get('/economy/casino', async (c) => {
    const q = c.req.query('range');
    const range: CasinoRange = q && Object.hasOwn(CASINO_RANGES, q) ? (q as CasinoRange) : '7d';
    const since = new Date(now().getTime() - CASINO_RANGES[range].days * 86_400_000);
    const [stats, matches, recent, players7d, daily, floor, picks, settingStats, guildRoles] = await Promise.all([
      casinoStats(db, since),
      matchStats(db, since),
      recentMatches(db, 10),
      casinoPlayers(db, new Date(now().getTime() - 7 * 86_400_000)),
      casinoDaily(db, 30, now()),
      slotFloorData(db, cfg, now()),
      dayPicks(db, now()),
      slotSettingStats(db, new Date(now().getTime() - 30 * 86_400_000)),
      loadRoles(),
    ]);
    return c.html(
      <CasinoAdminPage
        session={c.get('session')}
        casino={cfg.casino}
        coinName={cfg.economy.currencyName}
        url={`${deps.baseUrl}/casino`}
        range={range}
        stats={stats}
        matches={matches}
        recentMatches={recent}
        names={await namesOf(db, recent.flatMap((m) => [m.hostId, m.guestId ?? '', m.winnerId ?? '']))}
        players7d={players7d}
        daily={daily}
        floor={floor.today}
        picks={picks}
        atPicks={await atDayPicks(db, now())}
        settingStats={settingStats}
        roles={(guildRoles ?? []).filter((r) => r.id !== cfg.guildId && !r.managed)}
        horses={await listHorses(db)}
        art={await artUrls(db)}
        fileArt={AT_FILE_ART}
        channels={textChannelsOf(await loadChannels().catch(() => [] as GuildChannel[])).map((ch) => ({ id: ch.id, name: ch.name }))}
        flash={c.req.query('msg')}
        guji={c.get('session').level === 'guji'}
        ai={await aiStats(db, since)}
      />,
    );
  });

  // 🦊 AT 機の絵: 選んだ絵をまとめて保存（欄ごとに img_<名前>）
  app.post('/economy/casino/art', async (c) => {
    const body = await c.req.parseBody();
    let saved = 0;
    let failed = 0;
    for (const slot of AT_ART_SLOTS) {
      const f = body[`img_${slot.key}`];
      const file = Array.isArray(f) ? f[0] : f;
      if (!(file instanceof File) || file.size === 0) continue;
      const r = await saveArt(db, slot.key, new Uint8Array(await file.arrayBuffer()));
      if (r === 'ok') saved++;
      else failed++;
    }
    if (saved) await audit(db, { actorId: c.get('session').userId, action: 'casino.art_saved', detail: { count: saved }, via: 'web' });
    const msg = failed ? (saved ? 'art_partial' : 'art_bad') : saved ? 'art_saved' : 'art_none';
    return c.redirect(`/economy/casino?msg=${msg}#casino-art`);
  });
  // 🦊 AT 機の絵: 1 枚ずつ入れる・入れ替える・消す
  app.post('/economy/casino/art/:key', async (c) => {
    const key = c.req.param('key');
    if (!isArtKey(key)) return c.redirect('/economy/casino?msg=art_bad#casino-art');
    const f = (await c.req.parseBody()).image;
    const file = Array.isArray(f) ? f[0] : f;
    if (!(file instanceof File) || file.size === 0) return c.redirect('/economy/casino?msg=art_none#casino-art');
    const r = await saveArt(db, key, new Uint8Array(await file.arrayBuffer()));
    if (r !== 'ok') return c.redirect(`/economy/casino?msg=${r === 'too_big' ? 'art_big' : 'art_bad'}#casino-art`);
    await audit(db, { actorId: c.get('session').userId, action: 'casino.art_saved', detail: { key }, via: 'web' });
    return c.redirect(`/economy/casino?msg=art_saved#art-${key}`);
  });
  app.post('/economy/casino/art/:key/delete', async (c) => {
    const key = c.req.param('key');
    if (isArtKey(key)) {
      await deleteArt(db, key);
      await audit(db, { actorId: c.get('session').userId, action: 'casino.art_deleted', detail: { key }, via: 'web' });
    }
    return c.redirect(`/economy/casino?msg=art_deleted#art-${key}`);
  });

  // 🏇 馬の名簿: 入れる・名前を変える・引退
  app.post('/economy/casino/horses', async (c) => {
    const body = await c.req.parseBody();
    const name = typeof body.name === 'string' ? body.name : '';
    if (!cleanHorseName(name)) return c.redirect('/economy/casino?msg=horse_invalid#casino-horses');
    const row = await addHorse(db, name);
    if (!row) return c.redirect('/economy/casino?msg=horse_taken#casino-horses');
    await audit(db, { actorId: c.get('session').userId, action: 'keiba.horse_add', detail: { id: row.id, name: row.name }, via: 'web' });
    return c.redirect('/economy/casino?msg=horse_saved#casino-horses');
  });
  app.post('/economy/casino/horses/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.parseBody();
    const r = Number.isSafeInteger(id) ? await renameHorse(db, id, typeof body.name === 'string' ? body.name : '') : 'not_found';
    if (r === 'ok') await audit(db, { actorId: c.get('session').userId, action: 'keiba.horse_rename', detail: { id, name: body.name }, via: 'web' });
    return c.redirect(`/economy/casino?msg=${r === 'ok' ? 'horse_saved' : r === 'taken' ? 'horse_taken' : 'horse_invalid'}#casino-horses`);
  });
  app.post('/economy/casino/horses/:id/retire', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.parseBody();
    if (Number.isSafeInteger(id) && (await setRetired(db, id, body.retired === 'yes', now()))) {
      await audit(db, { actorId: c.get('session').userId, action: 'keiba.horse_retire', detail: { id, retired: body.retired === 'yes' }, via: 'web' });
    }
    return c.redirect('/economy/casino?msg=horse_saved#casino-horses');
  });

  /** スロットの台の数と、台ごとの設定（random か 1〜6） */
  const slotMachinesOf = (body: Record<string, unknown>) => {
    const n = typeof body.slotCount === 'string' && /^\d{1,2}$/.test(body.slotCount) ? Math.min(20, Math.max(1, Number(body.slotCount))) : cfg.casino.slotMachines.length;
    return Array.from({ length: n }, (_, i) => {
      const v = body[`slot_${i + 1}`];
      return typeof v === 'string' && /^[1-6]$/.test(v) ? Number(v) : 'random';
    }) as (number | 'random')[];
  };

  /** AT 機の島の台の数と、台ごとの設定 */
  const atMachinesOf = (body: Record<string, unknown>) => {
    if (typeof body.atCount !== 'string') return cfg.casino.atMachines;
    const n = /^\d{1,2}$/.test(body.atCount) ? Math.min(20, Math.max(1, Number(body.atCount))) : cfg.casino.atMachines.length;
    return Array.from({ length: n }, (_, i) => {
      const v = body[`at_${i + 1}`];
      return typeof v === 'string' && /^[1-6]$/.test(v) ? Number(v) : 'random';
    }) as (number | 'random')[];
  };

  app.post('/economy/casino', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const int = (k: string) => (typeof body[k] === 'string' && /^\d{1,9}$/.test(body[k] as string) ? Number(body[k]) : NaN);
    const raw = body.games;
    const list = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter((g): g is CasinoGame => typeof g === 'string' && (CASINO_GAMES as readonly string[]).includes(g));
    // 入れる人: rank（位のロール）・role（決めたロール）・all（だれでも）。前の形（requireRank のチェック）も読む
    const access = body.access === 'rank' || body.access === 'role' || body.access === 'all' ? body.access : body.requireRank === 'yes' ? 'rank' : 'all';
    const roleId = typeof body.accessRoleId === 'string' && /^\d{5,25}$/.test(body.accessRoleId) ? body.accessRoleId : undefined;
    if (access === 'role' && !roleId) return c.redirect('/economy/casino?msg=no_role_picked');
    const roleName = access === 'role' ? ((await loadRoles())?.find((r) => r.id === roleId)?.name ?? cfg.casino.accessRoleName) : undefined;
    const casino = {
      enabled: body.enabled === 'yes',
      requireRank: access === 'rank',
      ...(access === 'role' ? { accessRoleId: roleId, ...(roleName ? { accessRoleName: roleName } : {}) } : {}),
      minBet: int('minBet'),
      maxBet: int('maxBet'),
      rouletteMaxBet: typeof body.rouletteMaxBet === 'string' ? int('rouletteMaxBet') : cfg.casino.rouletteMaxBet,
      dailyBetLimit: int('dailyBetLimit'),
      mahjongBets: typeof body.mahjongBets === 'string' ? body.mahjongBets === 'yes' : cfg.casino.mahjongBets,
      keibaHorsePrice: typeof body.keibaHorsePrice === 'string' ? int('keibaHorsePrice') : cfg.casino.keibaHorsePrice,
      keibaMaxOwned: typeof body.keibaMaxOwned === 'string' ? int('keibaMaxOwned') : cfg.casino.keibaMaxOwned,
      keibaTrainPrice: typeof body.keibaTrainPrice === 'string' ? int('keibaTrainPrice') : cfg.casino.keibaTrainPrice,
      // 🏇 馬主への還元（欄がない古い画面から送られたら、今のまま）
      ...(['keibaPrizeMult', 'keibaFanPct', 'keibaRoyaltyPct', 'keibaRetirePerWin', 'keibaPurseDailyCap'] as const).reduce<Record<string, number>>((o, k) => {
        o[k] = typeof body[k] === 'string' ? int(k) : cfg.casino[k];
        return o;
      }, {}),
      keibaPurse: cfg.casino.keibaPurse.map((v, i) => (typeof body[`keibaPurse_${i}`] === 'string' ? int(`keibaPurse_${i}`) : v)),
      ...(['keibaAnnounceChannelId', 'keibaOwnerRoleId', 'keibaG1RoleId'] as const).reduce<Record<string, string>>((o, k) => {
        const v = body[k];
        if (typeof v === 'string' && /^\d{5,25}$/.test(v)) o[k] = v;
        else if (v === undefined && cfg.casino[k]) o[k] = cfg.casino[k]!;
        return o;
      }, {}),
      games: CASINO_GAMES.filter((g) => list.includes(g)),
      knownGames: [...CASINO_GAMES],
      slotMachines: slotMachinesOf(body),
      atMachines: atMachinesOf(body),
      atBet: typeof body.atBet === 'string' ? int('atBet') : cfg.casino.atBet,
      atOpen: typeof body.atCount === 'string' ? body.atOpen === 'yes' : cfg.casino.atOpen,
    };
    if (!(casino.minBet <= casino.maxBet)) return c.redirect('/economy/casino?msg=invalid');
    const current = await loadOverrides(db);
    let overrides: Overrides;
    try {
      overrides = overridesSchema.parse({ ...current, casino });
      applyOverrides(fileCfg(), overrides);
    } catch {
      return c.redirect('/economy/casino?msg=invalid');
    }
    await saveOverrides(db, overrides, c.get('session').userId);
    await deps.onSettingsSaved?.();
    await audit(db, { actorId: c.get('session').userId, action: 'casino.settings', detail: casino, via: 'web' });
    return c.redirect('/economy/casino?msg=saved');
  });

  /** 🎰 カジノのロールを作って（同じ名前のロールがあればそれを）、入れる人をそのロールにする */
  app.post('/economy/casino/role', async (c) => {
    try {
      const name = '🎰 カジノ';
      const role = (await loadRoles())?.find((r) => r.name === name) ?? (await deps.discord.createRole(cfg.guildId, { name, color: 0xe2b340, permissions: '0', hoist: false, mentionable: false }, '管理画面（カジノに入れる人）'));
      const current = await loadOverrides(db);
      const overrides = overridesSchema.parse({ ...current, casino: { ...cfg.casino, ...current.casino, requireRank: false, accessRoleId: role.id, accessRoleName: role.name } });
      applyOverrides(fileCfg(), overrides);
      await saveOverrides(db, overrides, c.get('session').userId);
      await deps.onSettingsSaved?.();
      await audit(db, { actorId: c.get('session').userId, action: 'casino.role', detail: { roleId: role.id }, via: 'web' });
      return c.redirect('/economy/casino?msg=role_made');
    } catch (err) {
      logger.warn({ err }, 'casino role create failed');
      return c.redirect('/economy/casino?msg=role_failed');
    }
  });

  /** ⚙ 見守りの設定 */
  app.post('/economy/settings', async (c) => {
    const body = await c.req.parseBody();
    const int = (k: string) => (typeof body[k] === 'string' && /^\d+$/.test(body[k] as string) ? Number(body[k]) : NaN);
    const channel = typeof body.channelId === 'string' && /^\d{17,20}$/.test(body.channelId) ? body.channelId : null;
    const current = await loadOverrides(db);
    let overrides: Overrides;
    try {
      overrides = overridesSchema.parse({
        ...current,
        economyOps: {
          reportEnabled: body.reportEnabled === 'yes',
          channelId: channel,
          reportWeekday: int('reportWeekday'),
          reportHour: int('reportHour'),
          alertsEnabled: body.alertsEnabled === 'yes',
          alertEarn24h: int('alertEarn24h'),
          alertSpend24h: int('alertSpend24h'),
          saisenEnabled: body.saisenEnabled === 'yes',
          saisenThreshold: int('saisenThreshold'),
          saisenPercent: int('saisenPercent'),
        },
      });
      applyOverrides(fileCfg(), overrides);
    } catch {
      return c.redirect('/economy?msg=watch_invalid#economy-watch');
    }
    await saveOverrides(db, overrides, c.get('session').userId);
    await deps.onSettingsSaved?.();
    await audit(db, { actorId: c.get('session').userId, action: 'economy.watch.settings', detail: overrides.economyOps, via: 'web' });
    return c.redirect('/economy?msg=watch_saved#economy-watch');
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
    const allRoles = (await loadRoles()) ?? [];
    const roles = allRoles.filter((r) => r.id !== cfg.guildId && !r.managed);
    // BOT が「メンション不可」のロールも鳴らせるか（@everyone、@here、全てのロールにメンション・管理者）
    const botRoles = allRoles.filter((r) => r.id === cfg.guildId || (r.tags?.bot_id && (!deps.botId || r.tags.bot_id === deps.botId)));
    const botPerms = botRoles.reduce((n, r) => n | BigInt(r.permissions ?? '0'), 0n);
    const botCanMentionAll = allRoles.length ? (botPerms & ((1n << 17n) | (1n << 3n))) !== 0n : undefined;
    const accounts = await listAccounts(db);
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
        streakRoles={allRoles.filter((r) => giftableRole(cfg, r, allRoles, deps.botId)).map((r) => ({ id: r.id, name: r.name }))}
        notify={await notifyView(allRoles)}
        gachaStats={await gachaStats(db)}
        botCanMentionAll={botCanMentionAll}
        webAccessNames={await namesOf(db, webAccessEntries(cfg).filter((e) => e.kind === 'member').map((e) => e.id))}
        accounts={accounts}
        accountNames={await namesOf(db, accounts.map((a) => a.memberId).filter((x): x is string => Boolean(x)))}
        discordLogin={discordLogin}
        boosters={await currentBoosters(db)}
        boostLog={await recentBoostMessages(db)}
        omikujiArt={await omikujiArtHashes(db)}
        slipBg={await slipBgHashes(db)}
      />,
    );
  });

  // 🎴 運営吉: 名前・ひとこと・確率・倍率と絵をまとめて保存（絵は選んだ枠だけ入れ替える）
  app.post('/settings/omikuji-special', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const back = (msg: string) => c.redirect(`/settings?msg=${msg}&at=unei#sec-unei`);
    const text = (k: string, max: number) => (typeof body[k] === 'string' ? (body[k] as string).trim().slice(0, max) : '');
    const list = [...Array(OMIKUJI_SPECIAL_MAX).keys()].flatMap((i) => {
      const name = text(`name.${i + 1}`, 20);
      const color = text(`color.${i + 1}`, 7);
      return name ? [{ name, message: text(`message.${i + 1}`, 200), ...(/^#[0-9a-fA-F]{6}$/.test(color) ? { color } : {}) }] : [];
    });
    // 枠の番号と絵の番号をそろえるので、途中の枠を空にはできない（使わない枠は後ろから空にする）
    const slots = [...Array(OMIKUJI_SPECIAL_MAX).keys()].map((i) => text(`name.${i + 1}`, 20));
    const lastUsed = slots.reduce((m, n, i) => (n ? i + 1 : m), 0);
    if (slots.slice(0, lastUsed).some((n) => !n)) return back('unei_gap');
    const dec = (k: string) => (typeof body[k] === 'string' && /^\d{1,3}(\.\d{1,4})?$/.test(body[k] as string) ? Number(body[k]) : NaN);
    const raw = { enabled: body.enabled === 'yes', percent: dec('percent'), mult: dec('mult'), list };
    const current = await loadOverrides(db);
    let overrides: Overrides;
    try {
      overrides = overridesSchema.parse({ ...current, omikujiSpecial: omikujiSpecialSchema.parse(raw) });
      applyOverrides(fileCfg(), overrides);
    } catch {
      return back('unei_invalid');
    }
    let failed = 0;
    for (let n = 1; n <= OMIKUJI_SPECIAL_MAX; n++) {
      const f = body[`img.${n}`];
      const file = Array.isArray(f) ? f[0] : f;
      if (!(file instanceof File) || file.size === 0) continue;
      if ((await saveOmikujiArt(db, n, new Uint8Array(await file.arrayBuffer()))) !== 'ok') failed++;
    }
    await saveOverrides(db, overrides, c.get('session').userId);
    await deps.onSettingsSaved?.();
    await audit(db, { actorId: c.get('session').userId, action: 'omikuji.special', detail: raw, via: 'web' });
    return back(failed ? 'unei_partial' : 'unei_saved');
  });
  // 🧪 運営吉を試しに出す（運営のチャンネルに、本番と同じ流れで。くじは引かない）
  app.post('/settings/omikuji-trial/:n', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const n = Number(c.req.param('n'));
    const back = (msg: string) => c.redirect(`/settings?msg=${msg}&at=unei#sec-unei`);
    if (!isOmikujiArtNo(n)) return back('unei_trial_noslot');
    try {
      const r = await trialUnei(db, deps.discord, cfg, n, c.get('session').userId, now());
      if (!r.ok) return back(r.reason === 'no_slot' ? 'unei_trial_noslot' : 'unei_trial_nochannel');
      r.done.catch((err) => logger.warn({ err }, 'omikuji trial failed'));
      await audit(db, { actorId: c.get('session').userId, action: 'omikuji.trial', detail: { n }, via: 'web' });
      return back('unei_trial');
    } catch (err) {
      logger.warn({ err }, 'omikuji trial failed');
      return back('unei_trial_failed');
    }
  });
  app.get('/settings/omikuji-art/:n', async (c) => {
    if (!gujiOnly(c)) return c.notFound();
    const art = await loadOmikujiArt(db, Number(c.req.param('n')));
    if (!art) return c.notFound();
    return c.body(Buffer.from(art.data), 200, { 'content-type': art.contentType, 'x-content-type-options': 'nosniff' });
  });
  app.post('/settings/omikuji-art/:n/delete', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const n = Number(c.req.param('n'));
    if (isOmikujiArtNo(n)) {
      await deleteOmikujiArt(db, n);
      await audit(db, { actorId: c.get('session').userId, action: 'omikuji.art_deleted', detail: { n }, via: 'web' });
    }
    return c.redirect('/settings?msg=unei_art_deleted&at=unei#sec-unei');
  });

  // 📜 おみくじの文と紙: 一言・項目・ラッキー場所（1 行 1 つ）と台紙をまとめて保存（台紙は選んだものだけ入れ替える）
  app.post('/settings/omikuji-texts', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const back = (msg: string) => c.redirect(`/settings?msg=${msg}&at=omikujitexts#sec-omikujitexts`);
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
    const many = (k: string) => [...new Set(str(k).replace(/\r\n/g, '\n').split('\n').map((x) => x.trim()).filter(Boolean))];
    const fields = [...FORTUNE_KEYS.map((k) => `msg.${k}`), 'places', ...Array.from({ length: 9 }, (_, n) => TONES.map((t) => `item.${n}.${t}`)).flat()];
    if (fields.some((k) => many(k).some((x) => [...x].length > OMIKUJI_LINE_MAX))) return back('otexts_long');
    const items = Array.from({ length: 9 }, (_, n) => n).flatMap((n) => {
      const label = str(`item.${n}.label`).trim();
      if (!label) return [];
      const key = str(`item.${n}.key`).trim() || `item${Date.now().toString(36)}${n}`;
      return [{ key, label, emoji: str(`item.${n}.emoji`).trim(), fixed: body[`item.${n}.fixed`] === 'yes', good: many(`item.${n}.good`), normal: many(`item.${n}.normal`), bad: many(`item.${n}.bad`) }];
    });
    const raw = {
      shrine: str('shrine').trim(),
      slip: body.slip === 'yes',
      shake: body.shake === 'yes',
      messages: Object.fromEntries(FORTUNE_KEYS.map((k) => [k, many(`msg.${k}`)])),
      items,
      places: many('places'),
    };
    const current = await loadOverrides(db);
    let overrides: Overrides;
    try {
      overrides = overridesSchema.parse({ ...current, omikujiTexts: omikujiTextsSchema.parse(raw) });
      applyOverrides(fileCfg(), overrides);
    } catch {
      return back('otexts_invalid');
    }
    let failed = 0;
    for (const k of SLIP_BG_KEYS) {
      const f = body[`bg.${k}`];
      const file = Array.isArray(f) ? f[0] : f;
      if (!(file instanceof File) || file.size === 0) continue;
      if ((await saveSlipBg(db, k, new Uint8Array(await file.arrayBuffer()))) !== 'ok') failed++;
    }
    await saveOverrides(db, overrides, c.get('session').userId);
    await deps.onSettingsSaved?.();
    await audit(db, { actorId: c.get('session').userId, action: 'omikuji.texts', detail: { shrine: raw.shrine, slip: raw.slip, shake: raw.shake, items: items.length }, via: 'web' });
    return back(failed ? 'otexts_partial' : 'otexts_saved');
  });
  app.post('/settings/omikuji-texts/reset', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const current = await loadOverrides(db);
    const def = omikujiTextsSchema.parse({});
    const keep = cfg.omikujiTexts;
    const overrides = overridesSchema.parse({ ...current, omikujiTexts: { ...def, shrine: keep.shrine, slip: keep.slip, shake: keep.shake } });
    await saveOverrides(db, overrides, c.get('session').userId);
    await deps.onSettingsSaved?.();
    await audit(db, { actorId: c.get('session').userId, action: 'omikuji.texts_reset', detail: {}, via: 'web' });
    return c.redirect('/settings?msg=otexts_reset&at=omikujitexts#sec-omikujitexts');
  });
  app.post('/settings/omikuji-bg/:k/delete', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const k = c.req.param('k');
    if (isSlipBgKey(k)) {
      await deleteSlipBg(db, k);
      await audit(db, { actorId: c.get('session').userId, action: 'omikuji.bg_deleted', detail: { key: k }, via: 'web' });
    }
    return c.redirect('/settings?msg=otexts_bg_deleted&at=omikujitexts#sec-omikujitexts');
  });
  // 紙の見本（今の文から 1 つ選んで描く。運営吉は決めたひとこと）
  app.get('/settings/omikuji-preview/:k', async (c) => {
    if (!gujiOnly(c)) return c.notFound();
    const k = c.req.param('k');
    if (!isSlipBgKey(k)) return c.notFound();
    const fortune = fortuneOf(k, cfg.omikujiSpecial);
    if (!fortune) return c.notFound();
    const texts = cfg.omikujiTexts;
    const pool = texts.messages[k as FortuneKey] ?? [];
    const message = specialIndex(k) !== undefined ? fortune.message : (pool[0] ?? fortune.message);
    const bg = await loadSlipBg(db, k);
    const png = renderSlip({
      name: fortune.name,
      color: `#${fortune.color.toString(16).padStart(6, '0')}`,
      message,
      items: omikujiSayings(texts, k).map((x) => ({ label: x.label, text: x.text })),
      shrine: texts.shrine,
      ...(pool.length && specialIndex(k) === undefined ? { number: 1 } : {}),
      date: now(),
      special: specialIndex(k) !== undefined,
      tone: toneOf(specialIndex(k) !== undefined ? 'daikichi' : k),
      ...(bg ? { bg } : {}),
    });
    return c.body(new Uint8Array(png), 200, { 'content-type': 'image/png', 'x-content-type-options': 'nosniff' });
  });

  /** 🔔 通知 OK／NG: 設定のページに出すもの */
  const notifyView = async (allRoles: GuildRole[]) => {
    const ready = notifyReady(cfg);
    const setup = await notifySetupState(db);
    if (setup && !setup.finishedAt) kickNotify();
    if (!ready) return { ready, setup };
    const name = (id?: string) => allRoles.find((r) => r.id === id)?.name;
    return { ready, setup, okName: name(cfg.notify.okRoleId), ngName: name(cfg.notify.ngRoleId), ...(await notifyCounts(db, cfg)) };
  };

  /** 通知 OK を今いる人に配る（裏で少しずつ） */
  let notifyRunning = false;
  const kickNotify = () => {
    if (notifyRunning) return;
    notifyRunning = true;
    void (async () => {
      try {
        for (let i = 0; i < 100_000; i++) {
          if (await runNotifySetup(db, cfg, deps.discord, 10, now())) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        logger.warn({ err }, 'notify setup runner stopped');
      } finally {
        notifyRunning = false;
      }
    })();
  };

  /** 通知 OK／NG のロールを作って（同じ名前があれば使う）、今いる人に通知 OK を付けはじめる */
  app.post('/settings/notify/create', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const by = c.get('session').userId;
    try {
      const roles = (await loadRoles()) ?? [];
      const find = (name: string) => roles.find((r) => r.name === name && !r.managed);
      // 前に作ったロール → 同じ名前のロール → 新しく作る
      const make = async (id: string | undefined, name: string, color: number) =>
        roles.find((r) => r.id === id) ??
        find(name) ??
        (await deps.discord.createRole(cfg.guildId, { name, color, permissions: '0', hoist: false, mentionable: false }, '管理画面（通知 OK／NG）'));
      const ok = await make(cfg.notify.okRoleId, NOTIFY_LABEL.ok, 0xe2b340);
      const ng = await make(cfg.notify.ngRoleId, NOTIFY_LABEL.ng, 0x7a6d71);
      const current = await loadOverrides(db);
      const overrides = overridesSchema.parse({ ...current, notify: { okRoleId: ok.id, ngRoleId: ng.id } });
      const after = applyOverrides(fileCfg(), overrides);
      await saveOverrides(db, overrides, by);
      await deps.onSettingsSaved?.();
      cfg = after;
      const st = await startNotifySetup(db, after, by, now());
      await audit(db, { actorId: by, action: 'notify.setup', detail: { okRoleId: ok.id, ngRoleId: ng.id, targets: st.targets.length }, via: 'web' });
      kickNotify();
      return c.redirect('/settings?msg=notify_started&at=notify#sec-notify');
    } catch (err) {
      logger.warn({ err }, 'notify setup failed');
      return c.redirect('/settings?msg=notify_failed&at=notify#sec-notify');
    }
  });

  /** ボタン（🔔 通知OK／🔕 通知NG）をチャンネルに置く */
  app.post('/settings/notify/panel', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const channelId = typeof body.channelId === 'string' && validId(body.channelId) ? body.channelId : undefined;
    if (!channelId || !notifyReady(cfg)) return c.redirect('/settings?msg=notify_panel_invalid&at=notify#sec-notify');
    try {
      await deps.discord.sendMessage(channelId, panelMessage('notify'));
      await audit(db, { actorId: c.get('session').userId, action: 'notify.panel', detail: { channelId }, via: 'web' });
      return c.redirect('/settings?msg=notify_panel&at=notify#sec-notify');
    } catch (err) {
      logger.warn({ err }, 'notify panel post failed');
      return c.redirect('/settings?msg=notify_failed&at=notify#sec-notify');
    }
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
    const prev = await loadOverrides(db);
    // 運営の見守りの数（空なら今の値のまま）
    const opsNow = { ...opsWatchSchema.parse({}), ...prev.opsWatch };
    const opsNum = (k: string, key: 'applicationHours' | 'soudanHours' | 'omairiHours' | 'bellMinutes' | 'quietStart' | 'quietEnd' | 'reportWeekday' | 'reportHour') =>
      Number.isFinite(num(k)) && typeof body[k] === 'string' && body[k] !== '' ? num(k) : opsNow[key];
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
        omikujiVoiceOnly: body.omikujiVoiceOnly === 'yes',
        joinBonus: num('joinBonus'),
        joinBonusNotify: body.joinBonusNotify === 'yes',
        joinBonusChannelId: field(body, 'joinBonusChannel', 20) || null,
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
        // 💎 極（VIP）はショップのページで作る（ここでは残す）
        ...(prev.rooms.vip ? { vip: prev.rooms.vip } : {}),
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
      // 運営の見守り（フォームにあるときだけ。なければ今の値を残す）
      opsWatch:
        typeof body.opsAppHours === 'string'
          ? {
              channelId: field(body, 'opsChannel', 20) || null,
              remindEnabled: body.opsRemind === 'yes',
              mention: body.opsMention === 'yes',
              applicationHours: opsNum('opsAppHours', 'applicationHours'),
              soudanHours: opsNum('opsSoudanHours', 'soudanHours'),
              omairiHours: opsNum('opsOmairiHours', 'omairiHours'),
              bellMinutes: opsNum('opsBellMinutes', 'bellMinutes'),
              quietStart: opsNum('opsQuietStart', 'quietStart'),
              quietEnd: opsNum('opsQuietEnd', 'quietEnd'),
              reportEnabled: body.opsReport === 'yes',
              reportWeekday: opsNum('opsReportWeekday', 'reportWeekday'),
              reportHour: opsNum('opsReportHour', 'reportHour'),
            }
          : prev.opsWatch,
      ...(typeof body.recruitCooldownSec === 'string'
        ? {
            recruit: {
              cooldownSeconds: num('recruitCooldownSec'),
              channelCooldownSeconds: num('recruitChannelCooldownSec'),
              requireRank: body.recruitRequireRank === 'yes',
              blockYakudoshi: body.recruitBlockYaku === 'yes',
              newMemberDays: num('recruitNewDays'),
              spamAlertCount: num('recruitSpamAlert'),
            },
          }
        : {}),
      // 物御籤は「物御籤」のページで変える（ここでは今の値を残す）
      gacha: prev.gacha,
      // 経済の見守りの設定は経済のページで変える（ここでは残す）
      economyOps: prev.economyOps,
      // カジノはカジノのページで変える（ここでは残す）
      casino: prev.casino,
      // 🎴 運営吉は「運営吉」の項目で変える（ここでは残す）
      omikujiSpecial: prev.omikujiSpecial,
      // ⛩ おみくじの文と紙は「おみくじの文と紙」の項目で変える（ここでは残す）
      omikujiTexts: prev.omikujiTexts,
      // 通知 OK／NG のロールは「🔔 通知 OK／NG」の項目で用意する（ここでは残す）
      notify: prev.notify,
      // おみくじの連続日数のおまけ（フォームにあるときだけ。日数が空の行は使わない）
      omikujiStreak:
        typeof body['streak.0.days'] === 'string'
          ? {
              rewards: [...Array(5).keys()].flatMap((i) => {
                if (!field(body, `streak.${i}.days`, 4)) return [];
                const roleId = field(body, `streak.${i}.roleId`, 20);
                return [
                  {
                    days: num(`streak.${i}.days`),
                    repeat: body[`streak.${i}.repeat`] === 'yes',
                    coins: num(`streak.${i}.coins`) || 0,
                    ticket: field(body, `streak.${i}.ticket`, 30) || 'none',
                    tickets: num(`streak.${i}.tickets`) || 0,
                    ...(roleId ? { roleId } : {}),
                  },
                ];
              }),
            }
          : prev.omikujiStreak,
      // 役職は役職のページで変える（ここでは残す）
      ranks: prev.ranks,
      extraRanks: prev.extraRanks,
      // 社務所Web に入れるロールは「社務所Web に入れるロール」の項目で変える（ここでは残す）
      webAccess: prev.webAccess,
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
    // 新しく選んだおまけのロールは、役目のない・危ない権限のないロールだけ
    const prevStreakRoles = new Set((prev.omikujiStreak.rewards ?? []).map((r) => r.roleId));
    const streakRoles = (overrides.omikujiStreak.rewards ?? []).flatMap((r) => (r.roleId && !prevStreakRoles.has(r.roleId) ? [r.roleId] : []));
    if (streakRoles.length) {
      const all = (await loadRoles()) ?? [];
      if (streakRoles.some((id) => !all.some((r) => r.id === id && giftableRole(cfg, r, all, deps.botId)))) return c.redirect(backTo('settings_invalid'));
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
      detail: {
        economy: diff(before.economy, after.economy),
        omairi: diff(before.omairi, after.omairi),
        applications: diff(before.applications, after.applications),
        recruit: diff(before.recruit, after.recruit),
        ranks: rankDiff(before, after),
      },
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

  // 社務所Web に入れる人（ロール・人ごとに、見られるページを選ぶ）
  const saveWebAccess = async (c: Context<Env>, entries: WebAccessEntry[], detail: Record<string, unknown>) => {
    const prev = await loadOverrides(db);
    await saveOverrides(db, { ...prev, webAccess: { shinshokuRoleIds: [], entries } }, c.get('session').userId);
    await deps.onSettingsSaved?.();
    // 次に開いたときに、全員の入れる・見られるページを確かめ直す
    await recheckAllSessions(db);
    await audit(db, { actorId: c.get('session').userId, action: 'settings.web_access', detail, via: 'web' });
  };
  const webAccessBack = (msg: string) => `/settings?msg=${msg}&at=webaccess#sec-webaccess`;

  app.post('/settings/web-access', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody({ all: true });
    const kind = body.kind === 'member' ? 'member' : 'role';
    let id: string | undefined;
    if (kind === 'role') {
      const roles = (await loadRoles()) ?? [];
      const v = field(body, 'roleId');
      id = roles.some((r) => r.id === v && r.id !== cfg.guildId && !r.managed) ? v : undefined;
    } else {
      const found = await findMemberByNameOrId(db, field(body, 'member', 100) ?? '');
      if (found === 'ambiguous') return c.redirect(webAccessBack('webaccess_ambiguous'));
      id = found?.id;
    }
    if (!id) return c.redirect(webAccessBack('webaccess_not_found'));
    const raw = body.pages === undefined ? [] : Array.isArray(body.pages) ? body.pages : [body.pages];
    const picked = raw.filter((v): v is string => typeof v === 'string');
    const pages: WebAccessEntry['pages'] = picked.includes('*') ? ['*'] : WEB_PAGE_KEYS.filter((k) => picked.includes(k));
    // ロールでページなしは意味がない（人は「神職でも入れない」にできる）
    if (kind === 'role' && !pages.length) return c.redirect(webAccessBack('webaccess_no_pages'));
    const rest = webAccessEntries(cfg).filter((e) => !(e.kind === kind && e.id === id));
    if (rest.length >= 50) return c.redirect(webAccessBack('invalid'));
    await saveWebAccess(c, [...rest, { kind, id, pages }], { kind, id, pages });
    return c.redirect(webAccessBack('saved'));
  });

  // ───────── 🪪 社務所Web のアカウント（ID とパスワード） ─────────

  const accountsBack = (msg: string) => `/settings?msg=${msg}&at=accounts#sec-accounts`;
  /** フォームの値（権限・ページ・Discord の人）。人が見つからなければ undefined */
  const accountForm = async (body: Record<string, unknown>, current?: string | null) => {
    const level = body.level === 'guji' ? ('guji' as const) : ('shinshoku' as const);
    const raw = body.pages === undefined ? [] : Array.isArray(body.pages) ? body.pages : [body.pages];
    const picked = raw.filter((v): v is string => typeof v === 'string');
    const pages = picked.includes('*') ? null : WEB_PAGE_KEYS.filter((k) => picked.includes(k));
    const memberRaw = field(body, 'member', 100);
    let memberId: string | null = null;
    if (memberRaw && memberRaw !== current) {
      const found = await findMemberByNameOrId(db, memberRaw);
      if (!found || found === 'ambiguous') return undefined;
      memberId = found.id;
    } else if (memberRaw) memberId = current ?? null;
    return { name: field(body, 'name', 40), level, pages, memberId };
  };

  app.post('/settings/accounts', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody({ all: true });
    const f = await accountForm(body);
    if (!f) return c.redirect(accountsBack('account_member_not_found'));
    const r = await createAccount(db, { loginId: field(body, 'loginId', 64), ...f }, c.get('session').userId, now());
    if (r.status !== 'ok') return c.redirect(accountsBack(`account_${r.status}`));
    await audit(db, { actorId: c.get('session').userId, action: 'account.create', detail: { account: r.account.loginId, level: r.account.level, pages: r.account.pages }, via: 'web' });
    return c.html(<AccountIssuedPage session={c.get('session')} loginId={r.account.loginId} name={r.account.name} password={r.password} entryHint={Boolean(deps.entryKey)} />);
  });

  app.post('/settings/accounts/:id/:action?', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const id = Number(c.req.param('id'));
    const action = c.req.param('action') ?? 'save';
    const a = Number.isSafeInteger(id) ? await getAccount(db, id) : undefined;
    if (!a) return c.redirect(accountsBack('invalid'));
    const by = c.get('session').userId;
    const log = (what: string, detail: Record<string, unknown> = {}) => audit(db, { actorId: by, action: `account.${what}`, detail: { account: a.loginId, ...detail }, via: 'web' });
    if (action === 'reset') {
      const r = await resetPassword(db, id);
      if (r.status !== 'ok') return c.redirect(accountsBack('invalid'));
      await log('reset');
      return c.html(<AccountIssuedPage session={c.get('session')} loginId={a.loginId} name={a.name} password={r.password} reset entryHint={Boolean(deps.entryKey)} />);
    }
    const body = await c.req.parseBody({ all: true });
    if (action === 'toggle') {
      const r = await setDisabled(db, id, !a.disabled);
      if (r !== 'ok') return c.redirect(accountsBack(r === 'last_guji' ? 'account_last_guji' : 'invalid'));
      await log(a.disabled ? 'enable' : 'disable');
      return c.redirect(accountsBack(a.disabled ? 'account_enabled' : 'account_disabled'));
    }
    if (action === 'delete') {
      if (body.confirm !== 'yes') return c.redirect(accountsBack('invalid'));
      const r = await deleteAccount(db, id);
      if (r !== 'ok') return c.redirect(accountsBack(r === 'last_guji' ? 'account_last_guji' : 'invalid'));
      await log('delete');
      return c.redirect(accountsBack('account_deleted'));
    }
    if (action !== 'save') return c.redirect(accountsBack('invalid'));
    const f = await accountForm(body, a.memberId);
    if (!f) return c.redirect(accountsBack('account_member_not_found'));
    const r = await updateAccount(db, id, f);
    if (r !== 'ok') return c.redirect(accountsBack(r === 'last_guji' ? 'account_last_guji' : r === 'bad_name' ? 'account_bad_name' : 'invalid'));
    // ログイン中の人にも、次に開いたときから効かせる
    await recheckAllSessions(db);
    await log('update', { level: f.level, pages: f.level === 'guji' ? null : f.pages });
    return c.redirect(accountsBack('account_saved'));
  });

  app.post('/settings/web-access/remove', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    const kind = body.kind === 'member' ? 'member' : 'role';
    const id = field(body, 'id');
    const entries = webAccessEntries(cfg);
    if (!id || !entries.some((e) => e.kind === kind && e.id === id)) return c.redirect(webAccessBack('invalid'));
    await saveWebAccess(c, entries.filter((e) => !(e.kind === kind && e.id === id)), { kind, id, removed: true });
    return c.redirect(webAccessBack('webaccess_removed'));
  });

  app.post('/settings/reset', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const before = cfg;
    // 役職は役職のページで変えるので残す
    const { ranks, extraRanks, rooms, webAccess } = await loadOverrides(db);
    const reset = overridesSchema.parse({ ranks, extraRanks, webAccess, ...(rooms.vip ? { rooms: { vip: rooms.vip } } : {}) });
    await saveOverrides(db, reset, c.get('session').userId);
    await deps.onSettingsSaved?.();
    await syncPostedNotices({ db, cfg: applyOverrides(fileCfg(), reset), discord: deps.discord }, before);
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
    const categories = channels
      .filter((ch) => ch.type === 4)
      .sort((a, b) => a.position - b.position)
      .map((ch) => ({ id: ch.id, name: ch.name }));
    return c.html(<NoticesPage session={c.get('session')} groups={groups} flash={c.req.query('msg')} now={now()} categories={categories} />);
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
        channelId={notice ? undefined : c.req.query('channel')}
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
        button={body.shuinButton === 'yes'}
      />,
    );
  });

  app.post('/notices/seed', async (c) => {
    return tryDiscord(c, '/notices', async () => {
      const r = await seedDefaultNotices(noticeCtx(), c.get('session').userId);
      return r.missing.length ? 'seed_missing' : 'seeded';
    });
  });

  app.post('/notices/shuin-category', async (c) => {
    const body = await c.req.parseBody();
    const categoryId = typeof body.categoryId === 'string' && /^\d{17,20}$/.test(body.categoryId) ? body.categoryId : '';
    if (!categoryId) return c.redirect('/notices');
    return tryDiscord(c, '/notices', async () => {
      const r = await addShuinButtonsToCategory(noticeCtx(), categoryId, c.get('session').userId);
      return r.updated + r.created > 0 ? 'shuin_buttons' : 'shuin_buttons_none';
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
    // ボタンだけの掲示（🌸 朱印を押す）は本文なしでよい
    if (!title || (!text && body.shuinButton !== 'yes') || !postableChannels(channels).some((ch) => ch.id === channelId)) return editPage(c, undefined, text, 'invalid');
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
      shuinButton: body.shuinButton === 'yes',
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
    return editPage(c, n, n.body, c.req.query('msg'));
  });

  app.post('/notices/:id', async (c) => {
    const id = noticeId(c);
    const n = id ? await getNotice(db, id) : undefined;
    if (!n) return c.redirect('/notices');
    const body = await c.req.parseBody({ all: true });
    const title = field(body, 'title', 60);
    const text = typeof body.body === 'string' ? body.body.replace(/\r\n/g, '\n').trimEnd() : '';
    if (!title || (!text && body.shuinButton !== 'yes')) return editPage(c, n, text || n.body, 'invalid');
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
      shuinButton: body.shuinButton === 'yes',
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

  const textChannel = (ch: GuildChannel) => ch.type === 0 || ch.type === 5;

  app.get('/glossary', async (c) => {
    const [terms, channels, places] = await Promise.all([listTerms(db), loadChannels().catch(() => [] as GuildChannel[]), loadGlossaryPlaces(db)]);
    const now = glossaryChannelsOf(places, channels);
    const categories = channels.filter((ch) => ch.type === 4).sort((a, b) => a.position - b.position);
    const edit = Number(c.req.query('edit'));
    return c.html(
      <GlossaryPage
        session={c.get('session')}
        terms={terms}
        coin={cfg.economy.currencyName}
        flash={c.req.query('msg')}
        render={(s) => renderNotice(s, cfg, channels, { forPreview: true }).text}
        places={places}
        current={{ rules: now.rules?.name, glossary: now.glossary?.name }}
        channels={postableChannels(channels).filter(textChannel)}
        categories={categories.map((ch) => ({ id: ch.id, name: ch.name }))}
        defaultCategoryId={now.rules?.parent_id ?? undefined}
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
      const msg = r.noShikitari && r.noChannel ? 'synced_none' : r.noChannel ? 'synced_nochannel' : r.noShikitari ? 'synced_norules' : 'synced';
      return c.redirect(`/glossary?msg=${msg}${msg === 'synced' ? '' : '#glossary-places'}`);
    } catch (err) {
      logger.warn({ err }, 'glossary sync failed');
      return c.redirect('/glossary?msg=discord_error');
    }
  });

  /** 用語集を出すチャンネルを選ぶ（空なら名前で探す） */
  app.post('/glossary/places', async (c) => {
    const body = await c.req.parseBody();
    const pick = (k: string) => (typeof body[k] === 'string' && body[k] ? (body[k] as string) : undefined);
    const rulesChannelId = pick('rulesChannelId');
    const glossaryChannelId = pick('glossaryChannelId');
    if (rulesChannelId || glossaryChannelId) {
      const channels = await loadChannels(true).catch(() => undefined);
      if (!channels) return c.redirect('/glossary?msg=discord_error#glossary-places');
      const ok = (id?: string) => !id || channels.some((ch) => ch.id === id && textChannel(ch));
      if (!ok(rulesChannelId) || !ok(glossaryChannelId) || (rulesChannelId && rulesChannelId === glossaryChannelId)) {
        return c.redirect('/glossary?msg=places_invalid#glossary-places');
      }
    }
    await saveGlossaryPlaces(db, { rulesChannelId, glossaryChannelId }, c.get('session').userId);
    return c.redirect('/glossary?msg=places_saved#glossary-places');
  });

  /** #用語集 を作る（選んだカテゴリに、カテゴリと同じ見える範囲で、読むだけ）。作ったら出すチャンネルにする */
  app.post('/glossary/channel', async (c) => {
    const body = await c.req.parseBody();
    const channels = await loadChannels(true).catch(() => undefined);
    if (!channels) return c.redirect('/glossary?msg=discord_error#glossary-places');
    const places = await loadGlossaryPlaces(db);
    if (glossaryChannelsOf(places, channels).glossary) return c.redirect('/glossary?msg=channel_exists#glossary-places');
    const parent = channels.find((ch) => ch.id === body.categoryId && ch.type === 4);
    if (!parent) return c.redirect('/glossary?msg=channel_nocategory#glossary-places');
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
      await saveGlossaryPlaces(db, { ...places, glossaryChannelId: created.id }, c.get('session').userId);
      await guildChannelsCached(deps.discord, cfg.guildId, true).catch(() => undefined);
      return c.redirect('/glossary?msg=channel_created#glossary-places');
    } catch (err) {
      logger.warn({ err }, 'glossary channel create failed');
      return c.redirect('/glossary?msg=channel_failed#glossary-places');
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

  /** 一覧・編集ページに出す、チャンネルのようす */
  const channelInfo = (ch: GuildChannel, all: GuildChannel[]): ChannelInfo => {
    const parent = ch.parent_id ? (all.find((x) => x.id === ch.parent_id) ?? null) : null;
    return { channel: ch, mode: isText(ch) ? channelModeOf(ch, cfg) : undefined, restricted: isRestricted(ch, cfg, parent), inUse: channelsInUse(cfg).get(ch.id) };
  };

  app.get('/channels', async (c) => {
    const channels = await loadChannels(true);
    const groups = listTextChannels(channels).map((g) => ({
      category: g.category ? channelInfo(g.category, channels) : null,
      // テキストのあとに通話（Discord と同じ並び）
      items: [...g.items, ...g.voice].map((ch) => channelInfo(ch, channels)),
    }));
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    return c.html(<ChannelsPage session={c.get('session')} groups={groups} flash={c.req.query('msg')} q={c.req.query('q')} total={total} />);
  });

  // ───────── 🧮 チャンネル権限（マトリクス・テンプレート） ─────────

  /** マトリクスで選べるロール（@everyone を先に、上のロールから。BOT・連携のロールは除く） */
  const matrixRoles = async () => {
    const [roles, { counts }] = await Promise.all([loadRoles(), roleMemberCounts(db)]);
    const list = (roles ?? []).filter((r) => !r.managed);
    return [
      { id: cfg.guildId, name: '@everyone（みんな）', members: undefined as number | undefined },
      ...list.filter((r) => r.id !== cfg.guildId).map((r) => ({ id: r.id, name: r.name, members: counts.get(r.id) ?? 0 })),
    ];
  };
  const matrixGroups = (channels: GuildChannel[]) => listTextChannels(channels).map((g) => ({ category: g.category, items: [...g.items, ...g.voice] }));

  app.get('/channels/perms', async (c) => {
    const [channels, roles, templates] = await Promise.all([loadChannels(true), matrixRoles(), listTemplates(db)]);
    const want = c.req.query('role');
    const roleId = roles.some((r) => r.id === want) ? want! : (roles[1]?.id ?? cfg.guildId);
    const groups = matrixGroups(channels);
    if (c.req.query('tab') === 'templates') {
      const edit = templates.find((t) => t.id === c.req.query('edit'));
      return c.html(<PermTemplatesPage session={c.get('session')} roles={roles} roleId={roleId} templates={templates} edit={edit} groups={groups} flash={c.req.query('msg')} applyId={c.req.query('t')} />);
    }
    if (c.req.query('tab') === 'roles') {
      const want = c.req.query('ch');
      const listed = groups.flatMap((g) => [...(g.category ? [g.category] : []), ...g.items]);
      const channel = listed.find((x) => x.id === want) ?? listed.find((x) => x.type !== 4) ?? listed[0];
      return c.html(<PermRolesPage session={c.get('session')} roles={roles} channel={channel} groups={groups} all={c.req.query('all') === '1'} flash={c.req.query('msg')} />);
    }
    const k = c.req.query('kind');
    const kind = k === 'text' || k === 'voice' ? k : 'all';
    return c.html(<PermMatrixPage session={c.get('session')} roles={roles} roleId={roleId} kind={kind} groups={groups} flash={c.req.query('msg')} />);
  });

  /** マスを 1 つ変える（perms.js から。答えは JSON） */
  app.post('/channels/perms/cell', async (c) => {
    const body = await c.req.parseBody();
    const channelId = typeof body.channel === 'string' && validId(body.channel) ? body.channel : '';
    const roleId = typeof body.role === 'string' && validId(body.role) ? body.role : '';
    const bit = Number(body.bit);
    const cell = body.cell;
    const p = MATRIX_PERMS.find((m) => m.bit === bit);
    if (!channelId || !roleId || !p || !isCell(cell)) return c.json({ ok: false, error: 'invalid' }, 400);
    const [channels, roles] = await Promise.all([loadChannels(true), loadRoles()]);
    const ch = channels.find((x) => x.id === channelId);
    const role = (roles ?? []).find((r) => r.id === roleId);
    if (!ch || !role || role.managed || !applies(p, ch)) return c.json({ ok: false, error: 'invalid' }, 400);
    const plan = planCells(ch, roleId, [{ bit, cell }]);
    const reason = 'チャンネル権限のマトリクス（管理画面）';
    try {
      if (plan && 'set' in plan) await deps.discord.setChannelOverwrite(ch.id, plan.set, reason);
      if (plan && 'del' in plan) {
        if (deps.discord.deleteChannelOverwrite) await deps.discord.deleteChannelOverwrite(ch.id, plan.del, reason);
        else await deps.discord.setChannelOverwrite(ch.id, { id: plan.del, type: 0, allow: '0', deny: '0' }, reason);
      }
    } catch (err) {
      logger.warn({ err }, 'perm matrix cell failed');
      return c.json({ ok: false, error: 'failed' }, 502);
    }
    // 次に開いたときに新しい上書きが出るように
    await loadChannels(true);
    if (plan) await audit(db, { actorId: c.get('session').userId, action: 'channel.perm_cell', detail: { channelId, name: ch.name, roleId, role: role.name, perm: p.key, cell }, via: 'web' });
    return c.json({ ok: true, cell });
  });

  /** まとめて変える: 選んだチャンネル × 選んだ権限を、1 つのロールで 許可・拒否・中立 に（perms.js から。答えは JSON） */
  app.post('/channels/perms/bulk', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const list = (k: string) => {
      const v = body[k];
      return (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === 'string');
    };
    const roleId = typeof body.role === 'string' && validId(body.role) ? body.role : '';
    const cell = body.cell;
    const ids = new Set(list('channels').filter(validId));
    const perms = MATRIX_PERMS.filter((m) => list('bits').includes(String(m.bit)));
    if (!roleId || !isCell(cell) || !ids.size || ids.size > 300 || !perms.length) return c.json({ ok: false, error: 'invalid' }, 400);
    const [channels, roles] = await Promise.all([loadChannels(true), loadRoles()]);
    const role = (roles ?? []).find((r) => r.id === roleId);
    if (!role || role.managed) return c.json({ ok: false, error: 'invalid' }, 400);
    const targets = channels.filter((ch) => ids.has(ch.id));
    const reason = 'チャンネル権限のマトリクス・まとめて変える（管理画面）';
    const done: { ch: string; bit: number; cell: string }[] = [];
    let changed = 0;
    let failed = false;
    for (const ch of targets) {
      const usable = perms.filter((m) => applies(m, ch));
      if (!usable.length) continue;
      const plan = planCells(ch, roleId, usable.map((m) => ({ bit: m.bit, cell })));
      try {
        if (plan && 'set' in plan) await deps.discord.setChannelOverwrite(ch.id, plan.set, reason);
        if (plan && 'del' in plan) {
          if (deps.discord.deleteChannelOverwrite) await deps.discord.deleteChannelOverwrite(ch.id, plan.del, reason);
          else await deps.discord.setChannelOverwrite(ch.id, { id: plan.del, type: 0, allow: '0', deny: '0' }, reason);
        }
      } catch (err) {
        logger.warn({ err }, 'perm matrix bulk failed');
        failed = true;
        break;
      }
      if (plan) changed++;
      for (const m of usable) done.push({ ch: ch.id, bit: m.bit, cell });
    }
    await loadChannels(true);
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'channel.perm_bulk',
      detail: { roleId, role: role.name, cell, perms: perms.map((m) => m.key), channels: targets.map((x) => x.name), changed, ...(failed ? { failed: true } : {}) },
      via: 'web',
    });
    return c.json({ ok: !failed, changed, cells: done, ...(failed ? { error: 'failed' } : {}) }, failed ? 502 : 200);
  });

  /** テンプレートを作る・直す */
  app.post('/channels/perms/templates', async (c) => {
    const body = await c.req.parseBody();
    const list = await listTemplates(db);
    const id = typeof body.id === 'string' && list.some((t) => t.id === body.id) ? body.id : `t${Date.now().toString(36)}`;
    const perms: Record<string, 'allow' | 'deny' | 'neutral'> = {};
    for (const m of MATRIX_PERMS) {
      const v = body[`p.${m.no}`];
      if (v === 'allow' || v === 'deny' || v === 'neutral') perms[String(m.no)] = v;
    }
    const parsed = templateSchema.safeParse({ id, name: field(body, 'name', 40), target: body.target, note: field(body, 'note', 200), perms });
    if (!parsed.success || !Object.keys(perms).length) return c.redirect('/channels/perms?tab=templates&msg=tpl_invalid#pm-edit');
    const next = list.some((t) => t.id === id) ? list.map((t) => (t.id === id ? parsed.data : t)) : [...list, parsed.data];
    await saveTemplates(db, next, c.get('session').userId);
    await audit(db, { actorId: c.get('session').userId, action: 'channel.perm_template', detail: { id, name: parsed.data.name, perms }, via: 'web' });
    return c.redirect('/channels/perms?tab=templates&msg=tpl_saved');
  });

  app.post('/channels/perms/templates/:id/delete', async (c) => {
    const list = await listTemplates(db);
    const id = c.req.param('id');
    if (!list.some((t) => t.id === id)) return c.redirect('/channels/perms?tab=templates&msg=invalid');
    await saveTemplates(db, list.filter((t) => t.id !== id), c.get('session').userId);
    await audit(db, { actorId: c.get('session').userId, action: 'channel.perm_template_delete', detail: { id }, via: 'web' });
    return c.redirect('/channels/perms?tab=templates&msg=tpl_deleted');
  });

  /** テンプレートを、選んだチャンネルのロールの上書きに当てる */
  app.post('/channels/perms/apply', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const one = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
    const back = (msg: string, role?: string) => c.redirect(`/channels/perms?tab=templates&msg=${msg}${role ? `&role=${role}` : ''}`);
    const t = (await listTemplates(db)).find((x) => x.id === one('template'));
    const roleId = validId(one('role')) ? one('role') : '';
    const roles = (await loadRoles()) ?? [];
    const role = roles.find((r) => r.id === roleId);
    if (!t || !role || role.managed || one('confirm') !== 'yes') return back('invalid');
    const raw = body.channels;
    const ids = new Set((Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter((v): v is string => typeof v === 'string' && validId(v)));
    const channels = await loadChannels(true);
    const targets = channels.filter((ch) => ids.has(ch.id) && templateFits(t, ch));
    if (!targets.length) return back('apply_none', roleId);
    const changes = templateChanges(t);
    const reason = `権限テンプレート「${t.name}」（管理画面）`;
    let changed = 0;
    try {
      for (const ch of targets) {
        const plan = planCells(ch, roleId, changes);
        if (!plan) continue;
        if ('set' in plan) await deps.discord.setChannelOverwrite(ch.id, plan.set, reason);
        else if (deps.discord.deleteChannelOverwrite) await deps.discord.deleteChannelOverwrite(ch.id, plan.del, reason);
        else await deps.discord.setChannelOverwrite(ch.id, { id: plan.del, type: 0, allow: '0', deny: '0' }, reason);
        changed++;
      }
    } catch (err) {
      logger.warn({ err }, 'perm template apply failed');
      await audit(db, { actorId: c.get('session').userId, action: 'channel.perm_apply', detail: { template: t.name, roleId, role: role.name, changed, failed: true }, via: 'web' });
      await loadChannels(true);
      return back('apply_failed', roleId);
    }
    await loadChannels(true);
    await audit(db, { actorId: c.get('session').userId, action: 'channel.perm_apply', detail: { template: t.name, roleId, role: role.name, channels: targets.map((x) => x.name), changed }, via: 'web' });
    return back(changed ? 'applied' : 'apply_unchanged', roleId);
  });

  app.get('/channels/new', async (c) => {
    const [channels, roles] = await Promise.all([loadChannels(true), loadRoles()]);
    const categories = channels.filter((ch) => ch.type === 4).sort((a, b) => a.position - b.position);
    // プライベートで選べるロール（@everyone・BOT などの自動のロールはのぞく）
    const pickable = (roles ?? []).filter((r) => r.id !== cfg.guildId && !r.managed);
    return c.html(<ChannelNewPage session={c.get('session')} categories={categories} roles={pickable} parentId={c.req.query('parent')} flash={c.req.query('msg')} />);
  });

  app.get('/channels/:id', async (c) => {
    const id = c.req.param('id');
    const channels = /^\d{17,20}$/.test(id) ? await loadChannels(true) : [];
    const ch = channels.find((x) => x.id === id);
    if (!ch) return c.html(<NotFoundPage session={c.get('session')} />, 404);
    const parent = ch.parent_id ? (channels.find((x) => x.id === ch.parent_id) ?? null) : null;
    const group = (x: GuildChannel) => (x.type === 4 ? 'cat' : isVoiceChannel(x) ? 'voice' : 'text');
    const siblings = channels.filter((x) => group(x) === group(ch) && (ch.type === 4 || (x.parent_id ?? null) === (ch.parent_id ?? null))).sort((a, b) => a.position - b.position);
    const children = ch.type === 4 ? listTextChannels(channels).find((g) => g.category?.id === ch.id) : undefined;
    const roles = (await loadRoles()) ?? [];
    const memberIds = (ch.permission_overwrites ?? []).filter((o) => o.type === 1).map((o) => o.id);
    const perm: ChannelPermView = {
      keys: permKeysFor(ch),
      rows: overwriteRows(ch, roles, await namesOf(db, memberIds), cfg.guildId, deps.botId),
      viewers: whoCanView(ch, roles, cfg.guildId),
      synced: parent ? sameOverwrites(ch.permission_overwrites, parent.permission_overwrites) : null,
      syncedChildren: ch.type === 4 ? channels.filter((x) => x.parent_id === ch.id && sameOverwrites(x.permission_overwrites, ch.permission_overwrites)).length : 0,
      roles: roles
        .filter((r) => r.id !== cfg.guildId && !r.managed && !(ch.permission_overwrites ?? []).some((o) => o.id === r.id))
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name })),
    };
    return c.html(
      <ChannelEditPage
        session={c.get('session')}
        perm={perm}
        guildId={cfg.guildId}
        info={channelInfo(ch, channels)}
        parent={parent}
        categories={channels.filter((x) => x.type === 4).sort((a, b) => a.position - b.position)}
        children={children ? [...children.items, ...children.voice].map((x) => channelInfo(x, channels)) : []}
        place={{ index: siblings.findIndex((x) => x.id === ch.id) + 1, count: siblings.length }}
        flash={c.req.query('msg')}
      />,
    );
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
    // カテゴリには「カテゴリと同じ」がないので、参拝者以上にする
    const visibility = type === 4 && one('visibility') === 'category' ? 'members' : one('visibility');
    const roleIds = (body.roles === undefined ? [] : Array.isArray(body.roles) ? body.roles : [body.roles]).filter((v): v is string => typeof v === 'string' && /^\d{17,20}$/.test(v));
    const topicRaw = one('topic');
    const topic = typeof topicRaw === 'string' ? topicRaw.trim().slice(0, 1024) : '';
    if (type === undefined || !name || !isChannelVisibility(visibility)) return c.redirect('/channels/new?msg=create_invalid');
    const channels = await loadChannels(true);
    const parentId = type === 4 ? '' : String(one('parent') ?? '');
    const parent = parentId ? channels.find((ch) => ch.id === parentId && ch.type === 4) : undefined;
    if ((parentId && !parent) || (visibility === 'category' && !parent) || (visibility === 'private' && !roleIds.length)) {
      return c.redirect('/channels/new?msg=create_invalid');
    }
    const permission_overwrites = overwritesFor(cfg, { visibility, roleIds, readOnly: type === 0 && one('readOnly') === 'yes', botId: deps.botId, parent });
    const limitRaw = one('userLimit');
    const user_limit = type === 2 && typeof limitRaw === 'string' && limitRaw !== '' ? userLimitOf(limitRaw) : 0;
    if (user_limit === undefined) return c.redirect('/channels/new?msg=create_invalid');
    let created: GuildChannel;
    try {
      created = await deps.discord.createChannel(
        cfg.guildId,
        { name, type, ...(parent ? { parent_id: parent.id } : {}), ...(type === 0 && topic ? { topic } : {}), ...(user_limit ? { user_limit } : {}), permission_overwrites },
        '管理画面（チャンネルを作る）',
      );
    } catch (err) {
      logger.warn({ err }, 'channel create failed');
      return c.redirect('/channels/new?msg=failed');
    }
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'channel.create',
      detail: { channelId: created.id, name, kind, visibility, ...(visibility === 'private' ? { roleIds } : {}), ...(parent ? { parent: parent.name } : {}) },
      via: 'web',
    });
    return c.redirect(`/channels/${created.id}?msg=created`);
  });

  /** 並べ替え（▲▼）・ほかのカテゴリへ移す */
  app.post('/channels/:id/move', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/channels');
    const body = await c.req.parseBody();
    const channels = await loadChannels(true);
    const channel = channels.find((ch) => ch.id === id);
    if (!channel) return c.redirect('/channels');
    // 一覧の ▲▼ からなら一覧へ、編集ページからなら編集ページへ戻る
    const fromList = body.from === 'list';
    const backTo = (msg: string) => c.redirect(fromList ? `/channels?msg=${msg}#${channel.type === 4 ? 'cat' : 'ch'}-${id}` : `/channels/${id}?msg=${msg}`);
    let plan: ChannelPositionPlan = [];
    let to: string | undefined;
    if (body.dir === 'up' || body.dir === 'down') {
      plan = planMoveChannel(channels, id, body.dir);
    } else if (typeof body.parent === 'string') {
      const parentId = body.parent === 'none' ? null : body.parent;
      plan = planParentChannel(channels, id, parentId, body.sync === 'yes');
      to = parentId ? (channels.find((ch) => ch.id === parentId)?.name ?? parentId) : 'カテゴリなし';
    }
    if (!plan.length) return backTo('unchanged');
    try {
      await deps.discord.reorderChannels(cfg.guildId, plan, '管理画面（チャンネルの並び）');
    } catch (err) {
      logger.warn({ err }, 'channel reorder failed');
      return backTo('failed');
    }
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'channel.move',
      detail: { channelId: id, name: channel.name, ...(to ? { to, sync: body.sync === 'yes' } : { dir: body.dir }) },
      via: 'web',
    });
    return backTo('moved');
  });

  /** 🔐 見られる人・ロール（ロール・人ごとの上書き）を変える。カテゴリなら、同期している中のチャンネルにも */
  app.post('/channels/:id/perms', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/channels');
    const body = await c.req.parseBody();
    const channels = await loadChannels(true);
    const channel = channels.find((ch) => ch.id === id);
    if (!channel) return c.redirect('/channels');
    const back = (msg: string) => c.redirect(`/channels/${id}?msg=${msg}`);
    const keys = permKeysFor(channel);
    const roles = (await loadRoles()) ?? [];
    const locked = (oid: string, type: 0 | 1) => (type === 1 && oid === deps.botId) || roles.some((r) => r.id === oid && r.managed);
    const trisFrom = (prefix: string) => Object.fromEntries(keys.map((k) => [k, body[`${prefix}.${k}`]]).filter(([, v]) => isTri(v))) as WantedOverwrite['tris'];
    const wanted: WantedOverwrite[] = [];
    const n = Math.min(Number(body.rows) || 0, 200);
    for (let i = 0; i < n; i++) {
      const oid = typeof body[`ow.${i}.id`] === 'string' ? (body[`ow.${i}.id`] as string) : '';
      const type = body[`ow.${i}.type`] === '1' ? 1 : 0;
      if (!/^\d{17,20}$/.test(oid) || locked(oid, type) || !(channel.permission_overwrites ?? []).some((o) => o.id === oid)) continue;
      wanted.push({ id: oid, type, tris: trisFrom(`ow.${i}`), remove: body[`ow.${i}.remove`] === 'yes' });
    }
    // 足す: ロールか人
    const newRole = typeof body['new.role'] === 'string' ? body['new.role'] : '';
    if (newRole && roles.some((r) => r.id === newRole && !r.managed)) wanted.push({ id: newRole, type: 0, tris: trisFrom('new') });
    const newMember = field(body, 'new.member', 100);
    if (newMember) {
      const found = await findMemberByNameOrId(db, newMember);
      if (!found || found === 'ambiguous') return back('perms_member_not_found');
      if (found.id !== deps.botId) wanted.push({ id: found.id, type: 1, tris: trisFrom('new') });
    }
    const before = channel.permission_overwrites ?? [];
    const plan = planOverwrites(before, wanted, keys);
    if (!plan.set.length && !plan.del.length) return back('unchanged');
    // カテゴリ: 同期している中のチャンネルにも同じ変更（Discord は API で変えたカテゴリを中へ広げないため）
    const targets = [channel, ...(channel.type === 4 && body.children === 'yes' ? channels.filter((x) => x.parent_id === id && sameOverwrites(x.permission_overwrites, before)) : [])];
    const reason = '見られる人・ロールを変えた（管理画面）';
    try {
      for (const t of targets) {
        const p = t.id === id ? plan : planOverwrites(t.permission_overwrites ?? [], wanted, permKeysFor(t).filter((k) => keys.includes(k)));
        for (const o of p.set) await deps.discord.setChannelOverwrite(t.id, o, reason);
        for (const oid of p.del) {
          if (deps.discord.deleteChannelOverwrite) await deps.discord.deleteChannelOverwrite(t.id, oid, reason);
          else await deps.discord.setChannelOverwrite(t.id, { id: oid, type: (t.permission_overwrites ?? []).find((o) => o.id === oid)?.type ?? 0, allow: '0', deny: '0' }, reason);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'channel perms update failed');
      return back('failed');
    }
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'channel.perms',
      detail: { channelId: id, name: channel.name, set: plan.set, removed: plan.del, children: targets.length - 1 },
      via: 'web',
    });
    return back('perms_saved');
  });

  /** チャンネル・カテゴリを消す（名前を入力して確認。BOT が使っているもの・中身のあるカテゴリは消さない） */
  app.post('/channels/:id/delete', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/channels');
    const body = await c.req.parseBody();
    const channels = await loadChannels(true);
    const channel = channels.find((ch) => ch.id === id);
    if (!channel) return c.redirect('/channels');
    const back = (msg: string) => c.redirect(`/channels/${id}?msg=${msg}`);
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
    if (topic === undefined || topic.length > 1024 || !mode || (body.name !== undefined && !name)) return c.redirect(`/channels/${id}?msg=invalid`);
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
      return c.redirect(`/channels/${id}?msg=failed`);
    }
    if (!changes.length) return c.redirect(`/channels/${id}?msg=unchanged`);
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
    return c.redirect(`/channels/${id}?msg=saved`);
  });

  /** カテゴリ・通話の名前だけ変える */
  app.post('/channels/:id/name', async (c) => {
    const id = c.req.param('id');
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/channels');
    const body = await c.req.parseBody();
    const name = cleanChannelName(body.name);
    if (!name) return c.redirect(`/channels/${id}?msg=invalid`);
    const channel = (await loadChannels(true)).find((ch) => ch.id === id);
    if (!channel) return c.redirect('/channels');
    const patch: { name?: string; nsfw?: boolean; user_limit?: number } = {};
    if (channel.name !== name) patch.name = name;
    // 通話の年齢制限（カテゴリには付けられない）
    if (body.ageGateField === '1' && channel.type !== 4 && (body.nsfw === 'yes') !== Boolean(channel.nsfw)) patch.nsfw = body.nsfw === 'yes';
    // 通話の人数の上限（0 = なし。Discord は 99 まで）
    if (typeof body.userLimit === 'string' && channel.type === 2) {
      const limit = userLimitOf(body.userLimit);
      if (limit === undefined) return c.redirect(`/channels/${id}?msg=invalid`);
      if (limit !== (channel.user_limit ?? 0)) patch.user_limit = limit;
    }
    if (!Object.keys(patch).length) return c.redirect(`/channels/${id}?msg=unchanged`);
    try {
      await deps.discord.editChannel(id, patch);
    } catch (err) {
      logger.warn({ err }, 'channel rename failed');
      return c.redirect(`/channels/${id}?msg=failed`);
    }
    await audit(db, {
      actorId: c.get('session').userId,
      action: 'channel.update',
      detail: { channelId: id, name: channel.name, newName: patch.name, nsfw: patch.nsfw, userLimit: patch.user_limit },
      via: 'web',
    });
    return c.redirect(`/channels/${id}?msg=saved`);
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
    return c.html(<RolesPage session={c.get('session')} rows={rows} flash={c.req.query('msg')} loadFailed={!roles} templates={await allRoleTemplates(db)} />);
  });

  app.get('/roles/:id', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 50);
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
        q={q}
        candidates={q && !isEveryone ? await searchMembersWithoutRole(db, role.id, q) : []}
        danger={dangerLabels(permsOf(role))}
        templates={await allRoleTemplates(db)}
        flash={c.req.query('msg')}
        n={Number(c.req.query('n')) || 0}
      />,
    );
  });

  /** ロールを人に付ける・外す（まとめて 50 人まで。危ない権限のロールは確認のチェックが要る） */
  const roleMembers = async (c: Context<Env>, add: boolean) => {
    const id = c.req.param('id') ?? '';
    if (!/^\d{17,20}$/.test(id)) return c.redirect('/roles');
    const back = (msg: string, n = 0) => c.redirect(`/roles/${id}?msg=${msg}${n ? `&n=${n}` : ''}#role-members`);
    const roles = await loadRoles();
    const role = roles?.find((r) => r.id === id);
    if (!roles || !role || id === cfg.guildId) return c.redirect('/roles');
    if (roleLocked(role, roles)) return back('locked');
    const body = await c.req.parseBody({ all: true });
    const raw = body.member === undefined ? [] : Array.isArray(body.member) ? body.member : [body.member];
    const ids = [...new Set(raw.filter((v): v is string => typeof v === 'string' && /^\d{17,20}$/.test(v)))];
    if (!ids.length) return back('pick_members');
    if (ids.length > 50) return back('too_many_members');
    if (add && dangerLabels(permsOf(role)).length && body.confirmDanger !== 'yes') return back('need_confirm_danger');
    const names = await namesOf(db, ids);
    const done: string[] = [];
    for (const memberId of ids) {
      try {
        if (add) await deps.discord.addRole(cfg.guildId, memberId, id, '管理画面（ロール）');
        else await deps.discord.removeRole(cfg.guildId, memberId, id, '管理画面（ロール）');
        await setMemberRole(db, memberId, id, add);
        done.push(memberId);
      } catch (err) {
        logger.warn({ err, memberId, roleId: id }, 'role member change failed');
      }
    }
    if (done.length) {
      await audit(db, {
        actorId: c.get('session').userId,
        action: add ? 'role.member_add' : 'role.member_remove',
        detail: { roleId: id, name: role.name, members: done.map((m) => ({ id: m, name: names.get(m) ?? m })) },
        via: 'web',
      });
    }
    if (!done.length) return back('failed');
    if (done.length < ids.length) return back('members_failed_some', done.length);
    return back(add ? 'members_added' : 'members_removed', done.length);
  };
  app.post('/roles/:id/members/add', (c) => roleMembers(c, true));
  app.post('/roles/:id/members/remove', (c) => roleMembers(c, false));

  /** ロールを作る（いちばん下にできる。権限はなしで作って、あとからロールのページで付ける） */
  // 📋 権限のテンプレート: 今のロールの権限から作る（同じ名前なら上書き）・消す
  app.post('/roles/templates', async (c) => {
    const body = await c.req.parseBody();
    const roleId = typeof body.roleId === 'string' && /^\d{17,20}$/.test(body.roleId) ? body.roleId : '';
    const back = (msg: string) => c.redirect(roleId ? `/roles/${roleId}?msg=${msg}#role-template` : `/roles?msg=${msg}#role-templates`);
    const role = roleId ? (await loadRoles())?.find((r) => r.id === roleId) : undefined;
    if (!role) return back('template_invalid');
    const r = await saveRoleTemplate(db, typeof body.name === 'string' ? body.name : '', permsOf(role), c.get('session').userId);
    if (r !== 'ok') return back(`template_${r}`);
    await audit(db, { actorId: c.get('session').userId, action: 'role.template_save', detail: { name: body.name, from: role.name }, via: 'web' });
    return back('template_saved');
  });
  app.post('/roles/templates/:id/delete', async (c) => {
    const id = Number(c.req.param('id'));
    if (Number.isSafeInteger(id) && (await deleteRoleTemplate(db, id))) {
      await audit(db, { actorId: c.get('session').userId, action: 'role.template_delete', detail: { id }, via: 'web' });
      return c.redirect('/roles?msg=template_deleted#role-templates');
    }
    return c.redirect('/roles#role-templates');
  });

  app.post('/roles/new', async (c) => {
    const body = await c.req.parseBody();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const colorRaw = typeof body.color === 'string' ? body.color : '';
    if (!name || name.length > 100 || (body.noColor !== 'yes' && !/^#[0-9a-f]{6}$/i.test(colorRaw))) return c.redirect('/roles?msg=invalid#new-role');
    // テンプレートを選んでいれば、その権限で作る（管理者入りは作るときには付けない）
    const tpl = typeof body.template === 'string' && body.template ? await findRoleTemplate(db, body.template) : undefined;
    if (tpl && (tpl.bits & ADMINISTRATOR) !== 0n) return c.redirect('/roles?msg=template_admin#new-role');
    const patch: RolePatch = {
      name,
      color: body.noColor === 'yes' ? 0 : parseInt(colorRaw.slice(1), 16),
      hoist: body.hoist === 'yes',
      mentionable: body.mentionable === 'yes',
      permissions: (tpl?.bits ?? 0n).toString(),
    };
    let role: GuildRole;
    try {
      role = await deps.discord.createRole(cfg.guildId, patch, '管理画面（ロールを作る）');
    } catch (err) {
      logger.warn({ err }, 'role create failed');
      return c.redirect('/roles?msg=failed#new-role');
    }
    await audit(db, { actorId: c.get('session').userId, action: 'role.create', detail: { roleId: role.id, name, ...(tpl ? { template: tpl.name } : {}) }, via: 'web' });
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

  // ───────── 役職（宮司のみ）: 名前・絵文字・ロール・格・昇格ライン・足す・消す ─────────

  app.use('/ranks', async (c, next) => (gujiOnly(c) ? next() : c.html(<NotFoundPage session={c.get('session')} />, 403)));
  app.use('/ranks/*', async (c, next) => (gujiOnly(c) ? next() : c.html(<NotFoundPage session={c.get('session')} />, 403)));

  /** 役職に選べるロール（@everyone・BOT などの自動のロールは除く） */
  const rankRoles = async () => (await loadRoles())?.filter((r) => r.id !== cfg.guildId && !r.managed);

  app.get('/ranks', async (c) => {
    const [roles, { counts }, reset] = await Promise.all([rankRoles(), roleMemberCounts(db), resetState(db)]);
    // 役職の付け替えが途中なら続ける（再起動したあとなど）
    if (reset && !reset.finishedAt) kickReset();
    return c.html(<RanksPage session={c.get('session')} cfg={cfg} fileCfg={fileCfg()} roles={roles} counts={counts} flash={c.req.query('msg')} reset={reset} />);
  });

  /** 🔄 評価のリセット（一度だけ・宮司）。役職の付け替えは裏で少しずつ */
  let resetRunning = false;
  const kickReset = () => {
    if (resetRunning) return;
    resetRunning = true;
    void (async () => {
      try {
        for (let i = 0; i < 100_000; i++) {
          if (await runDemotions(db, cfg, deps.discord, 10, now())) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        logger.warn({ err }, 'evaluation reset runner stopped');
      } finally {
        resetRunning = false;
      }
    })();
  };
  app.post('/ranks/reset', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const body = await c.req.parseBody();
    if (body.confirm !== 'リセット') return c.redirect('/ranks?msg=reset_confirm#reset');
    const r = await startEvaluationReset(db, cfg, c.get('session').userId, now());
    if (r.status === 'already') return c.redirect('/ranks?msg=reset_already#reset');
    kickReset();
    return c.redirect('/ranks?msg=reset_started#reset');
  });
  app.post('/ranks/reset/undo', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    await undoShuinReset(db, c.get('session').userId, now());
    return c.redirect('/ranks?msg=reset_undone#reset');
  });

  /** 役職の上書きを保存して、BOT・掲示に反映する */
  const saveRanks = async (c: Context<Env>, next: Overrides, action: string): Promise<string | undefined> => {
    let overrides: Overrides;
    try {
      overrides = overridesSchema.parse(next);
      applyOverrides(fileCfg(), overrides);
    } catch {
      return undefined;
    }
    const before = cfg;
    await saveOverrides(db, overrides, c.get('session').userId);
    await deps.onSettingsSaved?.();
    const after = applyOverrides(fileCfg(), overrides);
    const noticesUpdated = await syncPostedNotices({ db, cfg: after, discord: deps.discord }, before);
    await audit(db, { actorId: c.get('session').userId, action, detail: { ranks: rankDiff(before, after) }, via: 'web' });
    return noticesUpdated > 0 ? 'saved_notices' : 'saved';
  };

  app.post('/ranks', async (c) => {
    const body = await c.req.parseBody();
    const prev = await loadOverrides(db);
    const roles = await rankRoles();
    const num = (k: string) => Number(typeof body[k] === 'string' ? body[k] : NaN);
    const roleOf = (k: string, current: string) => {
      const v = body[k];
      if (typeof v !== 'string' || !v) return current;
      // 読めないときは変えない。選べないロールは NaN 扱い（保存しない）
      if (!roles) return current;
      return roles.some((r) => r.id === v) ? v : 'invalid';
    };
    const file = fileCfg();
    const fileFirstAuto = firstAutoKeyOf(file.ranks);
    const ranks: Overrides['ranks'] = {};
    const extraRanks: Overrides['extraRanks'] = [];
    for (const r of cfg.ranks) {
      const k = `rank.${r.key}`;
      // 通話の銭の倍率（%）。フォームになければ今のまま
      const voicePercent = typeof body[`${k}.voicePercent`] === 'string' ? num(`${k}.voicePercent`) : r.voicePercent;
      // 1 日の上限の倍率（%）。空なら「通話の銭」と同じ
      const capRaw = body[`${k}.voiceCapPercent`];
      const voiceCapPercent = typeof capRaw === 'string' ? (capRaw.trim() === '' ? undefined : num(`${k}.voiceCapPercent`)) : r.voiceCapPercent;
      const name = field(body, `${k}.name`, 20);
      const emoji = typeof body[`${k}.emoji`] === 'string' ? (body[`${k}.emoji`] as string).trim().slice(0, 16) : r.emoji;
      const fr = file.ranks.find((x) => x.key === r.key);
      if (fr) {
        const roleId = ADMIN_RANK_KEYS.includes(r.key) ? fr.roleId : roleOf(`${k}.roleId`, r.roleId);
        // なり方（宮司・神職と、入鯖時に付く役職は変えない）
        const fixed = ADMIN_RANK_KEYS.includes(r.key) || r.key === fileFirstAuto;
        const auto = fixed || body[`${k}.kind`] === undefined ? r.auto : body[`${k}.kind`] !== 'appointed';
        ranks[r.key] = {
          weight: num(`${k}.weight`),
          ...(auto ? { requiredGoen: num(`${k}.requiredGoen`) } : {}),
          ...(auto !== fr.auto ? { auto } : {}),
          // ファイルと同じなら持たない（ファイルを直したときにそちらが効くように）
          ...(name !== fr.name ? { name, formerNames: [...new Set([...(prev.ranks[r.key]?.formerNames ?? []), ...(name !== r.name ? [r.name] : [])])].slice(-20) } : {}),
          ...(emoji !== fr.emoji ? { emoji } : {}),
          ...(roleId !== fr.roleId ? { roleId } : {}),
          ...(voicePercent !== fr.voicePercent ? { voicePercent } : {}),
          ...(voiceCapPercent !== fr.voiceCapPercent ? { voiceCapPercent: voiceCapPercent ?? null } : {}),
        };
      } else {
        const auto = body[`${k}.kind`] !== 'appointed';
        extraRanks.push({
          key: r.key,
          name,
          emoji,
          roleId: roleOf(`${k}.roleId`, r.roleId),
          weight: num(`${k}.weight`),
          auto,
          requiredGoen: auto ? num(`${k}.requiredGoen`) : 0,
          voicePercent,
          ...(voiceCapPercent !== undefined ? { voiceCapPercent } : {}),
          formerNames: name && name !== r.name ? [...new Set([...(r.formerNames ?? []), r.name])].slice(-20) : r.formerNames,
        });
      }
    }
    const msg = await saveRanks(c, { ...prev, ranks, extraRanks }, 'ranks.update');
    return c.redirect(`/ranks?msg=${msg ?? 'invalid'}`);
  });

  app.post('/ranks/new', async (c) => {
    const body = await c.req.parseBody();
    const roles = await rankRoles();
    if (!roles) return c.redirect('/ranks?msg=no_roles');
    const roleId = typeof body.roleId === 'string' && roles.some((r) => r.id === body.roleId) ? body.roleId : '';
    const auto = body.kind !== 'appointed';
    const prev = await loadOverrides(db);
    const rank = {
      key: `r${Date.now().toString(36)}`,
      name: field(body, 'name', 20),
      emoji: typeof body.emoji === 'string' ? body.emoji.trim().slice(0, 16) : '',
      roleId,
      weight: Number(body.weight),
      auto,
      requiredGoen: auto ? Number(body.requiredGoen) : 0,
      voicePercent: typeof body.voicePercent === 'string' && body.voicePercent !== '' ? Number(body.voicePercent) : 100,
    };
    const msg = await saveRanks(c, { ...prev, extraRanks: [...prev.extraRanks, rank] }, 'ranks.create');
    return c.redirect(msg ? '/ranks?msg=added' : '/ranks?msg=invalid#rank-add');
  });

  app.post('/ranks/:key/delete', async (c) => {
    const key = c.req.param('key');
    const prev = await loadOverrides(db);
    if (!prev.extraRanks.some((r) => r.key === key)) return c.redirect('/ranks?msg=locked');
    const msg = await saveRanks(c, { ...prev, extraRanks: prev.extraRanks.filter((r) => r.key !== key) }, 'ranks.delete');
    return c.redirect(`/ranks?msg=${msg ? 'deleted' : 'invalid'}`);
  });

  // ───────── 市場（神職・宮司）: 問題ありの取引・出品の取り下げ ─────────

  // ───────── 面談告知 ─────────

  // ───────── 面談告知 ─────────

  const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];
  /** 日本時間の YYYY-MM-DD */
  const jstDay = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  /** 今日から 7 日分の日にちのボタン */
  const dayChips = (t: Date): DayChip[] =>
    Array.from({ length: 7 }, (_, n) => {
      const d = new Date(t.getTime() + n * 86_400_000);
      const day = jstDay(d);
      const j = new Date(`${day}T00:00:00Z`);
      const md = `${j.getUTCMonth() + 1}/${j.getUTCDate()}（${WEEKDAY[j.getUTCDay()]}）`;
      return { value: day, label: ['今日', '明日', '明後日'][n] ?? md, sub: n < 3 ? md : '' };
    });
  const voiceOptions = (channels: GuildChannel[]) => {
    const cat = (id: string | null) => channels.find((ch) => ch.id === id)?.name;
    return channels
      .filter((ch) => ch.type === 2 || ch.type === 13)
      .sort((a, b) => a.position - b.position)
      .map((ch) => ({ id: ch.id, name: ch.name, ...(cat(ch.parent_id) ? { category: cat(ch.parent_id)! } : {}) }));
  };

  type InterviewForm = {
    at?: Date;
    postAt?: Date;
    placeChannelId?: string;
    placeText: string;
    note: string;
    templateIndex: number;
    remind60: boolean;
    remind10: boolean;
    error?: 'invalid' | 'past' | 'post_after';
  };
  /** 告知のフォームを読む（日にち・時刻のボタン、ほかの日・時刻、流すタイミング） */
  const readInterviewForm = (body: Record<string, unknown>, st: InterviewSettings, t: Date): InterviewForm => {
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(str('dayOther')) ? str('dayOther') : str('day');
    const time = /^\d{2}:\d{2}$/.test(str('timeOther')) ? str('timeOther') : str('time');
    const at = /^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{2}:\d{2}$/.test(time) ? parseJstLocal(`${day}T${time}`) : undefined;
    const placeChannelId = validId(str('placeChannelId')) ? str('placeChannelId') : undefined;
    const idx = Number(str('template') || '0');
    const base: InterviewForm = {
      placeChannelId,
      placeText: placeChannelId ? '' : str('placeText').slice(0, 100),
      note: str('note').slice(0, 500),
      templateIndex: Number.isInteger(idx) && idx >= 0 && idx < st.templates.length ? idx : 0,
      remind60: body.remind60 === 'yes',
      remind10: body.remind10 === 'yes',
    };
    if (!at) return { ...base, error: 'invalid' };
    if (at.getTime() <= t.getTime()) return { ...base, at, error: 'past' };
    const w = str('when');
    let postAt = t;
    if (w === 'morning') postAt = parseJstLocal(`${day}T10:00`)!;
    else if (w === 'eve') postAt = new Date(parseJstLocal(`${day}T21:00`)!.getTime() - 86_400_000);
    else if (w === 'before2h') postAt = new Date(at.getTime() - 2 * 3_600_000);
    else if (w === 'custom') postAt = parseJstLocal(str('postAtOther')) ?? t;
    // もう過ぎた時刻なら、すぐ流す
    if (postAt.getTime() < t.getTime()) postAt = t;
    if (postAt.getTime() >= at.getTime()) return { ...base, at, error: 'post_after' };
    return { ...base, at, postAt };
  };

  const mentionLabelOf = (st: InterviewSettings, roleName: (id: string) => string | undefined) =>
    st.mention === 'here'
      ? '@here'
      : st.mention === 'everyone'
        ? '@everyone'
        : st.mention === 'ranks'
          ? '@すべての役職'
          : st.mention === 'role' && st.roleId
            ? `@${roleName(st.roleId) ?? 'ロール'}`
            : '';

  const interviewPreview = (st: InterviewSettings, form: InterviewForm, channels: GuildChannel[], roleName: (id: string) => string | undefined, t: Date) => {
    if (form.error) return { text: '', mention: '', postLabel: '', reminders: [], error: INTERVIEW_ERRORS[form.error] };
    const tpl = st.templates[form.templateIndex] ?? st.templates[0]!;
    const place = placeOf({ placeChannelId: form.placeChannelId ?? null, placeText: form.placeText }, (id) => channels.find((ch) => ch.id === id)?.name);
    const text = renderInterview(tpl.body, { at: form.at!, place, note: form.note });
    const p = jstParts(form.postAt!);
    const postLabel = form.postAt!.getTime() <= t.getTime() + 60_000 ? 'すぐに流します' : `${p.date} ${p.time} に流します（予約）`;
    return { text, mention: mentionLabelOf(st, roleName), postLabel, reminders: [...(form.remind60 ? ['1 時間前'] : []), ...(form.remind10 ? ['10 分前'] : [])] };
  };
  const INTERVIEW_ERRORS = { invalid: '日にちと時刻を選んでください。', past: 'その日時はもう過ぎています。', post_after: '告知を流す日時は、面談より前にしてください。' } as const;

  app.get('/interview', async (c) => {
    const t = now();
    const [st, channels, guildRoles, list] = await Promise.all([loadInterview(db), loadChannels(), loadRoles(), listInterviews(db, 60)]);
    const catName = (id: string | null) => channels.find((ch) => ch.id === id)?.name;
    const textChannels = listTextChannels(channels).flatMap((g) => g.items);
    const roles = (guildRoles ?? []).filter((r) => r.id !== cfg.guildId && !r.managed);
    const days = dayChips(t);
    const defaultTime = st.lastTime ?? '21:00';
    // 今日のその時刻が過ぎていたら、明日を選んでおく
    const defaultDay = parseJstLocal(`${days[0]!.value}T${defaultTime}`)!.getTime() > t.getTime() ? days[0]!.value : days[1]!.value;
    const form = readInterviewForm({ day: defaultDay, time: defaultTime, remind60: 'yes', remind10: 'yes', placeChannelId: st.lastPlaceChannelId ?? '' }, st, t);
    const upcoming = list.filter((i) => i.at.getTime() > t.getTime() - 3_600_000).reverse();
    const past = list.filter((i) => i.at.getTime() <= t.getTime() - 3_600_000);
    return c.html(
      <InterviewPage
        session={c.get('session')}
        settings={st}
        channelName={interviewChannelOf(st, channels)?.name}
        textChannels={textChannels.map((ch) => ({ id: ch.id, name: ch.name, ...(catName(ch.parent_id) ? { category: catName(ch.parent_id)! } : {}) }))}
        voiceChannels={voiceOptions(channels)}
        roles={roles.map((r) => ({ id: r.id, name: r.name }))}
        days={days}
        defaultDay={defaultDay}
        defaultTime={defaultTime}
        preview={interviewPreview(st, form, channels, (id) => roles.find((r) => r.id === id)?.name, t)}
        upcoming={upcoming}
        past={past}
        channelNameOf={(id) => channels.find((ch) => ch.id === id)?.name}
        now={t}
        flash={c.req.query('msg')}
      />,
    );
  });

  app.post('/interview/preview', async (c) => {
    const t = now();
    const [body, st, channels, guildRoles] = await Promise.all([c.req.parseBody(), loadInterview(db), loadChannels(), loadRoles()]);
    const form = readInterviewForm(body, st, t);
    return c.html(<InterviewPreview {...interviewPreview(st, form, channels, (id) => guildRoles?.find((r) => r.id === id)?.name, t)} />);
  });

  app.post('/interview/post', async (c) => {
    const t = now();
    const body = await c.req.parseBody();
    const st = await loadInterview(db);
    const form = readInterviewForm(body, st, t);
    if (form.error) return c.redirect(`/interview?msg=${form.error}`);
    const channel = interviewChannelOf(st, await loadChannels(true));
    if (!channel) return c.redirect('/interview?msg=no_channel');
    const by = c.get('session').userId;
    const i = await createInterview(
      db,
      {
        at: form.at!,
        ...(form.placeChannelId ? { placeChannelId: form.placeChannelId } : {}),
        placeText: form.placeText,
        note: form.note,
        template: st.templates[form.templateIndex]!,
        channelId: channel.id,
        postAt: form.postAt!,
        remind60: form.remind60,
        remind10: form.remind10,
      },
      by,
    );
    // 次に開いたときのために、時刻と場所を覚える
    const p = jstParts(form.at!);
    await saveInterview(db, { ...st, lastTime: p.time, ...(form.placeChannelId ? { lastPlaceChannelId: form.placeChannelId } : {}) }, by);
    await audit(db, { actorId: by, action: 'interview.create', detail: { id: i.id, at: form.at!.toISOString(), label: `${p.date} ${p.time}`, postAt: form.postAt!.toISOString() }, via: 'web' });
    if (form.postAt!.getTime() > t.getTime()) return c.redirect('/interview?msg=scheduled#iv-upcoming');
    try {
      await postInterview({ db, discord: deps.discord, rankRoleIds: pingRoleIds(cfg) }, i.id, st, t);
    } catch (err) {
      logger.warn({ err }, 'interview post failed');
      return c.redirect('/interview?msg=failed#iv-upcoming');
    }
    return c.redirect('/interview?msg=posted#iv-upcoming');
  });

  const interviewId = (c: Context<Env>) => {
    const id = Number(c.req.param('id'));
    return Number.isInteger(id) && id > 0 ? id : 0;
  };

  app.post('/interview/:id/post-now', async (c) => {
    const i = await getInterview(db, interviewId(c));
    if (!i || i.status !== 'scheduled') return c.redirect('/interview?msg=not_found#iv-upcoming');
    try {
      await postInterview({ db, discord: deps.discord, rankRoleIds: cfg.ranks.map((r) => r.roleId) }, i.id, await loadInterview(db), now());
    } catch (err) {
      logger.warn({ err }, 'interview post failed');
      return c.redirect('/interview?msg=failed#iv-upcoming');
    }
    return c.redirect('/interview?msg=posted#iv-upcoming');
  });

  app.post('/interview/:id/update', async (c) => {
    const t = now();
    const body = await c.req.parseBody();
    const at = typeof body.at === 'string' ? parseJstLocal(body.at) : undefined;
    const postAt = typeof body.postAt === 'string' ? parseJstLocal(body.postAt) : undefined;
    if (!at) return c.redirect('/interview?msg=invalid#iv-upcoming');
    if (at.getTime() <= t.getTime()) return c.redirect('/interview?msg=past#iv-upcoming');
    if (postAt && postAt.getTime() >= at.getTime()) return c.redirect('/interview?msg=post_after#iv-upcoming');
    const placeChannelId = typeof body.placeChannelId === 'string' && validId(body.placeChannelId) ? body.placeChannelId : undefined;
    try {
      const r = await updateInterview(
        { db, discord: deps.discord },
        interviewId(c),
        {
          at,
          ...(placeChannelId ? { placeChannelId } : {}),
          placeText: placeChannelId ? '' : field(body, 'placeText', 100),
          note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '',
          ...(postAt ? { postAt: postAt.getTime() < t.getTime() ? t : postAt } : {}),
          remind60: body.remind60 === 'yes',
          remind10: body.remind10 === 'yes',
        },
        c.get('session').userId,
        t,
      );
      return c.redirect(`/interview?msg=${r === 'ok' ? 'updated' : 'not_found'}#iv-upcoming`);
    } catch (err) {
      logger.warn({ err }, 'interview update failed');
      return c.redirect('/interview?msg=failed#iv-upcoming');
    }
  });

  app.post('/interview/:id/cancel', async (c) => {
    const body = await c.req.parseBody();
    const r = await cancelInterview({ db, discord: deps.discord }, interviewId(c), field(body, 'reason', 200), c.get('session').userId, now());
    return c.redirect(`/interview?msg=${r === 'ok' ? 'cancelled' : 'not_found'}#iv-upcoming`);
  });

  app.post('/interview/settings', async (c) => {
    const body = await c.req.parseBody();
    const current = await loadInterview(db);
    const channelId = typeof body.channelId === 'string' && validId(body.channelId) ? body.channelId : undefined;
    const roleId = typeof body.roleId === 'string' && validId(body.roleId) ? body.roleId : undefined;
    const templates =
      body.reset === 'yes'
        ? DEFAULT_TEMPLATES
        : Array.from({ length: 11 }, (_, i) => ({ name: field(body, `tplName.${i}`, 30), body: typeof body[`tplBody.${i}`] === 'string' ? (body[`tplBody.${i}`] as string).replace(/\r\n/g, '\n').trim() : '' }))
            .filter((t) => t.name || t.body)
            .map((t, i) => ({ name: t.name || `定型文 ${i + 1}`, body: t.body }));
    const reminderTemplate = body.reset === 'yes' ? DEFAULT_REMINDER_TEMPLATE : typeof body.reminderTemplate === 'string' ? body.reminderTemplate.replace(/\r\n/g, '\n').trim() : '';
    const parsed = interviewSchema.safeParse({
      ...(current.lastTime ? { lastTime: current.lastTime } : {}),
      ...(current.lastPlaceChannelId ? { lastPlaceChannelId: current.lastPlaceChannelId } : {}),
      ...(channelId ? { channelId } : {}),
      ...(roleId ? { roleId } : {}),
      templates,
      reminderTemplate,
      remindMention: body.remindMention === 'yes',
      mention: body.mention,
    });
    if (!parsed.success || (parsed.data.mention === 'role' && !parsed.data.roleId) || templates.some((t) => !t.body)) return c.redirect('/interview?msg=settings_invalid');
    await saveInterview(db, parsed.data, c.get('session').userId);
    await audit(db, { actorId: c.get('session').userId, action: 'interview.settings', detail: { channelId, mention: parsed.data.mention, templates: templates.length }, via: 'web' });
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
          roles: (guildRoles ?? []).filter((r) => giftableRole(cfg, r, guildRoles ?? [], deps.botId)).map((r) => ({ id: r.id, name: r.name })),
          channels: postableChannels(await loadChannels().catch(() => [])),
          recent: await recentGifts(db),
          narrow: await giftNarrowPreview(c.req.query('narrow'), c.req.query('joinedBy')),
          ...(c.req.query('msg') === 'gift_narrowed'
            ? { narrowed: { members: Number(c.req.query('n')) || 0, taken: Number(c.req.query('taken')) || 0, short: Number(c.req.query('short')) || 0 } }
            : {}),
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
    const item = typeof body.item === 'string' && body.item.startsWith('role:') ? parseGiftRole(cfg, body.item, (await loadRoles()) ?? [], deps.botId) : await parseGiftItem(db, body.item);
    const count = Number(body.count);
    const note = field(body, 'note', 200);
    const nonce = typeof body.nonce === 'string' ? body.nonce : '';
    const roleId = typeof body.roleId === 'string' && validId(body.roleId) ? body.roleId : undefined;
    // この日までに入った人だけ（任意）
    const joinedBy = endOfJstDay(body.joinedBy);
    if (typeof body.joinedBy === 'string' && body.joinedBy !== '' && !joinedBy) return to('gift_invalid');
    if (body.confirm !== 'yes' || !item || !validGiftCount(item, count) || !note || !/^[0-9a-f-]{36}$/.test(nonce)) return to('gift_invalid');
    const targets = await giftTargets(db, cfg.ranks.map((x) => x.roleId), roleId, joinedBy);
    if (targets.length === 0) return to('gift_none');
    const by = c.get('session').userId;
    const label = giftItemLabel(item, { name: cfg.economy.currencyName, emoji: cfg.economy.currencyEmoji });
    const r = await giftToAll(db, { item, label, count, note, memberIds: targets, roleId, joinedBy, by, nonce }, now());
    if (r.status === 'duplicate') return to('gift_dup');
    if (r.status !== 'ok') return to('gift_invalid');
    // 授与品・ロール: Discord でロールを付ける（人数が多いと時間がかかるので、待たずに進める）
    if (r.roles.length) void applyGiftRoles(deps.discord, cfg.guildId, r.roles);
    const joinedByDate = joinedBy ? (body.joinedBy as string) : undefined;
    await audit(db, { actorId: by, action: 'gift.all', detail: { gift: r.batch.id, item: r.batch.item, label, count, note, roleId, joinedBy: joinedByDate, recipients: targets.length }, via: 'web' });
    // チャンネルでお知らせ（任意）
    const announce = typeof body.announce === 'string' && validId(body.announce) ? body.announce : undefined;
    if (!announce) return to('gift_given');
    const roleName = roleId ? (await loadRoles())?.find((x) => x.id === roleId)?.name : undefined;
    const pingKind = body.ping === 'everyone' || body.everyone === 'yes' ? 'everyone' : body.ping === 'ranks' ? 'ranks' : '';
    const ping = pingKind !== '';
    const rankIds = pingRoleIds(cfg);
    const pingRoles = roleId ? [roleId] : pingKind === 'ranks' ? rankIds : [];
    const head = !ping ? '' : pingRoles.length ? `${pingRoles.map((id) => `<@&${id}>`).join(' ')}\n` : '@everyone\n';
    const howToUse = item.kind === 'coins' ? '' : item.kind === 'role' ? '\n-# ロールは少しずつ付きます' : item.kind === 'shop' ? '\n-# ロールは少しずつ付きます（もう持っている人には、期間のある品はその分のばします）' : '\n-# `/物御籤` の「🎟 券を使う」から使えます（持っている券は `/残高` で見られます）';
    try {
      await deps.discord.sendMessage(announce, {
        content: `${head}${giftAnnouncement(label, count, note, giftUnit(item), roleName, { role: item.kind === 'role', joinedBy: joinedByDate })}${howToUse}`,
        allowed_mentions: ping ? (pingRoles.length ? { parse: [], roles: pingRoles } : { parse: ['everyone'] }) : { parse: [] },
      });
      return to('gift_announced');
    } catch (err) {
      logger.warn({ err }, 'gift announce failed');
      return to('gift_announce_failed');
    }
  });

  /** 入った日を直す: 取り消す相手を先に見せる（?narrow=<id>&joinedBy=YYYY-MM-DD） */
  async function giftNarrowPreview(rawId: string | undefined, rawDate: string | undefined) {
    const id = Number(rawId);
    if (!rawId || !Number.isSafeInteger(id)) return undefined;
    const batch = await getGift(db, id);
    const joinedBy = endOfJstDay(rawDate);
    if (!batch) return undefined;
    const targets = joinedBy ? await narrowTargets(db, batch, joinedBy, cfg.ranks.map((x) => x.roleId)) : [];
    return { batch, joinedBy: joinedBy ? rawDate! : '', targets };
  }

  /** 🎁 入った日を直して、余分に渡った人から取り消す（宮司だけ） */
  app.post('/gacha/gift/:id/narrow', async (c) => {
    if (!gujiOnly(c)) return c.text('宮司のみできる操作です。', 403);
    const id = Number(c.req.param('id'));
    const body = await c.req.parseBody();
    const joinedBy = endOfJstDay(body.joinedBy);
    if (!Number.isSafeInteger(id) || !joinedBy || body.confirm !== 'yes') return c.redirect(`/gacha?msg=gift_narrow_invalid#gacha-gift`);
    const by = c.get('session').userId;
    const r = await narrowGift(db, id, joinedBy, cfg.ranks.map((x) => x.roleId), by, now());
    if (r.status !== 'ok') return c.redirect(`/gacha?msg=${r.status === 'none' ? 'gift_narrow_none' : 'gift_narrow_invalid'}#gacha-gift`);
    // ロールは Discord で外す（人数が多いと時間がかかるので、待たずに進める）
    if (r.roles.length) void applyNarrowRoles(deps.discord, cfg.guildId, r.roles);
    await audit(db, { actorId: by, action: 'gift.narrow', detail: { gift: id, joinedBy: body.joinedBy, members: r.members, taken: r.taken, short: r.short, roles: r.roles.length }, via: 'web' });
    return c.redirect(`/gacha?msg=gift_narrowed&n=${r.members}&taken=${r.taken}&short=${r.short}#gacha-gift`);
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
    const [orders, listings, requests] = await Promise.all([recentOrders(db), recentListings(db), recentRequests(db)]);
    const names = await namesOf(db, [...orders.flatMap((o) => [o.buyerId, o.sellerId]), ...listings.map((l) => l.sellerId), ...requests.map((r) => r.requesterId)]);
    return c.html(
      <MarketPage session={c.get('session')} orders={orders} listings={listings} requests={requests} names={names} feePercent={cfg.market.feePercent} flash={c.req.query('msg')} />,
    );
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

  // ───────── 📌 掲示板 ─────────

  app.get('/board', async (c) => {
    const [place, posts, channels] = await Promise.all([loadBoardPlace(db), recentPosts(db, 100), loadChannels().catch(() => [] as GuildChannel[])]);
    const entries = await entriesFor(db, posts.map((p) => p.id));
    const names = await namesOf(db, [...posts.map((p) => p.authorId), ...entries.map((e) => e.memberId)]);
    const cats = new Map(channels.filter((ch) => ch.type === 4).map((ch) => [ch.id, ch.name]));
    return c.html(
      <BoardPage
        session={c.get('session')}
        channelId={place.channelId}
        channels={textChannelsOf(channels).map((ch) => ({ id: ch.id, name: ch.name, category: ch.parent_id ? (cats.get(ch.parent_id) ?? null) : null }))}
        posts={posts}
        entries={entries}
        name={(id) => names.get(id) ?? id}
        coin={`${cfg.economy.currencyEmoji}${cfg.economy.currencyName}`}
        feePercent={cfg.market.feePercent}
        flash={c.req.query('msg')}
      />,
    );
  });

  app.post('/board/place', async (c) => {
    const body = await c.req.parseBody();
    const channels = await loadChannels(true).catch(() => [] as GuildChannel[]);
    const ch = textChannelsOf(channels).find((x) => x.id === body.channelId);
    if (!ch) return c.redirect('/board?msg=no_place');
    const by = c.get('session').userId;
    const prev = await loadBoardPlace(db);
    // 前のチャンネルの「募集を書く」は消す
    if (prev.panelMessageId && prev.channelId && prev.channelId !== ch.id) await deps.discord.deleteMessage(prev.channelId, prev.panelMessageId).catch(() => undefined);
    await saveBoardPlace(db, { channelId: ch.id, ...(prev.channelId === ch.id && prev.panelMessageId ? { panelMessageId: prev.panelMessageId } : {}) }, by);
    await audit(db, { actorId: by, action: 'board.place', detail: { channelId: ch.id }, via: 'web' });
    const ok = await postBoardPanel(db, cfg, deps.discord, by).catch(() => false);
    return c.redirect(`/board?msg=${ok ? 'place_saved' : 'panel_failed'}`);
  });

  app.post('/board/panel', async (c) => {
    const ok = await postBoardPanel(db, cfg, deps.discord, c.get('session').userId).catch(() => false);
    return c.redirect(`/board?msg=${ok ? 'panel' : (await loadBoardPlace(db)).channelId ? 'panel_failed' : 'no_place'}`);
  });

  /** Discord のカードとスレッドを今の状態に */
  const boardRefresh = async (postId: number, entryId?: number) => {
    const p = await getPost(db, postId);
    if (!p) return;
    if (p.channelId && p.messageId) await deps.discord.editMessage(p.channelId, p.messageId, postCard(p, await entriesOf(db, p.id), cfg) as never).catch(() => undefined);
    const e = entryId ? await getEntry(db, entryId) : undefined;
    // 採用のやり取りのスレッド（募集した人と採用された人だけ）。なければ応募の受付
    const where = e ? (e.threadId ?? p.applyThreadId ?? p.threadId) : undefined;
    if (e && where) await deps.discord.sendMessage(where, entryMessage(e, p, cfg) as never).catch(() => undefined);
  };

  app.post('/board/posts/:id/remove', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id)) return c.redirect('/board');
    const by = c.get('session').userId;
    const r = await closePost(db, id, by, { staff: true }, now());
    if (!r) return c.redirect('/board?msg=done_already');
    await audit(db, { actorId: by, targetId: r.post.authorId, action: 'board.remove', detail: { postId: id, refunded: r.refunded }, via: 'web' });
    await boardRefresh(id);
    if (r.post.threadId) await deps.discord.sendMessage(r.post.threadId, { content: `🛡 運営が募集を取り下げました${r.refunded ? `（採用しなかった分の ${r.refunded} 枚は募集した人に戻しました）` : ''}。` }).catch(() => undefined);
    // 応募の受付のスレッドを消し、採用しなかった人に知らせる
    if (r.post.applyThreadId) await deps.discord.deleteChannel(r.post.applyThreadId, '掲示板の募集を取り下げた').catch(() => undefined);
    for (const e of (await entriesOf(db, id)).filter((x) => x.status === 'applied')) {
      await deps.discord.sendDm(e.memberId, `📌 募集「${r.post.title}」は運営が取り下げました。応募ありがとうございました。`).catch(() => false);
    }
    return c.redirect('/board?msg=removed');
  });

  app.post('/board/entries/:id/:action', async (c) => {
    const id = Number(c.req.param('id'));
    const action = c.req.param('action');
    if (!Number.isSafeInteger(id) || (action !== 'pay' && action !== 'refund')) return c.redirect('/board');
    const by = c.get('session').userId;
    const e = cfg.economy;
    if (action === 'pay') {
      const r = await completeEntry(db, cfg, id, by, { staff: true }, now());
      if (r.status !== 'ok') return c.redirect('/board?msg=done_already');
      await audit(db, { actorId: by, targetId: r.entry.memberId, action: 'board.pay', detail: { postId: r.post.id, entryId: id, paid: r.paid }, via: 'web' });
      await boardRefresh(r.post.id, id);
      await deps.discord.sendDm(r.entry.memberId, `📌 募集「${r.post.title}」は運営の判断で完了にしました（${e.currencyEmoji} ${r.paid} 枚をお渡ししました）。`).catch(() => false);
      await deps.discord.sendDm(r.post.authorId, `📌 募集「${r.post.title}」は運営の判断で、報酬を採用した方に渡しました。`).catch(() => false);
      return c.redirect('/board?msg=paid');
    }
    const r = await refundEntry(db, id, by, now());
    if (!r) return c.redirect('/board?msg=done_already');
    await audit(db, { actorId: by, targetId: r.post.authorId, action: 'board.refund', detail: { postId: r.post.id, entryId: id }, via: 'web' });
    await boardRefresh(r.post.id, id);
    await deps.discord.sendDm(r.post.authorId, `📌 募集「${r.post.title}」は運営の判断で、報酬（${e.currencyEmoji} ${r.post.reward} 枚）をお返ししました。`).catch(() => false);
    await deps.discord.sendDm(r.entry.memberId, `📌 募集「${r.post.title}」は運営の判断で、報酬を募集した方に戻しました。`).catch(() => false);
    return c.redirect('/board?msg=refunded');
  });

  // ───────── 🎀 キャスト ─────────

  app.get('/cast', async (c) => {
    const [conf, channels, roles, list, stats, sessions, image] = await Promise.all([
      loadCastConfig(db),
      loadChannels().catch(() => [] as GuildChannel[]),
      loadRoles(),
      listCasts(db, ['pending', 'active', 'paused']),
      castStats(db, monthStart(now())),
      recentSessions(db, 100),
      loadMenuImage(db),
    ]);
    const names = await namesOf(db, [...list.map((x) => x.memberId), ...sessions.flatMap((x) => [x.castId, x.customerId])]);
    const cats = new Map(channels.filter((ch) => ch.type === 4).map((ch) => [ch.id, ch.name]));
    return c.html(
      <CastPage
        session={c.get('session')}
        config={conf}
        channels={textChannelsOf(channels).map((ch) => ({ id: ch.id, name: `#${ch.name}`, category: ch.parent_id ? (cats.get(ch.parent_id) ?? null) : null }))}
        categories={channels.filter((ch) => ch.type === 4).map((ch) => ({ id: ch.id, name: ch.name }))}
        roles={(roles ?? []).filter((r) => r.id !== cfg.guildId && !r.managed).map((r) => ({ id: r.id, name: r.name }))}
        hasImage={Boolean(image)}
        casts={list}
        stats={stats}
        sessions={sessions}
        name={(id) => names.get(id) ?? id}
        coin={`${cfg.economy.currencyEmoji}${cfg.economy.currencyName}`}
        flash={c.req.query('msg')}
      />,
    );
  });

  app.get('/cast/image', async (c) => {
    const img = await loadMenuImage(db);
    if (!img) return c.notFound();
    return c.body(Buffer.from(img.data), 200, { 'content-type': img.contentType, 'x-content-type-options': 'nosniff' });
  });

  const castPanelNow = () => refreshCastPanel(db, deps.discord).catch((err: unknown) => (logger.warn({ err }, 'cast panel failed'), false));

  app.post('/cast/settings', async (c) => {
    const body = await c.req.parseBody();
    const prev = await loadCastConfig(db);
    const id = (k: string) => (typeof body[k] === 'string' && validId(body[k] as string) ? (body[k] as string) : undefined);
    const n = (k: string) => Number(body[k]);
    const next = {
      ...prev,
      channelId: id('channelId'),
      privateCategoryId: id('privateCategoryId'),
      publicCategoryId: id('publicCategoryId'),
      roleId: id('roleId'),
      priceMin: n('priceMin'),
      priceMax: n('priceMax'),
      feePercent: n('feePercent'),
      acceptMinutes: n('acceptMinutes'),
    };
    const ok = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
    if (!ok(next.priceMin, 1, 1_000_000) || !ok(next.priceMax, next.priceMin, 1_000_000) || !ok(next.feePercent, 0, 90) || !ok(next.acceptMinutes, 1, 60)) return c.redirect('/cast?msg=invalid');
    // チャンネルを変えたら、前のメニューはそのままにして、新しいチャンネルに出し直す
    if (next.channelId !== prev.channelId) delete next.panelMessageId;
    await saveCastConfig(db, next, c.get('session').userId);
    await audit(db, { actorId: c.get('session').userId, action: 'cast.settings', detail: { ...next }, via: 'web' });
    return c.redirect('/cast?msg=saved');
  });

  app.post('/cast/image', async (c) => {
    const upload = await imageUpload(await c.req.parseBody());
    if (!(upload instanceof Uint8Array)) return c.redirect('/cast?msg=image_bad');
    if (!(await saveMenuImage(db, upload))) return c.redirect('/cast?msg=image_bad');
    await audit(db, { actorId: c.get('session').userId, action: 'cast.image', via: 'web' });
    await castPanelNow();
    return c.redirect('/cast?msg=image_saved');
  });

  app.post('/cast/image/delete', async (c) => {
    await deleteMenuImage(db);
    await castPanelNow();
    return c.redirect('/cast?msg=image_removed');
  });

  app.post('/cast/post', async (c) => {
    const ok = await refreshCastPanel(db, deps.discord, { repost: true, by: c.get('session').userId }).catch(() => false);
    return c.redirect(`/cast?msg=${ok ? 'posted' : 'post_failed'}`);
  });

  app.post('/cast/role', async (c) => {
    try {
      const role = await deps.discord.createRole(cfg.guildId, { name: '🎀 キャスト', color: 0xe86a92, permissions: '0', hoist: false, mentionable: false }, '管理画面（キャスト）');
      const prev = await loadCastConfig(db);
      await saveCastConfig(db, { ...prev, roleId: role.id }, c.get('session').userId);
      return c.redirect('/cast?msg=role_made');
    } catch (err) {
      logger.warn({ err }, 'cast role create failed');
      return c.redirect('/cast?msg=role_failed');
    }
  });

  app.post('/cast/casts/:id/:status', async (c) => {
    const id = c.req.param('id');
    const status = c.req.param('status');
    if (!validId(id) || (status !== 'active' && status !== 'paused' && status !== 'removed')) return c.redirect('/cast');
    const by = c.get('session').userId;
    const row = await setCastStatus(db, id, status, by, now());
    if (!row) return c.redirect('/cast');
    const conf = await loadCastConfig(db);
    if (conf.roleId) {
      if (status === 'active') await deps.discord.addRole(cfg.guildId, id, conf.roleId, 'キャストの承認').catch((err: unknown) => logger.warn({ err }, 'cast role add failed'));
      if (status === 'removed') await deps.discord.removeRole(cfg.guildId, id, conf.roleId, 'キャストを外した').catch(() => undefined);
    }
    await audit(db, { actorId: by, targetId: id, action: `cast.${status}`, via: 'web' });
    if (status === 'active') await deps.discord.sendDm(id, '🎀 キャストに承認されました。#キャスト一覧 の「⚙ キャストの方」から待機できます。').catch(() => false);
    await castPanelNow();
    return c.redirect(`/cast?msg=${status === 'active' && row.approvedBy === by ? 'approved' : 'status'}`);
  });

  app.post('/cast/sessions/:id/:action', async (c) => {
    const id = Number(c.req.param('id'));
    const action = c.req.param('action');
    if (!Number.isSafeInteger(id) || (action !== 'pay' && action !== 'refund')) return c.redirect('/cast');
    const by = c.get('session').userId;
    const s = await resolveSession(db, await loadCastConfig(db), id, action, by, now());
    if (!s) return c.redirect('/cast?msg=done_already');
    await audit(db, { actorId: by, targetId: action === 'pay' ? s.castId : s.customerId, action: `cast.${action}`, detail: { sessionId: id, price: s.price, paid: s.paid }, via: 'web' });
    const e = cfg.economy;
    await deps.discord.sendDm(s.castId, action === 'pay' ? `🎀 指名 #${id} は運営の判断で、${e.currencyEmoji} ${s.paid} 枚をお渡ししました。` : `🎀 指名 #${id} は運営の判断で、お客に戻しました。`).catch(() => false);
    await deps.discord.sendDm(s.customerId, action === 'pay' ? `🎀 指名 #${id} は運営の判断で、キャストに渡しました。` : `🎀 指名 #${id} は運営の判断で、${e.currencyEmoji} ${s.price} 枚をお戻ししました。`).catch(() => false);
    return c.redirect(`/cast?msg=${action === 'pay' ? 'paid' : 'refunded'}`);
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

  app.post('/market/requests/:id/close', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id)) return c.redirect('/market');
    const r = await closeRequest(db, id);
    if (!r) return c.redirect('/market?msg=done_already');
    if (r.channelId && r.messageId) await deps.discord.editMessage(r.channelId, r.messageId, requestCard(r, cfg) as never).catch(() => undefined);
    await audit(db, { actorId: c.get('session').userId, targetId: r.requesterId, action: 'market.request_close', detail: { requestId: id, by: 'staff' }, via: 'web' });
    return c.redirect('/market?msg=request_closed');
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
    const [items, roles, purchases, channels] = await Promise.all([listShopItems(db), shopRoles(), recentPurchases(db, 50), loadChannels().catch(() => [] as GuildChannel[])]);
    const names = await namesOf(db, purchases.flatMap((p) => [p.memberId, p.targetId ?? '']).filter(Boolean));
    const v = cfg.rooms.vip;
    const vip = v
      ? {
          roleName: roles.find((r) => r.id === v.roleId)?.name ?? '（見つからないロール）',
          hubName: channels.find((ch) => ch.id === v.hubId)?.name ?? '（見つからないチャンネル）',
          item: items.find((i) => i.roleId === v.roleId),
        }
      : undefined;
    const category = vipCategoryOf(cfg, channels);
    return c.html(
      <ShopPage
        session={c.get('session')}
        items={items}
        roles={roles}
        purchases={purchases}
        names={names}
        economy={cfg.economy}
        flash={c.req.query('msg')}
        vip={vip}
        vipCategory={category?.name}
        adultRoleSet={Boolean(cfg.roles.yoimairi)}
      />,
    );
  });

  // 💎 極（遊郭の VIP）: ロール・入口の通話・授与品をまとめて作る
  app.post('/shop/vip', async (c) => {
    const to = (msg: string) => c.redirect(`/shop?msg=${msg}#shop-vip`);
    if (cfg.rooms.vip) return to('vip_exists');
    const body = await c.req.parseBody();
    const price = Number(body.price ?? 10000);
    const days = body.durationDays === '' ? null : Number(body.durationDays ?? 30);
    if (!validInt(price, 0) || (days !== null && !validInt(days, 1))) return to('invalid');
    const channels = await loadChannels(true).catch(() => undefined);
    if (!channels) return to('vip_failed');
    const category = vipCategoryOf(cfg, channels);
    if (!category) return to('vip_nocategory');
    const by = c.get('session').userId;
    try {
      const role = await deps.discord.createRole(cfg.guildId, { name: VIP_ROLE_NAME, color: VIP_COLOR, permissions: '0', hoist: false, mentionable: false }, '管理画面（💎 極の VIP）');
      const hub = await deps.discord.createChannel(
        cfg.guildId,
        { name: VIP_HUB_NAME, type: 2, parent_id: category.id, permission_overwrites: vipHubOverwrites(category.permission_overwrites ?? [], cfg, role.id, deps.botId) },
        '管理画面（💎 極の部屋の入口）',
      );
      // 宵宮の入口が年齢制限なら、極の入口もそろえる
      if (hourlyHubOf(cfg, channels)?.nsfw) await deps.discord.editChannel(hub.id, { nsfw: true }).catch(() => undefined);
      const items = await listShopItems(db);
      await createShopItem(db, {
        kind: 'role',
        name: '極の VIP',
        emoji: '💎',
        description: '遊郭の「💎 極の部屋」をひらける・入れる（宵参りの方だけ。部屋代なし）',
        price,
        roleId: role.id,
        roleGroup: 'vip',
        durationDays: days,
        position: items.reduce((n, i) => Math.max(n, i.position), 0) + 1,
      });
      const prev = await loadOverrides(db);
      await saveOverrides(db, { ...prev, rooms: { ...prev.rooms, vip: { roleId: role.id, hubId: hub.id } } }, by);
      await deps.onSettingsSaved?.();
      await guildChannelsCached(deps.discord, cfg.guildId, true).catch(() => undefined);
      await audit(db, { actorId: by, action: 'rooms.vip_create', detail: { roleId: role.id, hubId: hub.id, price, days }, via: 'web' });
      return to('vip_created');
    } catch (err) {
      logger.warn({ err }, 'vip setup failed');
      return to('vip_failed');
    }
  });

  // 💎 極をやめる（ロール・入口の通話は消さない。授与品は販売しないにする）
  app.post('/shop/vip/off', async (c) => {
    const body = await c.req.parseBody();
    if (body.confirm !== 'yes' || !cfg.rooms.vip) return c.redirect('/shop#shop-vip');
    const v = cfg.rooms.vip;
    const prev = await loadOverrides(db);
    const { vip: _drop, ...rooms } = prev.rooms;
    await saveOverrides(db, { ...prev, rooms }, c.get('session').userId);
    await deps.onSettingsSaved?.();
    for (const i of (await listShopItems(db)).filter((x) => x.roleId === v.roleId)) await updateShopItem(db, i.id, { enabled: false });
    await audit(db, { actorId: c.get('session').userId, action: 'rooms.vip_off', detail: v, via: 'web' });
    return c.redirect('/shop?msg=vip_off#shop-vip');
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
      ...(item.kind !== 'menzaifu' && item.kind !== 'gift' && item.kind !== 'otoshidama' ? { boosterOnly: body.boosterOnly === 'yes' } : {}),
      ...(f.price !== undefined && item.kind !== 'menzaifu' && item.kind !== 'gift' ? { price: f.price } : {}),
      ...(item.kind === 'role' || item.kind === 'ema_pin' || item.kind === 'mycolor' ? { durationDays: item.kind === 'ema_pin' ? (f.durationDays ?? 7) : f.durationDays } : {}),
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
  const keys = ['name', 'emoji', 'roleId', 'weight', 'requiredGoen', 'auto', 'voicePercent', 'voiceCapPercent'] as const;
  for (const r of b.ranks) {
    const old = a.ranks.find((x) => x.key === r.key);
    if (!old) {
      out[r.key] = { added: { name: r.name, roleId: r.roleId, weight: r.weight, auto: r.auto, requiredGoen: r.requiredGoen } };
      continue;
    }
    const changed = Object.fromEntries(keys.filter((k) => old[k] !== r[k]).map((k) => [k, [old[k], r[k]]]));
    if (Object.keys(changed).length) out[r.key] = changed;
  }
  for (const r of a.ranks) if (!b.ranks.some((x) => x.key === r.key)) out[r.key] = { removed: r.name };
  return out;
}

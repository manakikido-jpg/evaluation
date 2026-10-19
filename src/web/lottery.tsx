import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordApi } from './discordApi.js';
import { casinoAllowed } from './casino.js';
import { buyLottery, buyScratch, fortuneState, revealScratch, fortuneErrorMessage, FortuneError } from '../services/casino/fortune.js';
import { walletOf } from '../services/economy.js';
import { FortunePage, FortuneEntry, type FortuneMe } from './views/fortune.js';
import { createMemberSession, findMemberSession, deleteMemberSession, markMemberChecked, MEMBER_RECHECK_MS } from './memberSessions.js';
import { randomToken, safeEqual } from './sessions.js';
const COOKIE = 'sakura_lottery', STATE = 'sakura_lottery_state';
type Deps = { db: Db; api: DiscordApi; cfg: () => GuildConfig; baseUrl: string; secure: boolean; now: () => Date };
export function mountLottery(app: Hono<any>, d: Deps) {
 const { db, api } = d;
 const opts = { httpOnly: true, secure: d.secure, sameSite: 'Lax' as const, path: '/lottery', maxAge: 7 * 86400 };
 const redirectUri = `${d.baseUrl}/casino/auth/callback`;
 const page = (handler: (c: Context, me: FortuneMe) => Response | Promise<Response>, options: { post?: boolean } = {}) => async (c: Context) => {
  const session = await findMemberSession(db, getCookie(c, COOKIE) ?? '', d.now());
  if (!session) {
   deleteCookie(c, COOKIE, { path: '/lottery' });
   return options.post ? c.redirect('/lottery', 303) : c.html(<FortuneEntry error={c.req.query('error')?.slice(0,160)} />);
  }
  if (d.now().getTime() - session.checkedAt.getTime() > MEMBER_RECHECK_MS) {
   let roles;
   try { roles = await api.memberRoles(d.cfg().guildId, session.userId); }
   catch { return c.text('Discordで入場条件を確認できません。少し待ってから開き直してください。', 503); }
   if (!roles || !casinoAllowed(d.cfg(), roles)) {
    await deleteMemberSession(db, session.id);deleteCookie(c, COOKIE, { path: '/lottery' });
    return c.redirect('/lottery?error=' + encodeURIComponent('入場ロールを確認してください。'),303);
   }
   await markMemberChecked(db, session.id, d.now());
  }
  if (options.post) {
   const b = await c.req.parseBody();
   if (!safeEqual(typeof b._csrf === 'string' ? b._csrf : '', session.csrfToken)) return c.text('不正なリクエストです（CSRF）。',403);
  }
  return handler(c,{ session, balance: (await walletOf(db,session.userId)).balance, coin: { name:d.cfg().economy.currencyName, emoji:d.cfg().economy.currencyEmoji } });
 };
 app.get('/lottery/auth', c => {
  const state=randomToken();setCookie(c,STATE,state,{...opts,path:'/casino/auth',maxAge:600});
  return c.redirect(api.authorizeUrl(state,redirectUri));
 });
 // 登録済みの認証コールバックを共用し、自分のstateだけを受け取る。
 app.get('/casino/auth/callback',async(c,next)=>{
  const state=getCookie(c,STATE);
  if(!state || !safeEqual(state,c.req.query('state') ?? '')) return next();
  deleteCookie(c,STATE,{path:'/casino/auth'});
  const code=c.req.query('code');if(!code) return c.redirect('/lottery?error='+encodeURIComponent('認証をやり直してください。'));
  try {
   const user=await api.me(await api.exchangeCode(code,redirectUri));
   const roles=await api.memberRoles(d.cfg().guildId,user.id);
   if(!roles || !casinoAllowed(d.cfg(),roles)) return c.redirect('/lottery?error='+encodeURIComponent('入場ロールが必要です。運営に確認してください。'));
   setCookie(c,COOKIE,await createMemberSession(db,user,d.now()),opts);
   return c.redirect('/lottery');
  } catch { return c.redirect('/lottery?error='+encodeURIComponent('Discord認証に失敗しました。少し待ってからやり直してください。')); }
 });
 app.post('/lottery/logout',page(async(c,me)=>{
  await deleteMemberSession(db,me.session.id);deleteCookie(c,COOKIE,{path:'/lottery'});return c.redirect('/lottery',303);
 },{post:true}));
  app.get('/lottery', page(async (c, me) => c.html(<FortunePage me={me} cfg={d.cfg().fortuneGames} state={await fortuneState(db, me.session.userId, d.cfg().fortuneGames, d.now())} selected={c.req.query('ticket')} error={c.req.query('error')?.slice(0, 160)} />)));
  app.post('/lottery/scratch', page(async (c, me) => {
    const body = await c.req.parseBody();
    try {
      if (typeof body.quote !== 'string' || Number(body.quote) !== d.cfg().fortuneGames.scratchPrice) throw new FortuneError('値段が変わりました。画面を開き直してから購入してください。');
      const id = await buyScratch(db, me.session.userId, String(body.nonce ?? ''), d.cfg().fortuneGames, d.now);
      return c.redirect('/lottery?ticket=' + id, 303);
    } catch (err) { return c.redirect('/lottery?error=' + encodeURIComponent(fortuneErrorMessage(err)), 303); }
  }, { post: true }));
  app.post('/lottery/scratch/:id/open', page(async (c, me) => {
    try {
      const result = await revealScratch(db, me.session.userId, c.req.param('id')!, d.now);
      if (c.req.header('accept') === 'application/json') return c.json(result);
      return c.redirect('/lottery?ticket=' + c.req.param('id'), 303);
    } catch (err) {
      if (c.req.header('accept') === 'application/json') return c.json({ error: fortuneErrorMessage(err) }, 400);
      return c.redirect('/lottery?error=' + encodeURIComponent(fortuneErrorMessage(err)), 303);
    }
  }, { post: true }));
  app.post('/lottery/tickets', page(async (c, me) => {
    const body = await c.req.parseBody();
    try {
      await buyLottery(db, me.session.userId, String(body.nonce ?? ''), String(body.roundId ?? ''), d.cfg().fortuneGames, d.now);
      return c.redirect('/lottery', 303);
    } catch (err) { return c.redirect('/lottery?error=' + encodeURIComponent(fortuneErrorMessage(err)), 303); }
  }, { post: true }));

}

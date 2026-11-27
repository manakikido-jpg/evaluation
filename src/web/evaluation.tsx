import type { Hono, Context } from 'hono';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { AdminSession } from '../db/schema.js';
import { evaluationCsv, EvaluationSelectionError, ujikoEvaluation, type EvaluationFilter } from '../services/ujikoEvaluation.js';
import { ujikoRatingRows, ujikoRatingXlsx } from '../services/ujikoRating.js';
import { emaPromotionEnabled, setEmaPromotion, ujikoBelowKeep } from '../services/emaPromotion.js';
import { resetAllShuin, undoAllShuinReset, lastAllShuinReset, newSystemStartedAt } from '../services/shuin.js';
import { perkUjikoEnabled, setPerkUjiko } from '../services/perkGate.js';
import { loadOverrides, saveOverrides } from '../services/settings.js';
import { ujikoWeekRequirement } from '../services/ujikoRequirement.js';
import { jstPeriodStart } from '../domain/ema.js';
import { listSewayakuElections, sewayakuVoteCount } from '../services/sewayakuElection.js';
import { motoUjikoIds, newSystemRoles, setNewSystemRoles } from '../services/ujikoKeep.js';
import { goenPerkSchema, emaThresholdsSchema, type GoenPerk } from '../config.js';
import { namesOf } from '../services/members.js';

/** テキスト（1行＝「ご縁 銭 [ロールID] [称号名]」）→ ご縁の節目特典。おかしな行があれば null */
function parseGoenPerks(text: string): GoenPerk[] | null {
  const out: GoenPerk[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const t = line.split(/\s+/);
    const goen = Number(t[0]);
    const coins = t[1] === undefined ? 0 : Number(t[1]);
    if (!Number.isInteger(goen) || goen <= 0 || !Number.isInteger(coins) || coins < 0) return null;
    const hasRole = t[2] !== undefined && /^\d{17,20}$/.test(t[2]);
    const roleId = hasRole ? t[2] : undefined;
    const label = t.slice(hasRole ? 3 : 2).join(' ').slice(0, 40);
    const parsed = goenPerkSchema.safeParse({ goen, coins, ...(roleId ? { roleId } : {}), label });
    if (!parsed.success) return null;
    out.push(parsed.data);
  }
  if (out.length > 30) return null;
  return out.sort((a, b) => a.goen - b.goen);
}
export function goenPerksToText(perks: readonly GoenPerk[]): string {
  return perks.map((p) => [p.goen, p.coins, ...(p.roleId ? [p.roleId] : []), ...(p.label ? [p.label] : [])].join(' ')).join('\n');
}
import { audit } from '../services/audit.js';
import { evaluationDeductionPage,saveEvaluationDeduction,EvaluationDeductionError } from '../services/evaluationDeductions.js';
import { EvaluationDeductionsPage } from './views/evaluationDeductions.js';
import { EvaluationPage } from './views/evaluation.js';

type Env = { Variables: { session: AdminSession } };
export function mountEvaluation(app: Hono<Env>, db: Db, cfg: () => GuildConfig, now: () => Date) {
  const read = async (c: Context<Env>, csv: boolean) => {
    c.header('Cache-Control', 'private, no-store');
    const q = (c.req.query('q') ?? '').trim(), status = c.req.query('status') ?? 'all';
    const scope = c.req.query('scope'), channelIds = c.req.queries('channel') ?? [], page = Number(c.req.query('page') ?? '1');
    if (q.length > 100 || !['all', 'met', 'unmet'].includes(status) || (scope !== undefined && scope !== '1') ||
      channelIds.length > 500 || channelIds.some(id => !/^\d{17,20}$/.test(id)) || !Number.isSafeInteger(page) || page < 1) {
      return c.text('集計条件が正しくありません。評価タブを開き直してください。', 400);
    }
    const filter: EvaluationFilter = { q, status: status as EvaluationFilter['status'], channelIds: scope === '1' || channelIds.length ? channelIds : undefined };
    try {
      const data = await ujikoEvaluation(db, cfg(), filter, now());
      if (csv) return c.body(evaluationCsv(data), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ujiko-evaluation.csv"' });
      const session = c.get('session');
      const emaPromotion = await emaPromotionEnabled(db);
      // 🎐 維持の注意（有効な絵馬が3枚未満の氏子）は宮司だけに出す
      const keepWarnings = session.level === 'guji' ? await ujikoBelowKeep(db, cfg(), now()) : [];
      const names = keepWarnings.length ? await namesOf(db, keepWarnings.map((w) => w.id)) : new Map<string, string>();
      const resetUndoable = session.level === 'guji' ? await lastAllShuinReset(db) : undefined;
      const perkUjiko = await perkUjikoEnabled(db);
      // 🎐 今週の「参拝者→氏子に要る絵馬の数」（2週間ごとにきまる）
      const ujikoWeek = session.level === 'guji' ? await ujikoWeekRequirement(db, cfg(), jstPeriodStart(now())) : undefined;
      // 🗳 世話役の選挙（投票中・これから・最近の結果。票と投票できる人の数だけ）
      let sewayaku: Parameters<typeof EvaluationPage>[0]['sewayaku'];
      if (session.level === 'guji') {
        const [active, recent] = await Promise.all([listSewayakuElections(db, ['open', 'scheduled', 'closing']), listSewayakuElections(db, ['passed', 'failed', 'cancelled'], 10)]);
        const rows = await Promise.all(active.map(async (e) => ({ ...e, votes: e.status === 'scheduled' ? null : await sewayakuVoteCount(db, e.id) })));
        const sNames = await namesOf(db, [...new Set([...active, ...recent].map((e) => e.candidateId))]);
        sewayaku = { active: rows, recent, names: sNames };
      }
      const started = session.level === 'guji' ? await newSystemStartedAt(db) : undefined;
      const nsRoles = session.level === 'guji' ? await newSystemRoles(db) : undefined;
      const motoCount = session.level === 'guji' ? (await motoUjikoIds(db)).size : 0;
      return c.html(<EvaluationPage nsRoles={nsRoles} motoCount={motoCount} rolesFlash={c.req.query('roles') ?? undefined} newSystemStartedAt={started} ujikoWeek={ujikoWeek} sewayaku={sewayaku} session={session} data={data} filter={filter} page={page} emaPromotion={emaPromotion} keepWarnings={keepWarnings} names={names} saved={c.req.query('ema') ?? undefined} resetFlash={c.req.query('reset') ?? undefined} resetUndoable={resetUndoable} perkUjiko={perkUjiko} perkFlash={c.req.query('perk') ?? undefined} goenPerksText={goenPerksToText(cfg().goenPerks)} goenPerksFlash={c.req.query('gp') ?? undefined} emaThresholds={cfg().emaThresholds} emaThresholdsFlash={c.req.query('th') ?? undefined}/>);
    } catch (error) {
      if (!(error instanceof EvaluationSelectionError)) throw error;
      return c.text(error.message, 400);
    }
  };
  const corrections=async(c:Context<Env>,error?:EvaluationDeductionError)=>{
    c.header('Cache-Control','private, no-store');
    if(c.get('session').level!=='guji')return c.text('過去時間の控除は宮司だけが操作できます。',403);
    const member=c.req.query('member')??'',page=Number(c.req.query('page')??'1');
    if(!/^\d{17,20}$/.test(member)||!Number.isSafeInteger(page)||page<1)return c.text('対象とページを確認してください。',400);
    try{return c.html(<EvaluationDeductionsPage session={c.get('session')} data={await evaluationDeductionPage(db,cfg(),member,page,now())} error={error?.message} saved={c.req.query('saved')==='1'}/>,error?.status??200);}
    catch(e){if(e instanceof EvaluationDeductionError)return c.text(e.message,e.status);throw e;}
  };
  app.get('/evaluation/corrections',c=>corrections(c));
  app.post('/evaluation/corrections',async c=>{
    c.header('Cache-Control','private, no-store');
    const session=c.get('session');if(session.level!=='guji')return c.text('過去時間の控除は宮司だけが操作できます。',403);
    const body=await c.req.parseBody(),member=typeof body.member==='string'?body.member:'',page=String(body.page??'1');
    const number=(name:string)=>typeof body[name]==='string'&&/^(0|[1-9]\d*)$/.test(body[name] as string)?Number(body[name]):NaN;
    try{
      await saveEvaluationDeduction(db,cfg(),{memberId:member,channelId:typeof body.channel==='string'?body.channel:'',date:typeof body.date==='string'?body.date:'',minutes:number('minutes'),expectedMinutes:number('expected'),expectedUpdatedAt:typeof body.expectedAt==='string'?body.expectedAt:'',reason:typeof body.reason==='string'?body.reason:''},session.userId,now());
      const query=new URLSearchParams({member,page:/^[1-9]\d*$/.test(page)?page:'1',saved:'1'});return c.redirect('/evaluation/corrections?'+query,303);
    }catch(error){if(!(error instanceof EvaluationDeductionError))throw error;return c.html(<p class="flash warn" role="alert">{error.message}</p>,error.status);}
  });
  app.get('/evaluation', c => read(c, false));
  app.get('/evaluation/export.csv', c => read(c, true));
  // 🎐 絵馬での昇格（新制度③）の ON/OFF（宮司だけ）
  app.post('/evaluation/ema-promotion', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const session = c.get('session');
    if (session.level !== 'guji') return c.text('絵馬での昇格の切り替えは宮司だけが操作できます。', 403);
    const body = await c.req.parseBody();
    if (body.confirm !== 'yes') return c.redirect('/evaluation?ema=confirm', 303);
    const on = body.on === '1';
    await setEmaPromotion(db, on, session.userId);
    await audit(db, { actorId: session.userId, action: 'ema.promotion_mode', detail: { on }, via: 'web' });
    return c.redirect(`/evaluation?ema=${on ? 'on' : 'off'}`, 303);
  });
  // 🔄 新制度の切替：全員のご縁（結び）と特別ご縁を 0 に戻す（宮司だけ・確認必須・絵馬での昇格がONのときだけ）
  app.post('/evaluation/goen-reset', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const session = c.get('session');
    if (session.level !== 'guji') return c.text('ご縁のリセットは宮司だけが操作できます。', 403);
    if (!(await emaPromotionEnabled(db))) return c.redirect('/evaluation?reset=need_ema', 303);
    const body = await c.req.parseBody();
    if (body.confirm !== 'yes' || body.phrase !== 'リセット') return c.redirect('/evaluation?reset=confirm', 303);
    const r = await resetAllShuin(db, session.userId, now());
    return c.redirect(`/evaluation?reset=done&members=${r.members}`, 303);
  });
  // 🎁 ご縁の節目特典の編集（宮司だけ・新制度⑦）
  app.post('/evaluation/goen-perks', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const session = c.get('session');
    if (session.level !== 'guji') return c.text('ご縁の節目特典の編集は宮司だけです。', 403);
    const body = await c.req.parseBody();
    const perks = parseGoenPerks(typeof body.perks === 'string' ? body.perks : '');
    if (!perks) return c.redirect('/evaluation?gp=invalid', 303);
    await saveOverrides(db, { ...(await loadOverrides(db)), goenPerks: perks }, session.userId);
    await audit(db, { actorId: session.userId, action: 'goen.perks_edit', detail: { count: perks.length }, via: 'web' });
    return c.redirect('/evaluation?gp=saved', 303);
  });
  // 🎐 絵馬の昇格・維持に要る枚数の編集（宮司だけ・新制度③⑧）
  app.post('/evaluation/ema-thresholds', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const session = c.get('session');
    if (session.level !== 'guji') return c.text('絵馬の枚数の編集は宮司だけです。', 403);
    const body = await c.req.parseBody();
    const num = (name: string) => (typeof body[name] === 'string' && /^\d{1,3}$/.test(body[name] as string) ? Number(body[name]) : NaN);
    const parsed = emaThresholdsSchema.safeParse({
      ujikoPercent: num('ujikoPercent'),
      ujikoActiveMinutes: Number.isNaN(num('ujikoActiveHours')) ? NaN : num('ujikoActiveHours') * 60,
      ujikoMin: num('ujikoMin'),
      inviteSubstituteMax: num('inviteSubstituteMax'),
      ujikoKeep: num('ujikoKeep'),
      sewayakuVotePercent: num('sewayakuVotePercent'),
      sewayakuVoterMinutes: Number.isNaN(num('sewayakuVoterHours')) ? NaN : num('sewayakuVoterHours') * 60,
      sewayakuCandidateMinutes: (() => { const v = typeof body.sewayakuCandidateHours === 'string' && /^\d{1,4}$/.test(body.sewayakuCandidateHours) ? Number(body.sewayakuCandidateHours) : NaN; return Number.isNaN(v) ? NaN : v * 60; })(),
      sewayakuCandidateMonths: num('sewayakuCandidateMonths'),
      sewayakuRetryMinutes: (() => { const v = typeof body.sewayakuRetryHours === 'string' && /^\d{1,4}$/.test(body.sewayakuRetryHours) ? Number(body.sewayakuRetryHours) : NaN; return Number.isNaN(v) ? NaN : v * 60; })(),
      sewayakuMinVoters: (() => { const v = typeof body.sewayakuMinVoters === 'string' && /^\d{1,4}$/.test(body.sewayakuMinVoters) ? Number(body.sewayakuMinVoters) : NaN; return v; })(),
      sodaiPromote: (() => { const v = typeof body.sodaiPromote === 'string' && /^\d{1,4}$/.test(body.sodaiPromote) ? Number(body.sodaiPromote) : NaN; return v; })(),
      // 🍃 キープと元氏子（欄がないときは今の値のまま）
      ...Object.fromEntries((['keepNeed', 'keepFromSanpai', 'keepInviteMax', 'keepDays', 'motoNeed', 'motoFromSanpai', 'motoInviteMax'] as const).map((k) => [k, body[k] === undefined ? cfg().emaThresholds[k] : num(k)])),
    });
    if (!parsed.success) return c.redirect('/evaluation?th=invalid', 303);
    await saveOverrides(db, { ...(await loadOverrides(db)), emaThresholds: parsed.data }, session.userId);
    await audit(db, { actorId: session.userId, action: 'ema.thresholds_edit', detail: parsed.data, via: 'web' });
    return c.redirect('/evaluation?th=saved', 303);
  });
  // 🍂 元氏子・荒魂のロール ID（宮司だけ）
  app.post('/evaluation/new-system-roles', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const session = c.get('session');
    if (session.level !== 'guji') return c.text('ロールの設定は宮司だけです。', 403);
    const body = await c.req.parseBody();
    const read = (name: string) => (typeof body[name] === 'string' ? (body[name] as string).trim() : '');
    const moto = read('motoUjiko'), ara = read('aramitama');
    if ((moto && !/^\d{17,20}$/.test(moto)) || (ara && !/^\d{17,20}$/.test(ara))) return c.redirect('/evaluation?roles=invalid#ns-roles', 303);
    const roles = { ...(moto ? { motoUjiko: moto } : {}), ...(ara ? { aramitama: ara } : {}) };
    await setNewSystemRoles(db, roles, session.userId);
    await audit(db, { actorId: session.userId, action: 'new_system.roles', detail: roles, via: 'web' });
    return c.redirect('/evaluation?roles=saved#ns-roles', 303);
  });
  app.post('/evaluation/goen-reset-undo', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const session = c.get('session');
    if (session.level !== 'guji') return c.text('ご縁のリセットは宮司だけが操作できます。', 403);
    const r = await undoAllShuinReset(db, session.userId);
    return c.redirect(`/evaluation?reset=${r.status === 'ok' ? 'undone' : 'none'}`, 303);
  });
  // 🎁 特典のゲート（新制度⑤）：カジノ・宿を「氏子から」に切り替える（宮司だけ・確認必須）
  app.post('/evaluation/perk-ujiko', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const session = c.get('session');
    if (session.level !== 'guji') return c.text('特典のゲートの切り替えは宮司だけが操作できます。', 403);
    const body = await c.req.parseBody();
    if (body.confirm !== 'yes') return c.redirect('/evaluation?perk=confirm', 303);
    const on = body.on === '1';
    await setPerkUjiko(db, on, session.userId);
    await audit(db, { actorId: session.userId, action: 'perk.ujiko_gate', detail: { on }, via: 'web' });
    return c.redirect(`/evaluation?perk=${on ? 'on' : 'off'}`, 303);
  });
  // 🍃 今いる氏子を 5 段階で評価するシート（エクセル）。宮司だけが取り出せる
  app.get('/evaluation/rating-sheet.xlsx', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    if (c.get('session').level !== 'guji') return c.text('氏子の評価シートは宮司だけが取り出せます。', 403);
    const rows = await ujikoRatingRows(db, cfg());
    await audit(db, { actorId: c.get('session').userId, action: 'ujiko.rating_sheet', detail: { count: rows.length }, via: 'web' });
    return c.body(new Uint8Array(ujikoRatingXlsx(rows)), 200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="ujiko-rating.xlsx"',
      'x-content-type-options': 'nosniff',
    });
  });
}

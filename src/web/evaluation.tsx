import type { Hono, Context } from 'hono';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { AdminSession } from '../db/schema.js';
import { evaluationCsv, EvaluationSelectionError, ujikoEvaluation, type EvaluationFilter } from '../services/ujikoEvaluation.js';
import { ujikoRatingRows, ujikoRatingXlsx } from '../services/ujikoRating.js';
import { emaPromotionEnabled, setEmaPromotion, ujikoBelowKeep } from '../services/emaPromotion.js';
import { resetAllShuin, undoAllShuinReset, lastAllShuinReset } from '../services/shuin.js';
import { namesOf } from '../services/members.js';
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
      return c.html(<EvaluationPage session={session} data={data} filter={filter} page={page} emaPromotion={emaPromotion} keepWarnings={keepWarnings} names={names} saved={c.req.query('ema') ?? undefined} resetFlash={c.req.query('reset') ?? undefined} resetUndoable={resetUndoable}/>);
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
  app.post('/evaluation/goen-reset-undo', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const session = c.get('session');
    if (session.level !== 'guji') return c.text('ご縁のリセットは宮司だけが操作できます。', 403);
    const r = await undoAllShuinReset(db, session.userId);
    return c.redirect(`/evaluation?reset=${r.status === 'ok' ? 'undone' : 'none'}`, 303);
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

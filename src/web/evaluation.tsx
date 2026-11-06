import type { Hono, Context } from 'hono';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { AdminSession } from '../db/schema.js';
import { evaluationCsv, EvaluationSelectionError, ujikoEvaluation, type EvaluationFilter } from '../services/ujikoEvaluation.js';
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
      return c.html(<EvaluationPage session={c.get('session')} data={data} filter={filter} page={page}/>);
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
}

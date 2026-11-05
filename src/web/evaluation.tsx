import type { Hono, Context } from 'hono';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { AdminSession } from '../db/schema.js';
import { evaluationCsv, EvaluationSelectionError, ujikoEvaluation, type EvaluationFilter } from '../services/ujikoEvaluation.js';
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
  app.get('/evaluation', c => read(c, false));
  app.get('/evaluation/export.csv', c => read(c, true));
}

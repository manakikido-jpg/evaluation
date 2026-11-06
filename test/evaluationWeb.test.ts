import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members, shuin, voiceChannels, voiceUsage } from '../src/db/schema.js';
import { createWebApp } from '../src/web/app.js';
import { createSession } from '../src/web/sessions.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const now = new Date('2026-11-07T03:00:00Z'), ID = '830000000000000001', A = '830000000000000002', B = '830000000000000003', C = '830000000000000004', ENG = '930000000000000001';
const user = { id: ID, username: 'staff', displayName: '運営', avatarUrl: null };
let db: Db, close: () => Promise<void>, app: ReturnType<typeof createWebApp>, token: string;
const headers = (t = token) => ({ cookie: 'shamusho_session=' + t });
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([{ id: ID, username: 'staff', displayName: '運営', roleIds: [ROLE.guji] },
    { id: A, username: 'alpha', displayName: '先に達成', roleIds: [ROLE.sanpaisha] }, { id: B, username: 'beta', displayName: '過去分で達成', roleIds: [ROLE.sanpaisha] }, { id: C, username: 'gamma', displayName: 'あと一分', roleIds: [ROLE.sanpaisha] }]);
  await db.insert(voiceChannels).values({ channelId: ENG, name: '縁側１' });
  await db.insert(voiceUsage).values([{ memberId: A, date: '2026-11-06', channelId: ENG, minutes: 1300, rankRecordedMinutes: 1200, sanpaishaMinutes: 1200, evaluationRecordedMinutes: 1200, evaluationEligibleMinutes: 1200 },
    { memberId: B, date: '2026-11-06', channelId: ENG, minutes: 10000, rankRecordedMinutes: 1199, sanpaishaMinutes: 1199, evaluationRecordedMinutes: 1199, evaluationEligibleMinutes: 1199 },
    { memberId: C, date: '2026-11-06', channelId: ENG, minutes: 1199, rankRecordedMinutes: 1199, sanpaishaMinutes: 1199, evaluationRecordedMinutes: 1199, evaluationEligibleMinutes: 1199 }]);
  await db.insert(shuin).values([A, B, C].flatMap((receiverId, i) => Array.from({ length: 40 + (i === 1 ? 1 : 0) }, (_, j) => ({ receiverId, giverId: String(840000000000000000n + BigInt(j)), weight: 10, giverRank: 'guji' }))));
  app = createWebApp({ db, cfg: () => cfg, api: { memberRoles: async () => [ROLE.guji] } as never,
    discord: { guildChannels: async () => [] } as never, baseUrl: 'https://example.test', now: () => now });
  token = await createSession(db, user, { level: 'guji', pages: null }, now);
});
afterEach(async () => close());

it('一覧とCSVのどちらも認証と独立した評価ページ権限を要求する', async () => {
  const limited = await createSession(db, user, { level: 'shinshoku', pages: ['members'] }, now);
  const allowed = await createSession(db, user, { level: 'shinshoku', pages: ['evaluation'] }, now);
  for (const path of ['/evaluation', '/evaluation/export.csv']) {
    expect((await app.request(path)).status).toBe(302);
    expect((await app.request(path, { headers: headers(limited) })).status).toBe(403);
    expect((await app.request(path, { headers: headers(allowed) })).status).toBe(200);
  }
  const menu = await (await app.request('/members', { headers: headers(limited) })).text();
  expect(menu).not.toContain('href="/evaluation"');
});

it('過去分も20時間へ加算し、内訳を表示する。読むだけで役職や元の記録を変えない', async () => {
  const beforeMembers = await db.select().from(members), beforeVoice = await db.select().from(voiceUsage);
  const response = await app.request('/evaluation', { headers: headers() }), html = await response.text();
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(html).toContain('2026年11月6日（金）0:00（日本時間）');
  expect(html).toContain('href="/evaluation"'); expect(html).toContain('40個 / 40個'); expect(html).toContain('41個 / 40個');
  expect(html).toContain('19時間59分 / 20時間'); expect(html).toContain('あと1分'); expect(html).toContain('過去取込'); expect(html).toContain('過去分の役職またはミュートは未確認');
  expect(html).not.toMatch(/<details class="evaluation-targets"[^>]*\bopen/);
  expect(html.indexOf('href="/members/' + B)).toBeLessThan(html.indexOf('href="/members/' + A));
  expect(html).not.toMatch(/onclick=|style=/);
  expect(await db.select().from(members)).toEqual(beforeMembers); expect(await db.select().from(voiceUsage)).toEqual(beforeVoice);
});

it('検索・達成状況・縁側選択をCSVへ引き継ぎ、絞り込み後も全体順位を保つ', async () => {
  const html = await (await app.request('/evaluation?q=beta&status=met', { headers: headers() })).text();
  expect(html).toContain('1位'); expect(html).not.toContain('href="/members/' + A);
  expect(html).toContain('/evaluation/export.csv?');
  const response = await app.request('/evaluation/export.csv?q=beta&status=met', { headers: headers() }), csv = await response.text();
  expect(response.headers.get('content-disposition')).toContain('attachment'); expect(response.headers.get('content-type')).toContain('text/csv');
  expect(csv).toContain('2026-11-06 00:00'); expect(csv).toContain('過去分で達成'); expect(csv).not.toContain('先に達成'); expect(csv).toContain('"1","過去分で達成"');
  expect(csv).toContain('うち過去取込'); expect(csv).toContain('"8801"');
  const none = await (await app.request('/evaluation?scope=1&status=met', { headers: headers() })).text();
  expect(none).toContain('未選択'); expect(none).toContain('この条件に合う参拝者はいません');
});

it('不正な検索条件や縁側以外のIDは400とし、全通話へすり替わらない', async () => {
  for (const query of ['page=0', 'page=NaN', 'status=oops', 'scope=oops', 'channel=bad', 'channel=930000000000000099', 'q=' + 'a'.repeat(101)]) {
    for (const path of ['/evaluation', '/evaluation/export.csv']) expect((await app.request(path + '?' + query, { headers: headers() })).status).toBe(400);
  }
});

it('100名ずつ表示し、CSVでは同じ条件に当てはまる全員を保存できる', async () => {
  await db.insert(members).values(Array.from({ length: 101 }, (_, i) => ({ id: String(850000000000000000n + BigInt(i)), username: `extra${i}`, displayName: `追加${i}`, roleIds: [ROLE.sanpaisha] })));
  const html = await (await app.request('/evaluation?page=2', { headers: headers() })).text();
  expect(html).toContain('2 / 2ページ'); expect(html).toContain('104名');
  expect((html.match(/scope="row"/g) ?? []).length).toBe(4);
  const csv = await (await app.request('/evaluation/export.csv?page=2', { headers: headers() })).text();
  expect(csv).toContain('先に達成'); expect(csv).toContain('追加100'); expect(csv.split('\r\n')).toHaveLength(106);
});

it('過去控除は宮司・評価権限・CSRFを要求し、保存後に一覧とCSVへ反映する',async()=>{
 const {findSession}=await import('../src/web/sessions.js');const {evaluationTimeDeductions,auditLogs}=await import('../src/db/schema.js');
 const csrf=(await findSession(db,token,now))!.csrfToken,limited=await createSession(db,user,{level:'shinshoku',pages:['evaluation'],writePages:['evaluation']},now);
 const target='/evaluation/corrections?member='+A;
 expect((await app.request(target)).status).toBe(302);expect((await app.request(target,{headers:headers(limited)})).status).toBe(403);
 const read=await app.request(target,{headers:headers()});expect(read.status).toBe(200);expect(read.headers.get('cache-control')).toContain('no-store');expect(await read.text()).toContain('控除する合計分数');
 const post=(extra:Record<string,string>={},t=token)=>app.request('/evaluation/corrections',{method:'POST',headers:{...headers(t),origin:'https://example.test','sec-fetch-site':'same-origin'},body:new URLSearchParams({_csrf:csrf,member:A,date:'2026-11-06',channel:ENG,minutes:'100',expected:'0',reason:'本人のミュート記録で100分を確認',...extra})});
 expect((await post({_csrf:''})).status).toBe(403);
 const limitedCsrf=(await findSession(db,limited,now))!.csrfToken;expect((await post({_csrf:limitedCsrf},limited)).status).toBe(403);expect(await db.select().from(evaluationTimeDeductions)).toHaveLength(0);
 const original=await db.select().from(voiceUsage);expect((await post()).status).toBe(303);expect((await post()).status).toBe(409);
 const csv=await(await app.request('/evaluation/export.csv?q=alpha',{headers:headers()})).text();expect(csv).toContain('"1200"');expect(csv).toContain('過去の控除（分）');const values=csv.split('\r\n')[1]!.split(',');expect(values[4]).toBe('"1200"');expect(values[8]).toBe('"0"');expect(values[11]).toBe('"100"');
 expect(await db.select().from(voiceUsage)).toEqual(original);expect(await db.select().from(evaluationTimeDeductions)).toHaveLength(1);expect((await db.select().from(auditLogs)).filter(r=>r.action==='evaluation.time_deduction')).toHaveLength(1);
 const html=await(await app.request('/evaluation',{headers:headers(limited)})).text();expect(html).not.toContain('/evaluation/corrections?member=');
});
it('控除フォームは不正な日付/分数/参拝者以外/評価閲覧権限なしを拒否する',async()=>{
 const {findSession}=await import('../src/web/sessions.js');const csrf=(await findSession(db,token,now))!.csrfToken;
 for(const change of [{minutes:'101'},{minutes:''},{minutes:'1.5'},{date:'2026-02-30'},{reason:' '},{member:ID}]){
  const r=await app.request('/evaluation/corrections',{method:'POST',headers:{...headers(),origin:'https://example.test','sec-fetch-site':'same-origin'},body:new URLSearchParams({_csrf:csrf,member:A,date:'2026-11-06',channel:ENG,minutes:'1',expected:'0',reason:'本人記録',...change})});expect(r.status).toBe(400);
 }
 const limited=await createSession(db,user,{level:'shinshoku',pages:['members']},now);expect((await app.request('/evaluation/corrections?member='+A,{headers:headers(limited)})).status).toBe(403);
 for(const q of ['member=bad','member='+A+'&page=0'])expect((await app.request('/evaluation/corrections?'+q,{headers:headers()})).status).toBe(400);
});

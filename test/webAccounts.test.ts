import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { adminSessions } from '../src/db/schema.js';
import {
  accountAccess,
  checkLogin,
  createAccount,
  deleteAccount,
  generatePassword,
  hashPassword,
  LOGIN_LOCK,
  resetPassword,
  setDisabled,
  updateAccount,
  verifyPassword,
} from '../src/services/webAccounts.js';
import { makeDb } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});
const T0 = new Date('2026-09-30T12:00:00Z');

describe('🪪 社務所Web のアカウント', () => {
  it('パスワードはハッシュで持ち、読み間違えにくい文字だけで作る', async () => {
    const pw = generatePassword();
    expect(pw).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{14}$/);
    const h = await hashPassword(pw);
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain(pw);
    expect(await verifyPassword(pw, h)).toBe(true);
    expect(await verifyPassword(pw + 'x', h)).toBe(false);
  });

  it('発行・ログイン・続けて間違えるとロック・止める・作り直す', async () => {
    expect((await createAccount(db, { loginId: 'A', name: 'x', level: 'guji', pages: null }, 'cli')).status).toBe('bad_id');
    expect((await createAccount(db, { loginId: 'miyaji', name: ' ', level: 'guji', pages: null }, 'cli')).status).toBe('bad_name');
    const g = await createAccount(db, { loginId: 'Miyaji', name: '宮司', level: 'guji', pages: ['board'] }, 'cli', T0);
    if (g.status !== 'ok') throw new Error(g.status);
    expect(g.account).toMatchObject({ loginId: 'miyaji', level: 'guji', pages: null });
    expect((await createAccount(db, { loginId: 'miyaji', name: '宮司', level: 'guji', pages: null }, 'cli')).status).toBe('taken');
    expect((await checkLogin(db, 'MIYAJI', g.password, T0)).status).toBe('ok');
    expect((await checkLogin(db, 'nobody', g.password, T0)).status).toBe('wrong');
    for (let n = 1; n < LOGIN_LOCK.tries; n++) expect((await checkLogin(db, 'miyaji', 'nope', T0)).status).toBe('wrong');
    expect((await checkLogin(db, 'miyaji', 'nope', T0)).status).toBe('locked');
    // ロック中は正しいパスワードでも入れない。時間が経てば入れる
    expect((await checkLogin(db, 'miyaji', g.password, T0)).status).toBe('locked');
    expect((await checkLogin(db, 'miyaji', g.password, new Date(T0.getTime() + LOGIN_LOCK.minutes * 60_000 + 1))).status).toBe('ok');

    // 最後の宮司は止められない・神職にできない・消せない
    expect(await setDisabled(db, g.account.id, true)).toBe('last_guji');
    expect(await updateAccount(db, g.account.id, { name: '宮司', level: 'shinshoku', pages: null })).toBe('last_guji');
    expect(await deleteAccount(db, g.account.id)).toBe('last_guji');

    const s = await createAccount(db, { loginId: 'shin', name: '神職さん', level: 'shinshoku', pages: ['board', 'members'] }, 'miyaji', T0);
    if (s.status !== 'ok') throw new Error(s.status);
    expect(accountAccess(s.account)).toEqual({ level: 'shinshoku', pages: ['members', 'board'] });
    // 止めると、ログイン中の分も消える。止めているとログインできない
    await db.insert(adminSessions).values({ id: 'h1', userId: 'acct:2', username: 'x', level: 'shinshoku', csrfToken: 'c', expiresAt: new Date(T0.getTime() + 3_600_000), accountId: s.account.id });
    expect(await setDisabled(db, s.account.id, true)).toBe('ok');
    expect(await db.select().from(adminSessions)).toEqual([]);
    expect((await checkLogin(db, 'shin', s.password, T0)).status).toBe('disabled');
    expect(accountAccess({ ...s.account, disabled: true })).toBeUndefined();
    // 作り直すと前のパスワードでは入れない
    await setDisabled(db, s.account.id, false);
    const r = await resetPassword(db, s.account.id);
    if (r.status !== 'ok') throw new Error(r.status);
    expect((await checkLogin(db, 'shin', s.password, T0)).status).toBe('wrong');
    expect((await checkLogin(db, 'shin', r.password, T0)).status).toBe('ok');
  });

  it('🏯 Discord の人を結びつけたアカウントは、組織図で置いた四角のページも使える（結びつけていない・全部見られる・サブアカウントは変えない）', async () => {
    const { accountAccessWithOrg, withOrgPages } = await import('../src/services/webAccounts.js');
    const { saveOrg, DEFAULT_ORG } = await import('../src/services/orgChart.js');
    const { setStaffAlt } = await import('../src/services/staffAlts.js');
    const A = '890000000000000101', ALT = '890000000000000102';
    await saveOrg(db, { ranks: DEFAULT_ORG.ranks, nodes: [{ id: 'g', name: '案内', pages: ['guide', 'members'], x: 0, y: 0 }], placements: [{ memberId: A, nodeId: 'g', rankId: 'member' }, { memberId: ALT, nodeId: 'g', rankId: 'member' }] }, 'admin');
    const base = { level: 'shinshoku' as const, pages: ['board'], disabled: false, writePages: null };
    const linked = await accountAccessWithOrg(db, { ...base, memberId: A });
    expect(linked?.level).toBe('shinshoku');
    expect([...linked!.pages!].sort()).toEqual(['board', 'guide', 'members']);
    expect(await accountAccessWithOrg(db, { ...base, memberId: null })).toEqual({ level: 'shinshoku', pages: ['board'] });
    expect(await accountAccessWithOrg(db, { ...base, pages: null, memberId: A })).toEqual({ level: 'shinshoku', pages: null });
    expect(await accountAccessWithOrg(db, { ...base, disabled: true, memberId: A })).toBeUndefined();
    // 書きこめるページを決めているアカウントは、足したページも書きこめる
    expect(withOrgPages({ level: 'shinshoku', pages: ['board'], writePages: [] }, ['guide'])).toMatchObject({ writePages: ['guide'] });
    // 運営のサブアカウントには足さない
    await setStaffAlt(db, ALT, true, 'admin', '890000000000000103');
    expect(await accountAccessWithOrg(db, { ...base, memberId: ALT })).toEqual({ level: 'shinshoku', pages: ['board'] });
  });
  it('🔑 宮司が決めたパスワードで発行・作り直しができる（8〜128 文字・ID と同じはだめ）', async () => {
    const { passwordOk } = await import('../src/services/webAccounts.js');
    expect(passwordOk('sakura-26', 'tokatsu')).toBe(true);
    expect(passwordOk('short', 'tokatsu')).toBe(false);
    expect(passwordOk('Tokatsu1', 'tokatsu1')).toBe(false);
    expect(passwordOk('        ', 'tokatsu')).toBe(false);
    expect((await createAccount(db, { loginId: 'tokatsu', name: '統括', level: 'shinshoku', pages: ['board'], password: 'short' }, 'g', T0)).status).toBe('bad_password');
    const r = await createAccount(db, { loginId: 'tokatsu', name: '統括', level: 'shinshoku', pages: ['board'], writePages: [], password: 'sakura-2026' }, 'g', T0);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r).toMatchObject({ custom: true, password: 'sakura-2026' });
    expect(r.account.writePages).toEqual([]);
    expect((await checkLogin(db, 'tokatsu', 'sakura-2026', T0)).status).toBe('ok');
    expect((await resetPassword(db, r.account.id, 'tokatsu')).status).toBe('bad_password');
    const again = await resetPassword(db, r.account.id, 'momiji-2026');
    expect(again).toMatchObject({ status: 'ok', custom: true });
    expect((await checkLogin(db, 'tokatsu', 'sakura-2026', T0)).status).not.toBe('ok');
    expect((await checkLogin(db, 'tokatsu', 'momiji-2026', T0)).status).toBe('ok');
    const auto = await resetPassword(db, r.account.id);
    expect(auto).toMatchObject({ status: 'ok', custom: false });
  });
});


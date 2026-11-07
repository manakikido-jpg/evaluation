import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { approveMemberAlt, altsOfMain, issueAltCode, normalizeAltCode, redeemAltCode, removeMemberAlt, requestMemberAlt, setAltRequireApproval, ALT_CODE_TTL_MS } from '../src/services/memberAlts.js';
import { isRestrictedAccount } from '../src/services/staffAlts.js';
import { cfg, makeDb } from './helpers.js';
import { altPanelBody } from '../src/discord/memberAlts.js';
import { commandDefinitions } from '../src/discord/commands.js';

const MAIN = '700000000000000901', ALT = '700000000000000902', OTHER = '700000000000000903';
let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => close());

describe('🔗 メンバーのサブアカウント', () => {
  it('申告 → 承認でサブの銭を本アカウントへ移し、そのあとサブには銭が入らない', async () => {
    await addCoins(db, ALT, 500, 'adjust');
    await addCoins(db, MAIN, 100, 'adjust');
    expect(await requestMemberAlt(db, { altId: ALT, mainId: ALT, by: ALT })).toBe('self');
    expect(await requestMemberAlt(db, { altId: ALT, mainId: MAIN, by: ALT })).toBe('ok');
    expect(await requestMemberAlt(db, { altId: ALT, mainId: OTHER, by: ALT })).toBe('exists');
    expect(await requestMemberAlt(db, { altId: OTHER, mainId: ALT, by: OTHER })).toBe('main_is_alt');
    expect(await requestMemberAlt(db, { altId: MAIN, mainId: OTHER, by: MAIN })).toBe('alt_has_alts');
    // 申告中はまだ制限しない
    expect(await isRestrictedAccount(db, ALT)).toBe(false);
    const [a, b] = await Promise.all([approveMemberAlt(db, ALT, 'staff'), approveMemberAlt(db, ALT, 'staff')]);
    expect([a.status, b.status].sort()).toEqual(['done', 'ok']);
    expect((await walletOf(db, ALT)).balance).toBe(0);
    expect((await walletOf(db, MAIN)).balance).toBe(600);
    expect(await isRestrictedAccount(db, ALT)).toBe(true);
    await addCoins(db, ALT, 300, 'adjust');
    expect((await walletOf(db, ALT)).balance).toBe(0);
    expect((await altsOfMain(db, MAIN)).map((x) => x.altId)).toEqual([ALT]);
    // 外すと、また銭が入る
    expect(await removeMemberAlt(db, ALT, 'staff')).toBe(true);
    await addCoins(db, ALT, 300, 'adjust');
    expect((await walletOf(db, ALT)).balance).toBe(300);
  });
  it('申告パネル: /パネル サブ垢申告 で置け、ボタンで本アカウントを選ぶ', () => {
    expect(commandDefinitions(cfg).find((c) => c.name === 'panel')!.options?.some((o) => o.name === 'alt')).toBe(true);
    expect(altPanelBody().components.flatMap((r) => r.components.map((c) => c.custom_id))).toContain('alt:declare');
  });
  it('本アカウント側の申告は、承認してもサブの銭を移さない（他人のアカウントの銭を取れない）', async () => {
    await addCoins(db, ALT, 500, 'adjust');
    expect(await requestMemberAlt(db, { altId: ALT, mainId: MAIN, by: MAIN })).toBe('ok');
    const r = await approveMemberAlt(db, ALT, 'staff');
    expect(r).toMatchObject({ status: 'ok', moved: 0, kept: true });
    expect((await walletOf(db, ALT)).balance).toBe(500);
    expect((await walletOf(db, MAIN)).balance).toBe(0);
    // 承認のあとは、サブに銭が入らない
    expect(await isRestrictedAccount(db, ALT)).toBe(true);
    await addCoins(db, ALT, 100, 'adjust');
    expect((await walletOf(db, ALT)).balance).toBe(500);
  });
  it('申告パネルに、本アカウントから・サブからの 2 つのボタンがある', () => {
    const ids = altPanelBody().components.flatMap((r) => r.components.map((c) => c.custom_id));
    expect(ids).toEqual(['alt:code_get', 'alt:code_enter', 'alt:declare_main', 'alt:declare']);
    const alt = commandDefinitions(cfg).find((c) => c.name === 'alt')!;
    expect(alt.options?.map((o) => o.name)).toEqual(['declare', 'code', 'enter', 'declare-main']);
  });

  it('🔑 合言葉: 本アカウントが出し、サブが入れると、その場でつながってサブの銭が本アカウントへ移る', async () => {
    await addCoins(db, ALT, 500, 'adjust');
    const now = new Date('2026-11-07T03:00:00Z');
    const issued = await issueAltCode(db, MAIN, now);
    if (issued.status !== 'ok') throw new Error(issued.status);
    expect(issued.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    // 本アカウント自身は入れられない（合言葉は消えない）
    expect(await redeemAltCode(db, MAIN, issued.code, now)).toEqual({ status: 'self' });
    // 空白・小文字・「-」があっても通る
    const typed = `${issued.code.slice(0, 3)}-${issued.code.slice(3)}`.toLowerCase();
    expect(normalizeAltCode(typed)).toBe(issued.code);
    const r = await redeemAltCode(db, ALT, typed, now);
    expect(r).toEqual({ status: 'linked', mainId: MAIN, moved: 500 });
    expect((await walletOf(db, MAIN)).balance).toBe(500);
    expect((await walletOf(db, ALT)).balance).toBe(0);
    expect(await isRestrictedAccount(db, ALT)).toBe(true);
    // 1 回だけ
    expect(await redeemAltCode(db, OTHER, issued.code, now)).toEqual({ status: 'invalid_code' });
    // サブのアカウントは、合言葉を出せない
    expect(await issueAltCode(db, ALT, now)).toEqual({ status: 'main_is_alt' });
  });

  it('🔑 合言葉: 期限切れ・もらい直し・まちがいの回数制限', async () => {
    const t0 = new Date('2026-11-07T03:00:00Z');
    const a = await issueAltCode(db, MAIN, t0);
    if (a.status !== 'ok') throw new Error(a.status);
    const b = await issueAltCode(db, MAIN, t0);
    if (b.status !== 'ok') throw new Error(b.status);
    // もらい直したら、前の合言葉は使えない
    if (a.code !== b.code) expect(await redeemAltCode(db, ALT, a.code, t0)).toEqual({ status: 'invalid_code' });
    // 期限が切れたら使えない
    expect(await redeemAltCode(db, ALT, b.code, new Date(t0.getTime() + ALT_CODE_TTL_MS + 1000))).toEqual({ status: 'invalid_code' });
    // 5 回まちがえると、ほんとうの合言葉でも入れられない
    const c = await issueAltCode(db, MAIN, t0);
    if (c.status !== 'ok') throw new Error(c.status);
    for (let n = 0; n < 3; n++) await redeemAltCode(db, OTHER, 'ZZZZZZ', t0);
    expect(await redeemAltCode(db, OTHER, 'ZZZZZZ', t0)).toEqual({ status: 'invalid_code' });
    expect(await redeemAltCode(db, OTHER, 'ZZZZZZ', t0)).toEqual({ status: 'invalid_code' });
    expect(await redeemAltCode(db, OTHER, c.code, t0)).toEqual({ status: 'locked' });
    // 9 分後はまだ入れない。10 分すぎて、合言葉をもらい直せば、また入れられる
    expect(await redeemAltCode(db, OTHER, c.code, new Date(t0.getTime() + 9 * 60_000))).toEqual({ status: 'locked' });
    const t1 = new Date(t0.getTime() + 11 * 60_000);
    const d = await issueAltCode(db, MAIN, t1);
    if (d.status !== 'ok') throw new Error(d.status);
    expect((await redeemAltCode(db, OTHER, d.code, t1)).status).toBe('linked');
  });

  it('🔑 合言葉: つなげないとき（もうサブ）は、合言葉を使わなかったことになる。「運営の承認を待つ」設定なら申告中で止まる', async () => {
    const t0 = new Date('2026-11-07T03:00:00Z');
    expect(await requestMemberAlt(db, { altId: ALT, mainId: OTHER, by: ALT })).toBe('ok');
    const code = await issueAltCode(db, MAIN, t0);
    if (code.status !== 'ok') throw new Error(code.status);
    expect(await redeemAltCode(db, ALT, code.code, t0)).toEqual({ status: 'exists' });
    await removeMemberAlt(db, ALT, 'staff');
    await addCoins(db, ALT, 200, 'adjust');
    await setAltRequireApproval(db, true, 'staff');
    expect(await redeemAltCode(db, ALT, code.code, t0)).toEqual({ status: 'pending', mainId: MAIN });
    expect(await isRestrictedAccount(db, ALT)).toBe(false);
    expect((await walletOf(db, ALT)).balance).toBe(200);
    // 承認すると、両方の確認ずみなので銭を移す
    expect(await approveMemberAlt(db, ALT, 'staff')).toMatchObject({ status: 'ok', moved: 200, kept: false });
    expect((await walletOf(db, MAIN)).balance).toBe(200);
  });
});


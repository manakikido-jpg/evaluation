import { describe, expect, it } from 'vitest';
import type { GuildChannel, GuildRole } from '../src/lib/discordRest.js';
import { canUsePermission, effectivePermissions, permissionIssues, syncChanges, validatePermissionSnapshot } from '../src/services/permissionCheck.js';
import { cfg } from './helpers.js';
const G = cfg.guildId, A = '900000000000000111', B = '900000000000000112', USER = '900000000000000113';
const bits = (...ns: number[]) => ns.reduce((m, n) => m | (1n << BigInt(n)), 0n).toString();
const role = (id: string, permissions: string): GuildRole => ({ id, name: id, permissions, color: 0, managed: false, position: 1 });
const ch = (id = '900000000000000201', parent_id: string | null = null): GuildChannel => ({ id, name: id, type: 0, position: 0, parent_id, permission_overwrites: [] });
const roles = [role(G, bits(10, 11, 16, 20, 21)), role(A, '0'), role(B, '0')];

describe('権限の点検', () => {
  it('複数ロールの許可を合算し、ロールの順番で結果を変えない', () => {
    const c = ch();
    c.permission_overwrites = [{ id: G, type: 0, allow: '0', deny: bits(10) }, { id: A, type: 0, allow: '0', deny: bits(10, 11) }, { id: B, type: 0, allow: bits(10, 11), deny: '0' }];
    expect(effectivePermissions(c, roles, G, [A]).view).toBe(false);
    expect(effectivePermissions(c, roles, G, [A, B])).toMatchObject({ view: true, send: true, history: true });
    expect(effectivePermissions(c, roles, G, [B, A])).toEqual(effectivePermissions(c, roles, G, [A, B]));
  });
  it('個人の上書きは最後。ロールだけの確認では適用しない。管理者は拒否を越える', () => {
    const c = ch(); c.permission_overwrites = [{ id: USER, type: 1, allow: '0', deny: bits(10) }];
    expect(effectivePermissions(c, roles, G, [A]).view).toBe(true);
    expect(effectivePermissions(c, roles, G, [A], USER).view).toBe(false);
    const admin = effectivePermissions(c, [...roles, role(A, bits(3))], G, [A], USER);
    expect(admin).toMatchObject({ admin: true, view: true, send: true });
    expect(canUsePermission(admin, 48)).toBe(true);
  });
  it('見えない場所では書く・過去ログ・接続も不可。送信と接続に伴う制限も反映', () => {
    const c = ch(); c.permission_overwrites = [{ id: G, type: 0, allow: bits(14, 15, 21), deny: bits(11, 20) }];
    const p = effectivePermissions(c, roles, G, []);
    expect(p).toMatchObject({ view: true, send: false, connect: false, speak: false });
    expect(canUsePermission(p, 14)).toBe(false);
    c.permission_overwrites[0]!.deny = bits(10);
    expect(effectivePermissions(c, roles, G, [])).toMatchObject({ view: false, send: false, history: false, connect: false, speak: false });
  });
  it('未同期の子にはカテゴリの拒否を足さない。同期差分は未知のビットも残す', () => {
    const parent = { ...ch('900000000000000202'), type: 4, permission_overwrites: [{ id: G, type: 0 as const, allow: '0', deny: bits(10, 60) }] };
    const child = ch(undefined, parent.id);
    expect(effectivePermissions(child, roles, G, []).view).toBe(true);
    expect(syncChanges(child, parent, roles)[0]!.labels).toContain('チャンネルを見る');
    expect(syncChanges(child, parent, roles)[0]!.labels).toContain('そのほかの権限');
    const issues = permissionIssues([parent, child], roles, cfg);
    expect(issues.some(i => i.key === `sync:${child.id}` && i.level === 'check')).toBe(true);
    expect(issues.some(i => i.key === `broader:${child.id}`)).toBe(true);
  });
  it('同期している子には未同期の警告を出さない。個人の差分も拾う', () => {
    const parent = { ...ch('900000000000000202'), type: 4 };
    const child = ch(undefined, parent.id);
    expect(permissionIssues([parent, child], roles, cfg).some(i => i.key === `sync:${child.id}`)).toBe(false);
    child.permission_overwrites = [{ id: USER, type: 1, allow: bits(10), deny: '0' }];
    expect(syncChanges(child, parent, roles)[0]).toMatchObject({ id: USER, type: 1 });
  });
  it('一般ロールの管理者・消えたロール・BOT用チャンネルと役職の欠落を確認項目にする', () => {
    const c = ch(); c.permission_overwrites = [{ id: 'gone', type: 0, allow: bits(10), deny: '0' }];
    const issues = permissionIssues([c], [...roles, role(A, bits(3))], cfg);
    expect(issues.some(i => i.key === `role:${A}` && i.level === 'warn')).toBe(true);
    expect(issues.some(i => i.key.startsWith('missing-role:'))).toBe(true);
    expect(issues.some(i => i.key.startsWith('missing-channel:'))).toBe(true);
    expect(issues.some(i => i.key.startsWith('rank:'))).toBe(true);
  });
  it('取得失敗や一部欠落を正常として判定しない', () => {
    expect(() => validatePermissionSnapshot([ch()], roles, G)).not.toThrow();
    expect(() => validatePermissionSnapshot([], roles, G)).toThrow();
    expect(() => validatePermissionSnapshot([ch()], [], G)).toThrow();
    expect(() => validatePermissionSnapshot([ch()], [role(G, 'broken')], G)).toThrow();
    expect(() => validatePermissionSnapshot([{ ...ch(), permission_overwrites: undefined }], roles, G)).toThrow();
  });
});

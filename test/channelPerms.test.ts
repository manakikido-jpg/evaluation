import { describe, expect, it } from 'vitest';
import type { GuildRole } from '../src/lib/discordRest.js';
import { overwriteRows, permKeysFor, planOverwrites, sameOverwrites, triOf, whoCanView, withTri } from '../src/services/channelPerms.js';

const G = '900000000000000000';
const R1 = '900000000000000001';
const R2 = '900000000000000002';
const BOT = '900000000000000099';
const VIEW = String(1 << 10);
const SEND = String(1 << 11);
const role = (id: string, name: string, position: number, permissions = '0', managed = false): GuildRole => ({ id, name, position, managed, color: 0, permissions });

describe('🔐 見られる人・ロール', () => {
  it('種類ごとの権限・許可/拒否/決めないの読み書き（ほかのビットは残す）', () => {
    expect(permKeysFor({ type: 0 })).toEqual(['view', 'send']);
    expect(permKeysFor({ type: 2 })).toEqual(['view', 'connect', 'speak']);
    expect(permKeysFor({ type: 4 })).toEqual(['view', 'send', 'connect']);
    const o = { allow: String((1 << 10) | 1), deny: SEND };
    expect([triOf(o, 'view'), triOf(o, 'send'), triOf(o, 'connect')]).toEqual(['allow', 'deny', 'inherit']);
    expect(withTri(o, 'view', 'deny')).toEqual({ allow: '1', deny: String((1 << 10) | (1 << 11)) });
    expect(withTri(o, 'send', 'inherit')).toEqual({ allow: o.allow, deny: '0' });
  });

  it('今見られるロール: @everyone を拒否して、許可したロールと、もともと見られるロール', () => {
    const roles = [role(G, '@everyone', 0, VIEW), role(R1, '参拝者', 2), role(R2, '神職', 5, String(1 << 3))];
    const ch = { permission_overwrites: [{ id: G, type: 0 as const, allow: '0', deny: VIEW }, { id: R1, type: 0 as const, allow: VIEW, deny: '0' }] };
    expect(whoCanView(ch, roles, G)).toEqual({ everyone: false, roles: ['神職', '参拝者'] });
    expect(whoCanView({ permission_overwrites: [] }, roles, G).everyone).toBe(true);
  });

  it('表の行: @everyone を先に、ロールは上から、人はあと。BOT・連携のロールは変えない', () => {
    const roles = [role(G, '@everyone', 0), role(R1, '参拝者', 2), role(R2, 'BOT', 9, '0', true)];
    const rows = overwriteRows(
      { type: 0, permission_overwrites: [{ id: BOT, type: 1, allow: VIEW, deny: '0' }, { id: R1, type: 0, allow: VIEW, deny: '0' }, { id: G, type: 0, allow: '0', deny: VIEW }, { id: R2, type: 0, allow: VIEW, deny: '0' }] },
      roles,
      new Map([[BOT, '社務所']]),
      G,
      BOT,
    );
    expect(rows.map((r) => [r.name, r.locked])).toEqual([
      ['@everyone（みんな）', false],
      ['@BOT', true],
      ['@参拝者', false],
      ['👤 社務所', true],
    ]);
  });

  it('変える分: 変わったものだけ置く。全部「決めない」・外すは消す', () => {
    const cur = [{ id: R1, type: 0 as const, allow: VIEW, deny: '0' }, { id: R2, type: 0 as const, allow: VIEW, deny: '0' }];
    const p = planOverwrites(
      cur,
      [
        { id: R1, type: 0, tris: { view: 'allow', send: 'deny' } },
        { id: R2, type: 0, tris: { view: 'inherit', send: 'inherit' } },
        { id: G, type: 0, tris: { view: 'deny' } },
      ],
      ['view', 'send'],
    );
    expect(p.set).toEqual([
      { id: R1, type: 0, allow: VIEW, deny: SEND },
      { id: G, type: 0, allow: '0', deny: VIEW },
    ]);
    expect(p.del).toEqual([R2]);
    expect(planOverwrites(cur, [{ id: R1, type: 0, tris: {}, remove: true }], ['view']).del).toEqual([R1]);
    expect(sameOverwrites(cur, [...cur].reverse())).toBe(true);
    expect(sameOverwrites(cur, cur.slice(1))).toBe(false);
  });
});

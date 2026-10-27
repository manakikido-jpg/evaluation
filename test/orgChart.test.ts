import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { makeDb } from './helpers.js';
import { DEFAULT_ORG, loadOrg, orgChartSchema, orgPagesOf, saveOrg, tidyOrg } from '../src/services/orgChart.js';
import { loadNavLayout, resetNavLayout, saveNavLayout } from '../src/services/navLayout.js';
import { arrangeNav, NAV_DEFAULT_GROUPS } from '../src/web/views/layout.js';
import { webAccessOf, type GuildConfig } from '../src/config.js';
import { cfg } from './helpers.js';

let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });
const A = '890000000000000001';

describe('組織図', () => {
  it('はじめは統括・副統括・一般。前の形（木）から場所と線を作り、消えた部署を指す置き方・線を外す', async () => {
    expect((await loadOrg(db)).ranks.map(r => r.name)).toEqual(['統括', '副統括', '一般']);
    const saved = await saveOrg(db, {
      ranks: DEFAULT_ORG.ranks,
      nodes: [{ id: 'top', name: '宮司', parentId: null, pages: [] }, { id: 'a', name: '案内部', parentId: 'top', pages: ['guide', 'guide'] }, { id: 'b', name: '広報部', parentId: 'top', pages: [] }],
      placements: [{ memberId: A, nodeId: 'a', rankId: 'lead' }, { memberId: A, nodeId: 'a', rankId: 'sub' }, { memberId: A, nodeId: 'gone', rankId: 'lead' }],
    }, 'admin');
    expect(saved.placements).toEqual([{ memberId: A, nodeId: 'a', rankId: 'lead' }]);
    expect(saved.nodes.find(n => n.id === 'a')!.pages).toEqual(['guide']);
    expect(saved.nodes.every(n => typeof n.x === 'number' && typeof n.y === 'number' && n.w === 220 && n.h === 120)).toBe(true);
    const top = saved.nodes.find(n => n.id === 'top')!, a = saved.nodes.find(n => n.id === 'a')!;
    expect(a.y!).toBeGreaterThan(top.y!);
    expect(saved.edges.map(e => [e.from, e.to]).sort()).toEqual([['top', 'a'], ['top', 'b']]);
    // 線: 消えた部署へつながる線は外す。場所・大きさ・曲がり角はそのまま
    const again = await saveOrg(db, { ...saved, nodes: saved.nodes.map(n => n.id === 'a' ? { ...n, x: 999, w: 400 } : n), edges: [...saved.edges.map(e => ({ ...e, bends: [{ x: 1, y: 2 }] })), { id: 'x1', from: 'a', to: 'nope', bends: [], dashed: true }] }, 'admin');
    expect(again.nodes.find(n => n.id === 'a')).toMatchObject({ x: 999, w: 400 });
    expect(again.edges).toHaveLength(2); expect(again.edges[0]!.bends).toEqual([{ x: 1, y: 2 }]);
    await expect(saveOrg(db, { ranks: [], nodes: [], placements: [] }, 'admin')).rejects.toThrow();
  });
  it('四角ごとに別の役職を作れ、その四角ではその役職だけ選べる', async () => {
    const saved = await saveOrg(db, {
      ranks: DEFAULT_ORG.ranks,
      nodes: [{ id: 'f', name: 'フロント', pages: [], x: 0, y: 0, ranks: [{ id: 'chief', name: '統括' }, { id: 'clerk', name: '主典' }] }, { id: 'b', name: 'バック', pages: [], x: 300, y: 0, ranks: [] }],
      placements: [{ memberId: A, nodeId: 'f', rankId: 'clerk' }, { memberId: '890000000000000002', nodeId: 'f', rankId: 'lead' }, { memberId: A, nodeId: 'b', rankId: 'sub' }],
    }, 'admin');
    expect(saved.nodes.find(n => n.id === 'f')!.ranks!.map(r => r.name)).toEqual(['統括', '主典']);
    expect(saved.nodes.find(n => n.id === 'b')!.ranks).toBeUndefined();
    expect(saved.placements).toEqual([{ memberId: A, nodeId: 'f', rankId: 'clerk' }, { memberId: A, nodeId: 'b', rankId: 'sub' }]);
  });
  it('置いた部署のページだけ社務所Webで使える（全部見られる人はそのまま）', () => {
    const c = tidyOrg(orgChartSchema.parse({ ranks: DEFAULT_ORG.ranks, nodes: [{ id: 'g', name: '案内', pages: ['guide', 'members'], x: 0, y: 0 }], placements: [{ memberId: A, nodeId: 'g', rankId: 'member' }] }));
    expect(orgPagesOf(c, A)).toEqual(['members', 'guide']);
    const conf = { ...cfg, webAccess: { shinshokuRoleIds: [], entries: [] } } as GuildConfig;
    expect(webAccessOf(conf, A, [])).toBeUndefined();
    expect(webAccessOf(conf, A, [], orgPagesOf(c, A))).toEqual({ level: 'shinshoku', pages: ['members', 'guide'] });
    const guji = cfg.ranks.find(r => r.key === 'guji')!.roleId;
    expect(webAccessOf(conf, A, [guji], ['guide'])).toEqual({ level: 'guji', pages: null });
  });
});

describe('メニューの並び方', () => {
  it('カテゴリと順番を組みかえ、並びにないページはもとのカテゴリの後ろに出す', async () => {
    expect(await loadNavLayout(db)).toBeUndefined();
    await saveNavLayout(db, { groups: [{ title: 'よく使う', keys: ['members', 'guide', 'members'] }, { title: NAV_DEFAULT_GROUPS[0]!.title, keys: [] }] }, 'admin');
    const layout = (await loadNavLayout(db))!;
    expect(layout.groups[0]).toEqual({ title: 'よく使う', keys: ['members', 'guide'] });
    const nav = arrangeNav(layout);
    expect(nav[0]!.items.map(i => i.key)).toEqual(['members', 'guide']);
    expect(nav[1]!.items.map(i => i.key)).toContain('home');
    const all = nav.flatMap(g => g.items.map(i => i.key));
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(NAV_DEFAULT_GROUPS.flatMap(g => g.keys).length);
    await resetNavLayout(db, 'admin');
    expect(await loadNavLayout(db)).toBeUndefined();
  });
});

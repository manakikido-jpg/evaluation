import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { makeDb } from './helpers.js';
import { DEFAULT_ORG, loadOrg, orgPagesOf, saveOrg, tidyOrg } from '../src/services/orgChart.js';
import { loadNavLayout, resetNavLayout, saveNavLayout } from '../src/services/navLayout.js';
import { arrangeNav, NAV_DEFAULT_GROUPS } from '../src/web/views/layout.js';
import { webAccessOf, type GuildConfig } from '../src/config.js';
import { cfg } from './helpers.js';

let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });
const A = '890000000000000001';

describe('組織図', () => {
  it('はじめは統括・副統括・一般。保存すると消えた部署の置き方や輪になった親を直す', async () => {
    expect((await loadOrg(db)).ranks.map(r => r.name)).toEqual(['統括', '副統括', '一般']);
    const saved = await saveOrg(db, {
      ranks: DEFAULT_ORG.ranks,
      nodes: [{ id: 'top', name: '宮司', parentId: null, pages: [] }, { id: 'a', name: '案内部', parentId: 'b', pages: ['guide', 'guide'] }, { id: 'b', name: '広報部', parentId: 'a', pages: [] }],
      placements: [{ memberId: A, nodeId: 'a', rankId: 'lead' }, { memberId: A, nodeId: 'a', rankId: 'sub' }, { memberId: A, nodeId: 'gone', rankId: 'lead' }],
    }, 'admin');
    expect(saved.placements).toEqual([{ memberId: A, nodeId: 'a', rankId: 'lead' }]);
    expect(saved.nodes.find(n => n.id === 'a')!.pages).toEqual(['guide']);
    // a→b→a の輪は、どちらかが一番上になる
    expect(saved.nodes.filter(n => n.parentId === null).length).toBeGreaterThanOrEqual(2);
    expect((await loadOrg(db)).nodes).toHaveLength(3);
    await expect(saveOrg(db, { ranks: [], nodes: [], placements: [] }, 'admin')).rejects.toThrow();
  });
  it('置いた部署のページだけ社務所Webで使える（全部見られる人はそのまま）', () => {
    const c = tidyOrg({ ranks: DEFAULT_ORG.ranks, nodes: [{ id: 'g', name: '案内', parentId: null, pages: ['guide', 'members'] }], placements: [{ memberId: A, nodeId: 'g', rankId: 'member' }] });
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

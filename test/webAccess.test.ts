import { describe, expect, it } from 'vitest';
import { webAccessEntries, webAccessOf, webPageOf, type GuildConfig } from '../src/config.js';
import { cfg, ROLE } from './helpers.js';

const OLD_ROLE = '980000000000000061';
const HELPER_ROLE = '980000000000000062';
const ME = '800000000000000061';
const withAccess = (webAccess: GuildConfig['webAccess']): GuildConfig => ({ ...cfg, webAccess });

describe('社務所Web に入れる人', () => {
  it('URL のページ: 1 段目で決める。選べないページは undefined', () => {
    expect(webPageOf('/')).toBe('home');
    expect(webPageOf('/members/123')).toBe('members');
    expect(webPageOf('/omairi')).toBe('applications');
    expect(webPageOf('/shop')).toBeUndefined();
    expect(webPageOf('/updates')).toBeUndefined();
  });

  it('前の形（ロールだけ）は全部のページ。ロールの行は合わせる。人の行が先', () => {
    const c = withAccess({
      shinshokuRoleIds: [OLD_ROLE],
      entries: [
        { kind: 'role', id: HELPER_ROLE, pages: ['board'] },
        { kind: 'role', id: ROLE.ujiko, pages: ['cast', 'board'] },
      ],
    });
    expect(webAccessEntries(c).map((e) => e.id)).toEqual([OLD_ROLE, HELPER_ROLE, ROLE.ujiko]);
    expect(webAccessOf(c, ME, [OLD_ROLE])).toEqual({ level: 'shinshoku', pages: null });
    expect(webAccessOf(c, ME, [HELPER_ROLE, ROLE.ujiko])).toEqual({ level: 'shinshoku', pages: ['board', 'cast'] });
    expect(webAccessOf(c, ME, [ROLE.sanpaisha])).toBeUndefined();
    // 神職はロールの行では絞らない。宮司はいつも全部
    expect(webAccessOf(c, ME, [ROLE.shinshoku, ROLE.ujiko])).toEqual({ level: 'shinshoku', pages: null });
    const mine = withAccess({ shinshokuRoleIds: [], entries: [{ kind: 'member', id: ME, pages: ['economy'] }] });
    expect(webAccessOf(mine, ME, [ROLE.shinshoku])).toEqual({ level: 'shinshoku', pages: ['economy'] });
    expect(webAccessOf(mine, ME, [ROLE.guji])).toEqual({ level: 'guji', pages: null });
    const none = withAccess({ shinshokuRoleIds: [], entries: [{ kind: 'member', id: ME, pages: [] }] });
    expect(webAccessOf(none, ME, [ROLE.shinshoku])).toBeUndefined();
  });
});

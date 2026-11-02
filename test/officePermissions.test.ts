import { describe, expect, it } from 'vitest';
import { webAccessOf, webPageOf } from '../src/config.js';
import { OFFICE_PRESETS, parseOfficeGrant } from '../src/domain/officeAccess.js';
import { cfg, ROLE } from './helpers.js';
const user = '700000000000000051', helper = '700000000000000052';
describe('担当別の閲覧と操作', () => {
  it('セットは宮司権限を含まず、閲覧のみセットに書き込みはない', () => {
    expect(OFFICE_PRESETS.find(p => p.id === 'reader')!.writePages).toEqual([]);
    for (const p of OFFICE_PRESETS) for (const page of p.writePages) expect(p.pages).toContain(page);
    expect(parseOfficeGrant({ page_guide: 'write', page_soudan: 'read', page_settings: 'write', page_market: 'evil' })).toEqual({ pages: ['soudan', 'guide'], writePages: ['guide'] });
  });
  it('個人の閲覧のみは神職・組織図でも操作できるようにならない。宮司は制限しない', () => {
    const c = { ...cfg, webAccess: { shinshokuRoleIds: [], entries: [{ kind: 'member' as const, id: user, pages: ['guide' as const], writePages: [] }] } };
    expect(webAccessOf(c, user, [ROLE.shinshoku], ['economy'])).toEqual({ level: 'shinshoku', pages: ['guide'], writePages: [] });
    expect(webAccessOf(c, user, [ROLE.guji], ['economy'])).toEqual({ level: 'guji', pages: null });
    c.webAccess.entries[0]!.pages = [];
    expect(webAccessOf(c, user, [ROLE.shinshoku], ['economy'])).toBeUndefined();
  });
  it('書けるロールが一つあっても、別の閲覧専用ページを書けるようにはしない', () => {
    const c = { ...cfg, webAccess: { shinshokuRoleIds: [], entries: [
      { kind: 'role' as const, id: helper, pages: ['soudan' as const], writePages: [] },
      { kind: 'role' as const, id: ROLE.ujiko, pages: ['guide' as const] },
    ] } };
    expect(webAccessOf(c, user, [helper, ROLE.ujiko])).toEqual({ level: 'shinshoku', pages: ['soudan', 'guide'], writePages: ['guide'] });
    expect(webPageOf('/voice-now.json')).toBe('voice');
    expect(webPageOf('/message-archive/file/1')).toBe('audit');
    expect(webPageOf('/security/raid/start')).toBe('security');
  });
});

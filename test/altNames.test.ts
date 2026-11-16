import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { memberAlts } from '../src/db/schema.js';
import { AltNameApp } from '../src/discord/altNames.js';
import { altNameTargets, altNickname } from '../src/services/memberAlts.js';
import { cfg, makeDb } from './helpers.js';

const MAIN = '850000000000000001';
const ALT1 = '850000000000000002';
const ALT2 = '850000000000000003';
const ALT3 = '850000000000000004';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => close());

describe('🏷 サブの名前を本アカウントに合わせる', () => {
  it('名前の作り方（サブ・サブ2…・32 文字まで）', () => {
    expect(altNickname('さくら', 0)).toBe('さくら サブ');
    expect(altNickname('さくら', 1)).toBe('さくら サブ2');
    expect(altNickname('さくら', 2)).toBe('さくら サブ3');
    expect(altNickname('あ'.repeat(40), 0)).toHaveLength(32);
    expect(altNickname('あ'.repeat(40), 0).endsWith(' サブ')).toBe(true);
    expect(altNickname('', 0)).toBe('メンバー サブ');
  });

  it('承認ずみのサブだけ、古い順に サブ・サブ2 を付ける', async () => {
    await db.insert(memberAlts).values([
      { altId: ALT1, mainId: MAIN, status: 'approved', requestedBy: MAIN, createdAt: new Date('2026-01-01') },
      { altId: ALT2, mainId: MAIN, status: 'approved', requestedBy: MAIN, createdAt: new Date('2026-01-02') },
      { altId: ALT3, mainId: MAIN, status: 'pending', requestedBy: MAIN, createdAt: new Date('2026-01-03') },
    ]);
    expect(await altNameTargets(db, MAIN, 'さくら')).toEqual([
      { altId: ALT1, nick: 'さくら サブ' },
      { altId: ALT2, nick: 'さくら サブ2' },
    ]);
  });

  it('本アカウントの名前が変わると、承認ずみのサブの名前も変わる', async () => {
    await db.insert(memberAlts).values([
      { altId: ALT1, mainId: MAIN, status: 'approved', requestedBy: MAIN, createdAt: new Date('2026-01-01') },
      { altId: ALT2, mainId: MAIN, status: 'pending', requestedBy: MAIN, createdAt: new Date('2026-01-02') },
    ]);
    const set: [string, string | null][] = [];
    const alt = (id: string, nickname: string | null) => ({ id, nickname, manageable: true, setNickname: async (n: string) => void set.push([id, n]) });
    const alts = new Map([[ALT1, alt(ALT1, '前の名前')], [ALT2, alt(ALT2, null)]]);
    const main = (name: string) => ({ id: MAIN, displayName: name, user: { bot: false }, guild: { id: cfg.guildId, members: { fetch: async (id: string) => alts.get(id) } } });
    const app = new AltNameApp(db, () => cfg);

    await app.onMemberUpdate({ partial: false, displayName: 'さくら' } as never, main('はなこ') as never);
    expect(set).toEqual([[ALT1, 'はなこ サブ']]); // 承認ずみの ALT1 だけ。pending の ALT2 は変えない

    // 名前が変わっていなければ、何もしない
    set.length = 0;
    await app.onMemberUpdate({ partial: false, displayName: 'はなこ' } as never, main('はなこ') as never);
    expect(set).toEqual([]);

    // すでに合っていれば、変えない
    alts.get(ALT1)!.nickname = 'はなこ サブ';
    await app.onMemberUpdate({ partial: false, displayName: 'さくら' } as never, main('はなこ') as never);
    expect(set).toEqual([]);
  });
});

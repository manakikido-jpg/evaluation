import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { audit, hideGujiAudit, listAudit } from '../src/services/audit.js';
import { recordJoin } from '../src/services/members.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const GUJI1 = '840000000000000001';
const GUJI2 = '840000000000000002';
const STAFF = '840000000000000003'; // 神職
const USER = '840000000000000004';

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const [id, roles] of [
    [GUJI1, [ROLE.guji]],
    [GUJI2, [ROLE.guji]],
    [STAFF, [ROLE.shinshoku]],
    [USER, [ROLE.ujiko]],
  ] as const) {
    await recordJoin(db, { id, username: id, displayName: `n${id.slice(-1)}`, avatarUrl: null, roleIds: [...roles], isBot: false, joinedAt: null });
  }
  await audit(db, { actorId: GUJI1, targetId: USER, action: 'yaku.add', via: 'web' });
  await audit(db, { actorId: GUJI2, targetId: USER, action: 'member.ban', via: 'web' });
  await audit(db, { actorId: STAFF, targetId: USER, action: 'yaku.add', via: 'discord' });
  await audit(db, { actorId: 'system', action: 'auto', via: 'system' });
});
afterEach(async () => close());

const actors = async (viewer: string) => (await hideGujiAudit(db, cfg, await listAudit(db, {}), viewer)).map((r) => r.actorId).sort();

describe('🔒 記録: 宮司の操作は、した本人の宮司にだけ見える', () => {
  it('神職には、宮司の操作が見えない（自分と system は見える）', async () => {
    expect(await actors(STAFF)).toEqual([STAFF, 'system']);
  });
  it('宮司は、自分の操作は見えるが、ほかの宮司の操作は見えない', async () => {
    expect(await actors(GUJI1)).toEqual([GUJI1, STAFF, 'system'].sort());
    expect(await actors(GUJI2)).toEqual([GUJI2, STAFF, 'system'].sort());
  });
  it('記録そのものは消えていない（内部の読み出しは全部見える）', async () => {
    expect((await listAudit(db, {})).length).toBe(4);
  });
});

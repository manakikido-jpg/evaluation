import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { keibaEntries, keibaHorses } from '../src/db/schema.js';
import { hallOfFame, horseTitles, isHall, rivalPairsAmong, rivalsOf } from '../src/services/casino/keibaHonors.js';
import { addHorse, loadRoster } from '../src/services/casino/keibaStable.js';
import { makeDb } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

const run = (horseId: number, name: string, race: string, at: Date, pos: number, cls = 5) =>
  db.insert(keibaEntries).values({ horseId, horseName: name, ownerId: null, race, cls, dist: 2000, surface: 0, going: 0, field: 8, no: pos, pop: 1, odds: 20, pos, time: '2:00.0', margin: '', last3f: 350, corners: '', prize: 0, at });

describe('🏆 称号・殿堂', () => {
  it('記録から称号を付ける', () => {
    expect(horseTitles([])).toEqual([]);
    const g1 = Array.from({ length: 2 }, () => ({ cls: 8, pos: 1 }));
    expect(horseTitles(g1)).toEqual(['🏛 殿堂入り', '👑 G1 2 勝']);
    expect(horseTitles([{ cls: 8, pos: 1 }])).toEqual(['👑 G1 馬']);
    expect(horseTitles([{ cls: 8, pos: 1 }], true)).toEqual(['🏛 殿堂入り', '👑 G1 馬']);
    const graded = [{ cls: 6, pos: 1 }, { cls: 7, pos: 1 }, { cls: 6, pos: 1 }, { cls: 5, pos: 1 }, { cls: 5, pos: 1 }];
    expect(horseTitles(graded)).toEqual(['🎖 重賞 3 勝', '✨ 5 戦 5 勝・無敗']);
    expect(horseTitles(Array.from({ length: 100 }, () => ({ cls: 2, pos: 5 })))).toEqual(['🛡 100 戦の鉄人']);
    expect(isHall(1, false)).toBe(false);
  });

  it('殿堂: G1 を 2 勝（引退した馬は 1 勝）', async () => {
    const a = (await addHorse(db, 'イチバンボシ'))!;
    const b = (await addHorse(db, 'ニバンボシ'))!;
    const c = (await addHorse(db, 'サンバンボシ'))!;
    const t = new Date('2026-10-01T12:00:00Z');
    await run(a.id, a.name, 'G1 その1', t, 1, 8);
    await run(a.id, a.name, 'G1 その2', new Date(t.getTime() + 1000), 1, 8);
    await run(b.id, b.name, 'G1 その3', new Date(t.getTime() + 2000), 1, 8);
    await run(c.id, c.name, 'G1 その4', new Date(t.getTime() + 3000), 1, 8);
    await db.update(keibaHorses).set({ retiredAt: t }).where(eq(keibaHorses.id, c.id));
    expect((await hallOfFame(db)).map((h) => [h.name, h.g1, h.retired])).toEqual([
      ['イチバンボシ', 2, false],
      ['サンバンボシ', 1, true],
    ]);
  });
});

describe('⚔ 宿敵', () => {
  it('1・2 着を 3 回争ったら宿敵。出馬表の名簿にも付く', async () => {
    const a = (await addHorse(db, 'アカツキ'))!;
    const b = (await addHorse(db, 'ヨイヤミ'))!;
    const c = (await addHorse(db, 'ハクロ'))!;
    const t = new Date('2026-10-01T12:00:00Z').getTime();
    for (let k = 0; k < 3; k++) {
      const at = new Date(t + k * 60_000);
      await run(a.id, a.name, `レース${k}`, at, k === 2 ? 2 : 1);
      await run(b.id, b.name, `レース${k}`, at, k === 2 ? 1 : 2);
      await run(c.id, c.name, `レース${k}`, at, 3);
    }
    // 2 回だけ争った組は宿敵にならない
    for (let k = 3; k < 5; k++) {
      const at = new Date(t + k * 60_000);
      await run(a.id, a.name, `レース${k}`, at, 1);
      await run(c.id, c.name, `レース${k}`, at, 2);
    }
    expect(await rivalsOf(db, a.id)).toEqual([{ id: b.id, name: 'ヨイヤミ', meets: 3, ahead: 2, behind: 1 }]);
    expect(await rivalsOf(db, c.id)).toEqual([]);
    expect(await rivalPairsAmong(db, [a.id, b.id, c.id])).toEqual([[a.id, b.id].sort((x, y) => x - y)]);
    const roster = await loadRoster(db);
    expect(roster.find((h) => h.id === a.id)?.rivals).toEqual([b.id]);
    expect(roster.find((h) => h.id === c.id)?.rivals).toBeUndefined();
  });
});

import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { perkUjikoEnabled, setPerkUjiko, meetsUjiko } from '../src/services/perkGate.js';
import { casinoAllowed } from '../src/web/casino.js';
import { cfg, makeDb, ROLE } from './helpers.js';

let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => close());

it('特典ゲートの ON/OFF（既定は OFF）', async () => {
  expect(await perkUjikoEnabled(db)).toBe(false);
  await setPerkUjiko(db, true, 'guji');
  expect(await perkUjikoEnabled(db)).toBe(true);
  await setPerkUjiko(db, false, 'guji');
  expect(await perkUjikoEnabled(db)).toBe(false);
});

it('meetsUjiko：氏子以上だけ true', () => {
  expect(meetsUjiko(cfg, [ROLE.sanpaisha])).toBe(false);
  expect(meetsUjiko(cfg, [ROLE.ujiko])).toBe(true);
  expect(meetsUjiko(cfg, [ROLE.sewayaku])).toBe(true);
  expect(meetsUjiko(cfg, [])).toBe(false);
});

it('casinoAllowed：ujikoOnly のとき氏子以上だけ入れる', () => {
  // OFF（既定）：位のロールがあれば参拝者でも入れる
  expect(casinoAllowed(cfg, [ROLE.sanpaisha])).toBe(true);
  // ON：参拝者は入れない・氏子以上は入れる
  expect(casinoAllowed(cfg, [ROLE.sanpaisha], true)).toBe(false);
  expect(casinoAllowed(cfg, [ROLE.ujiko], true)).toBe(true);
  expect(casinoAllowed(cfg, [ROLE.sewayaku], true)).toBe(true);
});

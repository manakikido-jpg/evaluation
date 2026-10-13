import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as E from '../src/services/shinpu/engine.js';
function game() {
  return E.create(3, () => 0, 'test');
}
function hand(s: E.State, i: number, ids: string[]) {
  s.players[i]!.hand = ids.map((id, n) => ({ ...E.cards.find((c) => c.id === id)!, uid: 100 + i * 20 + n }));
  return s.players[i]!.hand.map((c) => c.uid);
}
test('multi-card attacks spend MP, remove cards and wait for defense', () => {
  const s = game(),
    a = hand(s, 0, ['arrow', 'sun']);
  E.act(s, 'attack', a, 1);
  assert.equal(s.phase, 'defense');
  assert.equal(s.players[0]!.mp, 8);
  assert.equal(s.pending!.power, 14);
  assert.equal(s.players[0]!.hand.length, 0);
  const d = hand(s, 1, ['shield']);
  E.defend(s, d);
  assert.equal(s.players[1]!.hp, 51);
  assert.equal(s.turn, 1);
  assert.equal(s.players[1]!.hand.length, 7);
});
test('invalid target and mixed cards do not mutate resources', () => {
  const s = game(),
    a = hand(s, 0, ['sun', 'water']),
    before = JSON.stringify(s);
  assert.throws(() => E.act(s, 'attack', a, 1));
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => E.act(s, 'attack', [a[0]!], 0));
  assert.equal(JSON.stringify(s), before);
});
test('duplicate card ids cannot multiply damage', () => {
  const s = game(),
    a = hand(s, 0, ['arrow']);
  assert.throws(() => E.act(s, 'attack', [a[0]!, a[0]!], 1));
  assert.equal(s.phase, 'action');
});
test('invalid defense or insufficient MP does not resolve incoming attack', () => {
  const s = game(),
    a = hand(s, 0, ['arrow']);
  E.act(s, 'attack', a, 1);
  const d = hand(s, 1, ['mirror']);
  s.players[1]!.mp = 0;
  assert.throws(() => E.defend(s, d));
  assert.equal(s.players[1]!.hp, 60);
  assert.equal(s.phase, 'defense');
  E.defend(s, []);
  assert.equal(s.players[1]!.hp, 55);
});
test('reflection damages attacker and may end match', () => {
  const s = E.create(2, () => 0),
    a = hand(s, 0, ['sun']);
  s.players[0]!.hp = 2;
  E.act(s, 'attack', a, 1);
  E.defend(s, hand(s, 1, ['mirror']));
  assert.equal(s.players[0]!.hp, 0);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 1);
});
test('drain heals only half actual unblocked damage', () => {
  const s = game();
  s.players[0]!.hp = 40;
  E.act(s, 'attack', hand(s, 0, ['drain']), 1);
  E.defend(s, hand(s, 1, ['veil']));
  assert.equal(s.players[0]!.hp, 41);
  assert.equal(s.players[1]!.hp, 58);
});
test('burn applies on next turns and cleanse clears it', () => {
  const s = game();
  E.act(s, 'attack', hand(s, 0, ['curse']), 1);
  E.defend(s, []);
  assert.equal(s.players[1]!.hp, 54);
  assert.equal(s.players[1]!.burn, 2);
  E.act(s, 'use', hand(s, 1, ['cleanse']));
  assert.equal(s.players[1]!.burn, 0);
  assert.equal(s.players[1]!.hp, 59);
});
test('exchange spends resources and respects caps', () => {
  const s = game();
  s.players[0]!.hp = 58;
  E.act(s, 'exchange', [], 'hp');
  assert.equal(s.players[0]!.hp, 60);
  assert.equal(s.players[0]!.money, 16);
  assert.equal(s.turn, 1);
  const x = game();
  x.players[0]!.mp = 0;
  assert.throws(() => E.act(x, 'exchange', [], 'coin'));
  assert.equal(x.players[0]!.money, 20);
});
test('healing is capped and consumes exactly one card', () => {
  const s = game();
  s.players[0]!.hp = 59;
  E.act(s, 'use', hand(s, 0, ['water']));
  assert.equal(s.players[0]!.hp, 60);
  assert.equal(s.players[0]!.hand.length, 0);
});
test('draw obeys ten-card cap', () => {
  const s = game();
  hand(s, 0, Array(10).fill('draw'));
  E.act(s, 'use', [s.players[0]!.hand[0]!.uid]);
  assert.equal(s.players[0]!.hand.length, 10);
});
test('eliminated players are skipped and no action after game over', () => {
  const s = game();
  s.players[1]!.hp = 0;
  E.act(s, 'pass');
  assert.equal(s.turn, 2);
  s.players[2]!.hp = 0;
  E.act(s, 'pass');
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
  assert.throws(() => E.act(s, 'pass'));
});
test('100 seeded CPU games finish, with valid resource ranges', () => {
  for (let n = 1; n <= 100; n++) {
    let seed = n;
    const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const s = E.create(2 + (n % 5), rng);
    for (let step = 0; s.phase !== 'over' && step < 200; step++) {
      E.cpu(s);
      for (const p of s.players) {
        assert.ok(p.hp >= 0 && p.hp <= 60);
        assert.ok(p.mp >= 0 && p.mp <= 20);
        assert.ok(p.money >= 0);
        assert.ok(p.hand.length <= 10);
      }
    }
    assert.equal(s.phase, 'over');
  }
});

import { keiba } from '../src/services/casino/tables/keiba.js';
import type { Ctx } from '../src/services/casino/tables/types.js';
import { cfg } from './helpers.js';
const who = { id: '760000000000000001', name: 'さくら' };
export function broadcastFixture() {
  let seed=317;
  const ctx: Ctx={ now: Date.parse('2026-10-27T03:00:00Z'), cfg, rng: n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/2**32*n);} };
  const created=keiba.create(who,{dist:'2400'},ctx);
  if(!created.ok)throw Error('create');
  const started=keiba.act(created.state,who.id,{action:'start'},ctx);
  if(!started.ok)throw Error('start');
  return {betting:created.state,racing:started.state,ctx};
}

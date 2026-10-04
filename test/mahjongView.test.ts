import { describe, expect, it } from 'vitest';
import type { CasinoTable, MemberSession } from '../src/db/schema.js';
import type { Rng } from '../src/services/casino/cards.js';
import { mahjong, type MjState } from '../src/services/casino/tables/mahjong.js';
import { MahjongView } from '../src/web/views/mahjong.js';
import { cfg } from './helpers.js';

const seeded = (seed: number): Rng => {
  let x = seed;
  return (n) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x % n;
  };
};
const HOST = { id: '700000000000000001', name: 'ほすと' };
const ids = (spec: string) => {
  const out: number[] = [];
  const used = new Map<number, number>();
  for (const m of spec.matchAll(/(\d+)([mpsz])/g)) {
    const base = { m: 0, p: 9, s: 18, z: 27 }[m[2] as 'm'];
    for (const ch of m[1]!) {
      const k = base + Number(ch) - 1;
      const c = used.get(k) ?? (k < 27 && k % 9 === 4 ? 1 : 0);
      used.set(k, c + 1);
      out.push(k * 4 + c);
    }
  }
  return out;
};

describe('🀄 麻雀の画面', () => {
  it('自分の番: 切るとテンパイの牌に待ちと残り枚数・便利ボタン・方角盤', () => {
    const ctx = { now: 5, rng: seeded(3), cfg };
    let r = mahjong.create(HOST, { wager: 'off', length: 'tonpu' }, ctx);
    if (!r.ok) throw new Error(r.error);
    r = mahjong.act(r.state, HOST.id, { action: 'start' }, ctx);
    if (!r.ok) throw new Error(r.error);
    const s: MjState = structuredClone(r.state);
    const h = s.seats.findIndex((x) => x.id === HOST.id);
    s.turn = h;
    s.step = 'turn';
    s.hands[h] = ids('123m456p789s11z22z7z');
    s.drawn = s.hands[h]!.at(-1)!;
    s.rivers = [[], [], [], []];
    s.melds = [[], [], [], []];
    s.seats[h]!.prefs = { noCall: true };
    const me = { session: { userId: HOST.id, csrfToken: 'x', displayName: 'ほすと' } as MemberSession, balance: 0, coin: { name: '銭', emoji: '🪙' } };
    const html = String(MahjongView({ t: { id: 1 } as CasinoTable, s, me, now: 5 }));
    expect(html).toContain('中を切ると 待ち 東 残り2・南 残り2（あと 4 枚）');
    expect(html).toContain('mj-compass');
    expect(html).toContain('あなたの番');
    expect(html).toMatch(/class="mj-pref on"[^>]*>鳴きなし/);
    expect(html).toContain('data-mj-twotap');
  });

  it('三人打ち: 3 席の方角盤（向かいは空き）・北抜きボタン・抜いた北', () => {
    const ctx = { now: 5, rng: seeded(3), cfg };
    let r = mahjong.create(HOST, { wager: 'off', length: 'tonpu', players: '3' }, ctx);
    if (!r.ok) throw new Error(r.error);
    r = mahjong.act(r.state, HOST.id, { action: 'start' }, ctx);
    if (!r.ok) throw new Error(r.error);
    const s: MjState = structuredClone(r.state);
    const h = s.seats.findIndex((x) => x.id === HOST.id);
    s.turn = h;
    s.step = 'turn';
    s.hands[h] = ids('111m456p789s11z22z4z');
    s.drawn = s.hands[h]!.at(-1)!;
    s.nuki = [[], [], []];
    s.nuki[h] = ids('4z').map((t) => t + 1);
    const me = { session: { userId: HOST.id, csrfToken: 'x', displayName: 'ほすと' } as MemberSession, balance: 0, coin: { name: '銭', emoji: '🪙' } };
    const html = String(MahjongView({ t: { id: 1 } as CasinoTable, s, me, now: 5 }));
    expect(html).toContain('mj-board2 sanma');
    expect(html).toContain('mj-otop mj-empty');
    expect(html.match(/class="mj-cedge /g)).toHaveLength(3);
    expect(html).toContain('value="kita"');
    expect(html).toContain('mj-meld mj-nuki');
  });
});

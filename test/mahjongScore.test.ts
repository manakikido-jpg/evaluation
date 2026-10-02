import { describe, expect, it } from 'vitest';
import { scoreWin, type Meld, type WinInput } from '../src/services/casino/mahjong/score.js';
import { shanten, waitsOf } from '../src/services/casino/mahjong/shanten.js';
import { countsOf, doraOf, EAST } from '../src/services/casino/mahjong/tiles.js';

/** "123m456p789s11z" → 牌の番号（同じ種類は 1 枚目から順に。赤 5 は "0"） */
function tiles(spec: string): number[] {
  const out: number[] = [];
  const used = new Map<number, number>();
  for (const m of spec.matchAll(/(\d+)([mpsz])/g)) {
    const base = { m: 0, p: 9, s: 18, z: 27 }[m[2] as 'm' | 'p' | 's' | 'z'];
    for (const ch of m[1]!) {
      const red = ch === '0' && m[2] !== 'z';
      const k = base + (red ? 4 : Number(ch) - 1);
      // 赤は 1 枚目（copy 0）。ふつうの 5 は copy 1 から
      let copy = used.get(k) ?? (k % 9 === 4 && k < 27 ? 1 : 0);
      if (red) copy = 0;
      else used.set(k, copy + 1);
      out.push(k * 4 + copy);
    }
  }
  return out;
}

const base = (hand: string, win: string, o: Partial<WinInput> = {}): WinInput => {
  const h = tiles(hand);
  const w = tiles(win)[0]!;
  // 和了牌は手と同じ種類でも別の牌にする
  const winTile = h.includes(w) ? w + 1 : w;
  return { hand: [...h, winTile], melds: [], winTile, ron: true, seatWind: EAST + 1, roundWind: EAST, dealer: false, doraIndicators: [], uraIndicators: [], ...o };
};

describe('向聴数', () => {
  it('和了・テンパイ・一向聴', () => {
    expect(shanten(countsOf(tiles('123m456p789s111z22z')))).toBe(-1);
    expect(shanten(countsOf(tiles('123m456p789s11z22z')))).toBe(0);
    expect(shanten(countsOf(tiles('123m456p78s11z22z5z')))).toBe(1);
    expect(shanten(countsOf(tiles('19m19p19s1234567z1z')))).toBe(-1);
    expect(shanten(countsOf(tiles('1122m3344p5566s7z')))).toBe(0);
  });
  it('待ち', () => {
    expect(waitsOf(countsOf(tiles('23m456p789s111z22z')))).toEqual([0, 3]);
    expect(waitsOf(countsOf(tiles('1112345678999m')))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('鳴いた面子の数', () => {
    expect(shanten(countsOf(tiles('456p789s11z')), 2)).toBe(-1);
    expect(shanten(countsOf(tiles('456p789s11z')), 1)).toBe(1);
  });
});

describe('点数', () => {
  it('ピンフのみ 30 符 1 翻 = 1000 点（ロン・子）', () => {
    const s = scoreWin(base('23m456m456p789s99s', '1m'))!;
    expect(s.yaku.map((y) => y.name)).toEqual(['平和']);
    expect([s.han, s.fu, s.ron]).toEqual([1, 30, 1000]);
  });
  it('リーチ・ツモ・ピンフ（20 符）。親のツモは全員から', () => {
    const s = scoreWin(base('23m456m456p789s99s', '1m', { ron: false, riichi: true, dealer: true }))!;
    expect(s.yaku.map((y) => y.name).sort()).toEqual(['平和', '立直', '門前清自摸和'].sort());
    expect([s.han, s.fu, s.tsumoOther, s.total]).toEqual([3, 20, 1300, 3900]);
  });
  it('タンヤオ・ドラ・赤ドラ', () => {
    const s = scoreWin(base('234m067p345s66s88p', '8p', { doraIndicators: tiles('5s') }))!;
    expect(s.yaku.find((y) => y.name === 'ドラ')?.han).toBe(2);
    expect(s.yaku.find((y) => y.name === '赤ドラ')?.han).toBe(1);
    expect(s.yaku.some((y) => y.name === '断么九')).toBe(true);
  });
  it('役がないと和了れない（ドラだけはだめ）', () => {
    const m: Meld = { type: 'pon', tiles: tiles('999m'), from: 1, called: tiles('9m')[0]! };
    const w = base('234p567s11z', '1z', { melds: [m, { type: 'chi', tiles: tiles('123p'), from: 0, called: tiles('1p')[0]! }], doraIndicators: tiles('8m') });
    w.hand = tiles('234p567s1z');
    w.winTile = tiles('11z')[1]!;
    w.hand.push(w.winTile);
    expect(scoreWin(w)).toBeNull();
  });
  it('役牌・混一色・対々和（鳴き）', () => {
    const pon = (s: string, k: number): Meld => ({ type: 'pon', tiles: tiles(s), from: k, called: tiles(s)[0]! });
    const w = base('111m99m', '9m', { melds: [pon('555z', 1), pon('777z', 2), pon('333m', 3)], ron: true });
    w.hand = tiles('111m9m');
    w.winTile = tiles('99m')[1]!;
    w.hand.push(w.winTile);
    const s = scoreWin(w)!;
    const names = s.yaku.map((y) => y.name);
    expect(names).toEqual(expect.arrayContaining(['役牌 白', '役牌 中', '混一色', '対々和']));
    expect(s.limit).toBe('跳満');
  });
  it('七対子は 25 符 2 翻', () => {
    const s = scoreWin(base('1133m5577p2299s4z', '4z'))!;
    expect([s.fu, s.han, s.ron]).toEqual([25, 2, 1600]);
  });
  it('国士無双・四暗刻は役満', () => {
    expect(scoreWin(base('19m19p19s1234567z', '1m'))!.yakuman).toBe(1);
    const s = scoreWin(base('111m333p555s777s2z', '2z', { ron: false }))!;
    expect(s.yaku.map((y) => y.name)).toEqual(['四暗刻']);
    expect(s.total).toBe(32000);
  });
  it('一盃口より二盃口・七対子より高い方', () => {
    const s = scoreWin(base('112233m445566p9s', '9s', { ron: false }))!;
    expect(s.yaku.some((y) => y.name === '二盃口')).toBe(true);
  });
  it('清一色・一気通貫', () => {
    const s = scoreWin(base('1234567899m111m', '9m'.replace('9m', '5m')));
    expect(s).toBeNull();
    const t = scoreWin(base('123456789m1122m', '2m'))!;
    expect(t.yaku.map((y) => y.name)).toEqual(expect.arrayContaining(['清一色', '一気通貫']));
    expect(t.limit).toBe('倍満');
  });
  it('カンチャン・暗刻の符', () => {
    const s = scoreWin(base('13m555p777s234s99m', '2m', { riichi: true }))!;
    // 20 + 門前ロン 10 + 中張牌の暗刻 4×2 + カンチャン 2 = 40
    expect(s.fu).toBe(40);
  });
  it('ドラ表示牌の次', () => {
    expect([doraOf(8), doraOf(30), doraOf(33), doraOf(0)]).toEqual([0, 27, 31, 1]);
  });
});

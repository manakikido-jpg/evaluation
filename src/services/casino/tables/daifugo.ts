import { rankOf, shuffledShoe } from '../cards.js';
import { active, addLog, JOKER, nextActive, partyEngine, payoutByShares, SHARES, shuffle, type PartyBase } from './partyBase.js';
import { fail, list, ok, str, type Form, type Step } from './types.js';

/**
 * 👑 大富豪（3〜5 人）。同じ数字 1〜4 枚を出し、場より強いものを出していく。
 * ルール（ローカルルール）は卓を立てる人が選ぶ（DAIFUGO_RULES）。前に立てた卓（rules がない）は、はじめのルール
 */

export const DAIFUGO_RULES = {
  revolution: { label: '⚡ 革命', note: '同じ数字 4 枚（階段は 4 枚以上）で強さが逆になる', on: true },
  eight: { label: '✂ 8 切り', note: '8 を出すと場が流れて、もう一度出せる', on: true },
  joker: { label: '🃏 ジョーカー', note: '1 枚入れる。どの数字の代わりにもなり、1 枚で出すと一番強い', on: true },
  spade3: { label: '♠3 返し', note: 'ジョーカー 1 枚に ♠3 で勝てる（場が流れる）', on: false },
  jback: { label: '↩ 11 バック', note: 'J を出すと、場が流れるまで強さが逆になる', on: false },
  shibari: { label: '🔒 しばり', note: '同じマークが続くと、場が流れるまでそのマークしか出せない', on: false },
  stairs: { label: '🪜 階段', note: '同じマークの 3 枚以上の連番を出せる', on: false },
  skip5: { label: '⏭ 5 飛ばし', note: '5 を出すと、出した枚数だけ次の人を飛ばす', on: false },
  give7: { label: '🎁 7 渡し', note: '7 を出すと、出した枚数だけ好きなカードを次の人に渡せる', on: false },
  drop10: { label: '🗑 10 捨て', note: '10 を出すと、出した枚数だけ好きなカードを捨てられる', on: false },
  reverse9: { label: '🔄 9 リバース', note: '9 を出すと、順番が逆回りになる', on: false },
  sandstorm: { label: '🌪 砂嵐', note: '3 を 3 枚出すと、3 枚出しなら何にでも勝って場が流れる', on: false },
  foul: { label: '🚫 反則上がり', note: 'ジョーカー・2（革命中は 3）・8 切りの 8・♠3 返しの ♠3 で上がると最下位', on: false },
} as const;
export type DaifugoRule = keyof typeof DAIFUGO_RULES;
export const DAIFUGO_RULE_KEYS = Object.keys(DAIFUGO_RULES) as DaifugoRule[];
export const DAIFUGO_DEFAULT_RULES = DAIFUGO_RULE_KEYS.filter((k) => DAIFUGO_RULES[k].on);
/** 前に立てた卓（ルールを選べなかったころ）のルール */
const LEGACY_RULES: DaifugoRule[] = ['revolution', 'eight', 'joker'];

/** フォームのルール（rules_set があれば選んだものだけ。なければはじめのルール） */
export function daifugoRulesOf(f: Form): DaifugoRule[] {
  if (str(f, 'rules_set') !== '1') return [...DAIFUGO_DEFAULT_RULES];
  const picked = new Set(list(f, 'rules'));
  return DAIFUGO_RULE_KEYS.filter((k) => picked.has(k));
}

/** 強さ（3 が一番弱く 0、2 が一番強く 12。ジョーカーはその上の 13） */
export const dStrength = (c: number) => (c === JOKER ? 13 : (rankOf(c) + 10) % 13);
const suitOf = (c: number) => Math.floor(c / 13);
const SPADE3 = 0 * 13 + 2;

/** 場（type: same = 同じ数字 / seq = 階段。strength: 同じ数字はその強さ、階段は一番弱いところ。suits: ジョーカー以外のマーク） */
export type DField = { cards: number[]; n: number; strength: number; joker: boolean; by: number; type?: 'same' | 'seq'; suits?: number[] } | null;
export type DaifugoState = PartyBase & {
  kind: 'daifugo';
  field: DField;
  passes: number[];
  lastBy: number | null;
  revolution: boolean;
  played: number;
  rules?: DaifugoRule[];
  /** 11 バック中（場が流れるまで） */
  jback?: boolean;
  /** しばり中のマーク（場が流れるまで） */
  lock?: number[] | null;
  /** 反則上がりした人（最下位から） */
  fouls?: string[];
  /** 順番の向き（9 リバースで -1） */
  dir?: 1 | -1;
  /** 出したあとに選ぶもの（7 渡し・10 捨て）。終わったら then のとおりに番を回す */
  pending?: { by: number; steps: { kind: 'give' | 'drop'; n: number }[]; then: { cut: boolean; skips: number } } | null;
};

export type DSet = { n: number; strength: number; joker: boolean; rank: number | null; type: 'same' | 'seq'; suits: number[]; ranks: number[] };

export const rulesOf = (s: { rules?: DaifugoRule[] }) => s.rules ?? LEGACY_RULES;
const has = (s: { rules?: DaifugoRule[] }, r: DaifugoRule) => rulesOf(s).includes(r);
/** 強さが逆になっているか（革命と 11 バック） */
export const reversed = (s: DaifugoState) => s.revolution !== Boolean(s.jback);

/**
 * 出せる組か。同じ数字 1〜4 枚（ジョーカーはどの数字の代わりにもなる）。
 * stairs なら、同じマークの 3 枚以上の連番も（ジョーカーで 1 か所埋めたり伸ばしたりできる）
 */
export function dSet(cards: number[], opts: { stairs?: boolean } = {}): DSet | undefined {
  if (!cards.length || new Set(cards).size !== cards.length) return undefined;
  const nat = cards.filter((c) => c !== JOKER);
  const jokers = cards.length - nat.length;
  const suits = nat.map(suitOf).sort((a, b) => a - b);
  const ranks = nat.map(rankOf);
  if (!nat.length) return cards.length === 1 ? { n: 1, strength: 13, joker: true, rank: null, type: 'same', suits: [], ranks: [] } : undefined;
  if (cards.length <= 4 && nat.every((c) => rankOf(c) === rankOf(nat[0]!))) {
    return { n: cards.length, strength: dStrength(nat[0]!), joker: false, rank: rankOf(nat[0]!), type: 'same', suits, ranks };
  }
  if (!opts.stairs || cards.length < 3 || !nat.every((c) => suitOf(c) === suitOf(nat[0]!))) return undefined;
  const st = nat.map(dStrength).sort((a, b) => a - b);
  if (new Set(st).size !== st.length) return undefined;
  const span = st[st.length - 1]! - st[0]! + 1;
  if (span - st.length > jokers || span > cards.length) return undefined;
  // あまったジョーカーは上に伸ばす（2 の上には伸ばせないので下に）
  let low = st[0]!;
  if (low + cards.length - 1 > 12) low = 12 - cards.length + 1;
  if (low < 0) return undefined;
  return { n: cards.length, strength: low, joker: false, rank: null, type: 'seq', suits, ranks };
}

/** 場に出ているものに勝てるか（reverse: 強さが逆。spade3: ♠3 がジョーカー 1 枚に勝つ。lock: しばりのマーク） */
export function dBeats(field: DField, play: DSet, reverse: boolean, opts: { spade3?: boolean; lock?: number[] | null; cards?: number[] } = {}): boolean {
  if (!field) return true;
  if (play.n !== field.n || play.type !== (field.type ?? 'same')) return false;
  if (field.joker) return Boolean(opts.spade3 && play.n === 1 && opts.cards?.[0] === SPADE3);
  if (opts.lock && !suitsFit(play.suits, opts.lock)) return false;
  if (play.joker) return true;
  return reverse ? play.strength < field.strength : play.strength > field.strength;
}

/** マークが合っているか（ジョーカーはどのマークにもなる） */
function suitsFit(suits: number[], lock: number[]): boolean {
  const left = [...lock];
  for (const x of suits) {
    const k = left.indexOf(x);
    if (k < 0) return false;
    left.splice(k, 1);
  }
  return true;
}

export const sortHand = (h: number[], rev = false) => [...h].sort((a, b) => (rev ? dStrength(b) - dStrength(a) : dStrength(a) - dStrength(b)) || a - b);

/** 次の人（9 リバースで逆回りのときは前の人） */
function nextIn(s: DaifugoState, from: number): number | null {
  if ((s.dir ?? 1) === 1) return nextActive(s, from);
  const n = s.seats.length;
  for (let k = 1; k <= n; k++) {
    const j = (((from - k) % n) + n) % n;
    if (!s.seats[j]!.out) return j;
  }
  return null;
}

/** 場を流す（しばり・11 バックも終わる） */
function clearField(s: DaifugoState): void {
  s.field = null;
  s.passes = [];
  s.lock = null;
  s.jback = false;
}

/** 上がれないカード（反則上がり） */
function fouling(s: DaifugoState, cards: number[]): boolean {
  if (!has(s, 'foul')) return false;
  return cards.some((c) => c === JOKER || rankOf(c) === (s.revolution ? 3 : 2) || (has(s, 'eight') && rankOf(c) === 8) || (has(s, 'spade3') && c === SPADE3));
}

function dPlay(s: DaifugoState, i: number, cards: number[]): Step<DaifugoState> {
  const x = s.seats[i]!;
  if (!cards.length || !cards.every((c) => x.hand.includes(c))) return fail('invalid');
  const set = dSet(cards, { stairs: has(s, 'stairs') });
  if (!set) return fail('bad_set');
  const beatsJoker = Boolean(s.field?.joker && has(s, 'spade3') && cards.length === 1 && cards[0] === SPADE3);
  // 砂嵐: 3 を 3 枚（ジョーカーで代わりも可）。3 枚出しの場なら何にでも勝つ
  const sandstorm = has(s, 'sandstorm') && set.type === 'same' && set.n === 3 && set.rank === 3;
  const stormBeats = sandstorm && (!s.field || ((s.field.type ?? 'same') === 'same' && s.field.n === 3));
  if (!stormBeats && !dBeats(s.field, set, reversed(s), { spade3: has(s, 'spade3'), lock: s.lock ?? null, cards })) return fail(s.lock && s.field && !suitsFit(set.suits, s.lock) ? 'locked' : 'weak');
  const before = s.field;
  x.hand = x.hand.filter((c) => !cards.includes(c));
  s.played++;
  s.passes = [];
  s.lastBy = i;
  const notes: string[] = [];
  if (has(s, 'revolution') && ((set.type === 'same' && set.n === 4) || (set.type === 'seq' && set.n >= 4))) {
    s.revolution = !s.revolution;
    notes.push(s.revolution ? '⚡ 革命！' : '⚡ 革命返し！');
  }
  if (has(s, 'jback') && set.ranks.includes(11)) {
    s.jback = !s.jback;
    notes.push(s.jback ? '↩ 11 バック' : '↩ 11 バック返し');
  }
  // しばり: 前と同じマーク（ジョーカーなし同士）
  if (has(s, 'shibari') && before && !s.lock && before.suits && before.suits.length === before.n && set.suits.length === set.n && before.suits.join() === set.suits.join()) {
    s.lock = set.suits;
    notes.push(`🔒 ${set.suits.map((k) => ['♠', '♥', '♦', '♣'][k]).join('')} しばり`);
  }
  const eight = has(s, 'eight') && set.ranks.includes(8);
  if (eight) notes.push('✂ 8 切り');
  if (beatsJoker) notes.push('♠3 返し！');
  if (sandstorm) notes.push('🌪 砂嵐！');
  const skips = has(s, 'skip5') ? set.ranks.filter((r) => r === 5).length : 0;
  if (skips) notes.push(`⏭ ${skips} 人飛ばし`);
  const nines = has(s, 'reverse9') ? set.ranks.filter((r) => r === 9).length : 0;
  if (nines % 2 === 1) {
    s.dir = (s.dir ?? 1) === 1 ? -1 : 1;
    notes.push(s.dir === -1 ? '🔄 逆回り' : '🔄 もとの向き');
  }
  addLog(s, `${x.name}: ${cards.map(cardLabel).join(' ')}${notes.length ? `・${notes.join('・')}` : ''}`);
  const cut = eight || beatsJoker || sandstorm;
  if (cut) clearField(s);
  else s.field = { cards, n: set.n, strength: set.type === 'same' && set.joker ? 13 : set.strength, joker: set.joker, by: i, type: set.type, suits: set.suits };
  if (!x.hand.length) {
    x.out = true;
    if (fouling(s, cards)) {
      s.fouls = [...(s.fouls ?? []), x.id];
      addLog(s, `🚫 ${x.name} は反則上がり（最下位）`);
    } else {
      s.order.push(x.id);
      addLog(s, `🎉 ${x.name} が ${s.order.length} 番目に上がりました`);
    }
  }
  if (active(s).length <= 1) return ok(s);
  // 7 渡し・10 捨て: 手札が残っていれば、選んでもらってから番を回す
  const steps: { kind: 'give' | 'drop'; n: number }[] = [];
  const sevens = has(s, 'give7') ? set.ranks.filter((r) => r === 7).length : 0;
  const tens = has(s, 'drop10') ? set.ranks.filter((r) => r === 10).length : 0;
  if (sevens) steps.push({ kind: 'give', n: sevens });
  if (tens) steps.push({ kind: 'drop', n: tens });
  if (steps.length && x.hand.length) {
    s.pending = { by: i, steps, then: { cut, skips } };
    s.turn = i;
    return ok(s);
  }
  passTurn(s, i, cut, skips);
  return ok(s);
}

/** 出したあとの番の回し方。8 切り・♠3 返し・砂嵐は同じ人から（上がっていれば次の人）。5 飛ばしは、その数だけ飛ばす */
function passTurn(s: DaifugoState, i: number, cut: boolean, skips: number): void {
  const x = s.seats[i]!;
  if (cut) {
    s.turn = !x.out ? i : nextIn(s, i);
    return;
  }
  let t = nextIn(s, i);
  for (let k = 0; k < skips && t !== null; k++) {
    const nx = nextIn(s, t);
    if (nx === null || nx === i) break;
    addLog(s, `${s.seats[t]!.name} は飛ばされました`);
    t = nx;
  }
  s.turn = t;
}

/** 7 渡し・10 捨てのカードを選んだ */
function dChoose(s: DaifugoState, i: number, cards: number[]): Step<DaifugoState> {
  const p = s.pending;
  const x = s.seats[i]!;
  if (!p || p.by !== i) return fail('invalid');
  const step = p.steps[0]!;
  const n = Math.min(step.n, x.hand.length);
  if (cards.length !== n || new Set(cards).size !== n || !cards.every((c) => x.hand.includes(c))) return fail('pick_count');
  x.hand = x.hand.filter((c) => !cards.includes(c));
  if (step.kind === 'give') {
    const to = nextIn(s, i);
    if (to !== null) {
      s.seats[to]!.hand = sortHand([...s.seats[to]!.hand, ...cards]);
      // 渡したカードは、渡した人と渡された人だけが知っている
      addLog(s, `🎁 ${x.name} → ${s.seats[to]!.name} に ${n} 枚渡しました`);
    }
  } else {
    addLog(s, `🗑 ${x.name}: ${cards.map(cardLabel).join(' ')} を捨てました`);
  }
  const rest = p.steps.slice(1);
  if (!x.hand.length) {
    x.out = true;
    s.order.push(x.id);
    addLog(s, `🎉 ${x.name} が ${s.order.length} 番目に上がりました`);
  }
  if (rest.length && x.hand.length) {
    s.pending = { ...p, steps: rest };
    return ok(s);
  }
  s.pending = null;
  if (active(s).length <= 1) return ok(s);
  passTurn(s, i, p.then.cut, p.then.skips);
  return ok(s);
}

/** みんなが続けてパスしたら場を流す */
function maybeClear(s: DaifugoState): void {
  if (s.lastBy === null || !s.field) return;
  const others = active(s).filter((j) => j !== s.lastBy);
  if (others.length && others.every((j) => s.passes.includes(j))) {
    clearField(s);
    addLog(s, '— 場が流れました —');
    s.turn = s.seats[s.lastBy]!.out ? nextIn(s, s.lastBy) : s.lastBy;
  }
}

function dPass(s: DaifugoState, i: number): Step<DaifugoState> {
  if (!s.field) return fail('must_play');
  s.passes.push(i);
  addLog(s, `${s.seats[i]!.name}: パス`);
  s.turn = nextIn(s, i);
  maybeClear(s);
  return ok(s);
}

export const cardLabel = (c: number) => {
  if (c === JOKER) return '🃏';
  const r = rankOf(c);
  return `${['♠', '♥', '♦', '♣'][Math.floor(c / 13)]}${['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][r]}`;
};

export const daifugo = partyEngine<DaifugoState>({
  kind: 'daifugo',
  min: 3,
  max: 5,
  turnSeconds: 40,
  init: (f) => ({ kind: 'daifugo', field: null, passes: [], lastBy: null, revolution: false, played: 0, rules: daifugoRulesOf(f), jback: false, lock: null, fouls: [], dir: 1, pending: null }) as never,
  deal(s, rng) {
    const deck = shuffle([...shuffledShoe(1, rng), ...(has(s, 'joker') ? [JOKER] : [])], rng);
    deck.forEach((c, k) => s.seats[k % s.seats.length]!.hand.push(c));
    for (const x of s.seats) x.hand = sortHand(x.hand);
    // ♦3 を持っている人から
    const d3 = 2 * 13 + 2;
    s.turn = Math.max(0, s.seats.findIndex((x) => x.hand.includes(d3)));
    addLog(s, `配りました。${s.seats[s.turn]!.name} から始めます`);
    return s;
  },
  play(s, i, f) {
    const cards = list(f, 'cards').map(Number).filter((n) => Number.isInteger(n));
    // 7 渡し・10 捨ての途中は、選ぶことしかできない
    if (s.pending) return str(f, 'action') === 'choose' ? dChoose(s, i, cards) : fail('pending');
    if (str(f, 'action') === 'pass') return dPass(s, i);
    return dPlay(s, i, cards);
  },
  auto(s, i) {
    // 選ばないうちに時間切れなら、弱いカードから
    if (s.pending) {
      const n = Math.min(s.pending.steps[0]!.n, s.seats[i]!.hand.length);
      return dChoose(s, i, sortHand(s.seats[i]!.hand, reversed(s)).filter((c) => c !== JOKER).concat(JOKER).filter((c) => s.seats[i]!.hand.includes(c)).slice(0, n));
    }
    if (s.field) return dPass(s, i);
    // 場が空なら、一番弱い 1 枚
    const weakest = sortHand(s.seats[i]!.hand, reversed(s)).find((c) => c !== JOKER) ?? s.seats[i]!.hand[0]!;
    return dPlay(s, i, [weakest]);
  },
  finish(s) {
    // 反則上がりの人は最下位（先に反則した人ほど下）
    s.order = [...s.order, ...[...(s.fouls ?? [])].reverse()];
    return payoutByShares(s, SHARES[s.seats.length] ?? SHARES[5]!);
  },
});

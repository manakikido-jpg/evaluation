import { catalogCards, ELEMENTS } from './cardRules.js';
/** 運営テスト用の対戦ルール。サーバー通貨は扱わない。 */
export type CardDefinition = {
  id: string;
  name: string;
  type: 'attack' | 'guard' | 'heal' | 'mana' | 'cleanse' | 'money' | 'draw' | 'summon' | 'tool';
  element: string;
  power: number;
  cost: number;
  icon: string;
  /** 攻撃に追加できる＋付きの札。 */
  stackable?: boolean;
  text: string;
  pierce?: number;
  burn?: number;
  drain?: boolean;
  reflect?: boolean;
  effect?: string;
  category?: string;
  rarity?: string;
  weight?: number;
  price?: number;
};
export type Card = CardDefinition & {
  uid: number;
};
export type Player = {
  name: string;
  hp: number;
  mp: number;
  money: number;
  burn: number;
  hand: Card[];
  avatar: string;
  attackBoost: number;
  attackPenalty: number;
  guardBoost: number;
  statusGuard: boolean;
  weaponElement: string | null;
  lastBasic: Card | null;
};
export type Pending = {
  from: number;
  to: number;
  cards: Card[];
  power: number;
  pierce: number;
  burn: number;
  drain: boolean;
  elements?: string[];
  singleGuard?: boolean;
  guardPenalty?: number;
  bonusDamage?: number;
};
export type ActionOptions = { targets?: number[]; element?: string; pay?: boolean };
export type Choice = { player: number; kind: 'peek' | 'buy' | 'discardDraw' | 'sell' | 'exchange' | 'overflow'; cards: Card[]; min: number; max: number; label: string };
export type Summoner = { name: string; avatarUrl: string | null };
export const SUMMONER_NAMES = ['ais', '小林'] as const;
export type SummonEvent = Summoner & { id: number; recipient: string; healed: number; cleared: boolean };
export type State = {
  players: Player[];
  turn: number;
  turns: number;
  phase: 'action' | 'defense' | 'choice' | 'over';
  pending: Pending | null;
  log: string[];
  winner: number | null;
  rng: () => number;
  seq: number;
  summoners: Summoner[];
  summon: SummonEvent | null;
  deck: string[];
  discard: Card[];
  choice: Choice | null;
  queue: Pending[];
  afterAttack: { from: number; cards: Card[] } | null;
};
/** 旧試作の定義は回帰検証用に維持する。実際の山札はplayableCards。 */
export const cards: CardDefinition[] = [
  { id: 'arrow', name: '狐火の矢', type: 'attack', element: '火', power: 5, cost: 0, icon: '🏹', text: '相手1人に5ダメージ。' },
  {
    id: 'blade',
    stackable: true,
    name: '紫電の短刀',
    type: 'attack',
    element: '雷',
    power: 3,
    cost: 0,
    icon: '⚔',
    text: '相手1人に3ダメージ。通常の攻撃札1枚や、ほかの＋付き攻撃札に追加できる。',
  },
  {
    id: 'sun',
    name: '暁光の祈り',
    type: 'attack',
    element: '光',
    power: 9,
    cost: 4,
    icon: '☀',
    text: '9ダメージ。防御力を3だけ無視する。',
    pierce: 3,
  },
  { id: 'frost', name: '氷花の槍', type: 'attack', element: '水', power: 7, cost: 2, icon: '❄', text: '相手1人に7ダメージ。' },
  {
    id: 'curse',
    name: '燐火の呪札',
    type: 'attack',
    element: '火',
    power: 4,
    cost: 3,
    icon: '🔥',
    text: 'ダメージが通ると、相手の次の3手番に2ダメージ。',
    burn: 3,
  },
  {
    id: 'drain',
    name: '月影の牙',
    type: 'attack',
    element: '闇',
    power: 6,
    cost: 3,
    icon: '☾',
    text: 'ダメージが通ると、その半分だけ自分のHPを回復。',
    drain: true,
  },
  {
    id: 'shield',
    name: '山祇の大盾',
    type: 'guard',
    element: '土',
    power: 8,
    cost: 0,
    icon: '🛡',
    text: '受けるダメージを8減らす。防御札を合算できる。',
  },
  { id: 'veil', name: '桜霞の衣', type: 'guard', element: '風', power: 4, cost: 0, icon: '🌸', text: '受けるダメージを4減らす。' },
  {
    id: 'mirror',
    name: '水鏡の護符',
    type: 'guard',
    element: '水',
    power: 3,
    cost: 3,
    icon: '◈',
    text: '3防御。通ったダメージの半分を相手へ返す。',
    reflect: true,
  },
  { id: 'water', name: '御神水の大瓶', type: 'heal', element: '水', power: 12, cost: 0, icon: '⚱', text: 'HPを12回復。最大60。' },
  { id: 'mana', name: '月露の小瓶', type: 'mana', element: '月', power: 7, cost: 0, icon: '💧', text: 'MPを7回復。最大20。' },
  {
    id: 'cleanse',
    name: '禊の白鈴',
    type: 'cleanse',
    element: '光',
    power: 5,
    cost: 1,
    icon: '🔔',
    text: '継続ダメージを解除し、HPを5回復。',
  },
  {
    id: 'money',
    name: '福狐の小判',
    type: 'money',
    element: '福',
    power: 8,
    cost: 0,
    icon: '🪙',
    text: 'この対戦の中だけで使う霊銭を8得る。',
  },
  {
    id: 'summon',
    name: '式神を呼ぶ',
    type: 'summon',
    element: '縁',
    power: 10,
    cost: 3,
    icon: '🦊',
    text: '運営の式神が登場。HPを10回復し、継続ダメージを解除。',
  },
  { id: 'draw', name: '縁結びの文', type: 'draw', element: '縁', power: 2, cost: 1, icon: '✉', text: '札を2枚引く。手札は最大10枚。' },
];
export const playableCards = [...catalogCards, { ...cards.find(c => c.id === 'summon')!, weight: 4, price: 10 }];
export function create(
  count = 4,
  rng: () => number = Math.random,
  name = 'ais',
  summoners: Summoner[] = SUMMONER_NAMES.map((name) => ({ name, avatarUrl: null })),
): State {
  if (!Number.isInteger(count) || count < 2 || count > 6) throw Error('人数は2〜6人です。');
  const s: State = {
    players: [],
    turn: 0,
    turns: 1,
    phase: 'action',
    pending: null,
    log: [],
    winner: null,
    rng,
    seq: 0,
    summoners: summoners.length ? summoners.map((p) => ({ ...p })) : SUMMONER_NAMES.map((name) => ({ name, avatarUrl: null })),
    summon: null,
    deck: [], discard: [], choice: null, queue: [], afterAttack: null,
  };
  s.deck = shuffle(s, playableCards.flatMap(c => Array(c.weight ?? 1).fill(c.id) as string[]));
  const names = [name, 'あおい', 'こはく', 'すずね', 'みこと', 'つばき'];
  for (let i = 0; i < count; i++)
    s.players.push({ name: names[i]!, hp: 60, mp: 12, money: 20, burn: 0, hand: [], avatar: ['狐', '花', '月', '鈴', '鳥', '葉'][i]!, attackBoost: 0, attackPenalty: 0, guardBoost: 0, statusGuard: false, weaponElement: null, lastBasic: null });
  // 初回の操作を試しやすい札を配る。その後の補充はランダム。
  s.players[0]!.hand = ['SK-004', 'SK-038', 'SK-156', 'SK-108', 'SK-217', 'SK-222', 'summon'].map((id) => {
    s.deck.splice(s.deck.indexOf(id), 1);
    return make(s, id);
  });
  s.players.slice(1).forEach(p => refill(s, p));
  note(s, '鳥居の下で対戦開始。まずは攻撃札を選び、相手を選んでください。');
  return s;
}
function make(s: State, id: string): Card {
  const definition = playableCards.find(c => c.id === id) ?? cards.find(c => c.id === id);
  if (!definition) throw Error('札の定義がありません。');
  return { ...definition, uid: ++s.seq };
}
function shuffle<T>(s: State, values: T[]): T[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(s.rng() * (i + 1))));
    [values[i], values[j]] = [values[j]!, values[i]!];
  }
  return values;
}
function take(s: State): Card | null {
  if (!s.deck.length && s.discard.length) {
    s.deck = shuffle(s, s.discard.map(c => c.id));
    s.discard = [];
    note(s, '捨て札を混ぜて山札へ戻した。');
  }
  const id = s.deck.shift();
  return id ? make(s, id) : null;
}
function draw(s: State, p: Player, n: number, overflow = false) {
  while (n-- > 0 && (overflow || p.hand.length < 10)) {
    const card = take(s);
    if (!card) break;
    p.hand.push(card);
  }
}
function refill(s: State, p: Player) {
  draw(s, p, 7 - p.hand.length);
}
function note(s: State, t: string) {
  s.log.push(t);
  if (s.log.length > 100) s.log.shift();
}
function selection(p: Player, ids: number[]): Card[] {
  if (new Set(ids).size !== ids.length) throw Error('同じ札は一度だけ選べます。');
  const a = ids.map((id) => p.hand.find((c) => c.uid === id));
  if (a.some((c) => !c)) throw Error('手札にない札です。');
  return a as Card[];
}
function checkStack(a: Card[]) {
  if (a.filter((c) => c.stackable !== true).length > 1) throw Error('＋なしの攻撃札は1枚までです。＋付きの札は追加できます。');
}
function remove(p: Player, a: Card[], s?: State, used = true) {
  p.hand = p.hand.filter((c) => !a.some((x) => x.uid === c.uid));
  if (s) {
    s.discard.push(...a);
    if (used) for (const c of a) if (c.rarity === '並' && ['武器', '防具'].includes(c.category ?? '')) p.lastBasic = c;
  }
}
function valid(s: State) {
  if (s.phase === 'over') throw Error('対戦は終了しています。');
}
function finish(s: State) {
  const alive = s.players.map((p, i) => (p.hp > 0 ? i : -1)).filter((i) => i >= 0);
  if (alive.length <= 1) {
    s.phase = 'over';
    s.winner = alive.length ? alive[0]! : -1;
    s.pending = null; s.choice = null; s.queue = []; s.afterAttack = null;
    note(s, alive.length ? `${s.players[s.winner!]!.name}の勝利！` : '引き分け。');
    return true;
  }
  return false;
}
function advance(s: State) {
  if (finish(s)) return;
  if (s.turns >= 80) {
    const best = Math.max(...s.players.map((p) => p.hp));
    const ids = s.players.map((p, i) => (p.hp === best ? i : -1)).filter((i) => i >= 0);
    s.winner = ids.length === 1 ? ids[0]! : -1;
    s.phase = 'over';
    note(s, '80手番で終了。残りHPで決着。');
    return;
  }
  do {
    s.turn = (s.turn + 1) % s.players.length;
  } while (s.players[s.turn]!.hp <= 0);
  s.turns++;
  s.phase = 'action';
  s.pending = null;
  const p = s.players[s.turn]!;
  refill(s, p);
  if (p.burn > 0) {
    p.burn--;
    p.hp = Math.max(0, p.hp - 2);
    note(s, `${p.name}は燐火で2ダメージ。`);
    if (p.hp === 0) advance(s);
  }
}
export function act(s: State, action: string, ids: number[] = [], target?: number | string, options: ActionOptions = {}) {
  valid(s);
  if (action === 'choose') return choose(s, ids);
  if (s.phase !== 'action') throw Error('防御の返事を待っています。');
  const p = s.players[s.turn]!;
  const a = selection(p, ids);
  if (a.some(c => c.effect)) return catalogAct(s, action, a, target, options);
  if (action === 'exchange') {
    const rates = { mp: { money: 4, hp: 0, mp: 4 }, hp: { money: 4, hp: 8, mp: 0 }, coin: { money: -4, hp: 0, mp: -3 } };
    const rate = rates[target as keyof typeof rates];
    if (!rate) throw Error('両替方法を選んでください。');
    if (target === 'coin') {
      if (p.mp < 3) throw Error('MPが3必要です。');
    } else if (p.money < 4) throw Error('霊銭が4必要です。');
    if ((target === 'hp' && p.hp >= 60) || (target === 'mp' && p.mp >= 20)) throw Error('すでに上限です。');
    p.money -= rate.money;
    p.hp = Math.min(60, p.hp + rate.hp);
    p.mp = Math.min(20, p.mp + rate.mp);
    note(s, `${p.name}が両替：${target === 'coin' ? 'MP3 → 霊銭4' : target === 'hp' ? '霊銭4 → HP8' : '霊銭4 → MP4'}。`);
    advance(s);
    return;
  }
  if (action === 'pass') {
    note(s, `${p.name}は様子を見た。`);
    advance(s);
    return;
  }
  if (a.length === 0) throw Error('札を選んでください。');
  const cost = a.reduce((v, c) => v + c.cost, 0);
  if (p.mp < cost) throw Error('MPが足りません。');
  if (action === 'attack') {
    if (a.some((c) => c.type !== 'attack')) throw Error('攻撃札を選んでください。');
    checkStack(a);
    if (typeof target !== 'number' || !Number.isInteger(target) || target === s.turn || !s.players[target] || s.players[target]!.hp <= 0)
      throw Error('生きている相手を選んでください。');
    p.mp -= cost;
    remove(p, a, s);
    s.pending = {
      from: s.turn,
      to: target,
      cards: a,
      power: a.reduce((v, c) => v + c.power, 0),
      pierce: a.reduce((v, c) => v + (c.pierce || 0), 0),
      burn: Math.max(...a.map((c) => c.burn || 0)),
      drain: a.some((c) => c.drain),
    };
    s.phase = 'defense';
    note(s, `${p.name} → ${s.players[target]!.name}：${a.map((c) => c.name).join('＋')}（${s.pending.power}）。`);
    return;
  }
  if (action !== 'use' || a.length !== 1 || ['attack', 'guard'].includes(a[0]!.type)) throw Error('回復・道具札は1枚で使います。');
  const c = a[0]!;
  p.mp -= cost;
  remove(p, a, s);
  if (c.type === 'heal') p.hp = Math.min(60, p.hp + c.power);
  if (c.type === 'mana') p.mp = Math.min(20, p.mp + c.power);
  if (c.type === 'money') p.money += c.power;
  if (c.type === 'cleanse') {
    p.burn = 0;
    p.hp = Math.min(60, p.hp + c.power);
  }
  if (c.type === 'draw') draw(s, p, c.power);
  if (c.type === 'summon') {
    const helper = s.summoners[Math.min(s.summoners.length - 1, Math.floor(s.rng() * s.summoners.length))]!;
    const healed = Math.min(c.power, 60 - p.hp),
      cleared = p.burn > 0;
    p.hp += healed;
    p.burn = 0;
    s.summon = { ...helper, id: s.turns, recipient: p.name, healed, cleared };
    note(s, `${helper.name}の式神が${p.name}を助けた。HP＋${healed}、継続ダメージ解除。`);
  }
  note(s, `${p.name}が${c.name}を使った。`);
  advance(s);
}
export function defend(s: State, ids: number[] = [], options: ActionOptions = {}) {
  valid(s);
  if (s.phase !== 'defense') throw Error('今は防御する場面ではありません。');
  const q = s.pending!,
    p = s.players[q.to]!,
    a = selection(p, ids);
  if (q.cards.some(c => c.effect) || a.some(c => c.effect)) return catalogDefend(s, a, options);
  if (a.some((c) => c.type !== 'guard')) throw Error('防御札を選んでください。');
  const cost = a.reduce((v, c) => v + c.cost, 0);
  if (p.mp < cost) throw Error('MPが足りません。');
  const guard = Math.max(0, a.reduce((v, c) => v + c.power, 0) - q.pierce),
    damage = Math.max(0, q.power - guard);
  p.mp -= cost;
  remove(p, a, s);
  p.hp = Math.max(0, p.hp - damage);
  const from = s.players[q.from]!;
  if (damage && q.burn) p.burn = Math.max(p.burn, q.burn);
  if (damage && q.drain) from.hp = Math.min(60, from.hp + Math.floor(damage / 2));
  if (damage && a.some((c) => c.reflect)) {
    const reflected = Math.floor(damage / 2);
    from.hp = Math.max(0, from.hp - reflected);
    note(s, `水鏡が${from.name}に${reflected}を返した。`);
  }
  note(s, `${p.name}：${a.length ? a.map((c) => c.name).join('＋') : '防御なし'}。${damage}ダメージ${p.hp === 0 ? '、退場' : ''}。`);
  s.pending = null;
  advance(s);
}
function cpuSelection(p: Player, type: Card['type'], limit: number): Card[] {
  const chosen: Card[] = [];
  let mp = p.mp;
  for (const c of p.hand) {
    if (c.type !== type || c.cost > mp) continue;
    if (type === 'attack' && c.stackable !== true && chosen.some((x) => x.stackable !== true)) continue;
    chosen.push(c);
    mp -= c.cost;
    if (chosen.length === limit) break;
  }
  return chosen;
}
export function cpu(s: State) {
  valid(s);
  if (s.phase === 'choice' || s.players.some(p => p.hand.some(c => c.effect)) || s.pending?.cards.some(c => c.effect)) return catalogCpu(s);
  if (s.phase === 'defense') {
    const p = s.players[s.pending!.to]!;
    const ids = cpuSelection(p, 'guard', p.hand.length).map((c) => c.uid);
    defend(s, ids);
    return;
  }
  const p = s.players[s.turn]!;
  const heal = p.hand.find((c) => c.type === 'heal' || c.type === 'cleanse' || c.type === 'summon');
  if (heal && p.hp <= 42 && p.mp >= heal.cost) {
    act(s, 'use', [heal.uid]);
    return;
  }
  const a = cpuSelection(p, 'attack', p.hand.length);
  if (a.length) {
    const targets = s.players.map((x, i) => (x.hp > 0 && i !== s.turn ? i : -1)).filter((i) => i >= 0);
    act(
      s,
      'attack',
      a.map((c) => c.uid),
      targets[Math.min(targets.length - 1, Math.floor(s.rng() * targets.length))]!,
    );
    return;
  }
  const tool = p.hand.find((c) => !['attack', 'guard'].includes(c.type) && c.cost <= p.mp && !(c.type === 'mana' && p.mp >= 20));
  if (tool) {
    act(s, 'use', [tool.uid]);
    return;
  }
  if (p.money >= 4 && p.hp < 52) {
    act(s, 'exchange', [], 'hp');
    return;
  }
  act(s, 'pass');
}

function heal(p: Player, amount: number) { if (p.hp > 0) p.hp = Math.min(60, p.hp + amount); }
function mana(p: Player, amount: number) { p.mp = Math.max(0, Math.min(20, p.mp + amount)); }
function clearBad(p: Player) { p.burn = 0; p.attackPenalty = 0; }
function aliveTarget(s: State, target: unknown): target is number {
  return typeof target === 'number' && Number.isInteger(target) && !!s.players[target] && s.players[target]!.hp > 0;
}
function element(value: unknown): value is string { return ELEMENTS.includes(value as typeof ELEMENTS[number]); }
function isHealingTarget(c: Card) { return ['heal_small', 'heal_medium', 'heal_large', 'great_heal_cleanse', 'cleanse'].includes(c.effect ?? ''); }
function payment(c: Card, options: ActionOptions) {
  return options.pay && ['optional_money_attack', 'optional_money_guard'].includes(c.effect ?? '') ? 4 : 0;
}
function beginChoice(s: State, kind: Choice['kind'], cards: Card[], min: number, max: number, label: string) {
  s.choice = { player: s.turn, kind, cards, min, max, label };
  s.phase = 'choice';
}
function catalogAct(s: State, action: string, a: Card[], target: number | string | undefined, options: ActionOptions) {
  const p = s.players[s.turn]!, cost = a.reduce((v, c) => v + c.cost, 0);
  if (p.mp < cost) throw Error('MPが足りません。');
  if (action === 'attack') {
    if (a.some(c => c.type !== 'attack')) throw Error('攻撃札を選んでください。');
    checkStack(a);
    const targets = options.targets ?? [target as number];
    const max = a.some(c => c.effect === 'two_targets') ? 2 : 1;
    if (!targets.length || targets.length > max || new Set(targets).size !== targets.length || targets.some(t => !aliveTarget(s, t) || t === s.turn))
      throw Error('生きている相手を重複せず選んでください。');
    if (a.some(c => c.effect === 'choose_element') && !element(options.element)) throw Error('攻撃の属性を選んでください。');
    const money = a.reduce((v, c) => v + payment(c, options), 0);
    const extraMp = options.pay && a.some(c => c.effect === 'optional_mp_attack') ? 2 : 0;
    if (p.money < money) throw Error('霊銭が足りません。');
    if (p.mp < cost + extraMp) throw Error('MPが足りません。');
    if (a.some(c => c.effect === 'hp_cost_attack') && p.hp <= 3) throw Error('HP3以下では使えません。');
    const packets = targets.map(to => {
      let power = 0;
      const elements: string[] = [];
      for (const c of a) {
        let value = c.power;
        if (c.effect === 'double_hit') value *= 2;
        if (c.effect === 'opening_strike' && s.players[to]!.hp === 60) value += 3;
        if (c.effect === 'low_hp_attack' && p.hp <= 20) value += 4;
        if (c.effect === 'underdog_attack' && s.players[to]!.hp > p.hp) value += 3;
        if (c.effect === 'small_hand_attack' && p.hand.length <= 3) value += 3;
        if (c.effect === 'endgame_attack' && s.players.filter((x, i) => i !== s.turn && x.hp > 0).length <= 2) value += 3;
        if (c.effect === 'optional_money_attack' && options.pay) value += 4;
        power += value;
        elements.push(c.effect === 'choose_element' ? options.element! : c.category === '武器' && p.weaponElement ? p.weaponElement : c.element);
      }
      return { from: s.turn, to, cards: a, power: Math.max(0, power + p.attackBoost - p.attackPenalty),
        pierce: a.reduce((n, c) => n + (c.pierce ?? 0), 0), burn: Math.max(0, ...a.map(c => c.burn ?? 0)), drain: a.some(c => c.drain),
        elements, singleGuard: a.some(c => c.effect === 'double_hit'), guardPenalty: a.some(c => c.effect === 'pierce_guard') ? 2 : 0,
        bonusDamage: extraMp ? 3 : 0 };
    });
    p.mp -= cost + extraMp; p.money -= money;
    if (a.some(c => c.effect === 'hp_cost_attack')) p.hp -= 3;
    p.attackBoost = 0; p.attackPenalty = 0;
    if (a.some(c => c.category === '武器')) p.weaponElement = null;
    remove(p, a, s);
    s.afterAttack = { from: s.turn, cards: a };
    s.pending = packets[0]!; s.queue = packets.slice(1); s.phase = 'defense';
    note(s, `${p.name} → ${targets.map(t => s.players[t]!.name).join('・')}：${a.map(c => c.name).join('＋')}（${packets.map(q => q.power).join('・')}）。`);
    return;
  }
  if (action !== 'use' || a.length !== 1 || ['attack', 'guard'].includes(a[0]!.type)) throw Error('回復・道具札は1枚で使います。');
  const c = a[0]!, key = c.effect!;
  const to = isHealingTarget(c) ? (target ?? s.turn) : s.turn;
  if (!aliveTarget(s, to)) throw Error('生きている回復対象を選んでください。');
  if (key === 'change_element' && !element(options.element)) throw Error('次の武器の属性を選んでください。');
  if (['discard_draw', 'sell_card'].includes(key) && p.hand.length < 2) throw Error('この札以外の手札が必要です。');
  if (key === 'recover_basic' && (!p.lastBasic || !s.discard.some(x => x.uid === p.lastBasic!.uid))) throw Error('回収できる並の武器・防具がありません。');
  p.mp -= cost; remove(p, a, s);
  const recipient = s.players[to]!;
  switch (key) {
    case 'heal_small': case 'heal_medium': case 'heal_large': heal(recipient, c.power); break;
    case 'great_heal_cleanse': heal(recipient, c.power); clearBad(recipient); break;
    case 'heal_and_mp': heal(p, 5); mana(p, 2); break;
    case 'heal_and_draw': heal(p, 4); draw(s, p, 1); break;
    case 'mp_small': case 'mp_medium': case 'mp_large': mana(p, c.power); break;
    case 'cleanse': clearBad(recipient); break;
    case 'mp_heal_cleanse': heal(p, 8); p.burn = 0; break;
    case 'status_guard': p.statusGuard = true; break;
    case 'boost_attack': p.attackBoost += 3; break;
    case 'boost_guard': p.guardBoost += 4; break;
    case 'change_element': p.weaponElement = options.element!; break;
    case 'earn_money': p.money += 8; break;
    case 'clear_boosts_draw': for (const x of s.players) { x.attackBoost = 0; x.guardBoost = 0; } draw(s, p, 2, true); break;
    case 'draw_two': draw(s, p, 2, true); break;
    case 'recover_basic': {
      const card = p.lastBasic!;
      s.discard = s.discard.filter(x => x.uid !== card.uid); p.hand.push(card); p.lastBasic = null; break;
    }
    case 'select_draw': case 'buy_card': {
      const offers: Card[] = [];
      for (let i = 0; i < 3; i++) { const next = take(s); if (next) offers.push(next); }
      if (offers.length) beginChoice(s, key === 'select_draw' ? 'peek' : 'buy', offers, key === 'select_draw' ? 1 : 0, 1,
        key === 'select_draw' ? '山札の3枚から1枚を選ぶ' : '買う札を1枚選ぶ（選ばず確定で取りやめ）');
      break;
    }
    case 'discard_draw': beginChoice(s, 'discardDraw', [...p.hand], 1, 1, '捨てる手札を1枚選ぶ。その後2枚引く'); break;
    case 'sell_card': beginChoice(s, 'sell', [...p.hand], 1, 1, '売る手札を1枚選ぶ'); break;
    case 'exchange_cards': beginChoice(s, 'exchange', [...p.hand], 0, Math.min(2, p.hand.length), '入れ替える手札を2枚まで選ぶ'); break;
    default: throw Error(`未対応の札の効果：${key}`);
  }
  note(s, `${p.name}が${c.name}を使った${isHealingTarget(c) ? `（対象：${recipient.name}）` : ''}。`);
  if (p.hand.length > 10) beginChoice(s, 'overflow', [...p.hand], p.hand.length - 10, p.hand.length - 10, '手札が10枚になるよう、捨てる札を選ぶ');
  if (!s.choice) advance(s);
}

function choose(s: State, ids: number[]) {
  const choice = s.choice;
  if (s.phase !== 'choice' || !choice) throw Error('今は札を選ぶ場面ではありません。');
  if (new Set(ids).size !== ids.length || ids.length < choice.min || ids.length > choice.max || ids.some(id => !choice.cards.some(c => c.uid === id)))
    throw Error('選ぶ札と枚数を確認してください。');
  const p = s.players[choice.player]!, selected = choice.cards.filter(c => ids.includes(c.uid));
  if (choice.kind === 'buy' && selected[0] && p.money < (selected[0].price ?? 0)) throw Error('霊銭が足りません。');
  if (choice.kind === 'peek' || choice.kind === 'buy') {
    if (choice.kind === 'buy') p.money -= selected[0]?.price ?? 0;
    p.hand.push(...selected);
    s.deck.push(...choice.cards.filter(c => !ids.includes(c.uid)).map(c => c.id));
  } else {
    remove(p, selected, s, false);
    if (choice.kind === 'discardDraw') draw(s, p, 2);
    if (choice.kind === 'exchange') draw(s, p, selected.length);
    if (choice.kind === 'sell') p.money += Math.max(1, Math.floor((selected[0]!.price ?? 2) / 2));
  }
  note(s, `${p.name}が札の選択を終えた。`);
  s.choice = null;
  advance(s);
}

export function defenseValue(s: State, a: Card[], options: ActionOptions = {}) {
  const q = s.pending!, p = s.players[q.to]!;
  const guard = a.reduce((sum, c) => {
    let power = c.power;
    if (c.effect === 'element_guard' && q.elements?.includes(c.element)) power += 2;
    if (c.effect === 'low_hp_guard' && p.hp <= 20) power += 5;
    if (c.effect === 'optional_money_guard' && options.pay) power += 5;
    return sum + Math.max(0, power - (q.guardPenalty ?? 0));
  }, p.guardBoost);
  return Math.max(0, guard - q.pierce);
}
function catalogDefend(s: State, a: Card[], options: ActionOptions) {
  const q = s.pending!, p = s.players[q.to]!, from = s.players[q.from]!;
  if (a.some(c => c.type !== 'guard')) throw Error('防御札を選んでください。');
  if (q.singleGuard && a.length > 1) throw Error('鈴音の連矢への防御は1枚までです。');
  const cost = a.reduce((v, c) => v + c.cost, 0), money = a.reduce((v, c) => v + payment(c, options), 0);
  if (p.mp < cost) throw Error('MPが足りません。');
  if (p.money < money) throw Error('霊銭が足りません。');
  const canceled = a.some(c => c.effect === 'cancel_attack');
  let damage = canceled ? 0 : Math.max(0, q.power - defenseValue(s, a, options));
  if (damage) damage += q.bonusDamage ?? 0;
  p.mp -= cost; p.money -= money; p.guardBoost = 0; remove(p, a, s);
  p.hp = Math.max(0, p.hp - damage);
  if (damage) {
    const hasStatus = q.burn > 0 || q.cards.some(c => ['burn', 'drain_mp', 'reduce_mp'].includes(c.effect ?? '') || (c.effect === 'element_miracle' && ['火', '水', '闇'].includes(c.element)));
    const protectedStatus = p.statusGuard && hasStatus;
    if (protectedStatus) { p.statusGuard = false; note(s, `${p.name}の厄除けが火傷・霊力減少を防いだ。`); }
    if (q.burn && !protectedStatus) p.burn = Math.max(p.burn, q.burn);
    if (q.drain) heal(from, Math.floor(damage / 2));
    for (const c of q.cards) {
      switch (c.effect) {
        case 'next_attack_boost': from.attackBoost += 2; break;
        case 'drain_hp': heal(from, 3); break;
        case 'drain_mp': if (!protectedStatus) { mana(p, -2); mana(from, 2); } break;
        case 'reduce_mp': if (!protectedStatus) mana(p, -3); break;
        case 'earn_trade_money': from.money += 3; break;
        case 'burn': if (!protectedStatus) p.burn = Math.max(p.burn, 1); break;
        case 'weaken_attack': p.attackPenalty += 2; break;
        case 'remove_boosts': p.attackBoost = 0; p.guardBoost = 0; break;
        case 'element_miracle':
          if (c.element === '火' && !protectedStatus) p.burn = Math.max(p.burn, 1);
          if (c.element === '水' && !protectedStatus) mana(p, -1);
          if (c.element === '闇' && !protectedStatus) mana(p, -2);
          if (c.element === '雷') p.attackPenalty += 1;
          break;
      }
    }
    if (a.some(c => c.reflect || c.effect === 'reflect_half')) {
      const reflected = Math.floor(damage / 2); from.hp = Math.max(0, from.hp - reflected);
      note(s, `${p.name}の水鏡が${from.name}に${reflected}を返した。`);
    }
  }
  for (const c of a) {
    if (c.effect === 'guard_heal') heal(p, 3);
    if (c.effect === 'guard_draw' && p.hp > 0) draw(s, p, 1);
    if (c.effect === 'guard_mp') mana(p, 2);
  }
  note(s, `${p.name}：${a.length ? a.map(c => c.name).join('＋') : '防御なし'}。${damage}ダメージ${p.hp === 0 ? '、退場' : ''}。`);
  s.pending = null;
  if (from.hp > 0 && s.players.filter(p => p.hp > 0).length > 1) {
    const next = s.queue.shift();
    if (next) { s.pending = next; return; }
  }
  s.queue = [];
  if (from.hp > 0 && s.afterAttack) {
    for (const c of s.afterAttack.cards) {
      if (c.effect === 'draw_after_attack') draw(s, from, 1);
      if (c.effect === 'guard_after_attack') from.guardBoost += 2;
      if (c.effect === 'conditional_heal' && from.hp <= 30) heal(from, 2);
      if (c.effect === 'element_miracle') {
        if (c.element === '風') from.guardBoost += 1;
        if (c.element === '土') from.guardBoost += 2;
        if (c.element === '光') heal(from, 2);
      }
    }
  }
  s.afterAttack = null;
  advance(s);
}

/** CPUと時間切れの選択。候補はサーバー側の情報だけで選ぶ。 */
export function autoChoose(s: State) {
  const c = s.choice!;
  let ids: number[];
  if (c.kind === 'peek') ids = [c.cards.reduce((a, b) => b.power > a.power ? b : a).uid];
  else if (c.kind === 'buy') {
    const card = c.cards.filter(x => (x.price ?? 0) <= s.players[c.player]!.money).sort((a, b) => b.power - a.power)[0];
    ids = card ? [card.uid] : [];
  } else ids = [...c.cards].sort((a, b) => a.power - b.power).slice(0, c.kind === 'exchange' ? Math.min(2, c.cards.length) : c.min).map(x => x.uid);
  choose(s, ids);
}
function catalogCpu(s: State) {
  if (s.phase === 'choice') { autoChoose(s); return; }
  if (s.phase === 'defense') {
    const p = s.players[s.pending!.to]!;
    const guards = cpuSelection(p, 'guard', s.pending!.singleGuard ? 1 : p.hand.length);
    const optionalCost = guards.filter(c => c.effect === 'optional_money_guard').length * 4;
    const options = { pay: optionalCost > 0 && p.money >= optionalCost };
    defend(s, guards.map(c => c.uid), options); return;
  }
  const p = s.players[s.turn]!;
  const use = (card: Card) => {
    act(s, 'use', [card.uid], s.turn, { element: '火' });
    if (s.phase === 'choice') autoChoose(s);
  };
  const recovery = p.hand.find(c => c.cost <= p.mp && ((['heal', 'summon'].includes(c.type) && p.hp <= 42) || (c.type === 'mana' && p.mp <= 8) || (c.effect === 'cleanse' && (p.burn || p.attackPenalty))));
  if (recovery) { use(recovery); return; }
  const attacks = cpuSelection(p, 'attack', p.hand.length).filter(c => c.effect !== 'hp_cost_attack' || p.hp > 3);
  if (attacks.length) {
    const targets = s.players.map((p, i) => ({ hp: p.hp, i })).filter(x => x.i !== s.turn && x.hp > 0).sort((a, b) => a.hp - b.hp).map(x => x.i);
    const max = attacks.some(c => c.effect === 'two_targets') ? 2 : 1;
    const money = attacks.some(c => c.effect === 'optional_money_attack') && p.money >= 4;
    const mp = attacks.some(c => c.effect === 'optional_mp_attack') && p.mp >= attacks.reduce((n, c) => n + c.cost, 0) + 2;
    act(s, 'attack', attacks.map(c => c.uid), targets[0], { targets: targets.slice(0, max), element: '火', pay: money || mp }); return;
  }
  const tool = p.hand.find(c => c.type !== 'guard' && c.type !== 'attack' && c.cost <= p.mp
    && !(['sell_card', 'discard_draw'].includes(c.effect ?? '') && p.hand.length < 2)
    && !(c.effect === 'recover_basic' && (!p.lastBasic || !s.discard.some(x => x.uid === p.lastBasic!.uid)))
    && !(c.type === 'mana' && p.mp >= 20));
  if (tool) { use(tool); return; }
  if (p.money >= 4 && p.hp < 52) { act(s, 'exchange', [], 'hp'); return; }
  act(s, 'pass');
}

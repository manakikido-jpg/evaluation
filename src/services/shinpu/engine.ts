/** 運営テスト用のオリジナル試作ルール。サーバー通貨は扱わない。 */
export type CardDefinition = {
  id: string;
  name: string;
  type: 'attack' | 'guard' | 'heal' | 'mana' | 'cleanse' | 'money' | 'draw';
  element: string;
  power: number;
  cost: number;
  icon: string;
  /** ＋付きの札だけを、同じ種類で重ねて使える。 */
  stackable?: boolean;
  text: string;
  pierce?: number;
  burn?: number;
  drain?: boolean;
  reflect?: boolean;
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
};
export type Pending = {
  from: number;
  to: number;
  cards: Card[];
  power: number;
  pierce: number;
  burn: number;
  drain: boolean;
};
export type State = {
  players: Player[];
  turn: number;
  turns: number;
  phase: 'action' | 'defense' | 'over';
  pending: Pending | null;
  log: string[];
  winner: number | null;
  rng: () => number;
  seq: number;
};
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
    text: '相手1人に3ダメージ。＋付きの攻撃札とだけ重ねて使える。',
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
  { id: 'draw', name: '縁結びの文', type: 'draw', element: '縁', power: 2, cost: 1, icon: '✉', text: '札を2枚引く。手札は最大10枚。' },
];
export function create(count = 4, rng: () => number = Math.random, name = 'ais'): State {
  if (!Number.isInteger(count) || count < 2 || count > 6) throw Error('人数は2〜6人です。');
  const s: State = { players: [], turn: 0, turns: 1, phase: 'action', pending: null, log: [], winner: null, rng, seq: 0 };
  const names = [name, 'あおい', 'こはく', 'すずね', 'みこと', 'つばき'];
  for (let i = 0; i < count; i++)
    s.players.push({ name: names[i]!, hp: 60, mp: 12, money: 20, burn: 0, hand: [], avatar: ['狐', '花', '月', '鈴', '鳥', '葉'][i]! });
  s.players.forEach((p) => refill(s, p));
  // 初回の操作を試しやすい札を配る。その後の補充はランダム。
  s.players[0]!.hand = ['arrow', 'blade', 'shield', 'veil', 'water', 'mana', 'mirror'].map((id) => make(s, id));
  note(s, '鳥居の下で対戦開始。まずは攻撃札を選び、相手を選んでください。');
  return s;
}
function make(s: State, id: string): Card {
  return { ...cards.find((c) => c.id === id)!, uid: ++s.seq };
}
function draw(s: State, p: Player, n: number) {
  while (n-- > 0 && p.hand.length < 10) p.hand.push(make(s, cards[Math.min(cards.length - 1, Math.floor(s.rng() * cards.length))]!.id));
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
  if (a.length > 1 && a.some((c) => c.stackable !== true)) throw Error('重ねて使えるのは＋付きの札だけです。');
}
function remove(p: Player, a: Card[]) {
  p.hand = p.hand.filter((c) => !a.some((x) => x.uid === c.uid));
}
function valid(s: State) {
  if (s.phase === 'over') throw Error('対戦は終了しています。');
}
function finish(s: State) {
  const alive = s.players.map((p, i) => (p.hp > 0 ? i : -1)).filter((i) => i >= 0);
  if (alive.length <= 1) {
    s.phase = 'over';
    s.winner = alive.length ? alive[0]! : -1;
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
export function act(s: State, action: string, ids: number[] = [], target?: number | string) {
  valid(s);
  if (s.phase !== 'action') throw Error('防御の返事を待っています。');
  const p = s.players[s.turn]!;
  const a = selection(p, ids);
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
    if (a.length > 3 || a.some((c) => c.type !== 'attack')) throw Error('攻撃札を1〜3枚選んでください。');
    checkStack(a);
    if (typeof target !== 'number' || !Number.isInteger(target) || target === s.turn || !s.players[target] || s.players[target]!.hp <= 0)
      throw Error('生きている相手を選んでください。');
    p.mp -= cost;
    remove(p, a);
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
  remove(p, a);
  if (c.type === 'heal') p.hp = Math.min(60, p.hp + c.power);
  if (c.type === 'mana') p.mp = Math.min(20, p.mp + c.power);
  if (c.type === 'money') p.money += c.power;
  if (c.type === 'cleanse') {
    p.burn = 0;
    p.hp = Math.min(60, p.hp + c.power);
  }
  if (c.type === 'draw') draw(s, p, c.power);
  note(s, `${p.name}が${c.name}を使った。`);
  advance(s);
}
export function defend(s: State, ids: number[] = []) {
  valid(s);
  if (s.phase !== 'defense') throw Error('今は防御する場面ではありません。');
  const q = s.pending!,
    p = s.players[q.to]!,
    a = selection(p, ids);
  if (a.some((c) => c.type !== 'guard') || a.length > 3) throw Error('防御札を0〜3枚選んでください。');
  checkStack(a);
  const cost = a.reduce((v, c) => v + c.cost, 0);
  if (p.mp < cost) throw Error('MPが足りません。');
  const guard = Math.max(0, a.reduce((v, c) => v + c.power, 0) - q.pierce),
    damage = Math.max(0, q.power - guard);
  p.mp -= cost;
  remove(p, a);
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
    if (chosen.length && (c.stackable !== true || chosen[0]!.stackable !== true)) continue;
    chosen.push(c);
    mp -= c.cost;
    if (chosen.length === limit || c.stackable !== true) break;
  }
  return chosen;
}
export function cpu(s: State) {
  valid(s);
  if (s.phase === 'defense') {
    const p = s.players[s.pending!.to]!;
    const ids = cpuSelection(p, 'guard', 3).map((c) => c.uid);
    defend(s, ids);
    return;
  }
  const p = s.players[s.turn]!;
  const heal = p.hand.find((c) => c.type === 'heal' || c.type === 'cleanse');
  if (heal && p.hp <= 42 && p.mp >= heal.cost) {
    act(s, 'use', [heal.uid]);
    return;
  }
  const a = cpuSelection(p, 'attack', 2);
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

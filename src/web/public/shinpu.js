/** 運営テスト。ゲームの計算はWebサーバーだけで行う。 */
'use strict';
const $ = (id) => document.getElementById(id),
  API = '/casino/shinpu/api';
let view = null,
  state = null,
  myIndex = 0,
  selected = [],
  target = 1,
  busy = false,
  stopped = false;
const label = { attack: '攻撃', guard: '防御', heal: '回復', mana: 'MP回復', cleanse: '解除・回復', money: '霊銭', draw: '手札補充' };
function humanAction() {
  return state && state.phase === 'action' && state.turn === myIndex && state.players[myIndex].hp > 0;
}
function humanDefense() {
  return state && state.phase === 'defense' && state.pending.to === myIndex;
}
function chosen() {
  return state.players[myIndex].hand.filter((c) => selected.includes(c.uid));
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function toast(t) {
  $('toast').textContent = t;
}
async function request(body, path = API) {
  const r = await fetch(
    path,
    body
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': document.body.dataset.csrf },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      stopped = true;
      toast('入場権限を確認できません。Discordで入り直してください。');
    }
    throw Error(data.error || '読み込みに失敗しました。');
  }
  return data;
}
function apply(data) {
  if (view?.roomId === data.roomId && view.revision > data.revision) return;
  const changed = view?.revision !== data.revision;
  view = data;
  state = data.state;
  myIndex = data.myIndex;
  if (changed) selected = [];
  $('lobby').hidden = true;
  $('waiting').hidden = !!state;
  $('game').hidden = !state;
  history.replaceState(null, '', '?room=' + data.roomId);
  if (!state) {
    $('waiting-seats').textContent = data.seats.map((p) => p.name).join(' / ') + `（${data.seats.length} / ${data.capacity}人）`;
    $('invite').value = location.origin + location.pathname + '?room=' + data.roomId;
    $('start').hidden = !data.owner;
  } else if (changed) render();
}
async function refresh() {
  if (busy || stopped) return;
  try {
    if (view) apply(await request(null, API + '?room=' + view.roomId));
    else {
      const data = await request();
      $('room-list').replaceChildren(
        ...data.rooms.map((r) => {
          const b = el('button', '', `${r.mine ? '自分の部屋・再開 / ' : ''}${r.name}の部屋 · ${r.players}/${r.capacity}人 · ${r.status}`);
          b.disabled = r.status !== '参加受付中' && !r.mine;
          b.addEventListener('click', () => send({ operation: 'join', roomId: r.id }));
          return b;
        }),
      );
      if (!data.rooms.length) $('room-list').textContent = '参加受付中の部屋はまだありません。';
    }
  } catch (e) {
    toast(e.message);
  }
}
async function send(body) {
  if (busy || stopped) return;
  busy = true;
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  try {
    const data = await request(body);
    toast('');
    if (data.left) {
      view = null;
      state = null;
      selected = [];
      history.replaceState(null, '', location.pathname);
      $('game').hidden = true;
      $('waiting').hidden = true;
      $('lobby').hidden = false;
    } else apply(data);
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
    $('create').disabled = false;
    $('refresh').disabled = false;
    $('leave').disabled = false;
    $('start').disabled = false;
    $('copy').disabled = false;
    for (const b of document.querySelectorAll('[data-close],[data-dialog]')) b.disabled = false;
    if (state) render();
    if (!view) refresh();
  }
}
function move(action, ids = [], t) {
  return send({ operation: 'move', roomId: view.roomId, revision: view.revision, action, ids, target: t });
}
function render() {
  const me = state.players[myIndex];
  selected = selected.filter((id) => me.hand.some((c) => c.uid === id));
  if (target === myIndex || !state.players[target] || state.players[target].hp <= 0)
    target = state.players.findIndex((p, i) => i !== myIndex && p.hp > 0);
  $('players').className = 'players' + (state.players.length >= 5 ? ' six' : '');
  $('players').replaceChildren();
  state.players.forEach((p, i) => {
    const box = el(
      'button',
      'player' +
        (i === myIndex ? ' self' : '') +
        (target === i ? ' target' : '') +
        (state.turn === i && state.phase !== 'over' ? ' active' : '') +
        (p.hp === 0 ? ' dead' : ''),
    );
    box.type = 'button';
    box.disabled = !humanAction() || i === myIndex || p.hp === 0;
    box.setAttribute('aria-pressed', String(target === i));
    box.setAttribute('aria-label', `${p.name}、HP ${p.hp}、MP ${p.mp}、${p.hp > 0 ? '攻撃対象に選ぶ' : '退場'}`);
    const name = el('div', 'name');
    name.append(el('span', 'avatar', p.avatar), el('span', '', p.name + (i === myIndex ? '（あなた）' : '')));
    box.append(name);
    const stats = el('div', 'statline');
    stats.append(el('span', '', 'HP'), el('strong', '', p.hp), el('span', '', 'MP ' + p.mp));
    box.append(stats);
    const bar = el('div', 'bar'),
      fill = el('span');
    fill.style.width = (p.hp / 60) * 100 + '%';
    bar.append(fill);
    box.append(bar, el('div', 'small', `霊銭 ${p.money} · 手札 ${p.handCount}${p.burn ? ' · 燐火 ' + p.burn : ''}`));
    box.addEventListener('click', () => {
      target = i;
      render();
    });
    $('players').append(box);
  });
  $('round').textContent = `${state.turns} / 80 手番 · ${state.players.filter((p) => p.hp > 0).length}人生存`;
  const a = chosen(),
    power = a.reduce((n, c) => n + c.power, 0),
    cost = a.reduce((n, c) => n + c.cost, 0);
  $('phase').textContent =
    state.phase === 'over' ? '対戦終了' : humanDefense() ? 'あなたの防御' : humanAction() ? 'あなたの手番' : '相手の手番';
  if (state.phase === 'over') {
    $('message').textContent = state.winner < 0 ? '引き分け' : state.players[state.winner].name + 'の勝利';
    $('summary').textContent = '部屋を退出すると、新しい対戦を作れます。';
  } else if (humanDefense()) {
    $('message').textContent = state.players[state.pending.from].name + 'からの攻撃';
    $('summary').textContent =
      `攻撃力 ${state.pending.power} / 選択した防御力 ${a.filter((c) => c.type === 'guard').reduce((n, c) => n + c.power, 0)} / 消費MP ${cost}`;
  } else if (humanAction()) {
    $('message').textContent = a.length ? a.map((c) => c.name).join(' ＋ ') : '手札から札を選んでください';
    $('summary').textContent = a.length
      ? `${a.length}枚選択 / ${a.every((c) => c.type === 'attack') ? '攻撃力 ' + power + ' / 相手 ' + (state.players[target]?.name || '未選択') : a.every((c) => c.type === 'guard') ? '防御札は攻撃されたときに使います' : a.length === 1 ? '効果：' + a[0].text : '道具は1枚ずつ使います'} / 消費MP ${cost}`
      : '攻撃札を重ねると強い一撃に。回復・両替も選べます。';
  } else {
    $('message').textContent =
      state.phase === 'defense'
        ? state.players[state.pending.to].name + 'が防御を考えています'
        : state.players[state.turn].name + 'が札を選んでいます';
    $('summary').textContent = me.hp === 0 ? 'あなたは退場しました。残りの対戦を観戦できます。' : '記録に次の動きが表示されます。';
  }
  const button = $('main-action');
  button.textContent =
    state.phase === 'over'
      ? '部屋を退出'
      : humanDefense()
        ? a.length
          ? 'この札で防御'
          : '防御せず受ける'
        : a.length && a[0].type === 'attack'
          ? '攻撃する'
          : '札を使う';
  button.disabled = state.phase !== 'over' && !humanDefense() && !humanAction();
  if (humanAction())
    button.disabled =
      !a.length ||
      a.some((c) => c.type === 'guard') ||
      cost > me.mp ||
      (a.some((c) => c.type === 'attack') && !a.every((c) => c.type === 'attack')) ||
      (!a.every((c) => c.type === 'attack') && a.length !== 1);
  $('exchange-open').disabled = !humanAction();
  $('pass').disabled = !humanAction();
  $('hint').textContent = humanDefense()
    ? '防御札を最大3枚選べます。MPが足りない札は使えません。'
    : humanAction()
      ? '攻撃・道具・両替で手番が進みます。'
      : '相手の返事を待っています。CPUは自動で行動します。';
  $('hand-title').textContent = `あなたの手札 ${me.hand.length}枚 · HP ${me.hp} / MP ${me.mp} / 霊銭 ${me.money}`;
  $('hand').replaceChildren();
  me.hand.forEach((c) => {
    const b = el('button', 'card ' + c.type + (selected.includes(c.uid) ? ' selected' : ''));
    b.setAttribute('aria-pressed', String(selected.includes(c.uid)));
    b.setAttribute('aria-label', `${c.name}、${label[c.type]} ${c.power}、MP ${c.cost}。${c.text}`);
    b.disabled = !(humanAction() || humanDefense()) || (humanDefense() && c.type !== 'guard');
    b.append(el('div', 'art', c.icon));
    const body = el('div', 'cardbody');
    body.append(
      el('div', 'cardtitle', c.name),
      el('div', 'cardtype', c.element + ' / ' + label[c.type]),
      el('div', 'cardpower', `${label[c.type]} ${c.power} · MP ${c.cost}`),
      el('div', 'carddesc', c.text),
    );
    b.append(body);
    b.addEventListener('click', () => {
      if (selected.includes(c.uid)) selected = selected.filter((id) => id !== c.uid);
      else {
        if (selected.length >= 3) {
          toast('一度に選べる札は3枚までです。');
          return;
        }
        selected.push(c.uid);
      }
      toast('');
      render();
    });
    $('hand').append(b);
  });
  updateExchange();
  for (const id of ['log', 'history-log']) {
    $(id).replaceChildren(
      ...state.log
        .slice()
        .reverse()
        .map((t) => el('p', '', t)),
    );
  }
}
$('create').addEventListener('click', () => send({ operation: 'create', capacity: Number($('count').value) }));
$('refresh').addEventListener('click', refresh);
$('start').addEventListener('click', () => send({ operation: 'start', roomId: view.roomId, revision: view.revision }));
function leave() {
  if (view) send({ operation: 'leave', roomId: view.roomId });
}
$('leave').addEventListener('click', leave);
$('main-action').addEventListener('click', () => {
  if (state.phase === 'over') {
    leave();
    return;
  }
  move(humanDefense() ? 'defend' : chosen().every((c) => c.type === 'attack') ? 'attack' : 'use', selected, target);
});
$('pass').addEventListener('click', () => move('pass'));
$('exchange-open').addEventListener('click', () => {
  updateExchange();
  $('exchange').showModal();
});
function updateExchange() {
  document.querySelectorAll('[data-exchange]').forEach((b) => {
    const k = b.dataset.exchange,
      p = state.players[myIndex];
    b.disabled = !humanAction() || (k === 'coin' ? p.mp < 3 : p.money < 4 || (k === 'hp' ? p.hp >= 60 : p.mp >= 20));
  });
}
for (const b of document.querySelectorAll('[data-dialog]')) b.addEventListener('click', () => $(b.dataset.dialog).showModal());
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());
for (const b of document.querySelectorAll('[data-exchange]'))
  b.addEventListener('click', () => {
    move('exchange', [], b.dataset.exchange);
    $('exchange').close();
  });
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('invite').value);
    toast('リンクをコピーしました。');
  } catch {
    $('invite').select();
    toast('リンクを選択しました。コピーして運営に渡してください。');
  }
});
async function init() {
  const id = new URL(location.href).searchParams.get('room');
  if (id && /^[0-9a-f-]{36}$/.test(id)) {
    try {
      apply(await request(null, API + '?room=' + id));
    } catch {
      await send({ operation: 'join', roomId: id });
    }
  } else await refresh();
}
init();
setInterval(refresh, 2000);

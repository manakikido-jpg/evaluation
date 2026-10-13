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
const ART = JSON.parse(document.body.dataset.art || '{}');
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
  state.players
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.i === myIndex) - (b.i === myIndex))
    .forEach(({ p, i }) => {
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
      const portrait = avatar(i);
      box.append(portrait);
      const info = el('div', 'player-info');
      info.append(el('div', 'name', p.name));
      for (const [title, value, max, cls] of [
        ['HP', p.hp, 60, 'hp'],
        ['MP', p.mp, 20, 'mp'],
      ]) {
        const line = el('div', 'resource-line ' + cls);
        line.append(el('span', '', title), el('strong', '', value), el('span', 'resource-max', '/ ' + max));
        const bar = el('span', 'resource-bar'),
          fill = el('span');
        fill.style.width = (value / max) * 100 + '%';
        bar.append(fill);
        line.append(bar);
        info.append(line);
      }
      info.append(el('div', 'small', `🪙 霊銭 ${p.money}${p.burn ? ' · 燐火 ' + p.burn : ''}`));
      box.append(info);
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
    state.phase === 'over'
      ? '✿ 対戦終了 ✿'
      : humanDefense()
        ? '✿ あなたの防御ターン ✿'
        : humanAction()
          ? '✿ あなたの攻撃ターン ✿'
          : '✿ 相手のターン ✿';
  const preview = a.length ? a : state.phase === 'defense' ? state.pending.cards : [];
  $('selected-cards').replaceChildren(...preview.map((c) => card(c, false)));
  const canPreview = humanAction() && a.length && a.every((c) => c.type === 'attack');
  const targetIndex = state.phase === 'defense' ? state.pending.to : target;
  $('target-preview').replaceChildren();
  if (state.phase !== 'over' && targetIndex >= 0 && (canPreview || state.phase === 'defense')) {
    const t = state.players[targetIndex];
    $('target-preview').append(el('span', 'target-arrow', '➜'), avatar(targetIndex), el('strong', '', t.name));
  }
  $('selected-cards').hidden = !preview.length;
  $('target-preview').hidden = !$('target-preview').childElementCount;
  if (state.phase === 'over') {
    $('message').textContent = state.winner < 0 ? '引き分け' : state.players[state.winner].name + 'の勝利';
    $('summary').textContent = '部屋を退出すると、新しい対戦を作れます。';
  } else if (humanDefense()) {
    $('message').textContent = state.players[state.pending.from].name + 'からの攻撃';
    const guard = a.filter((c) => c.type === 'guard').reduce((n, c) => n + c.power, 0);
    const damage = Math.max(0, state.pending.power - Math.max(0, guard - state.pending.pierce));
    $('summary').replaceChildren(
      metric('受ける攻撃', state.pending.power, 'damage'),
      metric('選んだ防御', guard, 'guard'),
      metric('残るダメージ', damage, 'damage'),
      metric('消費MP', cost, 'mp'),
    );
  } else if (humanAction()) {
    $('message').textContent = a.length
      ? canPreview
        ? state.players[target]?.name + 'へ攻撃'
        : a.length === 1
          ? a[0].name
          : '選択した札'
      : '札を選んでください';
    $('summary').replaceChildren(
      ...(a.length
        ? [
            metric(
              a.every((c) => c.type === 'guard') ? '選んだ防御' : canPreview ? '合計攻撃' : '効果の値',
              power,
              canPreview ? 'damage' : 'guard',
            ),
            metric('消費MP', cost, 'mp'),
          ]
        : [el('p', 'selection-empty', '下の神器を選び、相手を押して攻撃。\n回復や両替も選べます。')]),
    );
  } else {
    $('message').textContent =
      state.phase === 'defense'
        ? state.players[state.pending.to].name + 'が防御を選んでいます'
        : state.players[state.turn].name + 'が札を選んでいます';
    $('summary').textContent = me.hp === 0 ? '退場しました。残りの対戦を観戦できます。' : '相手の返事を待っています。';
  }
  $('clear-selection').disabled = !selected.length || busy;
  updateDeadline();
  const button = $('main-action');
  button.textContent =
    state.phase === 'over'
      ? '部屋を退出'
      : humanDefense()
        ? a.length
          ? 'この札で防御'
          : '防御せず受ける'
        : a.length && a[0].type === 'attack'
          ? '⚔ 攻撃する'
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
  $('hand-title').textContent = `あなたの神器　${me.hand.length}枚 / 10枚`;
  $('hand').replaceChildren();
  me.hand.forEach((c) => {
    const b = el('button', 'card ' + c.type + (selected.includes(c.uid) ? ' selected' : ''));
    b.setAttribute('aria-pressed', String(selected.includes(c.uid)));
    b.setAttribute('aria-label', `${c.name}、${label[c.type]} ${c.power}、MP ${c.cost}。${c.text}`);
    b.disabled = !(humanAction() || humanDefense()) || (humanDefense() && c.type !== 'guard');
    b.dataset.element = c.element;
    b.append(...cardContent(c));
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

function avatar(index) {
  const e = el('span', 'portrait portrait-' + (index === myIndex ? 5 : index < myIndex ? index : index - 1));
  e.setAttribute('aria-hidden', 'true');
  return e;
}
function metric(title, value, cls) {
  const e = el('div', 'metric ' + cls);
  e.append(el('span', '', title), el('strong', '', value));
  return e;
}
function cardContent(c) {
  const image = el('img', 'card-art');
  image.src = ART[c.id] || '';
  image.alt = '';
  image.width = 360;
  image.height = 480;
  image.loading = 'eager';
  const power = el('div', 'cardpower');
  power.append(el('span', '', `${label[c.type]} `), el('strong', '', c.power));
  if (c.cost) power.append(el('small', '', ` / MP ${c.cost}`));
  return [el('div', 'cardtitle', c.name), image, power, el('div', 'carddesc', c.text)];
}
function card(c, interactive) {
  const e = el(interactive ? 'button' : 'article', 'card ' + c.type + (selected.includes(c.uid) ? ' selected' : ''));
  e.dataset.element = c.element;
  e.append(...cardContent(c));
  return e;
}
function updateDeadline() {
  if (!view || !state || state.phase === 'over') {
    $('deadline').textContent = '';
    return;
  }
  const seconds = Math.max(0, Math.ceil((view.deadline - Date.now()) / 1000));
  $('deadline').textContent = `⌛ 残り ${seconds} 秒`;
  $('deadline').classList.toggle('urgent', seconds <= 15);
}
$('clear-selection').addEventListener('click', () => {
  selected = [];
  render();
});
setInterval(updateDeadline, 1000);

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
let choiceSelected = [], useTarget = 0, secondTarget = -1, chosenElement = '火', optionalPay = false;
const ART = JSON.parse(document.body.dataset.art || '{}');
const FULL_ART = JSON.parse(document.body.dataset.artFull || '{}');
const cardName = (c) => c.name + (c.stackable === true ? ' ＋' : '');
const canStack = (a) => a.every((c) => c.type === 'guard') || a.filter((c) => c.stackable !== true).length <= 1;
const label = {
  attack: '攻撃',
  guard: '防御',
  heal: '回復',
  mana: 'MP回復',
  cleanse: '解除・回復',
  money: '霊銭',
  draw: '手札補充',
  summon: '召喚・回復',
  tool: '道具・取引',
};
function humanAction() {
  return state && state.phase === 'action' && state.turn === myIndex && state.players[myIndex].hp > 0;
}
function humanDefense() {
  return state && state.phase === 'defense' && state.pending.to === myIndex;
}
function humanChoice() { return state && state.phase === 'choice' && state.choice.player === myIndex; }
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
  if (changed) { selected = []; choiceSelected = []; optionalPay = false; secondTarget = -1; useTarget = data.myIndex; }
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
function move(action, ids = [], t, options) {
  return send({ operation: 'move', roomId: view.roomId, revision: view.revision, action, ids, target: t, options });
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
      info.append(el('div', 'small', `🪙 霊銭 ${p.money}${p.burn ? ' · 火傷 ' + p.burn : ''}`));
      const status=[p.attackBoost ? `次攻撃＋${p.attackBoost}` : '', p.attackPenalty ? `次攻撃−${p.attackPenalty}` : '',
        p.guardBoost ? `次防御＋${p.guardBoost}` : '', p.statusGuard ? '厄除け' : '', p.weaponElement ? `次武器：${p.weaponElement}` : ''].filter(Boolean);
      if(status.length)info.append(el('div','small',status.join(' / ')));
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
    cost = a.reduce((n, c) => n + c.cost, 0) + (optionalPay && a.some(c => c.effect === 'optional_mp_attack') ? 2 : 0);
    $('phase').textContent =
    state.phase === 'over'
      ? '✿ 対戦終了 ✿'
      : humanChoice() ? '✿ あなたの札を選ぶ番 ✿' : state.phase === 'choice' ? '✿ 札の選択を待っています ✿' : humanDefense()
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
  } else if (state.phase === 'choice') {
    $('message').textContent = humanChoice() ? state.choice.label : state.players[state.choice.player].name + 'が札を選んでいます';
    $('summary').textContent = humanChoice() ? '下の候補を押して、選択を確定してください。' : '他の人の候補や手札は表示しません。';
  } else if (humanDefense()) {
    $('message').textContent = state.players[state.pending.from].name + 'からの攻撃';
    const guard = a.filter((c) => c.type === 'guard').reduce((n, c) => n + Math.max(0, c.power
      + (c.effect === 'element_guard' && state.pending.elements?.includes(c.element) ? 2 : 0)
      + (c.effect === 'low_hp_guard' && me.hp <= 20 ? 5 : 0)
      + (c.effect === 'optional_money_guard' && optionalPay ? 5 : 0) - (state.pending.guardPenalty || 0)), me.guardBoost || 0);
    let damage = Math.max(0, state.pending.power - Math.max(0, guard - state.pending.pierce));
    if (damage) damage += state.pending.bonusDamage || 0;
    if (a.some(c => c.effect === 'cancel_attack')) damage = 0;
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
            ...(canPreview || a.every(c => c.type === 'guard') ? [metric(
              a.every((c) => c.type === 'guard') ? '基本防御' : canPreview ? '基本攻撃（条件で変化）' : '効果の値',
              power,
              canPreview ? 'damage' : 'guard',
            )] : [el('p', 'selection-effect', a[0].text)]),
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
  $('clear-selection').disabled = !(selected.length || choiceSelected.length) || busy;
  updateDeadline();
  const button = $('main-action');
  button.textContent =
    state.phase === 'over'
      ? '部屋を退出'
      : humanChoice() ? state.choice.kind === 'buy' && !choiceSelected.length ? '買わずに終える' : '選択を確定' : humanDefense()
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
      !canStack(a) ||
      a.some((c) => c.type === 'guard') ||
      cost > me.mp ||
      (a.some((c) => c.type === 'attack') && !a.every((c) => c.type === 'attack')) ||
      (!a.every((c) => c.type === 'attack') && a.length !== 1);
  if (humanDefense()) button.disabled = cost > me.mp || !canStack(a);
  if (humanDefense() && state.pending.singleGuard && a.length > 1) button.disabled = true;
  if (humanChoice()) button.disabled = choiceSelected.length < state.choice.min || choiceSelected.length > state.choice.max;
  if (optionalPay && a.filter(c => ['optional_money_attack','optional_money_guard'].includes(c.effect)).length * 4 > me.money) button.disabled = true;
  $('exchange-open').disabled = !humanAction();
  $('pass').disabled = !humanAction();
  $('hint').textContent = humanChoice() ? '候補を選んで確定してください。候補と手札は本人だけに表示しています。' : humanDefense()
    ? state.pending.singleGuard ? '鈴音の連矢への防御は1枚までです。' : '防御札は重ねられます。同属性の防具は＋2。'
    : humanAction()
      ? '通常攻撃は1枚まで。＋付きは追加できます。条件付き効果の最終値はサーバーで決まります。'
      : '相手の返事を待っています。CPUは自動で行動します。';
  $('hand-title').textContent = `あなたの神器　${me.hand.length}枚 / 10枚`;
  $('hand').replaceChildren();
  renderCardOptions(a);
  renderChoice();
  me.hand.forEach((c) => {
    const b = el('button', 'card ' + c.type + (selected.includes(c.uid) ? ' selected' : ''));
    b.setAttribute('aria-pressed', String(selected.includes(c.uid)));
    b.setAttribute('aria-label', `${cardName(c)}、${label[c.type]} ${c.power}、MP ${c.cost}。${c.text}`);
    b.disabled = !(humanAction() || humanDefense()) || (humanDefense() && c.type !== 'guard');
    b.dataset.element = c.element;
    b.append(...cardContent(c));
    b.addEventListener('click', () => {
      if (selected.includes(c.uid)) selected = selected.filter((id) => id !== c.uid);
      else {
        const next = [...chosen(), c];
        if (humanDefense() && state.pending.singleGuard && next.length > 1) { toast('この攻撃への防御は1枚までです。'); return; }
        if (!canStack(next)) {
          toast('＋なしの攻撃札は1枚までです。＋付きの札を追加してください。');
          return;
        }
        if (next.length > 1 && !next.every((x) => x.type === next[0].type && ['attack', 'guard'].includes(x.type))) {
          toast('同じ種類の攻撃札か防御札だけを重ねられます。');
          return;
        }
        selected.push(c.uid);
      }
      toast('');
      render();
    });
    $('hand').append(b);
  });
  renderSummon();
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
  if (humanChoice()) { move('choose', choiceSelected); return; }
  const a = chosen();
  const healing = a.length === 1 && ['heal_small', 'heal_medium', 'heal_large', 'great_heal_cleanse', 'cleanse'].includes(a[0].effect);
  const options = {};
  if (a.some(c => ['choose_element', 'change_element'].includes(c.effect))) options.element = chosenElement;
  if (a.some(c => ['optional_money_attack', 'optional_money_guard', 'optional_mp_attack'].includes(c.effect))) options.pay = optionalPay;
  if (a.some(c => c.effect === 'two_targets')) options.targets = [target, ...(secondTarget >= 0 && secondTarget !== target ? [secondTarget] : [])];
  move(humanDefense() ? 'defend' : a.every((c) => c.type === 'attack') ? 'attack' : 'use', selected, healing ? useTarget : target, options);
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
  power.append(el('span', '', `${label[c.type]} `), el('strong', '', (c.stackable === true ? '+' : '') + c.power));
  if (c.cost) power.append(el('small', '', ` / MP ${c.cost}`));
  return [el('div', 'cardtitle', cardName(c)), image, power, el('div', 'carddesc', c.text)];
}
function renderCardOptions(a) {
  const active = humanAction() || humanDefense();
  const healing = active && a.length === 1 && ['heal_small', 'heal_medium', 'heal_large', 'great_heal_cleanse', 'cleanse'].includes(a[0].effect);
  const multiple = active && a.some(c => c.effect === 'two_targets');
  const color = active && a.some(c => ['choose_element', 'change_element'].includes(c.effect));
  const pay = active && a.some(c => ['optional_money_attack', 'optional_money_guard', 'optional_mp_attack'].includes(c.effect));
  $('card-options').hidden = !(healing || multiple || color || pay);
  $('heal-target-label').hidden = !healing;
  $('second-target-label').hidden = !multiple;
  $('element-label').hidden = !color;
  $('optional-pay-label').hidden = !pay;
  $('optional-pay-description').textContent = a.some(c => c.effect === 'optional_mp_attack') ? 'MP2を払い、通ったダメージ＋3'
    : a.some(c => c.effect === 'optional_money_guard') ? `霊銭${4*a.filter(c=>c.effect==='optional_money_guard').length}を払い、対象の防御札ごとに防御＋5`
    : '霊銭4を払い、攻撃＋4';
  const people = state.players.map((p, i) => ({p,i})).filter(x => x.p.hp > 0);
  $('heal-target').replaceChildren(...people.map(({p,i}) => { const o = el('option', '', p.name); o.value = i; return o; }));
  $('heal-target').value = useTarget;
  const none = el('option', '', '選ばない（1人だけ攻撃）'); none.value = -1;
  $('second-target').replaceChildren(none, ...people.filter(x => x.i !== myIndex && x.i !== target).map(({p,i}) => { const o=el('option','',p.name); o.value=i; return o; }));
  if (secondTarget === target) secondTarget = -1;
  $('second-target').value = secondTarget;
  $('chosen-element').value = chosenElement;
  $('optional-pay').checked = optionalPay;
}
function renderChoice() {
  $('card-choice').hidden = !humanChoice();
  $('choice-cards').replaceChildren();
  if (!humanChoice()) return;
  const choice = state.choice, me = state.players[myIndex];
  $('choice-label').textContent = choice.label;
  $('choice-count').textContent = `${choiceSelected.length}枚を選択 / ${choice.min}〜${choice.max}枚`;
  for (const c of choice.cards) {
    const b = el('button', 'choice-card' + (choiceSelected.includes(c.uid) ? ' selected' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(choiceSelected.includes(c.uid)));
    const image = el('img'); image.src = ART[c.id]; image.alt = c.name; image.width=180; image.height=240;
    b.append(image, el('strong', '', c.name));
    b.append(el('span', 'choice-description', c.text));
    if (choice.kind === 'buy') { b.append(el('span', '', `${c.price}霊銭`)); b.disabled = (c.price || 0) > me.money; }
    if (choice.kind === 'sell') b.append(el('span', '', `売値 ${Math.max(1,Math.floor((c.price || 2)/2))}霊銭`));
    b.addEventListener('click', () => {
      if (choiceSelected.includes(c.uid)) choiceSelected=choiceSelected.filter(id=>id!==c.uid);
      else if (choice.max === 1) choiceSelected=[c.uid];
      else if (choiceSelected.length < choice.max) choiceSelected.push(c.uid);
      else { toast(`選べるのは${choice.max}枚までです。`); return; }
      render();
    });
    $('choice-cards').append(b);
  }
}
$('heal-target').addEventListener('change', e => { useTarget=Number(e.target.value); });
$('second-target').addEventListener('change', e => { secondTarget=Number(e.target.value); });
$('chosen-element').addEventListener('change', e => { chosenElement=e.target.value; });
$('optional-pay').addEventListener('change', e => { optionalPay=e.target.checked; render(); });
function card(c, interactive) {
  const e = el(interactive ? 'button' : 'article', 'card ' + c.type + (selected.includes(c.uid) ? ' selected' : ''));
  e.dataset.element = c.element;
  e.append(...cardContent(c));
  if (!interactive) {
    const zoom=el('button','card-zoom','大きく見る');zoom.type='button';
    zoom.addEventListener('click',()=>{
      $('card-detail-title').textContent=cardName(c);
      $('card-detail-image').src=FULL_ART[c.id] || ART[c.id];
      $('card-detail-image').alt=c.name+'のカード';
      $('card-detail-text').textContent=c.text;
      $('card-detail').showModal();
    });
    e.append(zoom);
  }
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
  choiceSelected = [];
  render();
});
setInterval(updateDeadline, 1000);

let lastSummon = '';
function renderSummon() {
  const panel = $('summon-effect'),
    event = state.summon;
  panel.hidden = !event;
  if (!event) {
    panel.replaceChildren();
    lastSummon = '';
    return;
  }
  const key = view.roomId + ':' + event.id;
  if (lastSummon === key) return;
  lastSummon = key;
  const portrait = el('img', 'summon-portrait');
  portrait.src = event.avatarUrl || ART.summon;
  portrait.alt = event.name + 'の肖像';
  portrait.addEventListener(
    'error',
    () => {
      if (portrait.src !== new URL(ART.summon, location.href).href) portrait.src = ART.summon;
    },
    { once: true },
  );
  const copy = el('div');
  copy.append(
    el('span', 'small', '式神を呼ぶ'),
    el('strong', '', event.name + 'が助けに来た！'),
    el('p', '', event.recipient + '：HP＋' + event.healed + (event.cleared ? ' ・ 継続ダメージ解除' : '')),
  );
  panel.replaceChildren(portrait, copy);
  panel.classList.remove('appearing');
  void panel.offsetWidth;
  panel.classList.add('appearing');
}

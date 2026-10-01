// 咲楽ノ宮カジノの画面の動き（ページの中にスクリプトは書けないので、全部ここに置く）
// - 確かめてから送る・2 回押しを防ぐ
// - 🔊 音（ブラウザの中で作る音。ファイルは使わない）
// - 送るボタンは画面ごと読み直さず、中身だけ差し替える（音を鳴らし続けられるように）
// - みんなで座る卓の自動更新・ヒント・ルーレットの盤・スロットの STOP

// ───── 確かめてから送る・2 回押しを防ぐ ─────
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('.c-confirm') : null;
  if (b && !window.confirm(b.getAttribute('data-confirm') || 'よろしいですか？')) e.preventDefault();
});
document.addEventListener('submit', (e) => {
  if (e.defaultPrevented) return;
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || form.dataset.sent === '1') {
    if (form instanceof HTMLFormElement) e.preventDefault();
    return;
  }
  form.dataset.sent = '1';
  // 押したボタンの値を送ってから、押せなくする
  setTimeout(() => form.querySelectorAll('button').forEach((x) => { x.disabled = true; }), 0);
});
window.addEventListener('pageshow', () => {
  document.querySelectorAll('form[data-sent]').forEach((f) => {
    delete f.dataset.sent;
    f.querySelectorAll('button').forEach((x) => { x.disabled = false; });
  });
});

// ───── 🔊 音 ─────
const Sound = (() => {
  const KEY = 'casino-sound';
  let on = true;
  try {
    on = localStorage.getItem(KEY) !== 'off';
  } catch {
    on = true;
  }
  let ctx = null;
  let master = null;
  const ensure = () => {
    if (!on) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    return ctx;
  };
  // ブラウザは、押したあとでないと音を出させてくれない
  document.addEventListener('pointerdown', ensure, true);
  document.addEventListener('keydown', ensure, true);
  /** 鳴らせるときだけ（止まっている間にためて、あとでまとめて鳴らさない） */
  const ready = () => {
    const c = on ? ctx : null;
    return c && c.state === 'running' ? c : null;
  };
  const tone = (freq, at, dur, o = {}) => {
    const c = ready();
    if (!c) return;
    const t = c.currentTime + Math.max(0, at);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const vol = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };
  let noiseBuf = null;
  const noise = (at, dur, o = {}) => {
    const c = ready();
    if (!c) return;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = c.currentTime + Math.max(0, at);
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = o.freq || 2000;
    f.Q.value = o.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(o.vol ?? 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  };
  const notes = (list, at = 0, o = {}) => list.forEach(([f, t, d]) => tone(f, at + t, d, o));
  const api = {
    get on() {
      return on;
    },
    set(v) {
      on = v;
      try {
        localStorage.setItem(KEY, v ? 'on' : 'off');
      } catch {
        // 覚えられなくても、この画面では切り替える
      }
      if (v) ensure();
    },
    click: (at = 0) => tone(1500, at, 0.035, { type: 'square', vol: 0.05 }),
    chip: (at = 0) => {
      noise(at, 0.035, { freq: 3200, q: 5, vol: 0.35 });
      noise(at + 0.055, 0.03, { freq: 2600, q: 5, vol: 0.25 });
    },
    deal: (at = 0) => noise(at, 0.14, { freq: 1600, q: 0.7, vol: 0.18 }),
    flip: (at = 0) => {
      noise(at, 0.04, { freq: 4200, q: 2, vol: 0.22 });
      tone(700, at, 0.04, { type: 'triangle', vol: 0.05 });
    },
    stone: (at = 0) => {
      tone(240, at, 0.08, { type: 'triangle', vol: 0.3 });
      noise(at, 0.03, { freq: 1400, q: 3, vol: 0.2 });
    },
    reelStop: (at = 0) => {
      tone(130, at, 0.14, { type: 'square', vol: 0.14, to: 60 });
      noise(at, 0.06, { freq: 900, q: 2, vol: 0.3 });
    },
    /** 回っている間のカラカラ（止めるまで） */
    reelLoop() {
      const id = setInterval(() => tone(700 + Math.random() * 500, 0, 0.018, { type: 'square', vol: 0.025 }), 70);
      return { stop: () => clearInterval(id) };
    },
    /** ルーレット: だんだん遅くなるカチカチと、玉が跳ねて落ちる音（5 秒） */
    wheel() {
      const n = 64;
      for (let i = 0; i < n; i++) {
        const p = i / n;
        const t = 4.4 * (1 - Math.sqrt(1 - p));
        noise(t, 0.02, { freq: 3000 + Math.random() * 800, q: 6, vol: 0.12 });
      }
      [3.45, 3.75, 4.1, 4.35, 4.62].forEach((t, k) => tone(1800 - k * 150, t, 0.05, { type: 'triangle', vol: 0.16 - k * 0.02 }));
      tone(500, 4.9, 0.12, { type: 'triangle', vol: 0.2 });
    },
    win: (at = 0) => notes([[523, 0, 0.12], [659, 0.1, 0.12], [784, 0.2, 0.12], [1047, 0.3, 0.35]], at, { type: 'triangle', vol: 0.18 }),
    bigWin(at = 0) {
      notes([[523, 0, 0.12], [659, 0.1, 0.12], [784, 0.2, 0.12], [1047, 0.3, 0.2], [784, 0.5, 0.1], [1047, 0.6, 0.12], [1319, 0.72, 0.6]], at, { type: 'square', vol: 0.09 });
      notes([[262, 0.3, 0.9], [330, 0.3, 0.9], [392, 0.3, 0.9]], at, { type: 'triangle', vol: 0.08 });
      for (let i = 0; i < 10; i++) tone(2000 + Math.random() * 2000, at + 0.8 + i * 0.07, 0.08, { vol: 0.05 });
    },
    even: (at = 0) => notes([[660, 0, 0.12], [660, 0.14, 0.12]], at, { type: 'triangle', vol: 0.12 }),
    lose: (at = 0) => {
      tone(392, at, 0.18, { type: 'sawtooth', vol: 0.07, to: 330 });
      tone(294, at + 0.2, 0.4, { type: 'sawtooth', vol: 0.07, to: 220 });
    },
    gogo(at = 0) {
      tone(900, at, 0.25, { type: 'sine', vol: 0.2, to: 1800 });
      notes([[1568, 0.22, 0.25], [2093, 0.36, 0.5]], at, { type: 'sine', vol: 0.16 });
    },
    bell: (at = 0) => notes([[1319, 0, 0.5], [1760, 0.12, 0.6]], at, { type: 'sine', vol: 0.12 }),
  };
  return api;
})();
window.CasinoSound = Sound;

const paintSoundButton = () => {
  document.querySelectorAll('[data-sound-toggle]').forEach((b) => {
    b.setAttribute('aria-pressed', Sound.on ? 'true' : 'false');
    b.textContent = Sound.on ? '🔊' : '🔇';
    b.title = Sound.on ? '音を消す' : '音を出す';
  });
};
document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  if (t.closest('[data-sound-toggle]')) {
    Sound.set(!Sound.on);
    paintSoundButton();
    if (Sound.on) setTimeout(() => Sound.chip(), 30);
    return;
  }
  // 押したときの音
  if (t.closest('.c-chip, .c-rb-cell')) Sound.chip();
  else if (t.closest('.c-cell.can')) Sound.stone();
  else if (t.closest('.c-btn, .c-pbtn, .c-qbtn, .c-pick, .c-game, .c-pickcard, .c-drawcard')) Sound.click();
});

/** 遅れ（--d）を秒で */
const delayOf = (el) => {
  const v = getComputedStyle(el).getPropertyValue('--d').trim();
  return v.endsWith('ms') ? parseFloat(v) / 1000 : parseFloat(v) || 0;
};

/** 前からあるカードは動かさない。新しいカードは順番に配る（卓の差し替え・画面の差し替えのとき） */
const markCards = (root, before) => {
  if (!before) return 0;
  let k = 0;
  root.querySelectorAll('.fc[data-ck]').forEach((el) => {
    if (before.has(el.getAttribute('data-ck'))) el.classList.add('still');
    else {
      el.style.setProperty('--d', `${(k * 0.4).toFixed(2)}s`);
      k++;
    }
  });
  const end = k ? k * 0.4 + 0.5 : 0;
  root.querySelectorAll('.c-later:not(.wait)').forEach((el) => {
    if (k) el.style.setProperty('--d', `${end.toFixed(2)}s`);
  });
  return end;
};
const cardKeys = (root) => new Set([...(root?.querySelectorAll('.fc[data-ck]') ?? [])].map((e) => e.getAttribute('data-ck')));

/** 画面の中の動きに合わせて音を鳴らす */
const playFx = (root, tableEnd) => {
  root.querySelectorAll('.fc:not(.still)').forEach((el) => {
    const d = delayOf(el);
    Sound.deal(d);
    if (!el.classList.contains('down')) Sound.flip(d + (el.classList.contains('slow') ? 1.0 : 0.34));
  });
  if (root.querySelector('.c-wheel2.spun')) Sound.wheel();
  // 結果（スロットは止めたときに鳴らす）
  const res = root.querySelector('.c-later:not(.wait) .c-result, .c-rl-outcome .c-result');
  if (res) {
    const holder = res.closest('.c-later, .c-rl-outcome');
    const d = holder?.classList.contains('c-rl-outcome') ? 5.2 : holder ? delayOf(holder) : 0;
    const big = holder?.classList.contains('c-fx-burst');
    if (res.classList.contains('win')) big ? Sound.bigWin(d) : Sound.win(d);
    else if (res.classList.contains('lose')) Sound.lose(d);
    else Sound.even(d);
  }
  // 卓: 自分の席の結果
  const mine = root.querySelector('.c-seat.me .c-seat-result');
  if (mine && tableEnd !== undefined) {
    const d = tableEnd + (root.querySelector('.c-wheel2.spun') ? 5.2 : 0);
    if (mine.classList.contains('win')) Sound.win(d);
    else if (mine.classList.contains('lose')) Sound.lose(d);
  }
};

// ───── 送るボタン: 画面ごと読み直さず、中身だけ差し替える ─────
const swapPage = (html, url) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const main = doc.querySelector('.c-main');
  // htmx が要るページ（オセロ対戦）に、今のページに htmx がなければ、ふつうに開く
  const needsHtmx = doc.querySelector('script[src*="htmx"]') && !document.querySelector('script[src*="htmx"]');
  if (!main || needsHtmx) {
    location.href = url;
    return;
  }
  const before = cardKeys(document.querySelector('.c-main'));
  const samePath = new URL(url, location.href).pathname === location.pathname;
  document.querySelector('.c-main')?.replaceWith(main);
  const top = doc.querySelector('.c-top');
  if (top) document.querySelector('.c-top')?.replaceWith(top);
  document.title = doc.title;
  history.pushState(null, '', url);
  if (!samePath) window.scrollTo(0, 0);
  // 同じ卓の画面なら、前からあるカードは動かさない
  const end = samePath ? markCards(main, before) : 0;
  pageInit(main, samePath ? end : undefined);
};
document.addEventListener('submit', async (e) => {
  if (e.defaultPrevented) return;
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || (form.getAttribute('method') || '').toLowerCase() !== 'post') return;
  // form.action は「action」という名前のボタンがあるとそちらを指すので、属性から読む
  const action = new URL(form.getAttribute('action') || location.href, location.href);
  if (action.origin !== location.origin || !action.pathname.startsWith('/casino') || action.pathname === '/casino/logout') return;
  e.preventDefault();
  const fd = new FormData(form);
  const by = e.submitter;
  if (by && by.name && !fd.has(by.name)) fd.append(by.name, by.value);
  try {
    const res = await fetch(action.href, { method: 'POST', body: new URLSearchParams(fd), credentials: 'same-origin' });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('text/html')) {
      location.href = res.url || action.href;
      return;
    }
    swapPage(await res.text(), res.url);
  } catch {
    // うまくいかなければ、ふつうに送る
    form.submit();
  }
});
window.addEventListener('popstate', () => location.reload());

// ───── みんなで座る卓: 1.5 秒ごとに変わったか確かめて、変わっていたら中身だけ差し替える ─────
let liveTimer = null;
let dirtyAt = 0;
const live = () => document.getElementById('c-live');
document.addEventListener('input', (e) => {
  if (live()?.contains(e.target)) dirtyAt = Date.now();
});
const tickCountdowns = () => {
  const skew = Number(document.documentElement.dataset.skew || 0);
  document.querySelectorAll('[data-deadline]').forEach((n) => {
    if (n.classList.contains('c-timer')) return;
    const left = Math.max(0, Math.ceil((Number(n.getAttribute('data-deadline')) - (Date.now() + skew)) / 1000));
    const b = n.querySelector('b');
    if (b) b.textContent = String(left);
    n.classList.toggle('soon', left <= 5);
  });
};
setInterval(tickCountdowns, 250);
const myTurn = (root) => Boolean(root?.querySelector('.c-pbar, .c-turn.mine, .c-hero.myturn, button[value="stand"], .c-draw, button[value="play"]'));
const initLive = () => {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
  const el = live();
  if (!el) return;
  const id = el.dataset.table;
  let version = el.dataset.v;
  const share = (now) => {
    document.documentElement.dataset.skew = String(Number(now || Date.now()) - Date.now());
  };
  share(el.dataset.now);
  let busy = false;
  const refresh = async () => {
    const res = await fetch(`/casino/t/${id}/frag`, { headers: { accept: 'text/html' }, credentials: 'same-origin' });
    if (res.status !== 200) return;
    const box = document.createElement('div');
    box.innerHTML = await res.text();
    const next = box.querySelector('#c-live');
    const cur = live();
    if (!next || !cur) return;
    const before = cardKeys(cur);
    const wasMyTurn = myTurn(cur);
    cur.replaceWith(next);
    version = next.getAttribute('data-v');
    share(next.getAttribute('data-now'));
    dirtyAt = 0;
    tickCountdowns();
    const end = markCards(next, before);
    playFx(next, end);
    if (!wasMyTurn && myTurn(next)) Sound.bell();
    document.dispatchEvent(new Event('c-live-updated'));
  };
  liveTimer = setInterval(async () => {
    if (busy || document.hidden || !live()) return;
    busy = true;
    try {
      const res = await fetch(`/casino/t/${id}/poll`, { credentials: 'same-origin' });
      if (res.redirected || res.status === 401) {
        location.href = '/casino';
        return;
      }
      const j = await res.json();
      share(j.now);
      // 選んでいる途中なら 15 秒まで待つ（そのあいだに時間切れになれば、そのまま差し替え）
      if (String(j.v) !== String(version) && (!dirtyAt || Date.now() - dirtyAt > 15000)) await refresh();
    } catch {
      // つながらないときは次にまた
    } finally {
      busy = false;
    }
  }, 1500);
};

// ───── 💡 ヒント・📖 役の一覧の「今のあなた」・持ち時間のバー ─────
const HINT_KEY = 'casino-hints';
const hintsOn = () => {
  try {
    return localStorage.getItem(HINT_KEY) !== 'off';
  } catch {
    return true;
  }
};
const applyHints = (on) => {
  document.body.classList.toggle('c-hints-off', !on);
  document.querySelectorAll('[data-hint-toggle]').forEach((b) => b.setAttribute('aria-pressed', on ? 'true' : 'false'));
};
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-hint-toggle]') : null;
  if (!b) return;
  const on = b.getAttribute('aria-pressed') !== 'true';
  try {
    localStorage.setItem(HINT_KEY, on ? 'on' : 'off');
  } catch {
    // 覚えられなくても、この画面では切り替える
  }
  applyHints(on);
});
setInterval(() => {
  const cat = document.querySelector('[data-hand-cat]')?.getAttribute('data-hand-cat') ?? '';
  document.querySelectorAll('.c-guide-list li').forEach((li) => li.classList.toggle('now', cat !== '' && li.getAttribute('data-cat') === cat));
  const now = Date.now() + Number(document.documentElement.dataset.skew || 0);
  document.querySelectorAll('.c-timer').forEach((t) => {
    const left = Number(t.getAttribute('data-deadline')) - now;
    const total = Number(t.getAttribute('data-total')) || 1;
    const i = t.querySelector('i');
    if (i) i.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
    t.classList.toggle('soon', left < 8000);
  });
}, 250);

// ───── 🎡 ルーレットの盤: チップを選んでマスを押すと置ける。「回す」でまとめて送る ─────
const RB_STORE = 'casino-rb-';
const boards = new Map();
const rbState = (form) => {
  const key = form.getAttribute('action');
  if (!boards.has(key)) boards.set(key, { bets: new Map(), history: [], chip: 0 });
  return boards.get(key);
};
const fmt = (n) => n.toLocaleString('ja-JP');
const paintBoard = (form) => {
  const st = rbState(form);
  if (!st.chip) {
    const on = form.querySelector('[data-chip].on');
    st.chip = Number(on?.getAttribute('data-chip') || form.dataset.min);
  }
  form.querySelectorAll('[data-chip]').forEach((b) => {
    const on = Number(b.getAttribute('data-chip')) === st.chip;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  form.querySelectorAll('.c-rb-cell').forEach((cell) => {
    const amount = st.bets.get(cell.getAttribute('data-bet')) || 0;
    let badge = cell.querySelector('.c-rb-chip');
    if (amount && !badge) {
      badge = document.createElement('span');
      badge.className = 'c-rb-chip';
      cell.appendChild(badge);
    }
    if (badge) {
      if (amount) badge.textContent = fmt(amount);
      else badge.remove();
    }
    cell.classList.toggle('placed', Boolean(amount));
  });
  const total = [...st.bets.values()].reduce((a, b) => a + b, 0);
  form.querySelector('[data-rb-total]').textContent = fmt(total);
  form.querySelector('[data-rb-count]').textContent = String(st.bets.size);
  form.querySelector('[data-rb-bets]').value = [...st.bets].map(([k, v]) => `${k}:${v}`).join(',');
  const submit = form.querySelector('[data-rb-submit]');
  if (submit) submit.disabled = total === 0;
};
const rbSay = (form, text) => {
  const m = form.querySelector('[data-rb-msg]');
  if (m) m.textContent = text;
};
const rbChanged = (form) => {
  paintBoard(form);
  // 卓の画面の差し替えを少し待ってもらう
  form.dispatchEvent(new Event('input', { bubbles: true }));
};
document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  const form = t?.closest('form[data-rb]');
  if (!form) return;
  const st = rbState(form);
  const max = Number(form.dataset.max);
  const spots = Number(form.dataset.spots);
  const chip = t.closest('[data-chip]');
  if (chip) {
    st.chip = Number(chip.getAttribute('data-chip'));
    paintBoard(form);
    return;
  }
  const cell = t.closest('.c-rb-cell');
  if (cell && !cell.disabled) {
    const bet = cell.getAttribute('data-bet');
    const cur = st.bets.get(bet) || 0;
    if (!cur && st.bets.size >= spots) return rbSay(form, `置けるのは ${spots} か所までです`);
    const next = Math.min(max, cur + st.chip);
    if (next === cur) return rbSay(form, `1 か所に置けるのは ${fmt(max)} までです`);
    st.history.push([bet, cur]);
    st.bets.set(bet, next);
    rbSay(form, '');
    return rbChanged(form);
  }
  if (t.closest('[data-rb-undo]')) {
    const last = st.history.pop();
    if (last) {
      if (last[1]) st.bets.set(last[0], last[1]);
      else st.bets.delete(last[0]);
    }
    return rbChanged(form);
  }
  if (t.closest('[data-rb-clear]')) {
    st.bets.clear();
    st.history = [];
    return rbChanged(form);
  }
  if (t.closest('[data-rb-double]')) {
    for (const [k, v] of st.bets) st.bets.set(k, Math.min(max, v * 2));
    st.history = [];
    return rbChanged(form);
  }
  if (t.closest('[data-rb-repeat]')) {
    let saved = '';
    try {
      saved = localStorage.getItem(RB_STORE + form.dataset.rb) || '';
    } catch {
      saved = '';
    }
    if (!saved) return rbSay(form, 'まだ前回の賭けがありません');
    st.bets = new Map(saved.split(',').filter(Boolean).map((p) => [p.split(':')[0], Math.min(max, Number(p.split(':')[1]))]));
    st.history = [];
    return rbChanged(form);
  }
});
// 送る前に（ほかの送る処理より先に）
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-rb]')) return;
  const st = rbState(form);
  if (!st.bets.size) {
    e.preventDefault();
    return;
  }
  try {
    localStorage.setItem(RB_STORE + form.dataset.rb, form.querySelector('[data-rb-bets]').value);
  } catch {
    // 覚えられなくても送る
  }
  boards.delete(form.getAttribute('action'));
}, true);
document.addEventListener('c-live-updated', () => document.querySelectorAll('form[data-rb]').forEach(paintBoard));

// ───── 🎰 スロット: 回り続けて、STOP で 1 本ずつ止める（止まる絵柄はもう決まっている） ─────
let slotLoop = null;
const initSlots = (root) => {
  if (slotLoop) slotLoop.stop();
  slotLoop = null;
  const jug = root.querySelector('.c-jug.spinning');
  if (!jug) return;
  const reels = [...jug.querySelectorAll('.c-jreel')];
  const stops = [...jug.querySelectorAll('[data-stop]')];
  const win = Number(jug.dataset.win || 0);
  let stopped = 0;
  let done = false;
  slotLoop = Sound.reelLoop();
  if (jug.classList.contains('lamp-pre')) Sound.gogo(0.15);
  const mark = () => stops.forEach((b) => b.classList.toggle('next', !b.disabled && stops.find((x) => !x.disabled) === b));
  const finish = () => {
    if (done) return;
    done = true;
    slotLoop?.stop();
    slotLoop = null;
    if (win > 0) reels.forEach((r) => r.classList.add('win-mid'));
    let wait = 0.5;
    if (jug.dataset.lamp === 'post') {
      jug.querySelector('.c-gogo')?.classList.add('lit');
      Sound.gogo(0.25);
      wait = 1.1;
    }
    setTimeout(() => {
      document.querySelectorAll('[data-after-stop]').forEach((e) => e.classList.add('go'));
      document.querySelectorAll('.c-balance.wait').forEach((b) => {
        b.classList.remove('wait');
        b.classList.add('go');
      });
      if (win >= 10) Sound.bigWin();
      else if (win > 1) Sound.win();
      else if (win === 1) Sound.even();
      else Sound.lose();
    }, wait * 1000);
  };
  const stopReel = (i) => {
    const r = reels[i];
    if (!r || r.classList.contains('stopped')) return;
    const strip = r.querySelector('.c-jstrip');
    strip.textContent = '';
    for (const e of (r.dataset.final || '').split(',')) {
      const s = document.createElement('span');
      s.textContent = e;
      strip.appendChild(s);
    }
    r.classList.add('stopped');
    stops[i].disabled = true;
    stops[i].classList.add('pressed');
    Sound.reelStop();
    stopped++;
    mark();
    if (stopped === reels.length) finish();
  };
  stops.forEach((b, i) => b.addEventListener('click', () => stopReel(i)));
  mark();
  const onKey = (e) => {
    if (done || !document.body.contains(jug)) return document.removeEventListener('keydown', onKey);
    if (e.code === 'Space' || e.key === ' ' || ['1', '2', '3'].includes(e.key)) {
      if (e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      const i = ['1', '2', '3'].includes(e.key) ? Number(e.key) - 1 : reels.findIndex((r) => !r.classList.contains('stopped'));
      stopReel(i);
    }
  };
  document.addEventListener('keydown', onKey);
  // 押さなくても、少したつと順に止まる
  setTimeout(() => {
    reels.forEach((_, i) => setTimeout(() => document.body.contains(jug) && stopReel(i), i * 700));
  }, 9000);
};

// ───── ページごとの準備（最初に開いたとき・中身を差し替えたとき） ─────
const pageInit = (root, tableEnd) => {
  paintSoundButton();
  applyHints(hintsOn());
  document.querySelectorAll('form[data-rb]').forEach(paintBoard);
  initLive();
  initSlots(root);
  playFx(root, tableEnd);
};
pageInit(document);

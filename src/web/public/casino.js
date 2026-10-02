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
    /** 🀄 牌を切る（カッ） */
    pai: (at = 0) => {
      noise(at, 0.03, { freq: 2400, q: 4, vol: 0.32 });
      tone(460, at, 0.05, { type: 'triangle', vol: 0.12, to: 280 });
    },
    /** 🀄 ポン・チー・カン */
    call: (at = 0) => notes([[880, 0, 0.08], [1175, 0.09, 0.14]], at, { type: 'triangle', vol: 0.16 }),
    /** 🀄 リーチ（シャラン） */
    riichi(at = 0) {
      tone(600, at, 0.22, { type: 'sine', vol: 0.14, to: 1500 });
      notes([[1568, 0.2, 0.2], [2093, 0.3, 0.5]], at, { type: 'sine', vol: 0.14 });
    },
    /** 🀄 ロン・ツモ（ドーン + 和音） */
    agari(at = 0) {
      tone(140, at, 0.6, { type: 'sine', vol: 0.3, to: 70 });
      noise(at, 0.25, { freq: 300, q: 0.8, vol: 0.3 });
      notes([[523, 0.12, 0.5], [659, 0.12, 0.5], [784, 0.12, 0.5], [1047, 0.3, 0.6]], at, { type: 'triangle', vol: 0.1 });
    },
    /** 🀄 流局 */
    ryukyoku: (at = 0) => notes([[660, 0, 0.18], [494, 0.2, 0.35]], at, { type: 'triangle', vol: 0.1 }),
    /** スロットのレバー（ガコッ） */
    lever: (at = 0) => {
      tone(110, at, 0.16, { type: 'square', vol: 0.12, to: 45 });
      noise(at, 0.07, { freq: 700, q: 1.5, vol: 0.35 });
    },
    /** GOGO ランプが光った（ペカッ） */
    peka(at = 0) {
      tone(2600, at, 0.06, { type: 'square', vol: 0.05 });
      notes([[2093, 0.05, 0.12], [3136, 0.12, 0.4]], at, { type: 'sine', vol: 0.18 });
    },
    /** 7 がそろわなかった */
    miss: (at = 0) => tone(330, at, 0.22, { type: 'triangle', vol: 0.1, to: 220 }),
    /** BIG・REG のファンファーレ */
    bonus(big = true, at = 0) {
      const m = big
        ? [[784, 0, 0.14], [784, 0.15, 0.14], [784, 0.3, 0.14], [1047, 0.45, 0.4], [988, 0.9, 0.14], [1047, 1.05, 0.14], [1175, 1.2, 0.14], [1568, 1.35, 0.8]]
        : [[659, 0, 0.14], [784, 0.15, 0.14], [988, 0.3, 0.14], [1319, 0.45, 0.6]];
      notes(m, at, { type: 'square', vol: 0.08 });
      notes(big ? [[262, 0.45, 1.6], [330, 0.45, 1.6], [392, 0.45, 1.6]] : [[330, 0.45, 0.9], [392, 0.45, 0.9]], at, { type: 'triangle', vol: 0.07 });
    },
    /** サイコロがどんぶりの中で跳ねる（チン・チロ・リン） */
    dice(at = 0) {
      [0.12, 0.3, 0.44, 0.56, 0.66].forEach((t, k) => {
        tone(2300 + Math.random() * 900 - k * 120, at + t, 0.09, { type: 'triangle', vol: 0.12 - k * 0.015 });
        noise(at + t, 0.025, { freq: 4500, q: 4, vol: 0.12 });
      });
    },
    /** 戻りを数えるチャリチャリ */
    tick: (at = 0) => tone(2400 + Math.random() * 1200, at, 0.03, { type: 'square', vol: 0.025 }),
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
  // 新しいカードは 0.4 秒ずつ、サイコロ（1 回振った目）は 1.2 秒ずつ
  let t = 0;
  let k = 0;
  root.querySelectorAll('.fc[data-ck], .c-roll[data-ck]').forEach((el) => {
    if (before.has(el.getAttribute('data-ck'))) el.classList.add('still');
    else {
      el.style.setProperty('--d', `${t.toFixed(2)}s`);
      t += el.classList.contains('c-roll') ? 1.2 : 0.4;
      k++;
    }
  });
  const end = k ? t + 0.5 : 0;
  root.querySelectorAll('.c-later:not(.wait)').forEach((el) => {
    if (k) el.style.setProperty('--d', `${end.toFixed(2)}s`);
  });
  return end;
};
const cardKeys = (root) => new Set([...(root?.querySelectorAll('.fc[data-ck], .c-roll[data-ck]') ?? [])].map((e) => e.getAttribute('data-ck')));

/** 画面の中の動きに合わせて音を鳴らす */
const playFx = (root, tableEnd) => {
  root.querySelectorAll('.fc:not(.still)').forEach((el) => {
    const d = delayOf(el);
    Sound.deal(d);
    if (!el.classList.contains('down')) Sound.flip(d + (el.classList.contains('slow') ? 1.0 : 0.34));
  });
  if (root.querySelector('.c-wheel2.spun')) Sound.wheel();
  // サイコロがどんぶりに入る（ちんちろりん）
  root.querySelectorAll('.c-roll:not(.still)').forEach((el) => Sound.dice(delayOf(el)));
  // 結果（スロットは initSlots が鳴らす）
  const res = root.querySelector('.c-jug') ? null : root.querySelector('.c-later:not(.wait) .c-result, .c-rl-outcome .c-result');
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
const myTurn = (root) => Boolean(root?.querySelector('.c-pbar, .c-turn.mine, .c-hero.myturn, button[value="stand"], .c-draw, button[value="play"], .mj-mine.myturn'));
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
document.addEventListener('c-live-updated', () => {
  document.querySelectorAll('form[data-rb]').forEach(paintBoard);
  paintTwoTap();
  paintTapHint();
});

// ───── 🎰 スロット（ジャグラー風）: リールを回し、STOP で左から 1 本ずつ止める ─────
// - spin: 止まる目はもう決まっている（data-stops）。遠ければ、ぼやけている間にずらしてから最大 4 コマすべらせる
// - aim: ボーナスを持っている。押した所から最大 4 コマ以内で、どれかのライン（5 本）に 7 がつながる所で止まる。
//   止め終わったら押した所を送り、サーバーが同じ計算で確かめる（services/casino/slots.ts の judge・aimStops と同じ決まり）
// - still: 止まったまま。レバー（スペース）で同じ量を賭けて回す
const REEL_SPEED = 15; // コマ / 秒
let slotCtl = null;
let leverAt = 0;
const initSlots = (root) => {
  if (slotCtl) slotCtl.stop();
  slotCtl = null;
  const jug = root.querySelector('.c-jug');
  if (!jug) return;
  const N = Number(jug.dataset.n) || 21;
  const SLIP = Number(jug.dataset.slip) || 4;
  let mode = jug.dataset.mode;
  const bonus = jug.dataset.role;
  const speed = matchMedia('(prefers-reduced-motion: reduce)').matches ? 7 : REEL_SPEED;
  const stops = (jug.dataset.stops || '0,0,0').split(',').map(Number);
  const want = (jug.dataset.want || '').split(',');
  const lines = (jug.dataset.lines || '').split('|').filter(Boolean).map((x) => {
    const [k, l] = x.split(':');
    return [k, l.split('.')];
  });
  const paylines = (jug.dataset.paylines || '1,1,1').split('|').map((x) => x.split(',').map(Number));
  const roleOf = (line) => (lines.find(([, w]) => w.every((x, i) => x === '*' || x === line[i])) || ['none'])[0];
  const reels = [...jug.querySelectorAll('.c-jreel')].map((el, i) => {
    const at = Number(el.dataset.at ?? stops[i]) || 0;
    return { el, strip: el.querySelector('.c-jstrip'), keys: (el.dataset.strip || '').split(','), pos: N + at, state: 'still', anim: null, at };
  });
  const keyAt = (r, i) => reels[r].keys[((i % N) + N) % N];
  /** どこかのラインにそろった役（slots.ts の judge と同じ） */
  const judge = (st) => {
    const found = paylines.map((rows) => roleOf(rows.map((row, i) => keyAt(i, st[i] - 1 + row))));
    const line = found.findIndex((r) => r !== 'none');
    return { role: line < 0 ? 'none' : found[line], line, roles: [...new Set(found.filter((r) => r !== 'none'))] };
  };
  const rowsOf = (reel, st, k) => [0, 1, 2].filter((row) => keyAt(reel, st - 1 + row) === k);
  const paint = (r) => r.strip.style.setProperty('--at', r.pos.toFixed(3));
  const stopBtns = [...jug.querySelectorAll('[data-stop]')];
  const lever = jug.querySelector('[data-lever]');
  const spinLever = jug.querySelector('[data-lever-spin]');
  const lamp = jug.querySelector('.c-gogo');
  const form = document.querySelector('form[data-aim]');
  const winEl = jug.querySelector('.c-winline');
  let alive = true;
  let raf = 0;
  let last = 0;
  let loop = null;
  let pressed = [];
  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(() => alive && fn(), ms));
  const nextIdx = () => reels.findIndex((r) => r.state === 'spin');
  const mark = () => {
    const n = mode === 'still' ? -1 : nextIdx();
    stopBtns.forEach((b, i) => b.classList.toggle('next', i === n));
  };
  const frame = (t) => {
    if (!alive) return;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    for (const r of reels) {
      if (r.state === 'spin') {
        r.pos -= speed * dt;
        while (r.pos < N) r.pos += N;
        paint(r);
      } else if (r.state === 'slide') {
        const a = r.anim;
        const p = Math.min(1, (t - a.t0) / a.dur);
        r.pos = a.from + (a.to - a.from) * (1 - (1 - p) ** 3);
        if (p >= 1) {
          r.pos = N + r.at;
          r.state = 'still';
          a.done();
        }
        paint(r);
      }
    }
    raf = requestAnimationFrame(frame);
  };
  reels.forEach(paint);
  raf = requestAnimationFrame(frame);

  /** 当たったラインを光らせる */
  const showLine = (l) => {
    if (l < 0 || !paylines[l]) return;
    reels.forEach((r, i) => r.el.classList.add(`hit-${paylines[l][i]}`));
    jug.querySelectorAll(`.ln[data-line="${l}"]`).forEach((e) => e.classList.add('on'));
    const win = jug.querySelector('.c-jug-window');
    if (!winEl || !win) return;
    const box = win.getBoundingClientRect();
    const pt = (i) => {
      const rb = reels[i].el.getBoundingClientRect();
      return [rb.left + rb.width / 2 - box.left, rb.top + (rb.height / 3) * (paylines[l][i] + 0.5) - box.top];
    };
    const [x0, y0] = pt(0);
    const [x2, y2] = pt(2);
    const pad = reels[0].el.getBoundingClientRect().width / 2;
    const len = Math.hypot(x2 - x0, y2 - y0) + pad * 2;
    const ang = Math.atan2(y2 - y0, x2 - x0);
    winEl.style.setProperty('left', `${(x0 + x2) / 2 - len / 2}px`);
    winEl.style.setProperty('top', `${(y0 + y2) / 2}px`);
    winEl.style.setProperty('width', `${len}px`);
    winEl.style.setProperty('transform', `rotate(${ang}rad)`);
    winEl.classList.add('show');
  };
  const clearLine = () => {
    reels.forEach((r) => r.el.classList.remove('hit-0', 'hit-1', 'hit-2'));
    jug.querySelectorAll('.ln.on').forEach((e) => e.classList.remove('on'));
    winEl?.classList.remove('show');
  };

  /** 目押しのすべり（slots.ts の aimStops と同じ） */
  const aimStop = (reel, p) => {
    const cands = Array.from({ length: SLIP + 1 }, (_, k) => (((p - k) % N) + N) % N);
    const prev = reels.slice(0, reel).map((r) => r.at);
    const alive2 = paylines.map((_, l) => l).filter((l) => prev.every((st, r) => rowsOf(r, st, want[r]).includes(paylines[l][r])));
    const hits = (c) => alive2.some((l) => rowsOf(reel, c, want[reel]).includes(paylines[l][reel]));
    const clean = (c) => {
      if (reel === 0) return rowsOf(0, c, 'cherry').length === 0;
      if (reel < 2) return true;
      return judge([...prev, c]).roles.every((r) => r === bonus);
    };
    return cands.find((c) => hits(c) && clean(c)) ?? cands.find(clean) ?? cands[0];
  };

  const spinAll = () => {
    clearLine();
    reels.forEach((r) => {
      r.state = 'spin';
      r.el.classList.add('spin');
    });
    jug.classList.add('running');
    loop?.stop();
    loop = Sound.reelLoop();
  };
  const startSpin = () => {
    pressed = [];
    spinAll();
    stopBtns.forEach((b) => {
      b.disabled = false;
      b.classList.remove('pressed');
    });
    if (lever) {
      lever.disabled = true;
      lever.classList.add('pulled');
    }
    mark();
  };

  const allStopped = () => {
    loop?.stop();
    loop = null;
    jug.classList.remove('running');
    lever?.classList.remove('pulled');
    const j = judge(reels.map((r) => r.at));
    if (mode === 'aim') {
      const hit = j.role === bonus;
      if (hit) showLine(j.line);
      else Sound.miss(0.1);
      later(() => {
        const input = form?.querySelector('[data-aim-p]');
        if (!input) return;
        input.value = pressed.join(',');
        form.requestSubmit();
      }, hit ? 300 : 650);
      return;
    }
    const win = Number(jug.dataset.win || 0);
    if (win > 0) showLine(Number(jug.dataset.winline ?? j.line));
    let wait = 450;
    const held = !jug.dataset.win && (bonus === 'big' || bonus === 'reg');
    if (held) {
      if (jug.dataset.lamp === 'post') {
        lamp?.classList.add('lit', 'peka');
        Sound.peka(0.2);
        wait = 1100;
      }
      // ここからは 7 を狙う
      later(() => {
        mode = 'aim';
        jug.dataset.mode = 'aim';
        if (lever) lever.disabled = false;
        const note = jug.querySelector('.c-deck-note');
        if (note) note.textContent = 'レバーで回して 7 を狙う';
      }, wait);
    }
    // 止め終わったら、レバーでまた回せる
    if (!held && spinLever) {
      later(() => {
        mode = 'still';
        jug.dataset.mode = 'still';
        spinLever.disabled = false;
        spinLever.classList.remove('pulled');
        const note = jug.querySelector('.c-deck-note');
        if (note) note.textContent = note.dataset.still || note.textContent;
      }, wait);
    }
    later(() => {
      document.querySelectorAll('[data-after-stop]').forEach((e) => e.classList.add('go'));
      document.querySelectorAll('.c-balance.wait').forEach((b) => {
        b.classList.remove('wait');
        b.classList.add('go');
      });
      if (win >= 2) Sound.win();
      else if (win === 1) Sound.even();
    }, wait);
  };

  const stopReel = (i) => {
    const r = reels[i];
    if (mode === 'still' || !r || r.state !== 'spin' || i !== nextIdx()) return;
    const pf = Math.floor(r.pos);
    const p = pf % N;
    let target;
    let from = r.pos;
    if (mode === 'aim') {
      pressed.push(p);
      target = aimStop(i, p);
    } else {
      target = stops[i];
    }
    let d = (((p - target) % N) + N) % N;
    if (mode !== 'aim' && d > SLIP) {
      const k = Math.floor(Math.random() * (SLIP + 1));
      from = r.pos - (d - k);
      if (from < N) from += N;
      d = k;
    }
    r.at = target;
    const to = Math.floor(from) - d;
    r.anim = {
      from,
      to,
      t0: performance.now(),
      dur: ((from - to) / speed) * 1000 * 1.6 + 70,
      done: () => {
        r.el.classList.remove('spin');
        r.strip.classList.remove('bump');
        void r.strip.offsetWidth;
        r.strip.classList.add('bump');
        Sound.reelStop();
        if (reels.every((x) => x.state === 'still')) allStopped();
      },
    };
    r.state = 'slide';
    const b = stopBtns[i];
    if (b) {
      b.disabled = true;
      b.classList.add('pressed');
    }
    mark();
  };

  stopBtns.forEach((b, i) => b.addEventListener('click', () => stopReel(i)));
  lever?.addEventListener('click', () => {
    if (reels.some((r) => r.state !== 'still')) return;
    Sound.lever();
    startSpin();
  });
  // 止まっているときのレバー: 送るのと同時に回し始める（次の画面が来たら、決まった目で止められる）
  spinLever?.addEventListener('click', () => {
    leverAt = Date.now();
    spinLever.classList.add('pulled');
    Sound.lever();
    spinAll();
  });
  const onKey = (e) => {
    if (!alive) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.repeat) return;
    const n = ['1', '2', '3'].indexOf(e.key);
    if (e.code !== 'Space' && e.key !== ' ' && n < 0) return;
    e.preventDefault();
    if (mode === 'still') {
      if (n < 0 && spinLever && !spinLever.disabled && !jug.classList.contains('running')) spinLever.click();
      return;
    }
    if (lever && !lever.disabled && reels.every((r) => r.state === 'still')) {
      lever.click();
      return;
    }
    stopReel(n >= 0 ? n : nextIdx());
  };
  document.addEventListener('keydown', onKey);

  if (mode === 'spin') {
    if (Date.now() - leverAt > 3000) Sound.lever();
    startSpin();
    // 押さなくても、少したつと左から止まる
    later(() => reels.forEach((_, i) => later(() => stopReel(i), i * 700)), 9000);
  } else if (mode === 'aim' && jug.dataset.auto === '1') {
    // 先ペカ: レバーでランプが光って、そのまま狙える
    lamp?.classList.add('peka');
    if (Date.now() - leverAt > 3000) Sound.lever();
    Sound.peka(0.15);
    startSpin();
  } else if (mode === 'still') {
    if (jug.dataset.winline) showLine(Number(jug.dataset.winline));
    // そろえたばかりのボーナス: ファンファーレと、戻りを数え上げる
    const count = jug.querySelector('[data-count]');
    if (count) {
      const total = Number(count.getAttribute('data-count')) || 0;
      Sound.bonus(bonus === 'big');
      const t0 = performance.now();
      const dur = 2600;
      const tick = (t) => {
        if (!alive) return;
        const p = Math.min(1, (t - t0) / dur);
        count.textContent = Math.round(total * p).toLocaleString('ja-JP');
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      for (let i = 0; i < 26; i++) Sound.tick(0.6 + i * 0.08);
    }
  }

  slotCtl = {
    stop() {
      alive = false;
      cancelAnimationFrame(raf);
      loop?.stop();
      timers.forEach(clearTimeout);
      timers = [];
      document.removeEventListener('keydown', onKey);
    },
  };
};

// ───── 🀄 麻雀: スマホは 1 回目のタップで牌を浮かせ、2 回目で切る（誤タップを防ぐ）。待ちを先に見せる ─────
const TWOTAP_KEY = 'mj-twotap';
const coarsePointer = () => window.matchMedia('(pointer: coarse)').matches;
/** 2 回タップで切るか（はじめはスマホ・タブレットだけ。ボタンで切り替え・ブラウザに覚える） */
const twoTapOn = () => {
  try {
    const v = localStorage.getItem(TWOTAP_KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch {
    // 覚えられなくてもよい
  }
  return coarsePointer();
};
const paintTwoTap = () => document.querySelectorAll('[data-mj-twotap]').forEach((b) => b.setAttribute('aria-pressed', twoTapOn() ? 'true' : 'false'));
const showWaits = (b) => {
  const box = b?.closest('form')?.querySelector('.mj-waitinfo');
  if (box) box.textContent = b?.dataset.waits || '';
};
document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  const toggle = t?.closest('[data-mj-twotap]');
  if (toggle) {
    try {
      localStorage.setItem(TWOTAP_KEY, twoTapOn() ? 'off' : 'on');
    } catch {
      // この画面だけ
    }
    paintTwoTap();
    return;
  }
  const b = t?.closest('.mj-handform button.mj-t');
  if (!b || b.disabled) return;
  if (twoTapOn() && !b.classList.contains('sel')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    document.querySelectorAll('.mj-handform button.mj-t.sel').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
    showWaits(b);
    // 選んでいるあいだは画面を差し替えない
    dirtyAt = Date.now();
  }
}, true);
document.addEventListener('mouseover', (e) => {
  const b = e.target instanceof Element ? e.target.closest('.mj-handform button.mj-t') : null;
  if (b) showWaits(b);
});
document.addEventListener('mouseout', (e) => {
  const b = e.target instanceof Element ? e.target.closest('.mj-handform button.mj-t') : null;
  if (b && !b.classList.contains('sel')) showWaits(document.querySelector('.mj-handform button.mj-t.sel'));
});
const paintTapHint = () =>
  document.querySelectorAll('.mj-hint-tap').forEach((n) => {
    n.textContent = twoTapOn() ? '切る牌をタップ → もう一度タップで切ります。' : '切る牌を押してください。';
  });

// ───── 🀄 麻雀の演出: 切った牌が落ちる音と動き・鳴き/リーチ/和了の文字（前に見た番号より新しいものだけ） ─────
let mjSeen = null;
const MJ_SHOUT = { riichi: 'リーチ', pon: 'ポン', chi: 'チー', kan: 'カン', ron: 'ロン', tsumo: 'ツモ', draw: '流局' };
const MJ_SOUND = { riichi: 'riichi', pon: 'call', chi: 'call', kan: 'call', ron: 'agari', tsumo: 'agari', draw: 'ryukyoku' };
const mjFx = () => {
  const el = document.querySelector('.mj-fxdata');
  const board = document.querySelector('.mj-board2');
  if (!el || !board) return;
  const table = live()?.dataset.table || '';
  let list = [];
  try {
    list = JSON.parse(el.getAttribute('data-fx') || '[]');
  } catch {
    return;
  }
  const max = list.reduce((a, e) => Math.max(a, e.n), 0);
  // はじめて開いたときは鳴らさない
  if (!mjSeen || mjSeen.table !== table) {
    mjSeen = { table, n: max };
    return;
  }
  const fresh = list.filter((e) => e.n > mjSeen.n).slice(-3);
  mjSeen.n = Math.max(mjSeen.n, max);
  fresh.forEach((e, k) => {
    const at = k * 0.28;
    if (e.k === 'discard' || e.k === 'riichi') {
      Sound.pai(at);
      board.querySelector(`.mj-rv.r${e.pos} .mj-river > .mj-t:last-child`)?.classList.add('fresh');
    }
    if (!MJ_SHOUT[e.k]) return;
    setTimeout(() => {
      Sound[MJ_SOUND[e.k]]?.();
      const d = document.createElement('div');
      d.className = `mj-shout p-${e.pos} k-${e.k}`;
      d.textContent = MJ_SHOUT[e.k];
      board.appendChild(d);
      setTimeout(() => d.remove(), 1500);
    }, at * 1000);
  });
};
document.addEventListener('c-live-updated', mjFx);

// ───── ページごとの準備（最初に開いたとき・中身を差し替えたとき） ─────
const pageInit = (root, tableEnd) => {
  paintSoundButton();
  applyHints(hintsOn());
  document.querySelectorAll('form[data-rb]').forEach(paintBoard);
  initLive();
  initSlots(root);
  playFx(root, tableEnd);
  paintTwoTap();
  paintTapHint();
  mjFx();
};
pageInit(document);

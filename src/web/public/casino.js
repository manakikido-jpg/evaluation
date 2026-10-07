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
    win: (at = 0) => document.body.dataset.styleSound === 'bell' ? notes([[1568, 0, .5], [2093, .18, .6], [2637, .36, .8]], at, { type: 'sine', vol: .12 }) : notes([[523, 0, 0.12], [659, 0.1, 0.12], [784, 0.2, 0.12], [1047, 0.3, 0.35]], at, { type: 'triangle', vol: 0.18 }),
    bigWin(at = 0) {
      if (document.body.dataset.styleSound === 'bell') { notes([[1568, 0, .5], [2093, .18, .6], [2637, .36, .8]], at, { type: 'sine', vol: .12 }); return; }
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
    /** 🏇 発走のファンファーレ・足音・ゴール */
    fanfare: (at = 0) =>
      notes([[523, 0, 0.16], [659, 0.16, 0.16], [784, 0.32, 0.16], [1047, 0.48, 0.3], [784, 0.82, 0.14], [1047, 0.98, 0.5]], at, { type: 'square', vol: 0.07 }),
    /** G1 のファンファーレ（長い） */
    fanfareG1: (at = 0) =>
      notes(
        [[392, 0, 0.18], [523, 0.2, 0.18], [659, 0.4, 0.18], [784, 0.6, 0.35], [659, 1.0, 0.16], [784, 1.18, 0.16], [1047, 1.36, 0.5], [988, 1.9, 0.16], [1047, 2.08, 0.16], [1175, 2.26, 0.16], [1319, 2.44, 0.8]],
        at,
        { type: 'square', vol: 0.07 },
      ),
    /** ゲートが開く音 */
    gateOpen: (at = 0) => {
      noise(at, 0.25, { freq: 900, q: 0.6, vol: 0.3 });
      tone(180, at, 0.2, { type: 'square', vol: 0.08, to: 90 });
    },
    /** 最後の直線の大歓声 */
    roar: (at = 0) => {
      noise(at, 1.6, { freq: 700, q: 0.4, vol: 0.12 });
      noise(at + 0.8, 2.4, { freq: 1100, q: 0.4, vol: 0.14 });
    },
    gallop: (at = 0) => {
      noise(at, 0.05, { freq: 300, q: 0.8, vol: 0.12 });
      noise(at + 0.09, 0.05, { freq: 260, q: 0.8, vol: 0.09 });
    },
    goal: (at = 0) => notes([[784, 0, 0.12], [988, 0.12, 0.12], [1175, 0.24, 0.12], [1568, 0.36, 0.5]], at, { type: 'triangle', vol: 0.16 }),
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
    /** 🎰 メダル 1 枚（チャリッ） */
    medal(at = 0) {
      tone(2600 + Math.random() * 900, at, 0.05, { type: 'triangle', vol: 0.07 });
      noise(at, 0.035, { freq: 6500, q: 3, vol: 0.1 });
    },
    /** 🎰 MAX BET（ピピピッ） */
    bet(at = 0) {
      [0, 0.07, 0.14].forEach((t, k) => tone(1800 + k * 200, at + t, 0.05, { type: 'square', vol: 0.05 }));
      noise(at + 0.02, 0.05, { freq: 5500, q: 2, vol: 0.1 });
    },
    // 🦊 AT 機の演出（atslot.js）が自分で音を組むためのもの
    tone,
    noise,
    notes,
    /** 今の音の時刻（鳴らせないときは null） */
    time: () => ready()?.currentTime ?? null,
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

/** お試しの時間が来たら、開いたままの画面も元の装備に戻す */
setInterval(() => {
  const until = Number(document.body.dataset.styleUntil);
  const skew = Number(document.documentElement.dataset.skew || 0);
  if (!until || Date.now() + skew < until) return;
  const styles = JSON.parse(document.body.dataset.baseStyles || '{}');
  for (const cls of [...document.body.classList]) if (/^cs-(background|table|ornament|chips|cards|effect|sound|title)-/.test(cls)) document.body.classList.remove(cls);
  for (const [slot, key] of Object.entries(styles)) document.body.classList.add(`cs-${slot}-${key}`);
  document.body.dataset.styleSound = styles.sound || '';
  document.body.dataset.styleEffect = styles.effect || '';
  document.body.dataset.styleUntil = '';
}, 1000);

/** 勝った人の画面だけに出す、着せ替えの桜吹雪 */
const styleVictory = (at = 0) => {
  if (document.body.dataset.styleEffect !== 'petals' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const effect = document.body.dataset.styleEffect;
  setTimeout(() => {
    if (document.body.dataset.styleEffect !== effect) return;
    document.querySelector('.cs-victory')?.remove();
    const box = document.createElement('div');
    box.className = 'cs-victory';
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 13; i++) { const petal = document.createElement('span'); petal.textContent = '🌸'; petal.style.setProperty('--petal', String(i)); box.append(petal); }
    document.body.append(box);
    setTimeout(() => box.remove(), 4200);
  }, at * 1000);
};
document.addEventListener('click', (e) => { if (e.target instanceof Element && e.target.closest('[data-style-demo]')) Sound.win(); });
const originalWin = Sound.win, originalBigWin = Sound.bigWin;
Sound.win = (at = 0) => { originalWin(at); styleVictory(at); };
Sound.bigWin = (at = 0) => { originalBigWin(at); styleVictory(at); };

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
  const res = root.querySelector('.c-jug, .c-atm') ? null : root.querySelector('.c-later:not(.wait) .c-result, .c-rl-outcome .c-result');
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
  document.body.className = doc.body.className;
  document.body.dataset.styleSound = doc.body.dataset.styleSound || '';
  document.body.dataset.styleEffect = doc.body.dataset.styleEffect || '';
  document.body.dataset.styleUntil = doc.body.dataset.styleUntil || '';
  document.body.dataset.baseStyles = doc.body.dataset.baseStyles || '{}';
  document.title = doc.title;
  history.pushState(null, '', url);
  if (!samePath) window.scrollTo(0, 0);
  // 同じ卓の画面なら、前からあるカードは動かさない
  const end = samePath ? markCards(main, before) : 0;
  pageInit(main, samePath ? end : undefined);
  document.dispatchEvent(new Event('c-page-swapped'));
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
  let styleVersion = el.dataset.styleV;
  const share = (now) => {
    document.documentElement.dataset.skew = String(Number(now || Date.now()) - Date.now());
  };
  share(el.dataset.now);
  let busy = false;
  const refresh = async (styleOnly = false) => {
    const res = await fetch(`/casino/t/${id}/frag`, { headers: { accept: 'text/html' }, credentials: 'same-origin' });
    if (res.status !== 200) return;
    const box = document.createElement('div');
    box.innerHTML = await res.text();
    const next = box.querySelector('#c-live');
    const cur = live();
    if (!next || !cur) return;
    const before = cardKeys(cur);
    const wasMyTurn = myTurn(cur);
    const kept = keepPicks(cur);
    cur.replaceWith(next);
    restorePicks(next, kept);
    version = next.getAttribute('data-v');
    styleVersion = next.getAttribute('data-style-v');
    share(next.getAttribute('data-now'));
    dirtyAt = 0;
    tickCountdowns();
    const end = markCards(next, before);
    if (!styleOnly) playFx(next, end);
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
      for (const cls of [...document.body.classList]) if (/^cs-(background|table|ornament|chips|cards|effect|sound|title)-/.test(cls)) document.body.classList.remove(cls);
      for (const [slot, key] of Object.entries(j.styles || {})) document.body.classList.add(`cs-${slot}-${key}`);
      document.body.dataset.styleUntil = '';
      document.body.dataset.styleSound = j.styles?.sound || '';
      document.body.dataset.styleEffect = j.styles?.effect || '';
      // 選んでいる途中なら 15 秒まで待つ（そのあいだに時間切れになれば、そのまま差し替え）
      const due = [...(live()?.querySelectorAll('.c-count[data-deadline]') ?? [])].some((n) => Number(n.dataset.deadline) <= Number(j.now));
      if ((String(j.v) !== String(version) || j.styleVersion !== styleVersion) && (!dirtyAt || due || Date.now() - dirtyAt > 15000)) await refresh(String(j.v) === String(version));
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
/** リールの速さ（コマ / 秒）。左が速く、右に行くほど遅い（目押ししやすいように） */
// ───── 🎰 実機っぽさ（SAKURA 777 と AT 機で同じ）─────
// - ウェイト: 前のゲームのリールが回り始めてから 4.1 秒たつまで、次のリールは回らない
// - MAX BET: レバーの前に BET ランプが 1・2・3 と点く（押さなくてもレバーで自動で）
// - 払い出し: PAYOUT と CREDIT を数え上げて、下皿にメダルが落ちる
// - リールの回り始めは少しずつ速くなる
const Real = (() => {
  const KEY = 'casino-reel-start';
  const WAIT = 4100;
  const lastStart = () => {
    try {
      return Number(sessionStorage.getItem(KEY)) || 0;
    } catch {
      return 0;
    }
  };
  let local = 0;
  return {
    SPINUP: 320,
    /** 次のリールが回れるまでの ms（ウェイト） */
    waitMs: () => Math.max(0, WAIT - (Date.now() - lastStart())),
    /** レバーの前の画面で、もう回し始めたか（次の画面ではそのまま回す。1 回だけ） */
    justStarted() {
      const yes = Date.now() - local < 3000;
      local = 0;
      return yes;
    },
    /** レバーで回し始めた（次の画面に知らせる） */
    leverSpun() {
      local = Date.now();
    },
    markStart() {
      try {
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        // 覚えられなければウェイトなし
      }
    },
    /** 回り始めの速さ（0〜1） */
    ramp: (spinAt, t) => (spinAt ? Math.min(1, Math.max(0.08, (t - spinAt) / 320)) : 1),
    /** MAX BET（もう点いていれば何もしない） */
    bet(box) {
      if (!box || box.classList.contains('betted')) return;
      box.classList.add('betted');
      Sound.bet();
      box.querySelectorAll('[data-bet-lamp]').forEach((l, i) => setTimeout(() => l.classList.add('on'), i * 70));
    },
    unbet(box) {
      if (!box) return;
      box.classList.remove('betted');
      box.querySelectorAll('[data-bet-lamp]').forEach((l) => l.classList.remove('on'));
    },
    /** 払い出し: PAYOUT・CREDIT を数え上げ、メダルの音と下皿 */
    payout(box) {
      if (!box) return;
      const out = box.querySelector('[data-payout]');
      const credit = box.querySelector('[data-credit]');
      const total = Number(out?.dataset.payout || 0);
      const from = Number(credit?.dataset.creditFrom || credit?.dataset.credit || 0);
      const to = Number(credit?.dataset.credit || 0);
      if (!out && !credit) return;
      if (total <= 0) {
        if (out) out.textContent = '0';
        if (credit) credit.textContent = to.toLocaleString('ja-JP');
        return;
      }
      const steps = Math.max(1, Math.min(30, Math.round(total / Math.max(1, Number(box.dataset.unit) || 10))));
      const dur = Math.min(2200, steps * 70);
      out?.classList.add('lit');
      for (let k = 0; k < steps; k++) Sound.medal((k * dur) / steps / 1000);
      const t0 = performance.now();
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        if (out) out.textContent = Math.round(total * p).toLocaleString('ja-JP');
        if (credit) credit.textContent = Math.round(from + (to - from) * p).toLocaleString('ja-JP');
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      // 下皿にメダルが落ちる
      const tray = box.querySelector('[data-tray]');
      if (tray && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (let k = 0; k < Math.min(steps, 24); k++) {
          setTimeout(() => {
            const m = document.createElement('i');
            m.className = 'c-medal-drop';
            m.style.left = `${8 + Math.random() * 84}%`;
            tray.append(m);
            setTimeout(() => m.classList.add('rest'), 420);
            // 多すぎたら古いものから消す
            const all = tray.querySelectorAll('.c-medal-drop');
            if (all.length > 40) all[0].remove();
          }, (k * dur) / steps);
        }
      }
    },
  };
})();

/** そろったラインを光らせる（両方の台。rows はリールごとの段 0 上・1 中・2 下） */
const showPayline = (win, rows) => {
  if (!win || !rows) return;
  const reels = [...win.querySelectorAll('.c-jreel')];
  reels.forEach((el, i) => el.classList.add(`hit-${rows[i]}`));
  const line = win.querySelector('.c-winline');
  if (!line || reels.length < 3) return;
  const box = win.getBoundingClientRect();
  const pt = (i) => {
    const rb = reels[i].getBoundingClientRect();
    return [rb.left + rb.width / 2 - box.left, rb.top + (rb.height / 3) * (rows[i] + 0.5) - box.top];
  };
  const [x0, y0] = pt(0);
  const [x2, y2] = pt(2);
  const pad = reels[0].getBoundingClientRect().width / 2;
  const len = Math.hypot(x2 - x0, y2 - y0) + pad * 2;
  line.style.setProperty('left', `${(x0 + x2) / 2 - len / 2}px`);
  line.style.setProperty('top', `${(y0 + y2) / 2}px`);
  line.style.setProperty('width', `${len}px`);
  line.style.setProperty('transform', `rotate(${Math.atan2(y2 - y0, x2 - x0)}rad)`);
  line.classList.add('show');
};

const REEL_SPEEDS = [15, 12, 9.5];
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
  // 動きを減らす設定なら半分の速さ
  const slow = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.5 : 1;
  const speedOf = (i) => (REEL_SPEEDS[i] ?? REEL_SPEEDS.at(-1)) * slow;
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
    for (const [i, r] of reels.entries()) {
      if (r.state === 'spin') {
        r.pos -= speedOf(i) * dt * Real.ramp(r.spinAt, t);
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
    Real.markStart();
    const t = performance.now();
    reels.forEach((r) => {
      r.state = 'spin';
      r.spinAt = t;
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
    if (win > 0) jug.querySelector('.c-jug-window')?.classList.add('bl-flash');
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
      if (!held) {
        Real.payout(jug);
        Real.unbet(jug);
      }
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
      dur: ((from - to) / speedOf(i)) * 1000 * 1.6 + 70,
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
    if (reels.some((r) => r.state !== 'still') || jug.classList.contains('waiting')) return;
    Sound.lever();
    lever.classList.add('pulled');
    // ウェイト（前のゲームから 4.1 秒）がすんでから回る
    const w = Real.waitMs();
    if (w > 0) jug.classList.add('waiting');
    later(() => {
      jug.classList.remove('waiting');
      startSpin();
    }, w);
  });
  // 止まっているときのレバー: 送るのと同時に回し始める（次の画面が来たら、決まった目で止められる）
  spinLever?.addEventListener('click', () => {
    leverAt = Date.now();
    Real.bet(jug);
    spinLever.classList.add('pulled');
    Sound.lever();
    // ウェイト中なら、次の画面で回り始める
    if (Real.waitMs() <= 0) {
      Real.leverSpun();
      spinAll();
    }
  });
  jug.querySelector('[data-maxbet]')?.addEventListener('click', () => Real.bet(jug));
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
    jug.classList.add('betted');
    jug.querySelectorAll('[data-bet-lamp]').forEach((l) => l.classList.add('on'));
    // ウェイト（前のゲームから 4.1 秒）がすんでから回る
    const w = Real.justStarted() ? 0 : Real.waitMs();
    if (w > 0) jug.classList.add('waiting');
    later(() => {
      jug.classList.remove('waiting');
      startSpin();
      // 押さなくても、少したつと左から止まる
      later(() => reels.forEach((_, i) => later(() => stopReel(i), i * 700)), 9000);
    }, w);
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
const MJ_SHOUT = { riichi: 'リーチ', pon: 'ポン', chi: 'チー', kan: 'カン', kita: '北', ron: 'ロン', tsumo: 'ツモ', draw: '流局' };
const MJ_SOUND = { riichi: 'riichi', pon: 'call', chi: 'call', kan: 'call', kita: 'call', ron: 'agari', tsumo: 'agari', draw: 'ryukyoku' };
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

// ───── 🏇 みんなでダービー: 楕円のコースを馬が走る（みんな同じ時刻に同じ動き）・実況・いまの順位 ─────
/** 差し替える前に、馬券の選んだもの（賭け方・馬・量）と、オッズを覚えておく */
const keepPicks = (root) => {
  const odds = {};
  root?.querySelectorAll('[data-kb-odd]').forEach((el) => {
    odds[el.dataset.kbOdd] = Number(el.dataset.v);
  });
  const f = root?.querySelector('.kb-slip');
  if (!f) return { odds };
  return {
    odds,
    type: f.querySelector('input[name="type"]:checked')?.value,
    mode: f.querySelector('input[name="mode"]:checked')?.value,
    seq: f.seq?.value,
    h: [...f.querySelectorAll('input[name="h"]:checked')].map((x) => x.value),
    bet: f.querySelector('input[name="bet"]:checked')?.value,
    custom: f.betCustom?.value,
  };
};
const restorePicks = (root, k) => {
  if (!root || !k) return;
  // オッズが動いたら光らせる（上がった = 赤、下がった = 青）
  root.querySelectorAll('[data-kb-odd]').forEach((el) => {
    const before = k.odds?.[el.dataset.kbOdd];
    const now = Number(el.dataset.v);
    if (before === undefined || before === now) return;
    el.classList.add(now > before ? 'kb-up' : 'kb-down');
  });
  const f = root.querySelector('.kb-slip');
  if (!f || k.type === undefined) return;
  const r = f.querySelector(`input[name="type"][value="${k.type}"]`);
  if (r) r.checked = true;
  const md = k.mode && f.querySelector(`input[name="mode"][value="${k.mode}"]`);
  if (md) md.checked = true;
  if (f.seq) f.seq.value = k.seq || '';
  f.querySelectorAll('input[name="h"]').forEach((x) => {
    x.checked = k.h.includes(x.value);
  });
  const b = k.bet && f.querySelector(`input[name="bet"][value="${k.bet}"]`);
  if (b) b.checked = true;
  if (k.custom && f.betCustom) f.betCustom.value = k.custom;
  paintSlip(f);
};

const kbFmt = (n) => Math.round(n).toLocaleString('ja-JP');
const kbOdd = (o10) => (o10 / 10).toFixed(1);
const kbPair = (a, b) => (Number(a) < Number(b) ? `${a}-${b}` : `${b}-${a}`);
/** 1 枚に選ぶ馬の数・順番どおりか・組の書き方（サーバーの comboKey と同じ） */
const KB_PICKS = { win: 1, place: 1, quinella: 2, wide: 2, exacta: 2, trio: 3, trifecta: 3 };
const kbOrdered = (t) => t === 'exacta' || t === 'trifecta';
const kbKey = (t, nos) => (kbOrdered(t) ? nos.join('>') : [...nos].sort((a, b) => a - b).join('-'));
/** 選んだ馬の組み合わせ全部（ボックス。順番どおりの賭け方は順番ちがいも） */
const kbBox = (t, picks) => {
  const k = KB_PICKS[t] || 1;
  if (k === 1) return picks.map(String);
  const out = new Set();
  const walk = (cur) => {
    if (cur.length === k) return void out.add(kbKey(t, cur));
    picks.forEach((n) => {
      if (!cur.includes(n)) walk([...cur, n]);
    });
  };
  walk([]);
  return [...out];
};
/** 押した順（着順どおりで使う）。外した馬は抜き、まだ入っていない選んだ馬は後ろに */
const kbSeq = (f) => {
  const picks = [...f.querySelectorAll('input[name="h"]:checked')].map((x) => Number(x.value));
  const seq = (f.seq?.value || '').split(',').filter(Boolean).map(Number).filter((n) => picks.includes(n));
  picks.forEach((n) => {
    if (!seq.includes(n)) seq.push(n);
  });
  if (f.seq) f.seq.value = seq.join(',');
  return seq;
};
/** 馬券の画面: 選んだ馬のオッズ・何点・合計・当たるといくら */
const paintSlip = (f) => {
  let odds;
  try {
    odds = JSON.parse(f.dataset.odds);
  } catch {
    return;
  }
  const type = f.querySelector('input[name="type"]:checked')?.value || 'win';
  const picks = [...f.querySelectorAll('input[name="h"]:checked')].map((x) => x.value);
  const sel = f.querySelector('input[name="bet"]:checked');
  const amount = sel?.value === 'custom' ? Number(f.betCustom?.value) : Number(sel?.value);
  const need = KB_PICKS[type] || 1;
  const pair = need > 1;
  const order = kbOrdered(type) && f.querySelector('input[name="mode"]:checked')?.value === 'order';
  const seq = kbSeq(f);
  // 着順どおり: 押した順に「1着」「2着」「3着」
  f.querySelectorAll('[data-kb-seq]').forEach((el) => {
    const at = seq.indexOf(Number(el.dataset.kbSeq));
    el.textContent = order && at >= 0 && at < need ? `${at + 1}着` : '';
  });
  // 馬のボタンに、いまの賭け方のオッズ。2 頭・3 頭の賭け方は、先に選んだ馬（1 頭・2 頭）とこの馬の組
  const anchors = need > 1 && seq.length >= need - 1 ? seq.slice(0, need - 1) : null;
  const SHORT = { quinella: '連', wide: 'ワ', exacta: '馬単', trio: '3連複', trifecta: '3連単' };
  f.querySelectorAll('[data-kb-hodds]').forEach((el) => {
    const no = Number(el.dataset.kbHodds);
    if (type === 'win') el.textContent = `単 ${kbOdd(odds.win[no])}`;
    else if (type === 'place') el.textContent = `複 ${kbOdd(odds.place[no][0])}-${kbOdd(odds.place[no][1])}`;
    else if (!anchors) el.textContent = `${SHORT[type]} —`;
    else if (anchors.includes(no)) el.textContent = kbOrdered(type) ? `${anchors.indexOf(no) + 1}着` : '軸';
    else {
      const o = odds[type]?.[kbKey(type, [...anchors, no])];
      const v = Array.isArray(o) ? o[0] : o;
      el.textContent = `${SHORT[type]} ${v ? kbOdd(v) : '—'}`;
    }
  });
  // 何点
  const keys = order ? (seq.length === need ? [kbKey(type, seq.slice(0, need))] : []) : picks.length >= need ? kbBox(type, picks.map(Number)) : [];
  const range = (k) => {
    if (type === 'win') return [odds.win[k], odds.win[k]];
    const o = odds[type]?.[k];
    if (o === undefined) return [10, 10];
    return Array.isArray(o) ? (type === 'quinella' ? [o[0], o[0]] : o) : [o, o];
  };
  // 自分が賭けた分も箱に入るので、そのぶんオッズは下がる（払い戻し率 90% で見込む）
  const total = odds.totals?.[type] ?? 0;
  const after = (o10) => {
    if (!total || !(amount > 0) || o10 <= 10) return o10;
    const stake = (total * 0.9 * 10) / o10;
    return Math.max(10, Math.floor(((total + amount * keys.length) * 0.9 * 10) / (stake + amount)));
  };
  const lo = keys.map((k) => after(range(k)[0]));
  const hi = keys.map((k) => after(range(k)[1]));
  const out = f.querySelector('.kb-preview');
  const buy = f.querySelector('.kb-buy');
  const coin = f.dataset.coin || '';
  const max = Number(f.dataset.max) || 30;
  let ok = keys.length > 0 && amount > 0;
  if (!keys.length)
    out.textContent = order
      ? `${need} 頭を、1 着にする馬から順に押してください（いま ${Math.min(seq.length, need)} 頭）${seq.length > need ? '。多すぎるので外してください' : ''}`
      : pair
        ? `${need} 頭以上選んでください（選んだ馬の組み合わせを全部買います）`
        : '馬を選んでください';
  else if (!(amount > 0)) out.textContent = '量を選んでください';
  else {
    const min = Math.min(...lo) * amount / 10;
    const max = Math.max(...hi) * amount / 10;
    out.innerHTML = '';
    const a = document.createElement('b');
    a.textContent = `${keys.length} 点 × ${kbFmt(amount)} = 合計 ${kbFmt(keys.length * amount)} ${coin}`;
    const b = document.createElement('span');
    b.textContent = `当たると 約 ${kbFmt(min)}${max > min ? `〜${kbFmt(max)}` : ''} ${coin}`;
    out.append(a, b);
    if (keys.length > max) {
      ok = false;
      b.textContent = `1 レースに ${max} 枚までです。馬を減らしてください`;
    }
  }
  if (buy) {
    buy.disabled = !ok;
    buy.textContent = ok ? `🎫 ${keys.length} 点 買う（${kbFmt(keys.length * amount)} ${coin}）` : '🎫 馬券を買う';
  }
};
document.addEventListener('change', (e) => {
  const f = e.target.closest?.('.kb-slip');
  if (!f) return;
  if (e.target.name === 'betCustom') f.querySelector('input[name="bet"][value="custom"]').checked = true;
  paintSlip(f);
});
document.addEventListener('input', (e) => {
  const f = e.target.closest?.('.kb-slip');
  if (f && e.target.name === 'betCustom') {
    f.querySelector('input[name="bet"][value="custom"]').checked = true;
    paintSlip(f);
  }
});
document.addEventListener('click', (e) => {
  // 🎲 おまかせ・⭐ 1 番人気・選び直す
  const q = e.target.closest?.('[data-kb-quick]');
  if (q) {
    const f = q.closest('.kb-slip');
    const boxes = [...f.querySelectorAll('input[name="h"]')];
    const type = f.querySelector('input[name="type"]:checked')?.value;
    const n = KB_PICKS[type] || 1;
    boxes.forEach((x) => {
      x.checked = false;
    });
    if (f.seq) f.seq.value = '';
    if (q.dataset.kbQuick === 'random') {
      const pool = [...boxes];
      for (let i = 0; i < n; i++) pool.splice(Math.floor(Math.random() * pool.length), 1)[0].checked = true;
      Sound.chip?.();
    } else if (q.dataset.kbQuick === 'fav') {
      let odds = {};
      try {
        odds = JSON.parse(f.dataset.odds).win;
      } catch {
        odds = {};
      }
      boxes.sort((a, b) => (odds[a.value] ?? 0) - (odds[b.value] ?? 0)).slice(0, n).forEach((x) => {
        x.checked = true;
      });
    }
    dirtyAt = Date.now();
    paintSlip(f);
    return;
  }
  // 出馬表の行を押すと、その馬を選ぶ（もう一度押すと外す）。リンク（成績）は選ばない
  const row = e.target.closest?.('[data-kb-pick]');
  if (!row || e.target.closest('a')) return;
  const box = document.querySelector(`.kb-slip input[name="h"][value="${row.dataset.kbPick}"]`);
  if (!box) return;
  box.checked = !box.checked;
  paintSlip(box.form);
  box.closest('.kb-hbtn')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  dirtyAt = Date.now();
});
/** 人気の棒の長さ（CSP で style 属性が使えないので、ここで） */
const paintPopBars = () => {
  document.querySelectorAll('.kb-popbar i[data-w]').forEach((el) => {
    el.style.width = `${Math.min(100, Number(el.dataset.w))}%`;
  });
};
// ⏰ 締め切り 10 秒前から「締め切り間近！」、5 秒前からカウントの音
let kbBeep = -1;
setInterval(() => {
  const stage = document.querySelector('.kb-stage');
  const banner = stage?.querySelector('.kb-hurry');
  const cd = stage?.querySelector('.kb-head .c-count[data-deadline]');
  if (!stage || !banner || !cd) return;
  const left = Number(cd.dataset.deadline) - (Date.now() + Number(document.documentElement.dataset.skew || 0));
  const hurry = left > 0 && left <= 10_000;
  stage.classList.toggle('kb-hurrying', hurry);
  const sec = Math.ceil(left / 1000);
  if (hurry && sec <= 5 && sec !== kbBeep) {
    kbBeep = sec;
    Sound.click?.();
  }
}, 250);
// 的中の発表は、同じレースで 1 回だけ
const kbRevealed = new Set();

// テレビ中継のように横から映す。カメラは先頭集団を追う。右上に小さなコース全体の図
// 毛色（体・たてがみと脚の先）
const KB_COAT = [
  ['#7b4a26', '#22150c'],
  ['#a9592a', '#7d3c17'],
  ['#4a2d1b', '#170e08'],
  ['#bdbdbd', '#6f6f6f'],
  ['#25242b', '#0e0e12'],
  ['#8d4f25', '#e7cf9f'],
];
// 帽子の色は枠の色
const KB_CAP = ['#ffffff', '#222222', '#e53935', '#1e63d6', '#f4c430', '#2e9e4f', '#f08a24', '#f48fb1'];
const KB_CAP_TEXT = ['#111', '#fff', '#fff', '#fff', '#111', '#fff', '#111', '#111'];
const KB_LAP = 2000;
const KB_NO_MARK = '①②③④⑤⑥⑦⑧';
/** 角の丸い四角（古いブラウザはふつうの四角） */
const kbRound = (g, x, y, w, h, r) => (g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h));
const kbStartOf = (d) => (((-d) % KB_LAP) + KB_LAP) % KB_LAP;

/** 勝負服の柄を、いま描いている形（clip 済み）の中に塗る */
const kbSilk = (g, silk, x, y, w, h) => {
  g.fillStyle = silk.base;
  g.fillRect(x, y, w, h);
  g.fillStyle = silk.accent;
  const p = silk.pattern;
  if (p === 1) for (let i = x; i < x + w; i += 6) g.fillRect(i, y, 2.5, h);
  else if (p === 2) {
    g.beginPath();
    g.moveTo(x, y + h * 0.15);
    g.lineTo(x + w, y + h * 0.75);
    g.lineTo(x + w, y + h);
    g.lineTo(x, y + h * 0.4);
    g.fill();
  } else if (p === 3) for (let j = y; j < y + h; j += 7) g.fillRect(x, j, w, 3);
  else if (p === 4) {
    g.beginPath();
    g.moveTo(x, y + h * 0.2);
    g.lineTo(x + w / 2, y + h * 0.65);
    g.lineTo(x + w, y + h * 0.2);
    g.lineTo(x + w, y + h * 0.45);
    g.lineTo(x + w / 2, y + h * 0.9);
    g.lineTo(x, y + h * 0.45);
    g.fill();
  } else if (p === 5) for (let i = 0; i < 4; i++) g.fillRect(x + 3 + i * 5, y + 3 + (i % 2) * 6, 3, 3);
};

/**
 * 横から見た、走っている馬と騎手。(x, y) は蹄の高さの真ん中、s は大きさ、ph は脚の動き（0〜1）、run は走っているか
 */
const kbHorse = (g, x, y, s, ph, h, run) => {
  const [body, dark] = KB_COAT[h.coat] || KB_COAT[0];
  const TAU = Math.PI * 2;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  // 蹄の高さから体の高さへ
  // run: true = 走る / 'walk' = 歩く（パドック） / false = 止まる
  const walk = run === 'walk';
  const gallop = run === true;
  const bob = gallop ? Math.sin(ph * TAU * 2) * 1.6 : walk ? Math.sin(ph * TAU * 2) * 0.5 : 0;
  g.translate(0, -44 + bob);
  // 影
  g.save();
  g.translate(0, 44 - bob);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath();
  g.ellipse(4, 1, 40, 4.5, 0, 0, TAU);
  g.fill();
  g.restore();
  // 脚（a1: 上の骨の角度、a2: 下の骨の角度。0 が真下、+ が前）
  const leg = (hx, hy, a1, a2, far, fore) => {
    const k = [hx + Math.sin(a1) * 19, hy + Math.cos(a1) * 19];
    const f = [k[0] + Math.sin(a2) * 19, k[1] + Math.cos(a2) * 19];
    g.lineCap = 'round';
    g.strokeStyle = far ? dark : body;
    g.lineWidth = fore ? 7 : 9;
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(k[0], k[1]);
    g.stroke();
    g.strokeStyle = dark;
    g.lineWidth = 4.2;
    g.beginPath();
    g.moveTo(k[0], k[1]);
    g.lineTo(f[0], f[1]);
    g.stroke();
    g.fillStyle = '#121212';
    g.beginPath();
    g.ellipse(f[0] + 1.5, f[1] + 1, 3.6, 2.2, 0, 0, TAU);
    g.fill();
  };
  // ギャロップ: 後ろ脚 → 前脚の順に地面をける
  const legs = [
    { hx: -26, hy: 4, o: 0.0, fore: false },
    { hx: -22, hy: 5, o: 0.12, fore: false },
    { hx: 22, hy: 5, o: 0.45, fore: true },
    { hx: 26, hy: 4, o: 0.57, fore: true },
  ].map((l, i) => {
    // 歩くときは 4 拍子で小さく
    const p = (ph + (walk ? [0, 0.5, 0.25, 0.75][i] : l.o)) % 1;
    const sw = gallop ? Math.sin(p * TAU) : walk ? Math.sin(p * TAU) * 0.38 : 0;
    const lift = gallop ? Math.max(0, Math.cos(p * TAU)) : walk ? Math.max(0, Math.cos(p * TAU)) * 0.45 : 0;
    const a1 = l.fore ? 0.55 * sw + 0.05 : -0.5 * sw + 0.12;
    const a2 = l.fore ? a1 - 1.2 * lift : a1 + 0.9 * lift * (sw > 0 ? 1 : 0.4);
    return { ...l, a1, a2, far: i % 2 === 0 };
  });
  for (const l of legs.filter((x) => x.far)) leg(l.hx, l.hy, l.a1, l.a2, true, l.fore);
  // しっぽ
  const wave = gallop ? Math.sin(ph * TAU) * 4 : walk ? Math.sin(ph * TAU) * 1.5 : 2;
  g.strokeStyle = dark;
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-34, -6);
  g.quadraticCurveTo(-50, -4 + wave, -60, 8 + wave);
  g.stroke();
  // 体・首・頭
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(0, -2, 37, 15, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.moveTo(20, -12);
  g.quadraticCurveTo(34, -30, 46, -40);
  g.lineTo(56, -33);
  g.quadraticCurveTo(44, -18, 36, 6);
  g.closePath();
  g.fill();
  g.save();
  g.translate(58, -33);
  g.rotate(0.6);
  g.beginPath();
  g.ellipse(0, 0, 13, 6.2, 0, 0, TAU);
  g.fill();
  g.fillStyle = dark;
  g.beginPath();
  g.ellipse(9, 1, 4.5, 4.4, 0, 0, TAU);
  g.fill();
  g.restore();
  // 耳・たてがみ
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(48, -42);
  g.lineTo(50, -50);
  g.lineTo(53, -41);
  g.fill();
  g.strokeStyle = dark;
  g.lineWidth = 3.5;
  g.beginPath();
  g.moveTo(22, -16);
  g.quadraticCurveTo(34, -32, 47, -42);
  g.stroke();
  // 手前の脚
  for (const l of legs.filter((x) => !x.far)) leg(l.hx, l.hy, l.a1, l.a2, false, l.fore);
  // 鞍とゼッケン
  g.fillStyle = '#f7f7f2';
  g.fillRect(-14, -14, 20, 15);
  g.fillStyle = '#111';
  g.font = 'bold 11px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(h.no), -4, -6);
  // 騎手: 前かがみ。服は勝負服、帽子は枠の色
  g.save();
  g.translate(4, -18);
  g.rotate(-0.42);
  g.beginPath();
  kbRound(g, -4, -14, 22, 12, 5);
  g.clip();
  kbSilk(g, h.silk, -4, -14, 22, 12);
  g.restore();
  g.strokeStyle = h.silk.base;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(16, -28);
  g.lineTo(30, -22);
  g.stroke();
  g.strokeStyle = '#2b2b2b';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(30, -22);
  g.lineTo(52, -30);
  g.stroke();
  // ひざと長靴
  g.strokeStyle = '#f2f2f2';
  g.lineWidth = 4.5;
  g.beginPath();
  g.moveTo(2, -18);
  g.lineTo(10, -10);
  g.stroke();
  g.strokeStyle = '#1a1a1a';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(10, -10);
  g.lineTo(4, -4);
  g.stroke();
  g.fillStyle = KB_CAP[h.no - 1] || '#fff';
  g.beginPath();
  g.arc(21, -35, 5.6, Math.PI, 0);
  g.lineTo(28, -35);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 0.8;
  g.stroke();
  g.fillStyle = '#e9c7a8';
  g.beginPath();
  g.arc(22, -33, 3, 0, Math.PI);
  g.fill();
  g.restore();
};

/** 遠くの景色（木・スタンド・大型ビジョン）。px は遠いほど小さく動く */
const kbScenery = (g, W, top, bottom, camX, ppm, weather) => {
  const far = camX * ppm * 0.18;
  g.fillStyle = weather === 0 ? '#5f8f5a' : '#5a7a58';
  g.fillRect(0, top, W, bottom - top);
  // 丘
  g.fillStyle = weather === 0 ? '#4f7f4b' : '#4b6b49';
  g.beginPath();
  g.moveTo(0, bottom);
  for (let x = 0; x <= W; x += 20) g.lineTo(x, top + (bottom - top) * (0.35 + 0.18 * Math.sin((x + far * 0.6) / 140)));
  g.lineTo(W, bottom);
  g.fill();
  // 木（桜もまぜる）
  const step = 46;
  const off = ((far % step) + step) % step;
  for (let i = -1; i < W / step + 2; i++) {
    const idx = Math.floor((far + i * step) / step);
    const tx = i * step - off + ((idx * 37) % 17);
    const sz = 9 + ((idx * 13) % 7);
    const sak = idx % 5 === 0;
    g.fillStyle = '#4a3020';
    g.fillRect(tx - 1.5, bottom - sz * 0.9, 3, sz * 0.9);
    g.fillStyle = sak ? '#f3b6c8' : weather === 0 ? '#2f6b34' : '#2f5a33';
    g.beginPath();
    g.arc(tx, bottom - sz * 1.15, sz * 0.75, 0, Math.PI * 2);
    g.arc(tx - sz * 0.45, bottom - sz * 0.9, sz * 0.55, 0, Math.PI * 2);
    g.arc(tx + sz * 0.45, bottom - sz * 0.9, sz * 0.55, 0, Math.PI * 2);
    g.fill();
  }
};

/** ハロン棒・ゴール板・ラチ・芝の縞（近いほど速く動く） */
const kbTrack = (g, W, H, geo, camX, ppm, surface, D) => {
  const { railY, nearY } = geo;
  const sx = (m) => (m - camX) * ppm + W * 0.5;
  // コース
  if (surface === 0) {
    g.fillStyle = '#4da84a';
    g.fillRect(0, railY, W, nearY - railY);
    // 芝の縞（刈り込みの模様）
    g.fillStyle = 'rgba(255,255,255,0.07)';
    const band = 6;
    const m0 = Math.floor((camX - W / ppm) / band) * band;
    for (let m = m0; m < camX + W / ppm; m += band * 2) {
      const a = sx(m);
      const b = sx(m + band);
      g.beginPath();
      g.moveTo(a, railY);
      g.lineTo(b, railY);
      g.lineTo(b + (nearY - railY) * 0.35, nearY);
      g.lineTo(a + (nearY - railY) * 0.35, nearY);
      g.fill();
    }
  } else {
    g.fillStyle = '#b5845a';
    g.fillRect(0, railY, W, nearY - railY);
    g.fillStyle = 'rgba(90,55,30,0.18)';
    const m0 = Math.floor(camX - W / ppm);
    for (let m = m0; m < camX + W / ppm; m += 0.7) {
      const k = Math.abs(Math.sin(m * 91.7)) ;
      g.fillRect(sx(m), railY + k * (nearY - railY), 2, 1.5);
    }
  }
  // ゴールの線
  const gx = sx(D);
  if (gx > -20 && gx < W + 20) {
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.moveTo(gx - 1.5, railY);
    g.lineTo(gx + 1.5, railY);
    g.lineTo(gx + 1.5 + (nearY - railY) * 0.35, nearY);
    g.lineTo(gx - 1.5 + (nearY - railY) * 0.35, nearY);
    g.fill();
  }
  // 内ラチ（奥）
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, railY - 9, W, 3);
  const post = 4;
  for (let m = Math.floor((camX - W / ppm) / post) * post; m < camX + W / ppm; m += post) g.fillRect(sx(m), railY - 9, 2, 10);
  // ハロン棒（残り 200m ごと）とゴール板
  for (let r = 200; r < D; r += 200) {
    const x = sx(D - r);
    if (x < -40 || x > W + 40) continue;
    g.fillStyle = '#fff';
    g.fillRect(x - 1.5, railY - 34, 3, 26);
    g.fillStyle = r % 400 === 0 ? '#d83a3a' : '#2d6fd8';
    g.fillRect(x - 13, railY - 44, 26, 13);
    g.fillStyle = '#fff';
    g.font = 'bold 10px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(r), x, railY - 37.5);
  }
  if (gx > -60 && gx < W + 60) {
    g.fillStyle = '#fff';
    g.fillRect(gx - 2, railY - 58, 4, 50);
    g.fillStyle = '#e53950';
    g.beginPath();
    g.arc(gx, railY - 62, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 9px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('GOAL', gx, railY - 62);
  }
};

/** 手前のラチ（いちばん前に描く） */
const KB_CROWD = ['#e53935', '#1e63d6', '#f4c430', '#ffffff', '#2e9e4f', '#f48fb1', '#8e44ad', '#f08a24', '#333'];
const kbNearRail = (g, W, geo, camX, ppm) => {
  const sx = (m) => (m - camX) * ppm * 1.12 + W * 0.5;
  g.fillStyle = '#2d5f2e';
  g.fillRect(0, geo.nearY, W, geo.H - geo.nearY);
  // スタンド（手前ほど速く動く）
  const standY = geo.nearY + (geo.H - geo.nearY) * 0.32;
  g.fillStyle = '#5b5f68';
  g.fillRect(0, standY, W, geo.H - standY);
  const rowH = Math.max(5, (geo.H - standY) / 4);
  for (let row = 0; row < 4; row++) {
    const y = standY + rowH * (row + 0.55);
    const par = 1.2 + row * 0.08;
    const gap = 7 + row;
    const off = (((camX * ppm * par) % gap) + gap) % gap;
    for (let x = -gap; x < W + gap; x += gap) {
      const idx = Math.floor((camX * ppm * par + x) / gap) + row * 7;
      g.fillStyle = KB_CROWD[Math.abs(idx * 7 + row) % KB_CROWD.length];
      g.beginPath();
      g.arc(x - off, y + ((idx * 3) % 3) - 1, 2.6 + row * 0.35, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = '#f7f7f7';
  g.fillRect(0, geo.nearY + 2, W, 4);
  const post = 3;
  for (let m = Math.floor((camX - W / ppm) / post) * post; m < camX + W / ppm; m += post) g.fillRect(sx(m), geo.nearY + 2, 3, 14);
};

/** スタートのゲート */
const kbGate = (g, W, geo, camX, ppm, n) => {
  const x = (0 - camX) * ppm + W * 0.5 + 18;
  if (x < -60 || x > W + 60) return;
  for (let i = 0; i <= n; i++) {
    const y = geo.laneY(i * 1.25 - 0.6);
    g.fillStyle = 'rgba(210,210,215,0.95)';
    g.fillRect(x + (y - geo.railY) * 0.35 - 2, y - 46 * geo.scale(i * 1.25), 4, 46 * geo.scale(i * 1.25));
  }
  g.fillStyle = 'rgba(80,90,110,0.9)';
  const y0 = geo.laneY(-0.6);
  const y1 = geo.laneY(n * 1.25);
  g.beginPath();
  g.moveTo(x - 3 + (y0 - geo.railY) * 0.35, y0 - 50);
  g.lineTo(x + 3 + (y0 - geo.railY) * 0.35, y0 - 50);
  g.lineTo(x + 3 + (y1 - geo.railY) * 0.35, y1 - 54 * geo.scale(n * 1.25));
  g.lineTo(x - 3 + (y1 - geo.railY) * 0.35, y1 - 54 * geo.scale(n * 1.25));
  g.fill();
};

/** 右上の小さなコース全体の図 */
const kbMini = (g, W, H, D, pos) => {
  const w = Math.min(150, W * 0.24);
  const h = w * 0.48;
  const x0 = W - w - 10;
  const y0 = 10;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  kbRound(g, x0 - 6, y0 - 6, w + 12, h + 12, 8);
  g.fill();
  const r = h / 2;
  const cx1 = x0 + r;
  const cx2 = x0 + w - r;
  const cy = y0 + r;
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx1, y0);
  g.lineTo(cx2, y0);
  g.arc(cx2, cy, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(cx1, y0 + h);
  g.arc(cx1, cy, r, Math.PI / 2, (Math.PI * 3) / 2);
  g.stroke();
  // ゴールから: 100m 直線 → 400m カーブ → 600m → 400m カーブ → 500m でゴール（下の直線を左から右へ）
  const straight = cx2 - cx1;
  const pt = (lap) => {
    let p = ((lap % KB_LAP) + KB_LAP) % KB_LAP;
    const gx = cx1 + straight * (5 / 6);
    if (p < 100) return [gx + straight * (p / 600), y0 + h];
    p -= 100;
    if (p < 400) {
      const a = Math.PI / 2 - (p / 400) * Math.PI;
      return [cx2 + r * Math.cos(a), cy + r * Math.sin(a)];
    }
    p -= 400;
    if (p < 600) return [cx2 - straight * (p / 600), y0];
    p -= 600;
    if (p < 400) {
      const a = -Math.PI / 2 - (p / 400) * Math.PI;
      return [cx1 + r * Math.cos(a), cy + r * Math.sin(a)];
    }
    p -= 400;
    return [cx1 + straight * (p / 600), y0 + h];
  };
  const gp = pt(0);
  g.strokeStyle = '#ff4a64';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(gp[0], y0 + h - 5);
  g.lineTo(gp[0], y0 + h + 5);
  g.stroke();
  [...pos].sort((a, b) => a.m - b.m).forEach((p) => {
    const [x, y] = pt(kbStartOf(D) + p.m);
    g.fillStyle = KB_CAP[p.no - 1];
    g.beginPath();
    g.arc(x, y, 3.4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#000';
    g.lineWidth = 0.8;
    g.stroke();
  });
};

// 🎽 勝負服えらび: 選ぶと見本が変わる
document.addEventListener('change', (e) => {
  const f = e.target.closest?.('.kb-silk-form');
  if (!f) return;
  const prev = f.querySelector('.kb-silk-preview .kb-silk');
  const base = f.querySelector('input[name="base"]:checked')?.value;
  const accent = f.querySelector('input[name="accent"]:checked')?.value;
  const pattern = f.querySelector('input[name="pattern"]:checked')?.value ?? '0';
  if (!prev || !base || !accent) return;
  prev.dataset.base = base;
  prev.dataset.accent = accent;
  prev.className = `kb-silk big kb-pat${pattern}`;
  paintSilks();
});
/** 出馬表の勝負服の見本を塗る（CSP で style 属性が使えないので、ここで） */
const paintSilks = () => {
  document.querySelectorAll('.kb-silk[data-base]').forEach((el) => {
    const b = el.dataset.base;
    const a = el.dataset.accent;
    const p = [...el.classList].find((c) => c.startsWith('kb-pat'))?.slice(6);
    el.style.background =
      p === '1' ? `repeating-linear-gradient(90deg, ${b} 0 3px, ${a} 3px 5px)` :
      p === '2' ? `linear-gradient(135deg, ${b} 0 35%, ${a} 35% 60%, ${b} 60%)` :
      p === '3' ? `repeating-linear-gradient(0deg, ${b} 0 3px, ${a} 3px 5px)` :
      p === '4' ? `linear-gradient(160deg, ${b} 0 40%, ${a} 40% 60%, ${b} 60%)` :
      p === '5' ? `radial-gradient(circle at 30% 35%, ${a} 0 18%, transparent 19%), radial-gradient(circle at 70% 65%, ${a} 0 18%, ${b} 19%)` : b;
  });
};
/** 🐴 パドック: 1 頭ずつ大きく、厩務員さんに引かれて歩く。うしろにお客さん */
const kbPaddock = (g, W, H, horses, sec) => {
  const sky = g.createLinearGradient(0, 0, 0, H * 0.3);
  sky.addColorStop(0, '#9fd0f2');
  sky.addColorStop(1, '#e3f1fa');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H * 0.3);
  // 木とスタンドの屋根
  g.fillStyle = '#6b7380';
  g.fillRect(0, H * 0.12, W, H * 0.05);
  for (let x = 0; x < W; x += 40) {
    g.fillStyle = (x / 40) % 4 === 0 ? '#f3b6c8' : '#3f7f45';
    g.beginPath();
    g.arc(x + 20, H * 0.27, 18, 0, Math.PI * 2);
    g.fill();
  }
  // お客さん（柵のむこう）
  g.fillStyle = '#4c5260';
  g.fillRect(0, H * 0.3, W, H * 0.16);
  for (let row = 0; row < 3; row++) for (let x = (row % 2) * 4; x < W; x += 8) {
    g.fillStyle = KB_CROWD[Math.abs(Math.floor(x * 7 + row * 13)) % KB_CROWD.length];
    g.beginPath();
    g.arc(x, H * 0.33 + row * H * 0.045, 2.8, 0, Math.PI * 2);
    g.fill();
  }
  // 柵と芝・歩く道
  g.fillStyle = '#58a85a';
  g.fillRect(0, H * 0.46, W, H * 0.54);
  g.fillStyle = '#c9a374';
  g.fillRect(0, H * 0.62, W, H * 0.2);
  g.fillStyle = '#fff';
  g.fillRect(0, H * 0.46, W, 4);
  const off = (sec * 46) % 30;
  for (let x = -off; x < W; x += 30) g.fillRect(x, H * 0.46, 3, 16);
  // 1 頭ずつ（3.2 秒ごとに次の馬）
  const n = horses.length;
  const f = Math.floor(sec / 3.2) % n;
  const s = (W / 900) * 1.9;
  const y = H * 0.8;
  for (const [d, i] of [[-1, (f + n - 1) % n], [1, (f + 1) % n], [0, f]]) {
    const x = W * 0.5 + d * W * 0.62 - ((sec % 3.2) / 3.2 - 0.5) * W * 0.12 * (d === 0 ? 1 : 1);
    const h = horses[i];
    kbHorse(g, x, y, s * (d === 0 ? 1 : 0.85), (sec * 1.1 + i * 0.3) % 1, h, 'walk');
    // 厩務員さん
    const hx = x + 66 * s;
    g.fillStyle = '#2a3550';
    g.fillRect(hx - 5 * s, y - 34 * s, 10 * s, 22 * s);
    g.fillStyle = '#e9c7a8';
    g.beginPath();
    g.arc(hx, y - 39 * s, 5 * s, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a3550';
    g.lineWidth = 3 * s;
    g.beginPath();
    g.moveTo(hx - 3 * s, y - 12 * s);
    g.lineTo(hx - 5 * s + Math.sin(sec * 7) * 3 * s, y);
    g.moveTo(hx + 3 * s, y - 12 * s);
    g.lineTo(hx + 5 * s - Math.sin(sec * 7) * 3 * s, y);
    g.stroke();
  }
  return horses[f];
};

/** 🏆 口取り式: 勝った馬を囲んで記念撮影 */
const kbWinnerCircle = (g, W, H, h, data, sec) => {
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2f6b3a');
  bg.addColorStop(1, '#1d4a26');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // 花の飾り
  for (let x = 10; x < W; x += 26) {
    g.fillStyle = (x / 26) % 2 < 1 ? '#f3b6c8' : '#ffe08a';
    g.beginPath();
    g.arc(x, H * 0.9 + Math.sin(x) * 4, 9, 0, Math.PI * 2);
    g.fill();
  }
  const s = (W / 900) * 2.1;
  const y = H * 0.84;
  kbHorse(g, W * 0.5, y, s, 0, h, false);
  // 囲む人たち（馬主・関係者）
  const people = [-0.28, -0.2, 0.22, 0.3, 0.37];
  people.forEach((dx, i) => {
    const px = W * (0.5 + dx);
    const ps = s * (i === 0 ? 1.15 : 1);
    g.fillStyle = i === 0 ? '#1f2a44' : ['#5a3b2b', '#3d4f6b', '#6b3b4a', '#2f4f3f'][i % 4];
    g.fillRect(px - 9 * ps, y - 52 * ps, 18 * ps, 40 * ps);
    g.fillStyle = '#e9c7a8';
    g.beginPath();
    g.arc(px, y - 60 * ps, 8 * ps, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = g.fillStyle === '#e9c7a8' ? '#1f2a44' : '#1f2a44';
    g.lineWidth = 4 * ps;
    g.beginPath();
    g.moveTo(px - 4 * ps, y - 12 * ps);
    g.lineTo(px - 5 * ps, y);
    g.moveTo(px + 4 * ps, y - 12 * ps);
    g.lineTo(px + 5 * ps, y);
    g.stroke();
  });
  // 横断幕
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(W * 0.08, H * 0.06, W * 0.84, H * 0.22);
  g.strokeStyle = '#ffd34d';
  g.lineWidth = 2;
  g.strokeRect(W * 0.08, H * 0.06, W * 0.84, H * 0.22);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffd34d';
  g.font = `900 ${Math.round(W * 0.034)}px system-ui, sans-serif`;
  g.fillText(`🏆 ${data.raceName || ''} 優勝`, W / 2, H * 0.13);
  g.fillStyle = '#fff';
  g.font = `800 ${Math.round(W * 0.028)}px system-ui, sans-serif`;
  g.fillText(`${KB_NO_MARK[h.no - 1]} ${h.name}　馬主 ${h.owner || '咲楽ノ宮ファーム'}`, W / 2, H * 0.22);
  // 紙吹雪
  for (let i = 0; i < 40; i++) {
    const cx = (i * 137 + sec * 40 * (1 + (i % 3))) % W;
    const cy = (i * 71 + sec * 90) % (H * 0.8);
    g.fillStyle = KB_CROWD[i % KB_CROWD.length];
    g.fillRect(cx, cy, 4, 7);
  }
};

let kbAnim = null;
const initKeiba = () => {
  paintSilks();
  document.querySelectorAll('.kb-slip').forEach(paintSlip);
  paintPopBars();
  const el = document.querySelector('.kb-tv[data-kb]');
  if (kbAnim && kbAnim.el === el) return;
  if (kbAnim) cancelAnimationFrame(kbAnim.raf);
  kbAnim = null;
  if (!el) return;
  let data;
  try {
    data = JSON.parse(el.dataset.kb);
  } catch {
    return;
  }
  const canvas = el.querySelector('canvas');
  const g = canvas?.getContext('2d');
  if (!g) return;
  const call = el.querySelector('.kb-call');
  const rankBox = el.querySelector('.kb-rank');
  const remainBox = el.querySelector('.kb-remain');
  const mineBox = el.querySelector('.kb-mine');
  const paddockBox = el.querySelector('.kb-paddock');
  const board = el.querySelector('.kb-board');
  const reveal = el.querySelector('.kb-reveal');
  const net = el.closest('.kb-stage')?.dataset.kbNet;
  const mine = new Set(data.mine || []);
  let photo = false;
  let fanfared = false;
  let roared = false;
  let kakuteiDone = false;
  const D = data.dist;
  const horses = data.horses;
  const n = horses.length;
  const frames = data.frames;
  const lanesF = data.lanes;
  const last = frames ? frames[0].length - 1 : 0;
  const skew = () => Number(document.documentElement.dataset.skew || 0);
  const at = (rows, i, k) => {
    const k0 = Math.min(last, Math.floor(k));
    const k1 = Math.min(last, k0 + 1);
    const f = k - Math.floor(k);
    return rows[i][k0] + (rows[i][k1] - rows[i][k0]) * (k0 === k1 ? 0 : f);
  };
  let camX = null;
  let ppm = null;
  let shown = -1;
  let rankAt = 0;
  let started = false;
  let goal = false;
  const state = { el, raf: 0 };
  kbAnim = state;
  const draw = () => {
    if (kbAnim !== state || !document.body.contains(el)) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = el.clientWidth;
    const H = Math.round(W * (W < 560 ? 0.62 : 0.5));
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = `${H}px`;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = Date.now() + skew() - (data.start || 0);
    const racing = data.phase === 'racing' || data.phase === 'result';
    const sec = Date.now() / 1000;
    // 受付中はパドック
    if (!racing) {
      const h = kbPaddock(g, W, H, horses, sec);
      if (paddockBox && paddockBox.dataset.no !== String(h.no)) {
        paddockBox.dataset.no = String(h.no);
        paddockBox.textContent = `パドック ${KB_NO_MARK[h.no - 1]} ${h.name}　${h.weight}kg${h.wdiff ? `（${h.wdiff > 0 ? '+' : ''}${h.wdiff}）` : ''}　気配: ${h.look}${h.owner ? `　馬主: ${h.owner}` : ''}`;
      }
      state.raf = requestAnimationFrame(draw);
      return;
    }
    if (paddockBox) paddockBox.textContent = '';
    const k = data.phase === 'result' ? last : Math.max(0, t / (data.frameMs || 1));
    // 発走前: 本馬場入場（返し馬）→ ファンファーレ → ゲート入り（奇数番から）
    const pre = data.phase === 'racing' && t < 0 ? (t < -10_000 ? 'parade' : t < -5000 ? 'fanfare' : 'gate') : null;
    const loadOrder = horses.map((h) => h.no).sort((a, b) => (b % 2) - (a % 2) || a - b);
    // 位置（m）と内ラチからの距離（m）
    const pos = horses.map((h, i) => {
      if (pre === 'parade') return { no: h.no, m: -70 + ((t + data.prerace) / 1000) * 9 - i * 6, lane: 3 + (i % 3) * 2.5, canter: true };
      if (pre === 'fanfare') return { no: h.no, m: -9 - (i % 2) * 2.5, lane: i * 1.25 };
      if (pre === 'gate') {
        const at0 = -5000 + loadOrder.indexOf(h.no) * 520;
        const p = Math.max(0, Math.min(1, (t - at0) / 450));
        return { no: h.no, m: -9 + p * 7.5 - (1 - p) * (i % 2) * 2.5, lane: i * 1.25 };
      }
      return { no: h.no, m: (at(frames, i, k) / 1000) * D, lane: at(lanesF, i, k) / 10 };
    });
    // カメラ: 先頭の 3 頭を追う。ばらけたら少し引く
    const sorted = [...pos].sort((a, b) => b.m - a.m);
    const lead = sorted[0].m;
    // 先頭はいつも画面に入れて、2・3 番手との間を映す
    const third = sorted[Math.min(2, n - 1)].m;
    const target = Math.min(D + 4, lead - Math.min(9, (lead - third) / 2) + 3);
    const spread = lead - sorted[Math.min(3, n - 1)].m;
    // 発走前はゲート全体が入るように引きで
    const wantPpm = pre === 'parade' ? W / 40 : pre ? W / 34 : W / Math.max(26, Math.min(44, spread + 18));
    // 返し馬のあいだは、スタンド前に置いたカメラで
    const want = pre === 'parade' ? -35 : pre ? -4 : target;
    camX = camX === null || data.phase !== 'racing' || pre ? want : camX + (want - camX) * 0.12;
    ppm = ppm === null || data.phase !== 'racing' || pre ? wantPpm : ppm + (wantPpm - ppm) * 0.05;
    const top = H * 0.18;
    const railY = H * 0.38;
    const nearY = H * 0.78;
    // 内ラチから 10m までを、奥から手前に。手前ほど大きい
    const geo = {
      H,
      railY,
      nearY,
      laneY: (lane) => railY + (nearY - railY) * (0.2 + (Math.max(-1, Math.min(10, lane)) / 10) * 0.75),
      scale: (lane) => 0.82 + (Math.max(0, Math.min(10, lane)) / 10) * 0.3,
    };
    // 空
    const sky = g.createLinearGradient(0, 0, 0, top);
    if (data.weather === 0) {
      sky.addColorStop(0, '#5aa8e8');
      sky.addColorStop(1, '#bfe2f7');
    } else {
      sky.addColorStop(0, '#7f8a96');
      sky.addColorStop(1, '#c4cad0');
    }
    g.fillStyle = sky;
    g.fillRect(0, 0, W, top);
    kbScenery(g, W, top, railY - 9, camX, ppm, data.weather);
    kbTrack(g, W, H, geo, camX, ppm, data.surface, D);
    if (pre !== 'parade' && (!racing || t < 1200)) kbGate(g, W, geo, camX, ppm, n);
    // 馬（奥の内ラチ側から）
    const draws = pos.map((p, i) => ({ p, h: horses[i] })).sort((a, b) => a.p.lane - b.p.lane);
    for (const { p, h } of draws) {
      const y = geo.laneY(p.lane);
      const x = (p.m - camX) * ppm + W * 0.5 + (y - railY) * 0.35;
      if (x < -80 || x > W + 80) continue;
      const s = (ppm / 26) * geo.scale(p.lane);
      const run = (racing && t >= 0 && !(data.phase === 'result')) || Boolean(p.canter);
      kbHorse(g, x, y, s, (sec * 2.4 + h.no * 0.37) % 1, h, run);
      // 頭の上の番号
      const by = y - 70 * s;
      if (mine.has(h.no)) {
        g.strokeStyle = '#ffd34d';
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(x + 2 * s, y + 1, 44 * s, 7 * s, 0, 0, Math.PI * 2);
        g.stroke();
        const ay = by - 12 + Math.sin(sec * 6) * 2;
        g.fillStyle = '#ffd34d';
        g.beginPath();
        g.moveTo(x + 14 * s - 6, ay - 8);
        g.lineTo(x + 14 * s + 6, ay - 8);
        g.lineTo(x + 14 * s, ay);
        g.fill();
      }
      g.fillStyle = KB_CAP[h.no - 1];
      g.strokeStyle = mine.has(h.no) ? '#ffd34d' : '#000';
      g.lineWidth = mine.has(h.no) ? 2.5 : 1;
      g.beginPath();
      g.arc(x + 14 * s, by, 7.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = KB_CAP_TEXT[h.no - 1];
      g.font = 'bold 9px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(h.no), x + 14 * s, by + 0.5);
    }
    kbNearRail(g, W, geo, camX, ppm);
    // 雨
    if (data.weather === 2) {
      g.strokeStyle = 'rgba(220,230,255,0.35)';
      g.lineWidth = 1;
      for (let i = 0; i < 70; i++) {
        const rx = (i * 97 + sec * 600) % (W + 40) - 20;
        const ry = (i * 53 + sec * 900) % H;
        g.beginPath();
        g.moveTo(rx, ry);
        g.lineTo(rx - 4, ry + 11);
        g.stroke();
      }
    }
    kbMini(g, W, H, D, pos);
    // 残りの距離
    if (remainBox) remainBox.textContent = !racing || t < 0 ? `${D}m 発走前` : lead >= D ? 'ゴール' : `残り ${Math.max(0, Math.ceil((D - lead) / 100) * 100)}m`;
    // 実況
    if (call && data.calls) {
      let idx = -1;
      data.calls.forEach((c, j) => {
        if (data.phase === 'result' || t >= c.t) idx = j;
      });
      if (idx !== shown && idx >= 0) {
        shown = idx;
        call.textContent = data.calls[idx].text;
        call.classList.remove('pop');
        void call.offsetWidth;
        call.classList.add('pop');
      } else if (idx < 0 && pre) {
        const text =
          pre === 'parade'
            ? '本馬場入場です。各馬、元気よく返し馬へ向かいます'
            : pre === 'fanfare'
              ? data.cls === 8
                ? '🎺 G1 のファンファーレが鳴り響きます！ スタンドは大歓声！'
                : '🎺 ファンファーレ！ 各馬、ゲートの後ろで輪乗りをしています'
              : t < -900
                ? 'ゲートイン。奇数番の馬から順に入ります…'
                : '体勢完了！';
        if (call.textContent !== text) call.textContent = text;
      }
    }
    if (pre === 'fanfare' && !fanfared) {
      fanfared = true;
      if (data.cls === 8) Sound.fanfareG1?.();
      else Sound.fanfare?.();
    }
    // 結果: 到達順位 → 確定 → 払戻金。当たった・はずれたの発表は確定のあと
    const circle = data.phase === 'result' && data.resultAt && Date.now() + skew() - data.resultAt >= 12_000;
    el.classList.toggle('kb-circle', Boolean(circle));
    if (circle) {
      board?.classList.add('done');
      kbWinnerCircle(g, W, H, horses[data.order[0] - 1], data, sec);
      if (call) call.textContent = `口取り式。${data.raceName || ''}を勝った ${horses[data.order[0] - 1].name}、おめでとう！`;
    }
    if (data.phase === 'result' && board && data.resultAt) {
      const rs = Date.now() + skew() - data.resultAt;
      board.classList.toggle('show-order', rs >= 1200);
      board.classList.toggle('kakutei', rs >= 6000);
      if (rs >= 6000 && !kakuteiDone) {
        kakuteiDone = true;
        Sound.bell?.();
      }
      if (rs >= 6800 && net !== undefined && !kbRevealed.has(data.key)) {
        kbRevealed.add(data.key);
        if (reveal) {
          reveal.classList.add('show');
          setTimeout(() => reveal.classList.remove('show'), 4500);
        }
        if (reveal?.classList.contains('hit')) Sound.win();
        else Sound.lose();
      }
    }
    // いまの順位（0.3 秒ごと）
    if (rankBox && racing && Date.now() - rankAt > 300) {
      rankAt = Date.now();
      const top8 = data.phase === 'result' ? data.order : sorted.map((p) => p.no);
      rankBox.innerHTML = '';
      top8.forEach((no) => {
        const li = document.createElement('li');
        li.className = `kb-g${no}${mine.has(no) ? ' kb-mine-rank' : ''}`;
        li.textContent = String(no);
        rankBox.appendChild(li);
      });
      if (mineBox) {
        const mineRanks = top8.map((no, r) => [no, r + 1]).filter(([no]) => mine.has(no)).slice(0, 3);
        mineBox.textContent = mineRanks.length && t >= 0 ? `あなたの ${mineRanks.map(([no, r]) => `${KB_NO_MARK[no - 1]} ${r} 番手`).join('・')}` : '';
        mineBox.classList.toggle('top', mineRanks.some(([, r]) => r <= 3));
      }
    }
    if (data.phase === 'racing') {
      if (!started && t >= 0) {
        started = true;
        if (t < 1500) Sound.gateOpen?.();
      }
      const lastCall = data.calls.at(-1);
      if (!photo && lastCall.text.includes('写真判定') && t >= lastCall.t) {
        photo = true;
        const d = document.createElement('div');
        d.className = 'kb-photo';
        d.textContent = '📸 写真判定';
        el.appendChild(d);
        setTimeout(() => d.remove(), 2600);
      }
      if (!goal && lead >= D) {
        goal = true;
        if (t - data.calls.at(-1).t < 1500) Sound.goal?.();
      }
      if (started && !goal && Math.random() < 0.08) Sound.gallop?.();
      if (started && !roared && lead >= D - 400) {
        roared = true;
        Sound.roar?.();
      }
    }
    state.raf = requestAnimationFrame(draw);
  };
  draw();
};

// ───── 🦊 AT 機（鬼斬り白狐）: STOP はどの順でも。AT 中の押し順ベルは押した順を送る ─────
// - spin: 止まる目は決まっている（data-stops）。遠ければ、ぼやけている間にずらしてから最大 4 コマすべらせる
// - wait: 押し順ベル（AT 中）。止め終わったら押した順を送る（サーバーが 3 倍かこぼしかを決める）
// - settle: 押した順を送ったあと。data-from の目から data-stops へすべらせる（ベルがそろう）
// - still: 止まったまま。レバー（スペース）で回す
let atCtl = null;
let atLeverAt = 0;
/** 液晶の演出（atslot.js）は AT 機の画面を開いたときだけ読む */
let atStageLoading = false;
const loadAtStage = (src, then) => {
  if (window.AtStage) return then();
  if (!src) return;
  document.addEventListener('at-stage-ready', then, { once: true });
  if (atStageLoading) return;
  atStageLoading = true;
  const sc = document.createElement('script');
  sc.src = src;
  sc.onload = () => document.dispatchEvent(new Event('at-stage-ready'));
  document.head.append(sc);
};
const initAtSlot = (root) => {
  if (atCtl) atCtl.stop();
  atCtl = null;
  const box = root.querySelector('.c-atm');
  if (!box) {
    window.AtStage?.leave();
    return;
  }
  const N = Number(box.dataset.n) || 21;
  const SLIP = 4;
  const mode = box.dataset.mode;
  const slow = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.5 : 1;
  const speed = 13 * slow;
  const stops = (box.dataset.stops || '0,0,0').split(',').map(Number);
  const from = box.dataset.from ? box.dataset.from.split(',').map(Number) : null;
  const navi = box.dataset.navi ? box.dataset.navi.split(',').map(Number) : null;
  const reels = [...box.querySelectorAll('.c-jreel')].map((el) => {
    const at = Number(el.dataset.at) || 0;
    return { el, strip: el.querySelector('.c-jstrip'), pos: N + at, state: 'still', anim: null };
  });
  const stopBtns = [...box.querySelectorAll('[data-at-stop]')];
  const lever = box.querySelector('[data-at-lever]');
  const fx = box.querySelector('.c-at-fx');
  let alive = true;
  let raf = 0;
  let last = 0;
  let loop = null;
  const order = [];
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(() => alive && fn(), ms));
  let show = null;
  try {
    show = JSON.parse(box.dataset.show || 'null');
  } catch {
    show = null;
  }
  /** 液晶の演出（読めていなければ null。文字だけの演出になる） */
  let st = null;
  /** フリーズ中（リールが回らない）・溜め中（最後のリールを少し止められない） */
  let frozen = false;
  let held = false;
  const paint = (r) => r.strip.style.setProperty('--at', r.pos.toFixed(3));
  const frame = (t) => {
    if (!alive) return;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    for (const r of reels) {
      if (r.state === 'spin') {
        r.pos -= speed * dt * Real.ramp(r.spinAt, t);
        while (r.pos < N) r.pos += N;
        paint(r);
      } else if (r.state === 'slide') {
        const a = r.anim;
        const p = Math.min(1, (t - a.t0) / a.dur);
        r.pos = a.from + (a.to - a.from) * (1 - (1 - p) ** 3);
        if (p >= 1) {
          r.pos = N + a.target;
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

  /** 次に止めるリール（ナビがあればその順・なければ左から） */
  const nextIdx = () => {
    if (navi) {
      const n = navi.find((i) => reels[i].state === 'spin');
      return n === undefined ? -1 : n;
    }
    return reels.findIndex((r) => r.state === 'spin');
  };
  const mark = () => stopBtns.forEach((b, i) => b.classList.toggle('next', reels[i].state === 'spin' && i === nextIdx()));

  /** 演出（AT 突入・上乗せ・継続バトル…）を順に出す */
  const showEvents = () => {
    let list = [];
    try {
      list = JSON.parse(box.dataset.events || '[]');
    } catch {
      list = [];
    }
    list.forEach((e, k) => {
      later(() => {
        if (!fx) return;
        fx.innerHTML = '';
        const d = document.createElement('div');
        d.className = `c-at-ev ${e.cls}`;
        const b = document.createElement('b');
        b.textContent = e.big;
        d.append(b);
        if (e.small) {
          const sm = document.createElement('small');
          sm.textContent = e.small;
          d.append(sm);
        }
        fx.append(d);
        if (e.cls === 'start') Sound.bonus(true);
        else if (e.cls === 'win') Sound.bigWin();
        else if (e.cls === 'lose') Sound.lose();
        else if (e.cls === 'add' || e.cls === 'tokka') Sound.peka();
        else if (e.cls === 'end') Sound.fanfare?.();
        later(() => d.classList.add('out'), 1500);
      }, k * 1700);
    });
    return list.length * 1700;
  };

  const reveal = () => {
    loop?.stop();
    loop = null;
    box.classList.remove('running');
    lever?.classList.remove('pulled');
    const win = Number(box.dataset.win || 0);
    const finish = () => {
      // 液晶をこのゲームのあとに替える（同時に替えて、高さが変わらないように）
      box.querySelectorAll('[data-before-stop]').forEach((e) => e.setAttribute('hidden', ''));
      box.querySelectorAll('[data-after-lcd]').forEach((e) => e.removeAttribute('hidden'));
      document.querySelectorAll('[data-after-stop]').forEach((e) => e.classList.add('go'));
      document.querySelectorAll('.c-balance.wait').forEach((b) => {
        b.classList.remove('wait');
        b.classList.add('go');
      });
      if (win >= 2) Sound.win();
      else if (win === 1) Sound.even();
      if (lever && !box.dataset.taken) lever.disabled = false;
      // 台の光り方を、このゲームのあとに・PAYOUT を出す
      box.classList.toggle('in-at', box.dataset.atPost === '1');
      box.classList.toggle('in-tokka', box.dataset.tokkaPost === '1');
      if (win > 0) box.querySelector('.c-at-window')?.classList.add('bl-flash');
      // そろったライン（5 本のどれか）
      const wl = box.dataset.winline;
      if (wl) {
        const rows = (box.dataset.paylines || '').split('|')[Number(wl)]?.split(',').map(Number);
        const win2 = box.querySelector('.c-at-window');
        showPayline(win2, rows);
        win2?.querySelectorAll(`.ln[data-line="${wl}"]`).forEach((e) => e.classList.add('on'));
      }
      Real.payout(box);
      Real.unbet(box);
      const note = box.querySelector('.c-deck-note');
      if (note && note.dataset.still) note.textContent = note.dataset.still;
      st?.settle();
    };
    let list = [];
    try {
      list = JSON.parse(box.dataset.events || '[]');
    } catch {
      list = [];
    }
    // 液晶の演出があれば、そちらで見せる（画面をたたく・スペースで飛ばせる）。なければ文字だけ
    if (st && list.length) st.play(list, show, () => later(finish, 120));
    else later(finish, Math.min(showEvents(), 1200) + 250);
  };

  const allStopped = () => {
    if (mode === 'wait') {
      loop?.stop();
      loop = null;
      const form = document.querySelector('form[data-at-order]');
      const input = form?.querySelector('[data-at-order-input]');
      if (!form || !input) return;
      input.value = order.join(',');
      later(() => form.requestSubmit(), 250);
      return;
    }
    if (show?.kakutei) st?.kakutei();
    reveal();
  };

  /** そのリールを target まで止める（遠ければ、ぼやけている間にずらす） */
  const slideTo = (i, target, done) => {
    const r = reels[i];
    const p = Math.floor(r.pos) % N;
    let d = (((p - target) % N) + N) % N;
    let start = r.pos;
    if (d > SLIP) {
      const k = Math.floor(Math.random() * (SLIP + 1));
      start = r.pos - (d - k);
      if (start < N) start += N;
      d = k;
    }
    const to = Math.floor(start) - d;
    r.anim = {
      from: start,
      to,
      target,
      t0: performance.now(),
      dur: ((start - to) / speed) * 1000 * 1.6 + 70,
      done: () => {
        r.el.classList.remove('spin');
        r.strip.classList.remove('bump');
        void r.strip.offsetWidth;
        r.strip.classList.add('bump');
        Sound.reelStop();
        done?.();
      },
    };
    r.state = 'slide';
  };

  const stopReel = (i) => {
    const r = reels[i];
    if (!r || r.state !== 'spin' || frozen || held) return;
    order.push(i);
    const b = stopBtns[i];
    if (b) {
      b.disabled = true;
      b.classList.add('pressed');
    }
    slideTo(i, stops[i], () => {
      if (reels.every((x) => x.state === 'still')) allStopped();
    });
    mark();
    // 最後のリール: ボタンの色（青・赤・金・虹）と溜め
    const rest = reels.filter((x) => x.state === 'spin');
    if (rest.length === 1 && show && mode !== 'settle') {
      const k = reels.indexOf(rest[0]);
      const lastBtn = stopBtns[k];
      if (show.stop3 && show.stop3 !== 'none' && lastBtn) {
        lastBtn.classList.add('col', `col-${show.stop3}`);
        st?.stopColor(show.stop3);
      }
      if (show.hold) {
        held = true;
        if (lastBtn) lastBtn.disabled = true;
        st?.hold();
        later(() => {
          held = false;
          if (lastBtn && reels[k].state === 'spin') lastBtn.disabled = false;
          mark();
        }, 1400);
      }
    }
  };
  /** 押さなくても止める（溜め・フリーズ中は待つ）。回し直したら前の分はやめる */
  let spinGen = 0;
  const autoStop = (gen) => {
    if (gen !== spinGen || !reels.some((r) => r.state === 'spin')) return;
    stopReel(nextIdx());
    later(() => autoStop(gen), 700);
  };

  stopBtns.forEach((b) => b.addEventListener('click', () => stopReel(Number(b.dataset.atStop))));
  // 止まっているときのレバー: 送るのと同時に回し始める
  lever?.addEventListener('click', () => {
    atLeverAt = Date.now();
    Real.bet(box);
    lever.classList.add('pulled');
    Sound.lever();
    // ウェイト中なら、次の画面で回り始める
    if (Real.waitMs() > 0) return;
    Real.leverSpun();
    Real.markStart();
    const t = performance.now();
    reels.forEach((r) => {
      r.state = 'spin';
      r.spinAt = t;
      r.el.classList.add('spin');
    });
    box.classList.add('running');
    loop?.stop();
    loop = Sound.reelLoop();
  });
  box.querySelector('[data-maxbet]')?.addEventListener('click', () => Real.bet(box));
  const onKey = (e) => {
    if (!alive) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.repeat) return;
    const n = ['1', '2', '3'].indexOf(e.key);
    if (e.code !== 'Space' && e.key !== ' ' && n < 0) return;
    e.preventDefault();
    if (st?.busy()) {
      if (n < 0) st.skip();
      return;
    }
    if (reels.every((r) => r.state === 'still')) {
      if (n < 0 && lever && !lever.disabled) lever.click();
      return;
    }
    stopReel(n >= 0 ? n : nextIdx());
  };
  document.addEventListener('keydown', onKey);

  const startSpin = () => {
    frozen = false;
    box.classList.remove('frozen');
    Real.markStart();
    const t = performance.now();
    reels.forEach((r) => {
      r.state = 'spin';
      r.spinAt = t;
      r.el.classList.add('spin');
    });
    box.classList.add('running');
    loop?.stop();
    loop = Sound.reelLoop();
    mark();
    if (navi) st?.navi(navi);
    // 押さなくても、少したつと止まる（ナビがあればナビの順）
    const gen = ++spinGen;
    later(() => autoStop(gen), 12000);
  };
  const begin = () => {
    // レバーの予告（液晶の演出がなければ音だけ）。フリーズのあいだはリールが回らない
    const wait = st && show ? st.lever(show) : 0;
    if (!st) {
      const hint = Number(box.dataset.hint || 0);
      if (hint >= 2) Sound.peka(0.2);
      else if (hint === 1) Sound.gogo?.(0.2);
    }
    if (wait > 0) {
      frozen = true;
      box.classList.add('frozen');
      later(startSpin, wait);
    } else startSpin();
  };

  // 止まったまま見せるときも、そろったラインを光らせる
  if (mode === 'still' && box.dataset.winline) {
    const rows = (box.dataset.paylines || '').split('|')[Number(box.dataset.winline)]?.split(',').map(Number);
    showPayline(box.querySelector('.c-at-window'), rows);
  }
  loadAtStage(box.dataset.stageJs, () => {
    if (!alive || st || !window.AtStage) return;
    st = window.AtStage.mount(box, { Sound, mode });
  });
  if (mode === 'spin' || mode === 'wait') {
    if (Date.now() - atLeverAt > 3000) Sound.lever();
    box.classList.add('betted');
    box.querySelectorAll('[data-bet-lamp]').forEach((l) => l.classList.add('on'));
    // ウェイト（前のゲームから 4.1 秒）。待つ間はリールが止まったまま
    const w = Real.justStarted() ? 0 : Real.waitMs();
    if (w > 0) {
      frozen = true;
      box.classList.add('waiting');
      later(() => {
        box.classList.remove('waiting');
        begin();
      }, w);
    } else if (window.AtStage || !box.dataset.stageJs) begin();
    else {
      frozen = true;
      let started = false;
      const go = () => {
        if (started || !alive) return;
        started = true;
        begin();
      };
      document.addEventListener('at-stage-ready', () => setTimeout(go, 0), { once: true });
      later(go, 600);
    }
  } else if (mode === 'settle' && from) {
    // そろえる: 送る前の目から、決まった目へ
    reels.forEach((r, i) => {
      r.pos = N + from[i];
      paint(r);
    });
    const moving = reels.map((_, i) => i).filter((i) => from[i] !== stops[i]);
    if (!moving.length) later(reveal, 150);
    moving.forEach((i, k) =>
      later(() => {
        reels[i].state = 'spin';
        slideTo(i, stops[i], () => {
          if (reels.every((x) => x.state === 'still')) reveal();
        });
      }, 120 + k * 120),
    );
  }
  /** 🎬 演出を見る: 選んだ演出をこの台で（銭は動かない） */
  const demo = (d) => {
    if (!st || reels.some((r) => r.state !== 'still') || st.busy()) return;
    show = d.show || null;
    box.dataset.events = JSON.stringify(d.list || []);
    box.dataset.stagePost = d.post || d.stage || box.dataset.stagePost;
    box.dataset.oni = '0';
    st.setStage(d.stage || 'rush', d.oni || 0);
    if (d.navi) {
      st.navi(d.navi);
      return;
    }
    if (d.spin) {
      order.length = 0;
      stopBtns.forEach((b) => {
        b.disabled = false;
        b.classList.remove('pressed', 'col', 'col-blue', 'col-red', 'col-gold', 'col-rainbow');
      });
      Sound.lever();
      begin();
      return;
    }
    if (d.list) st.play(d.list, show, () => st.settle());
  };
  atCtl = {
    demo,
    stop() {
      st?.unmount();
      alive = false;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      loop?.stop();
      document.removeEventListener('keydown', onKey);
    },
  };
};

document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-at-demo]') : null;
  if (!b || !atCtl) return;
  try {
    atCtl.demo(JSON.parse(b.getAttribute('data-at-demo') || '{}'));
  } catch {
    // 読めない演出は出さない
  }
});

// ───── ページごとの準備（最初に開いたとき・中身を差し替えたとき） ─────
const pageInit = (root, tableEnd) => {
  paintSoundButton();
  applyHints(hintsOn());
  document.querySelectorAll('form[data-rb]').forEach(paintBoard);
  initLive();
  initSlots(root);
  initAtSlot(root);
  playFx(root, tableEnd);
  paintTwoTap();
  paintTapHint();
  mjFx();
  initKeiba();
};
document.addEventListener('c-live-updated', () => initKeiba());
pageInit(document);

// 🖥 PC: スロットの台を「🔍 大きく」（高さを気にせず横いっぱいまで）。このブラウザに覚える
(() => {
  const KEY = 'c-big';
  const get = () => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  };
  const set = (on) => {
    document.documentElement.classList.toggle('c-big', on);
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* 覚えられなくても動く */
    }
  };
  document.documentElement.classList.toggle('c-big', get());
  // ページを入れ替えたあと（レバーを叩いたあとなど）も付け直す
  const init = () => {
    if (!document.querySelector('.c-main > .c-slot-stage')) return;
    const h1 = document.querySelector('.c-main > .c-h1');
    if (!h1 || h1.querySelector('.c-bigbtn')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'c-bigbtn';
    const paint = () => {
      const on = document.documentElement.classList.contains('c-big');
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? '🔍 ふつうの大きさ' : '🔍 もっと大きく';
      b.title = on ? '台を画面の高さに合わせる' : '台を横いっぱいまで大きくする（スクロールして遊ぶ。キーボードでも遊べます）';
    };
    paint();
    b.addEventListener('click', () => {
      set(!document.documentElement.classList.contains('c-big'));
      paint();
    });
    h1.appendChild(b);
  };
  init();
  document.addEventListener('c-page-swapped', init);
})();

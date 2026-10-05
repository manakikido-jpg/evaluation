// 🦊 AT 機「鬼斬り白狐」の液晶の演出（AT 機の画面を開いたときだけ読む）
// - 当たり・払い戻しはサーバーで決まっている。ここは見せ方だけ（data-show・data-events）
// - 絵は社務所で入れたもの（data-art: key → URL）を使い、入っていないものはここで描いた仮の絵
// - 音は casino.js の CasinoSound（ブラウザの中で作る音）を使う。音を消していれば鳴らない
// - ページの中にスクリプトや style 属性は書けないので、動きは el.animate・el.style で付ける
(() => {
  const Sound = window.CasinoSound;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ───── 仮の絵（SVG）─────
  const SVG = (vb, body, cls = '') => `<svg class="sc-svg ${cls}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
  const FOX = `
    <defs>
      <linearGradient id="fx-fur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9d8ff"/></linearGradient>
      <radialGradient id="fx-aura" cx="50%" cy="55%" r="50%"><stop offset="0" stop-color="#9fd0ff" stop-opacity=".55"/><stop offset="1" stop-color="#9fd0ff" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="sc-aura" cx="100" cy="140" rx="100" ry="110" fill="url(#fx-aura)"/>
    <path d="M128 200 C186 196 206 132 178 84 C172 70 186 58 196 66 C190 40 160 40 150 64 C176 104 160 156 120 176 Z" fill="url(#fx-fur)" stroke="#8fa8e8" stroke-width="2"/>
    <path d="M184 70 C190 62 196 64 196 66 C190 54 178 52 172 60 Z" fill="#ff4a6a"/>
    <path d="M66 236 C56 186 66 146 100 134 C134 146 144 186 134 236 Z" fill="url(#fx-fur)" stroke="#8fa8e8" stroke-width="2"/>
    <path d="M84 150 L100 176 L116 150" fill="none" stroke="#e8203c" stroke-width="5" stroke-linejoin="round"/>
    <rect x="80" y="186" width="40" height="10" rx="3" fill="#e8203c"/>
    <path d="M100 44 L60 10 L64 72 C48 86 50 108 68 118 L100 142 L132 118 C150 108 152 86 136 72 L140 10 Z" fill="url(#fx-fur)" stroke="#8fa8e8" stroke-width="2"/>
    <path d="M67 22 L80 60 L70 64 Z M133 22 L120 60 L130 64 Z" fill="#ff6a8a"/>
    <path d="M74 86 Q86 76 98 90 M126 86 Q114 76 102 90" stroke="#e8203c" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M100 52 L93 68 L100 76 L107 68 Z" fill="#e8203c"/>
    <path class="sc-eye" d="M76 96 Q86 88 96 98 Q86 101 76 96 Z M124 96 Q114 88 104 98 Q114 101 124 96 Z" fill="#d0102e"/>
    <path d="M68 108 L54 112 M68 114 L56 120 M132 108 L146 112 M132 114 L144 120" stroke="#8fa8e8" stroke-width="1.5"/>
    <ellipse cx="100" cy="126" rx="6" ry="4.5" fill="#2a2a3a"/>
    <g class="sc-blade"><path d="M150 176 L198 30" stroke="#f4f8ff" stroke-width="6" stroke-linecap="round"/><path d="M150 176 L198 30" stroke="#9fd0ff" stroke-width="2"/><rect x="138" y="170" width="24" height="8" rx="2" transform="rotate(-72 150 174)" fill="#c8a040"/></g>`;
  const ONI = `
    <defs>
      <linearGradient id="oni-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5a3a"/><stop offset="1" stop-color="#9a1a10"/></linearGradient>
      <radialGradient id="oni-aura" cx="50%" cy="55%" r="50%"><stop offset="0" stop-color="#ff2a40" stop-opacity=".5"/><stop offset="1" stop-color="#ff2a40" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="sc-aura" cx="100" cy="140" rx="100" ry="110" fill="url(#oni-aura)"/>
    <path d="M30 230 C26 170 48 130 100 124 C152 130 174 170 170 230 Z" fill="url(#oni-skin)" stroke="#3a0404" stroke-width="3"/>
    <path d="M44 206 L156 206 L150 236 L50 236 Z" fill="#f0c020" stroke="#3a2a00" stroke-width="2"/>
    <path d="M56 206 l8 30 M80 206 l6 30 M104 206 l4 30 M128 206 l4 30 M148 206 l0 30" stroke="#1a1a1a" stroke-width="5"/>
    <g class="sc-club"><path d="M170 214 L196 70" stroke="#3a2a20" stroke-width="16" stroke-linecap="round"/><path d="M178 160 l12 4 M182 136 l12 4 M186 112 l12 4 M190 90 l11 4" stroke="#c8c8c8" stroke-width="5"/></g>
    <path d="M40 92 C30 40 70 20 100 22 C130 20 170 40 160 92 C176 100 170 128 150 128 L136 146 L64 146 L50 128 C30 128 24 100 40 92 Z" fill="url(#oni-skin)" stroke="#3a0404" stroke-width="3"/>
    <path d="M36 70 C20 40 40 24 52 18 C40 40 50 60 60 66 Z M164 70 C180 40 160 24 148 18 C160 40 150 60 140 66 Z" fill="#2a1a10"/>
    <path d="M62 40 L50 0 L76 34 Z M138 40 L150 0 L124 34 Z" fill="#f4ecd8" stroke="#3a2a10" stroke-width="2"/>
    <path d="M62 74 L94 86 M138 74 L106 86" stroke="#1a0000" stroke-width="7" stroke-linecap="round"/>
    <path class="sc-eye" d="M66 96 Q80 86 94 98 Q80 104 66 96 Z M134 96 Q120 86 106 98 Q120 104 134 96 Z" fill="#ffe040"/>
    <path d="M70 120 Q100 140 130 120 L126 132 Q100 146 74 132 Z" fill="#2a0000"/>
    <path d="M78 122 L82 134 L86 124 M122 122 L118 134 L114 124" fill="#fff"/>`;
  const BG = {
    shrine: `<defs><linearGradient id="bg-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1440"/><stop offset=".7" stop-color="#2a3a7a"/><stop offset="1" stop-color="#1a1430"/></linearGradient></defs>
      <rect width="160" height="90" fill="url(#bg-s)"/><circle cx="128" cy="20" r="11" fill="#fff8d8"/><circle cx="128" cy="20" r="16" fill="#fff8d8" opacity=".15"/>
      <g fill="#fff" opacity=".8"><circle cx="20" cy="12" r=".6"/><circle cx="44" cy="22" r=".5"/><circle cx="70" cy="8" r=".7"/><circle cx="96" cy="16" r=".5"/><circle cx="150" cy="40" r=".5"/></g>
      <path d="M0 74 Q40 66 80 72 T160 70 V90 H0 Z" fill="#100c20"/>
      <g fill="#c8203a"><rect x="22" y="38" width="4" height="36"/><rect x="50" y="38" width="4" height="36"/><rect x="14" y="34" width="48" height="4" rx="1"/><rect x="18" y="42" width="40" height="3"/></g>
      <path d="M12 32 Q38 28 64 32 L64 34 L12 34 Z" fill="#2a0a10"/>
      <g fill="#ffb84a" opacity=".9"><circle cx="90" cy="68" r="2"/><circle cx="104" cy="67" r="2"/><circle cx="118" cy="68" r="2"/></g>`,
    forest: `<defs><linearGradient id="bg-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14031a"/><stop offset=".7" stop-color="#3a0a2a"/><stop offset="1" stop-color="#0a0208"/></linearGradient></defs>
      <rect width="160" height="90" fill="url(#bg-f)"/><circle cx="80" cy="26" r="14" fill="#ff3a3a" opacity=".85"/><circle cx="80" cy="26" r="22" fill="#ff3a3a" opacity=".15"/>
      <g fill="#05010a"><path d="M0 90 L8 30 L16 90 Z M14 90 L24 20 L34 90 Z M126 90 L136 24 L146 90 Z M142 90 L152 34 L160 90 Z"/><path d="M30 90 L40 46 L50 90 Z M110 90 L120 44 L130 90 Z"/><path d="M0 80 Q80 70 160 80 V90 H0 Z"/></g>
      <g fill="#a0ffa0" opacity=".5"><circle cx="60" cy="60" r=".8"/><circle cx="100" cy="54" r=".8"/><circle cx="70" cy="40" r=".6"/></g>`,
    rush: `<defs><radialGradient id="bg-r" cx="50%" cy="60%" r="70%"><stop offset="0" stop-color="#ffe8a0"/><stop offset=".35" stop-color="#8a4ad8"/><stop offset="1" stop-color="#120830"/></radialGradient></defs>
      <rect width="160" height="90" fill="url(#bg-r)"/>
      <g fill="#fff" opacity=".12">${Array.from({ length: 16 }, (_, i) => `<path d="M80 54 L${80 + 200 * Math.cos((i * Math.PI) / 8)} ${54 + 200 * Math.sin((i * Math.PI) / 8)} L${80 + 200 * Math.cos(((i + 0.45) * Math.PI) / 8)} ${54 + 200 * Math.sin(((i + 0.45) * Math.PI) / 8)} Z"/>`).join('')}</g>
      <path d="M0 80 Q80 72 160 80 V90 H0 Z" fill="#1a0a3a"/>`,
    ranbu: `<defs><linearGradient id="bg-k" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3aa0"/><stop offset=".33" stop-color="#ffd03a"/><stop offset=".66" stop-color="#3ad0ff"/><stop offset="1" stop-color="#a03aff"/></linearGradient></defs>
      <rect width="160" height="90" fill="url(#bg-k)"/>
      <g fill="#fff" opacity=".22">${Array.from({ length: 12 }, (_, i) => `<path d="M80 50 L${80 + 200 * Math.cos((i * Math.PI) / 6)} ${50 + 200 * Math.sin((i * Math.PI) / 6)} L${80 + 200 * Math.cos(((i + 0.5) * Math.PI) / 6)} ${50 + 200 * Math.sin(((i + 0.5) * Math.PI) / 6)} Z"/>`).join('')}</g>`,
    battle: `<defs><linearGradient id="bg-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0004"/><stop offset=".6" stop-color="#8a1010"/><stop offset="1" stop-color="#1a0204"/></linearGradient></defs>
      <rect width="160" height="90" fill="url(#bg-b)"/><circle cx="80" cy="30" r="20" fill="#ffd0a0" opacity=".9"/>
      <path d="M0 74 L40 70 L60 76 L100 70 L130 76 L160 72 V90 H0 Z" fill="#100204"/><path d="M50 82 L62 76 L70 84 M104 80 L114 74" stroke="#ff6a3a" stroke-width=".8" fill="none"/>`,
  };
  const BG_KEY = { shrine: 'bg-normal', forest: 'bg-zenchou', rush: 'bg-at', ranbu: 'bg-tokka', battle: 'bg-battle' };
  const LOGO = {
    'logo-rush': ['白狐ラッシュ', 'BYAKKO RUSH'],
    'logo-ranbu': ['白狐乱舞', 'RANBU ZONE'],
    'logo-battle': ['決戦', 'VS 鬼'],
  };
  const TRACK = { shrine: null, forest: 'forest', rush: 'rush', ranbu: 'ranbu', battle: 'battle' };

  // ───── 音 ─────
  const fx = {
    kyuin(at = 0) {
      Sound.tone(500, at, 0.35, { type: 'sawtooth', vol: 0.08, to: 2400 });
      Sound.tone(2400, at + 0.33, 0.25, { type: 'square', vol: 0.05 });
    },
    kyuinKyuin(at = 0) {
      for (let k = 0; k < 3; k++) fx.kyuin(at + k * 0.42);
    },
    flash: (at = 0) => Sound.noise(at, 0.25, { freq: 5000, q: 0.6, vol: 0.18 }),
    roar(at = 0) {
      Sound.tone(90, at, 0.7, { type: 'sawtooth', vol: 0.14, to: 55 });
      Sound.noise(at, 0.6, { freq: 260, q: 0.6, vol: 0.3 });
    },
    heart(at = 0) {
      Sound.tone(70, at, 0.16, { type: 'sine', vol: 0.4, to: 45 });
      Sound.tone(70, at + 0.24, 0.2, { type: 'sine', vol: 0.32, to: 45 });
    },
    zukyun(at = 0) {
      Sound.tone(1800, at, 0.9, { type: 'sawtooth', vol: 0.1, to: 60 });
      Sound.noise(at, 0.9, { freq: 800, q: 0.4, vol: 0.25 });
      Sound.tone(55, at + 0.05, 1.2, { type: 'sine', vol: 0.4 });
    },
    slash(at = 0) {
      Sound.noise(at, 0.18, { freq: 6000, q: 0.8, vol: 0.32 });
      Sound.tone(3000, at, 0.16, { type: 'sawtooth', vol: 0.05, to: 600 });
    },
    hit(at = 0) {
      Sound.tone(120, at, 0.3, { type: 'square', vol: 0.18, to: 40 });
      Sound.noise(at, 0.25, { freq: 400, q: 0.5, vol: 0.4 });
    },
    whoosh: (at = 0) => Sound.noise(at, 0.3, { freq: 1200, q: 0.5, vol: 0.18 }),
    taiko(at = 0, v = 1) {
      Sound.tone(110, at, 0.35, { type: 'sine', vol: 0.45 * v, to: 50 });
      Sound.noise(at, 0.08, { freq: 300, q: 1, vol: 0.25 * v });
    },
    stopCol(c) {
      if (c === 'blue') Sound.notes([[880, 0, 0.18]], 0, { type: 'sine', vol: 0.14 });
      else if (c === 'red') Sound.notes([[1175, 0, 0.12], [1568, 0.1, 0.25]], 0, { type: 'square', vol: 0.06 });
      else if (c === 'gold') Sound.notes([[1568, 0, 0.12], [2093, 0.1, 0.12], [2637, 0.2, 0.4]], 0, { type: 'triangle', vol: 0.14 });
      else if (c === 'rainbow') fx.kyuinKyuin();
    },
    navi: (k, at = 0) => Sound.notes([[[1319, 1568, 1976][k] || 1319, 0, 0.14]], at, { type: 'square', vol: 0.06 }),
    count: (at = 0) => Sound.tone(2200 + Math.random() * 600, at, 0.03, { type: 'square', vol: 0.03 }),
    stamp(at = 0) {
      fx.taiko(at, 1.2);
      Sound.noise(at, 0.2, { freq: 2000, q: 0.5, vol: 0.2 });
    },
  };

  // ───── BGM（ページを差し替えても続ける。同じ曲なら頭からにしない）─────
  const N = (n) => 440 * 2 ** ((n - 69) / 12);
  const TRACKS = {
    // 白狐ラッシュ: 疾走する 8 分のベースと、上の分散和音（ラ短調 → ファ → ソ → ミ）
    rush: {
      bpm: 152,
      step(i, at) {
        const bar = Math.floor(i / 8) % 4;
        const roots = [45, 41, 43, 40];
        const r = roots[bar];
        Sound.tone(N(r + (i % 2 ? 12 : 0)), at, 0.16, { type: 'square', vol: 0.035 });
        const chord = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]][bar];
        const arp = [0, 1, 2, 1, 0, 1, 2, 1][i % 8];
        Sound.tone(N(chord[arp] + 12), at, 0.12, { type: 'triangle', vol: 0.03 });
        if (i % 4 === 0) Sound.noise(at, 0.06, { freq: 180, q: 1, vol: 0.14 });
        if (i % 4 === 2) Sound.noise(at, 0.05, { freq: 5000, q: 1, vol: 0.06 });
        if (i % 32 === 28) Sound.notes([[N(76), 0, 0.12], [N(79), 0.1, 0.12], [N(81), 0.2, 0.3]], at, { type: 'square', vol: 0.025 });
      },
    },
    // 白狐乱舞: もっと速く・高く
    ranbu: {
      bpm: 176,
      step(i, at) {
        const bar = Math.floor(i / 8) % 2;
        Sound.tone(N([50, 52][bar] + (i % 2 ? 12 : 0)), at, 0.12, { type: 'square', vol: 0.035 });
        const sc = [74, 76, 78, 81, 83, 81, 78, 76];
        Sound.tone(N(sc[i % 8] + (bar ? 2 : 0)), at, 0.1, { type: 'square', vol: 0.025 });
        if (i % 2 === 0) Sound.noise(at, 0.05, { freq: i % 4 === 0 ? 180 : 4500, q: 1, vol: i % 4 === 0 ? 0.16 : 0.06 });
      },
    },
    // 決戦: 太鼓と低い繰り返し
    battle: {
      bpm: 132,
      step(i, at) {
        if ([0, 3, 6].includes(i % 8)) fx.taiko(at, i % 8 === 0 ? 1 : 0.6);
        Sound.tone(N([38, 38, 41, 38, 43, 38, 41, 40][i % 8]), at, 0.18, { type: 'sawtooth', vol: 0.03 });
      },
    },
    // 鬼の森（前兆）: 心臓の音と低いうなり
    forest: {
      bpm: 96,
      step(i, at) {
        if (i % 4 === 0) fx.heart(at);
        if (i % 16 === 8) Sound.tone(N(33), at, 1.6, { type: 'sawtooth', vol: 0.025, to: N(32) });
      },
    },
  };
  const Bgm = (() => {
    let cur = null;
    let timer = 0;
    let next = null;
    let i = 0;
    const tick = () => {
      const now = Sound.time();
      const tr = TRACKS[cur];
      if (now === null || !tr) {
        next = null;
        return;
      }
      const dt = 60 / tr.bpm / 2;
      if (next === null || next < now) next = now + 0.05;
      while (next < now + 0.3) {
        tr.step(i, next - now);
        i++;
        next += dt;
      }
    };
    return {
      play(name) {
        if (name === cur) return;
        clearInterval(timer);
        cur = name;
        next = null;
        i = 0;
        if (name && TRACKS[name]) timer = setInterval(tick, 100);
      },
      stop() {
        clearInterval(timer);
        cur = null;
      },
    };
  })();

  // ───── 入れた絵のまわりの透明な余白を切る（ChatGPT の絵は余白が大きい。1 回切ったら覚えておく）─────
  const trimmed = new Map();
  const ready = new Map();
  const trim = (url) => {
    if (!trimmed.has(url)) {
      trimmed.set(
        url,
        new Promise((res) => {
          const done = (u) => {
            ready.set(url, u);
            res(u);
          };
          const im = new Image();
          im.onerror = () => done(url);
          im.onload = () => {
            try {
              const s = Math.min(1, 400 / Math.max(im.naturalWidth, im.naturalHeight));
              const w = Math.max(1, Math.round(im.naturalWidth * s));
              const h = Math.max(1, Math.round(im.naturalHeight * s));
              const cv = document.createElement('canvas');
              cv.width = w;
              cv.height = h;
              const cx = cv.getContext('2d', { willReadFrequently: true });
              cx.drawImage(im, 0, 0, w, h);
              const d = cx.getImageData(0, 0, w, h).data;
              let x0 = w;
              let y0 = h;
              let x1 = -1;
              let y1 = -1;
              for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                  if (d[(y * w + x) * 4 + 3] > 20) {
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    if (y > y1) y1 = y;
                  }
                }
              }
              // 透明なところがない・ほとんど余白がない絵はそのまま
              if (x1 < 0 || (x1 - x0 + 1) * (y1 - y0 + 1) > w * h * 0.9) return done(url);
              const sx = Math.max(0, Math.floor((x0 - 1) / s));
              const sy = Math.max(0, Math.floor((y0 - 1) / s));
              const sw = Math.min(im.naturalWidth - sx, Math.ceil((x1 - x0 + 3) / s));
              const sh = Math.min(im.naturalHeight - sy, Math.ceil((y1 - y0 + 3) / s));
              const out = document.createElement('canvas');
              out.width = sw;
              out.height = sh;
              out.getContext('2d').drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
              out.toBlob((b) => done(b ? URL.createObjectURL(b) : url), 'image/png');
            } catch {
              done(url);
            }
          };
          im.src = url;
        }),
      );
    }
    return trimmed.get(url);
  };
  /** 絵を img に入れる（切ったものがあればそれ、まだなら切れたら差し替える） */
  const putArt = (img, url) => {
    img.src = ready.get(url) || url;
    if (!ready.has(url)) trim(url).then((u) => img.isConnected && img.getAttribute('src') === url && (img.src = u));
  };

  // ───── 小さな道具 ─────
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const rand = (a, b) => a + Math.random() * (b - a);

  function mount(box, opts = {}) {
    const screen = box.querySelector('[data-screen]');
    const scene = box.querySelector('[data-scene]');
    if (!screen || !scene) return null;
    let art = {};
    try {
      art = JSON.parse(box.dataset.art || '{}');
    } catch {
      art = {};
    }
    let alive = true;
    let busy = false;
    let skipping = false;
    const timers = [];
    const wakers = new Set();
    /** 待つ（飛ばしたらすぐ） */
    const sleep = (ms) =>
      new Promise((res) => {
        if (skipping || !alive || reduce) return res();
        const w = () => {
          wakers.delete(w);
          res();
        };
        wakers.add(w);
        timers.push(setTimeout(w, ms));
      });
    const anim = (node, frames, o) => {
      if (!node.animate) return null;
      const a = node.animate(frames, { fill: 'forwards', ...o, duration: skipping || reduce ? 1 : o.duration });
      return a;
    };

    // キャラ・ロゴの余白を先に切っておく（台の名前のロゴも）
    Object.entries(art).forEach(([k, u]) => {
      if (!k.startsWith('bg-') && !k.startsWith('sym-')) trim(u);
    });
    const title = box.querySelector('.c-at-title-img');
    if (title) putArt(title, title.getAttribute('src'));

    // 層: 背景・流れる線・キャラ・上にかぶせるもの・光
    scene.innerHTML = '';
    const bg = el('div', 'sc-bg');
    const lines = el('div', 'sc-lines');
    const actors = el('div', 'sc-actors');
    const over = el('div', 'sc-over');
    const flash = el('div', 'sc-flash');
    scene.append(bg, lines, actors, over, flash);

    const setBg = (stage) => {
      const key = BG_KEY[stage] || 'bg-normal';
      bg.innerHTML = '';
      bg.className = `sc-bg st-${stage}`;
      if (art[key]) {
        const img = el('img', 'sc-bg-img');
        img.src = art[key];
        img.alt = '';
        bg.append(img);
      } else bg.innerHTML = SVG('0 0 160 90', BG[stage] || BG.shrine, 'sc-bg-svg');
      screen.className = screen.className.replace(/\bstage-\S+/g, '').trim() + ` stage-${stage}`;
      lines.className = `sc-lines st-${stage}`;
    };
    /** キャラ（絵がなければ仮の絵。ポーズの絵がなければふつうの絵を傾けて使う） */
    const actor = (kind, pose = '') => {
      const key = pose ? `${kind}-${pose}` : kind;
      const a = el('div', `sc-actor ${kind}${pose ? ` pose-${pose}` : ''}`);
      const src = art[key] || art[kind];
      if (src) {
        const img = el('img', `sc-actor-img${art[key] ? ' exact' : ''}`);
        putArt(img, src);
        img.alt = '';
        img.draggable = false;
        a.append(img);
      } else a.innerHTML = SVG('0 0 200 240', kind === 'oni' ? ONI : FOX, `sc-${kind}`);
      return a;
    };
    const logo = (key, cls = '') => {
      const d = el('div', `sc-logo ${key} ${cls}`);
      if (art[key]) {
        const img = el('img');
        putArt(img, art[key]);
        img.alt = LOGO[key]?.[0] || '';
        d.append(img);
      } else {
        const [big, small] = LOGO[key] || ['', ''];
        d.append(el('b', '', ''), el('small', '', ''));
        d.firstChild.textContent = big;
        d.lastChild.textContent = small;
      }
      return d;
    };
    const text = (cls, big, small) => {
      const d = el('div', `sc-text ${cls}`);
      const b = el('b');
      b.textContent = big;
      d.append(b);
      if (small) {
        const s = el('small');
        s.textContent = small;
        d.append(s);
      }
      return d;
    };
    const doFlash = (cls = 'white', ms = 380) => {
      flash.className = `sc-flash ${cls}`;
      anim(flash, [{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
    };
    const shake = (px = 6, ms = 420) =>
      anim(box, [0, 1, 2, 3, 4, 5, 6].map((k) => ({ transform: k === 6 ? 'none' : `translate(${rand(-px, px)}px, ${rand(-px, px)}px)` })), { duration: ms, fill: 'none' });
    const coins = (n = 24, gold = true) => {
      for (let k = 0; k < (reduce ? 0 : n); k++) {
        const c = el('i', `sc-coin${gold ? '' : ' silver'}`);
        over.append(c);
        const x = rand(-1, 1) * 46;
        const a = anim(
          c,
          [
            { transform: 'translate(-50%, -50%) scale(.4)', opacity: 1 },
            { transform: `translate(calc(-50% + ${x}vw * .35), calc(-50% - ${rand(40, 110)}px)) scale(1) rotate(${rand(-180, 180)}deg)`, opacity: 1, offset: 0.45 },
            { transform: `translate(calc(-50% + ${x * 1.3}vw * .35), calc(-50% + ${rand(60, 140)}px)) scale(.9) rotate(${rand(-360, 360)}deg)`, opacity: 0 },
          ],
          { duration: rand(900, 1500), easing: 'cubic-bezier(.2,.7,.4,1)' },
        );
        if (a) a.onfinish = () => c.remove();
        else c.remove();
      }
    };
    /** HUD（液晶の文字）の「残り G」 */
    const hudLeft = () => [...box.querySelectorAll('.c-at-lcd')].find((x) => !x.hidden)?.querySelector('.c-at-left');
    const countUp = async (node, from, to, ms, fmt = (v) => v.toLocaleString('ja-JP')) => {
      if (!node) return;
      const steps = Math.max(1, Math.min(30, Math.abs(to - from)));
      for (let k = 1; k <= steps; k++) {
        if (skipping) break;
        node.textContent = fmt(Math.round(from + ((to - from) * k) / steps));
        if (k % 2) fx.count();
        await sleep(ms / steps);
      }
      node.textContent = fmt(to);
    };

    // 待っているときの舞台（白狐が立っている・前兆なら鬼が近づいている）
    let stage = box.dataset.stagePre || 'shrine';
    let oniNow = Number((opts.mode === 'still' ? box.dataset.oni : box.dataset.oniPre) || 0);
    const idle = (st) => {
      stage = st;
      setBg(st);
      actors.innerHTML = '';
      const oni = oniNow;
      if (st === 'forest' && oni > 0) {
        const o = actor('oni');
        o.classList.add('idle-oni', `near-${Math.min(3, oni)}`);
        actors.append(o);
      }
      const b = actor('byakko');
      b.classList.add('idle', st === 'forest' ? 'side' : 'center');
      actors.append(b);
      Bgm.play(TRACK[st] ?? null);
    };
    idle(stage);

    // 画面をたたくと演出を飛ばす
    const onTap = () => {
      if (busy) ctl.skip();
    };
    screen.addEventListener('click', onTap);

    // ───── 演出の場面 ─────
    const scenes = {
      async at_start(e) {
        Bgm.play(null);
        const black = el('div', 'sc-black');
        over.append(black);
        fx.zukyun();
        await sleep(700);
        doFlash('white', 500);
        black.remove();
        const cut = actor('byakko', 'cutin');
        cut.classList.add('cutin');
        over.append(cut);
        fx.slash();
        anim(cut, [{ transform: 'translateX(110%) skewX(-12deg)' }, { transform: 'translateX(0) skewX(-12deg)', offset: 0.3 }, { transform: 'translateX(-4%) skewX(-12deg)', offset: 0.75 }, { transform: 'translateX(-120%) skewX(-12deg)' }], {
          duration: 1100,
          easing: 'ease-in-out',
        });
        await sleep(1000);
        cut.remove();
        idle('rush');
        const lg = logo('logo-rush', 'zoom');
        over.append(lg);
        anim(lg, [{ transform: 'translate(-50%, -50%) scale(3)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(.92)', opacity: 1, offset: 0.6 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }], {
          duration: 520,
          easing: 'cubic-bezier(.3,1.5,.5,1)',
        });
        await sleep(420);
        shake(9, 500);
        doFlash('gold', 500);
        coins(36);
        Sound.bonus(true);
        await sleep(1500);
        const t = text('rate', `継続率 ${e.rate}%`, e.tenjou ? '天井到達！' : 'BATTLE で SET 継続');
        over.append(t);
        fx.stamp();
        anim(t, [{ transform: 'translate(-50%, 0) scale(2)', opacity: 0 }, { transform: 'translate(-50%, 0) scale(1)', opacity: 1 }], { duration: 260, easing: 'ease-out' });
        await sleep(1300);
        lg.remove();
        t.remove();
        Bgm.play('rush');
      },
      async add(e) {
        const big = e.games >= 50;
        if (big) {
          // 白狐目: +100 G
          Bgm.play(null);
          const black = el('div', 'sc-black');
          over.append(black);
          fx.zukyun();
          await sleep(600);
          black.remove();
          doFlash('rainbow', 900);
          fx.kyuinKyuin();
        }
        const atk = actor('byakko', 'attack');
        atk.classList.add('lunge');
        over.append(atk);
        fx.whoosh();
        anim(atk, [{ transform: 'translateX(-120%)' }, { transform: 'translateX(10%)', offset: 0.55 }, { transform: 'translateX(140%)' }], { duration: 640, easing: 'ease-in' });
        await sleep(300);
        const sl = el('i', 'sc-slash');
        over.append(sl);
        fx.slash();
        anim(sl, [{ transform: 'translate(-50%, -50%) rotate(-24deg) scaleX(0)', opacity: 1 }, { transform: 'translate(-50%, -50%) rotate(-24deg) scaleX(1)', opacity: 1, offset: 0.4 }, { transform: 'translate(-50%, -50%) rotate(-24deg) scaleX(1)', opacity: 0 }], {
          duration: 520,
        });
        await sleep(300);
        atk.remove();
        const n = text(`add${big ? ' huge' : ''}`, `+${e.games}G`, big ? '白狐目！！ 大上乗せ' : '上乗せ！');
        over.append(n);
        anim(n, [{ transform: 'translate(-50%, -50%) scale(.2)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1.25)', opacity: 1, offset: 0.6 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }], {
          duration: 380,
          easing: 'ease-out',
        });
        if (big) {
          shake(10, 700);
          coins(48);
          Sound.bigWin();
        } else Sound.peka();
        await sleep(big ? 1500 : 650);
        // 数字が「残り G」へ飛んでいって、数が増える
        screen.classList.remove('scening');
        const left = hudLeft();
        if (left) {
          const r1 = n.getBoundingClientRect();
          const r2 = left.getBoundingClientRect();
          anim(n, [{ transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${r2.left + r2.width / 2 - (r1.left + r1.width / 2)}px), calc(-50% + ${r2.top + r2.height / 2 - (r1.top + r1.height / 2)}px)) scale(.3)`, opacity: 0.2 }], {
            duration: 380,
            easing: 'ease-in',
          });
          await sleep(380);
          const cur = Number((left.textContent || '').replace(/\D/g, '')) || 0;
          left.classList.add('pop');
          await countUp(left, cur, cur + e.games, big ? 900 : 450, (v) => `残り ${v} G`);
          left.classList.remove('pop');
        } else await sleep(300);
        n.remove();
        screen.classList.add('scening');
        if (big) Bgm.play(stage === 'ranbu' ? 'ranbu' : 'rush');
      },
      async tokka_start() {
        Bgm.play(null);
        doFlash('rainbow', 800);
        fx.kyuinKyuin();
        shake(8, 600);
        idle('ranbu');
        const lg = logo('logo-ranbu', 'zoom');
        over.append(lg);
        anim(lg, [{ transform: 'translate(-50%, -50%) rotate(-8deg) scale(3)', opacity: 0 }, { transform: 'translate(-50%, -50%) rotate(-3deg) scale(1)', opacity: 1 }], { duration: 500, easing: 'cubic-bezier(.3,1.5,.5,1)' });
        await sleep(500);
        coins(30);
        Sound.bonus(true);
        const t = text('rate', '毎ゲーム上乗せ！', '上乗せ特化ゾーン');
        over.append(t);
        await sleep(1800);
        lg.remove();
        t.remove();
        Bgm.play('ranbu');
      },
      async tokka_end() {
        const t = text('end', '白狐乱舞 終了', 'AT に戻ります');
        over.append(t);
        Sound.notes([[1047, 0, 0.12], [1319, 0.12, 0.12], [1568, 0.24, 0.4]], 0, { type: 'triangle', vol: 0.12 });
        await sleep(1300);
        t.remove();
        idle('rush');
      },
      async battle(e, show) {
        Bgm.play('battle');
        setBg('battle');
        actors.innerHTML = '';
        const lg = logo('logo-battle', 'slam');
        over.append(lg);
        fx.stamp();
        shake(7, 400);
        anim(lg, [{ transform: 'translate(-50%, -50%) scale(2.6)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }], { duration: 260, easing: 'ease-out' });
        const t0 = text('set', `SET ${e.set} 継続をかけて`, '');
        over.append(t0);
        await sleep(1100);
        lg.remove();
        t0.remove();
        const fox = actor('byakko');
        const oni = actor('oni');
        fox.classList.add('duel', 'left');
        oni.classList.add('duel', 'right');
        actors.append(fox, oni);
        anim(fox, [{ transform: 'translateX(-90%)' }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });
        anim(oni, [{ transform: 'translateX(90%) scaleX(-1)' }, { transform: 'scaleX(-1)' }], { duration: 380, easing: 'ease-out' });
        fx.roar(0.2);
        await sleep(700);
        const blows = show?.battle?.length ? show.battle : [{ who: e.win ? 'byakko' : 'oni', hit: true }];
        for (let k = 0; k < blows.length; k++) {
          if (skipping) break;
          const b = blows[k];
          const last = k === blows.length - 1;
          const me = b.who === 'byakko' ? fox : oni;
          const them = b.who === 'byakko' ? oni : fox;
          const dir = b.who === 'byakko' ? 1 : -1;
          const flip = b.who === 'oni' ? ' scaleX(-1)' : '';
          const flipThem = b.who === 'byakko' ? ' scaleX(-1)' : '';
          if (last) {
            // 決め手の前の溜め
            const dark = el('div', 'sc-black soft');
            over.append(dark);
            fx.heart();
            await sleep(900);
            dark.remove();
          }
          me.classList.add('attack');
          // 攻める絵があれば、その間だけ替える
          const kind = b.who;
          const img = me.querySelector('.sc-actor-img');
          const base = img?.getAttribute('src');
          if (img && art[`${kind}-attack`]) {
            img.src = ready.get(art[`${kind}-attack`]) || art[`${kind}-attack`];
            me.classList.add('pose-attack');
          }
          fx.whoosh();
          anim(me, [{ transform: `translateX(0)${flip}` }, { transform: `translateX(${dir * 70}%)${flip}`, offset: 0.5 }, { transform: `translateX(0)${flip}` }], { duration: last ? 520 : 420, easing: 'ease-in-out', fill: 'none' });
          await sleep(220);
          if (b.hit) {
            b.who === 'byakko' ? fx.slash() : fx.hit();
            fx.hit(0.04);
            doFlash(b.who === 'byakko' ? 'white' : 'red', 260);
            shake(last ? 10 : 5, 320);
            anim(them, [{ filter: 'brightness(3)', transform: `translateX(0)${flipThem}` }, { filter: 'none', transform: `translateX(${dir * 10}%)${flipThem}` }, { filter: 'none', transform: `translateX(0)${flipThem}` }], {
              duration: 360,
              fill: 'none',
            });
            const hitTxt = text(`blow ${b.who}`, b.who === 'byakko' ? '斬！' : '痛っ…！', '');
            over.append(hitTxt);
            timers.push(setTimeout(() => hitTxt.remove(), 520));
          } else {
            Sound.tone(1600, 0, 0.08, { type: 'triangle', vol: 0.08 });
            anim(them, [{ transform: `translateY(0)${flipThem}` }, { transform: `translateY(-26%)${flipThem}`, offset: 0.5 }, { transform: `translateY(0)${flipThem}` }], { duration: 360, fill: 'none' });
            const miss = text('blow miss', 'かわした！', '');
            over.append(miss);
            timers.push(setTimeout(() => miss.remove(), 480));
          }
          await sleep(last ? 700 : 560);
          me.classList.remove('attack');
          if (img && base && !(last && kind === 'byakko' && e.win)) {
            img.src = base;
            me.classList.remove('pose-attack');
          }
        }
        if (e.win) {
          if (art['oni-down']) {
            const down = actor('oni', 'down');
            down.classList.add('duel', 'right');
            oni.replaceWith(down);
            anim(down, [{ transform: 'scaleX(-1)', opacity: 1 }, { transform: 'scaleX(-1)', opacity: 1, offset: 0.6 }, { transform: 'translateY(12%) scaleX(-1)', opacity: 0 }], { duration: 1600, easing: 'ease-in' });
          } else {
            oni.classList.add('down');
            anim(oni, [{ transform: 'scaleX(-1)', opacity: 1 }, { transform: 'translateY(20%) rotate(18deg) scaleX(-1)', opacity: 0 }], { duration: 700, easing: 'ease-in' });
          }
          const winner = actor('byakko', 'win');
          winner.classList.add('duel', 'left', 'win');
          fox.replaceWith(winner);
          const t = text('win', '継続！！', `SET ${e.set + 1} へ`);
          over.append(t);
          anim(t, [{ transform: 'translate(-50%, -50%) scale(3)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }], { duration: 300, easing: 'ease-out' });
          doFlash('gold', 600);
          coins(40);
          Sound.bigWin();
          await sleep(1900);
          t.remove();
          idle('rush');
          Bgm.play('rush');
        } else {
          if (art['byakko-down']) {
            const down = actor('byakko', 'down');
            down.classList.add('duel', 'left');
            fox.replaceWith(down);
            anim(down, [{ opacity: 0.4, filter: 'brightness(2)' }, { opacity: 1, filter: 'none' }], { duration: 500 });
          } else {
            fox.classList.add('down');
            anim(fox, [{ opacity: 1, filter: 'none' }, { opacity: 0.5, filter: 'grayscale(1)', transform: 'translateY(14%) rotate(-10deg)' }], { duration: 800 });
          }
          screen.classList.add('lost');
          const t = text('lose', '鬼に敗れた…', '白狐ラッシュ 終了');
          over.append(t);
          Bgm.play(null);
          Sound.lose();
          await sleep(1800);
          t.remove();
          screen.classList.remove('lost');
        }
      },
      async at_end(e) {
        Bgm.play(null);
        idle('shrine');
        const card = el('div', 'sc-result');
        const h = el('b', 'sc-result-h');
        h.textContent = '白狐ラッシュ 結果';
        const won = el('strong', 'sc-result-won');
        won.textContent = '0';
        const sub = el('small');
        sub.textContent = `${e.sets} セット・${e.games} G`;
        card.append(h, won, sub);
        over.append(card);
        anim(card, [{ transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }], { duration: 300, easing: 'ease-out' });
        Sound.fanfare();
        await countUp(won, 0, e.won, 1100, (v) => `獲得 ${v.toLocaleString('ja-JP')}`);
        if (e.won > 0) coins(20);
        await sleep(1500);
        card.remove();
      },
    };

    const ctl = {
      /** レバーの予告。リールが回り出すまで待つ ms を返す（フリーズ） */
      lever(show) {
        if (show.freeze) {
          Bgm.play(null);
          box.classList.add('sc-freeze');
          fx.zukyun();
          const eyes = el('div', 'sc-eyes');
          over.append(eyes);
          timers.push(
            setTimeout(() => {
              doFlash('rainbow', 900);
              fx.kyuinKyuin();
              shake(10, 600);
            }, 1700),
            setTimeout(() => {
              eyes.remove();
              box.classList.remove('sc-freeze');
            }, 2700),
          );
          return reduce ? 400 : 2900;
        }
        const l = show.lever;
        if (l === 'kyuin') {
          fx.kyuin();
          doFlash('blue', 300);
        } else if (l === 'flash') {
          fx.flash();
          doFlash('white', 420);
        } else if (l === 'shake') {
          fx.roar();
          shake(8, 600);
          doFlash('red', 300);
        } else if (l === 'blackout') {
          fx.heart();
          fx.heart(0.6);
          const black = el('div', 'sc-black');
          black.append(el('i', 'sc-eyes-red'));
          over.append(black);
          timers.push(setTimeout(() => black.remove(), 1300));
        } else if (l === 'rainbow') {
          fx.kyuinKyuin();
          doFlash('rainbow', 1000);
          shake(6, 500);
        }
        return 0;
      },
      stopColor(c) {
        fx.stopCol(c);
        if (c === 'gold' || c === 'rainbow') doFlash(c === 'gold' ? 'gold' : 'rainbow', 400);
      },
      hold() {
        screen.classList.add('hold');
        fx.heart();
        fx.heart(0.7);
        timers.push(setTimeout(() => screen.classList.remove('hold'), 1400));
      },
      kakutei() {
        fx.kyuinKyuin();
        doFlash('rainbow', 900);
      },
      navi(order) {
        const row = el('div', 'sc-navi');
        [0, 1, 2].forEach((reel) => {
          const k = order.indexOf(reel);
          const m = el('b', `n${k}`);
          m.textContent = ['①', '②', '③'][k];
          row.append(m);
          fx.navi(k, 0.05 + k * 0.12);
        });
        over.append(row);
        anim(row, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 200 });
        timers.push(setTimeout(() => row.remove(), 6000));
      },
      /** 止め終わったあとの演出を順に（done はいちばん最後に 1 回） */
      play(list, show, done) {
        busy = true;
        skipping = false;
        screen.classList.add('scening');
        over.querySelectorAll('.sc-navi').forEach((n) => n.remove());
        (async () => {
          for (const item of list) {
            if (!alive) return;
            const e = item.ev;
            const f = e && scenes[e.k];
            if (f) await f(e, show);
          }
        })()
          .catch(() => undefined)
          .finally(() => {
            busy = false;
            screen.classList.remove('scening');
            skipping = false;
            if (alive) done();
          });
      },
      busy: () => busy,
      skip() {
        if (!busy) return;
        skipping = true;
        [...wakers].forEach((w) => w());
        over.querySelectorAll('.sc-text, .sc-logo, .sc-black, .sc-result, .sc-coin, .sc-slash, .sc-actor').forEach((n) => n.remove());
      },
      /** 止め終わって演出も終わった: 台の今の舞台にする */
      /** 舞台を替える（演出を見る画面から） */
      setStage(name, oni = 0) {
        oniNow = oni;
        idle(name);
      },
      settle() {
        const post = box.dataset.stagePost || 'shrine';
        const postOni = Number(box.dataset.oni || 0);
        if (postOni !== oniNow) {
          oniNow = postOni;
          return idle(post);
        }
        if (post !== stage || actors.childElementCount === 0 || actors.querySelector('.duel')) idle(post);
        else Bgm.play(TRACK[post] ?? null);
      },
      unmount() {
        alive = false;
        timers.forEach(clearTimeout);
        [...wakers].forEach((w) => w());
        screen.removeEventListener('click', onTap);
        box.classList.remove('sc-freeze');
      },
    };
    if (opts.mode === 'still') ctl.settle();
    return ctl;
  }

  window.AtStage = { mount, leave: () => Bgm.stop() };
})();

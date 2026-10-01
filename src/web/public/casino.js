// 咲楽ノ宮カジノ: 確かめてから送る・2 回押しを防ぐ（ページの中にスクリプトは書けないので、ここに置く）
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
// 戻るボタンで戻ってきたときは、また押せるように
window.addEventListener('pageshow', () => {
  document.querySelectorAll('form[data-sent]').forEach((f) => {
    delete f.dataset.sent;
    f.querySelectorAll('button').forEach((x) => { x.disabled = false; });
  });
});

// ───── みんなで座る卓: 1.5 秒ごとに変わったか確かめて、変わっていたら中身だけ差し替える ─────
(() => {
  const live = () => document.getElementById('c-live');
  const el = live();
  if (!el) return;
  const id = el.dataset.table;
  let version = el.dataset.v;
  // サーバーとの時計のずれ
  let skew = Number(el.dataset.now || Date.now()) - Date.now();
  const share = () => {
    document.documentElement.dataset.skew = String(skew);
  };
  share();
  // 選んでいる途中（カードを選んだ・数を入れている）は差し替えを少し待つ
  let dirtyAt = 0;
  document.addEventListener('input', (e) => {
    if (live()?.contains(e.target)) dirtyAt = Date.now();
  });
  const tickCountdowns = () => {
    document.querySelectorAll('[data-deadline]').forEach((n) => {
      const left = Math.max(0, Math.ceil((Number(n.getAttribute('data-deadline')) - (Date.now() + skew)) / 1000));
      const b = n.querySelector('b');
      if (b) b.textContent = String(left);
      n.classList.toggle('soon', left <= 5);
    });
  };
  setInterval(tickCountdowns, 250);
  let busy = false;
  const refresh = async () => {
    const res = await fetch(`/casino/t/${id}/frag`, { headers: { accept: 'text/html' }, credentials: 'same-origin' });
    if (res.status !== 200) return;
    const html = await res.text();
    const box = document.createElement('div');
    box.innerHTML = html;
    const next = box.querySelector('#c-live');
    const cur = live();
    if (!next || !cur) return;
    cur.replaceWith(next);
    version = next.getAttribute('data-v');
    skew = Number(next.getAttribute('data-now') || Date.now()) - Date.now();
    share();
    dirtyAt = 0;
    tickCountdowns();
    document.dispatchEvent(new Event('c-live-updated'));
  };
  const poll = async () => {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const res = await fetch(`/casino/t/${id}/poll`, { credentials: 'same-origin' });
      if (res.redirected || res.status === 401) {
        location.href = '/casino';
        return;
      }
      const j = await res.json();
      skew = j.now - Date.now();
      share();
      const changed = String(j.v) !== String(version);
      // 選んでいる途中なら 15 秒まで待つ（そのあいだに時間切れになれば、そのまま差し替え）
      if (changed && (Date.now() - dirtyAt > 15000 || !dirtyAt)) await refresh();
    } catch {
      // つながらないときは次にまた
    } finally {
      busy = false;
    }
  };
  setInterval(poll, 1500);
})();

// ───── 💡 ヒントの表示・📖 役の一覧の「今のあなた」・持ち時間のバー ─────
(() => {
  const KEY = 'casino-hints';
  const get = () => {
    try {
      return localStorage.getItem(KEY) !== 'off';
    } catch {
      return true;
    }
  };
  const apply = (on) => {
    document.body.classList.toggle('c-hints-off', !on);
    document.querySelectorAll('[data-hint-toggle]').forEach((b) => b.setAttribute('aria-pressed', on ? 'true' : 'false'));
  };
  apply(get());
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-hint-toggle]') : null;
    if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      // 覚えられなくても、この画面では切り替える
    }
    apply(on);
  });
  const mark = () => {
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
  };
  mark();
  setInterval(mark, 250);
})();

// ───── 🎡 ルーレットの盤: チップを選んでマスを押すと置ける。「回す」でまとめて送る ─────
(() => {
  const STORE = 'casino-rb-';
  // 盤ごとの置いた分（卓の画面が差し替わっても残す）
  const boards = new Map();
  const stateOf = (form) => {
    const key = form.getAttribute('action');
    if (!boards.has(key)) boards.set(key, { bets: new Map(), history: [], chip: 0 });
    return boards.get(key);
  };
  const fmt = (n) => n.toLocaleString('ja-JP');
  const paint = (form) => {
    const st = stateOf(form);
    const max = Number(form.dataset.max);
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
    void max;
  };
  const say = (form, text) => {
    const m = form.querySelector('[data-rb-msg]');
    if (m) m.textContent = text;
  };
  const changed = (form) => {
    paint(form);
    // 卓の画面の差し替えを少し待ってもらう
    form.dispatchEvent(new Event('input', { bubbles: true }));
  };
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const form = t?.closest('form[data-rb]');
    if (!form) return;
    const st = stateOf(form);
    const max = Number(form.dataset.max);
    const spots = Number(form.dataset.spots);
    const chip = t.closest('[data-chip]');
    if (chip) {
      st.chip = Number(chip.getAttribute('data-chip'));
      paint(form);
      return;
    }
    const cell = t.closest('.c-rb-cell');
    if (cell && !cell.disabled) {
      const bet = cell.getAttribute('data-bet');
      const cur = st.bets.get(bet) || 0;
      if (!cur && st.bets.size >= spots) return say(form, `置けるのは ${spots} か所までです`);
      const next = Math.min(max, cur + st.chip);
      if (next === cur) return say(form, `1 か所に置けるのは ${fmt(max)} までです`);
      st.history.push([bet, cur]);
      st.bets.set(bet, next);
      say(form, '');
      return changed(form);
    }
    if (t.closest('[data-rb-undo]')) {
      const last = st.history.pop();
      if (last) {
        if (last[1]) st.bets.set(last[0], last[1]);
        else st.bets.delete(last[0]);
      }
      return changed(form);
    }
    if (t.closest('[data-rb-clear]')) {
      st.bets.clear();
      st.history = [];
      return changed(form);
    }
    if (t.closest('[data-rb-double]')) {
      for (const [k, v] of st.bets) st.bets.set(k, Math.min(max, v * 2));
      st.history = [];
      return changed(form);
    }
    if (t.closest('[data-rb-repeat]')) {
      let saved = '';
      try {
        saved = localStorage.getItem(STORE + form.dataset.rb) || '';
      } catch {
        saved = '';
      }
      if (!saved) return say(form, 'まだ前回の賭けがありません');
      st.bets = new Map(saved.split(',').filter(Boolean).map((p) => [p.split(':')[0], Math.min(max, Number(p.split(':')[1]))]));
      st.history = [];
      return changed(form);
    }
  });
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-rb]')) return;
    const st = stateOf(form);
    if (!st.bets.size) {
      e.preventDefault();
      return;
    }
    try {
      localStorage.setItem(STORE + form.dataset.rb, form.querySelector('[data-rb-bets]').value);
    } catch {
      // 覚えられなくても送る
    }
    // 送ったら空にする（戻ってきたときに二重にならないように）
    boards.delete(form.getAttribute('action'));
  }, true);
  const all = () => document.querySelectorAll('form[data-rb]').forEach(paint);
  all();
  document.addEventListener('c-live-updated', all);
})();

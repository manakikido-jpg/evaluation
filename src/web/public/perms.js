// 🧮 チャンネル権限のマトリクス: マスを押すと 中立 → 許可 → 拒否 と変える。出す列はこのブラウザに覚える。
// 🖱 ホイールで変える（ボタンで ON/OFF。このブラウザに覚える）: マスの上で回すと変わり、止めて少したったら保存する。
// 変えたものは 1 つずつ順番に送る（同時に送ると、あとの変更が前の変更を消してしまうことがあるため）
(() => {
  const root = document.querySelector('[data-pm]');
  const MAIN = [1, 6, 7, 11, 12, 15, 18, 20, 21, 22, 23, 24, 25, 26];
  const KEY = 'pm-cols';
  const NEXT = { neutral: 'allow', allow: 'deny', deny: 'neutral' };
  const MARK = { allow: '✓', deny: '✕', neutral: '-' };
  const LABEL = { allow: '許可', deny: '拒否', neutral: '中立' };
  const ORDER = ['neutral', 'allow', 'deny'];
  /** マスの見た目を変える。saved: Discord に入った値（まだ送っていないときは false） */
  const paint = (cell, v, saved = true) => {
    if (!cell.hasAttribute('data-saved')) cell.setAttribute('data-saved', cell.getAttribute('data-cell') || 'neutral');
    cell.setAttribute('data-cell', v);
    if (saved) cell.setAttribute('data-saved', v);
    cell.className = `pm-cell ${v}${cell.getAttribute('data-saved') === v ? '' : ' pending'}`;
    cell.textContent = MARK[v];
    cell.title = (cell.title || '').replace(/[^:]*$/, ` ${LABEL[v]}`);
  };

  // ───────── 送るのは 1 つずつ順番に ─────────
  let chain = Promise.resolve();
  let busy = 0;
  const enqueue = (fn) => {
    busy++;
    const run = chain.then(fn).catch(() => undefined).finally(() => busy--);
    chain = run;
    return run;
  };
  /** まだ送っていないマス（マス → タイマー） */
  const waiting = new Map();
  const statusEl = () => document.querySelector('[data-pm-status]');
  /** マスの今の見た目の値を送る（Discord に入っている値と同じなら送らない） */
  const send = (cell) =>
    enqueue(async () => {
      const want = cell.getAttribute('data-cell');
      if (want === cell.getAttribute('data-saved')) return paint(cell, want);
      const status = statusEl();
      try {
        const res = await fetch('/channels/perms/cell', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': root.getAttribute('data-csrf') || '' },
          body: new URLSearchParams({ _csrf: root.getAttribute('data-csrf') || '', channel: cell.getAttribute('data-ch'), role: cell.getAttribute('data-role') || root.getAttribute('data-role'), bit: cell.getAttribute('data-bit'), cell: want }),
        });
        const r = await res.json().catch(() => ({ ok: false }));
        if (!r.ok) throw new Error(r.error || 'failed');
        cell.setAttribute('data-saved', r.cell);
        // 送っている間にもっと回したときは、見た目はそのまま（あとでもう一度送る）
        if (cell.getAttribute('data-cell') === want) paint(cell, r.cell);
        if (status) status.textContent = `保存しました（${LABEL[r.cell]}）`;
      } catch {
        // 送れなかったら、Discord に入っている値に戻す
        clearTimeout(waiting.get(cell));
        waiting.delete(cell);
        paint(cell, cell.getAttribute('data-saved') || 'neutral');
        if (status) status.textContent = '変えられませんでした（BOT が持っていない権限は許可できません）。ページを読み直してください。';
      }
    });
  /** 見た目を先に変えて、delay ミリ秒さわらなければ送る */
  const change = (cell, v, delay) => {
    paint(cell, v, false);
    clearTimeout(waiting.get(cell));
    waiting.set(
      cell,
      setTimeout(() => {
        waiting.delete(cell);
        void send(cell);
      }, delay),
    );
  };
  // 送り終わる前に閉じようとしたら、知らせる
  window.addEventListener('beforeunload', (e) => {
    if (busy > 0 || waiting.size > 0) e.preventDefault();
  });

  // ───────── 🖱 ホイールで変える ─────────
  const WHEEL = 'pm-wheel';
  const wheelOn = () => document.body.classList.contains('pm-wheel-on');
  const setWheel = (on) => {
    document.body.classList.toggle('pm-wheel-on', on);
    for (const b of document.querySelectorAll('[data-pm-wheel]')) b.setAttribute('aria-pressed', String(on));
    try {
      localStorage.setItem(WHEEL, on ? '1' : '0');
    } catch {
      /* 覚えられなくても動く */
    }
  };
  try {
    if (localStorage.getItem(WHEEL) === '1') setWheel(true);
  } catch {
    /* はじめは OFF */
  }
  // トラックパッドは細かく何回も来るので、たまった量で 1 段ずつ
  let acc = 0;
  let accAt = 0;
  document.addEventListener(
    'wheel',
    (e) => {
      if (!wheelOn() || !(e.target instanceof Element)) return;
      const cell = e.target.closest('button.pm-cell[data-ch]');
      const sel = cell ? null : e.target.closest('select.pm-sel');
      if ((!cell || cell.disabled || !root) && !sel) return;
      e.preventDefault();
      const now = Date.now();
      if (now - accAt > 400) acc = 0;
      accAt = now;
      acc += e.deltaMode === 0 ? e.deltaY : e.deltaY * 40;
      if (Math.abs(acc) < 40) return;
      const step = acc > 0 ? 1 : -1;
      acc = 0;
      if (cell) {
        const i = ORDER.indexOf(cell.getAttribute('data-cell') || 'neutral');
        change(cell, ORDER[(i + step + ORDER.length) % ORDER.length], 700);
      } else if (sel) {
        const n = sel.options.length;
        sel.selectedIndex = (sel.selectedIndex + step + n) % n;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },
    { passive: false },
  );

  // テンプレートの選ぶ欄: 選んだ値で色を変える
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLSelectElement && t.classList.contains('pm-sel')) t.className = `pm-sel ${t.value}`;
  });

  // ───────── 列を選ぶ ─────────
  const boxes = () => [...document.querySelectorAll('[data-pm-col]')];
  const load = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      return Array.isArray(v) ? v.map(Number) : MAIN;
    } catch {
      return MAIN;
    }
  };
  const save = (cols) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cols));
    } catch {
      /* 覚えられなくても動く */
    }
  };
  const apply = (cols) => {
    const set = new Set(cols);
    for (const el of document.querySelectorAll('[data-pm-colno]')) el.hidden = !set.has(Number(el.getAttribute('data-pm-colno')));
    for (const b of boxes()) b.checked = set.has(Number(b.value));
    const n = document.querySelector('[data-pm-count]');
    if (n) n.textContent = `${set.size}/${boxes().length}`;
  };
  if (root) {
    apply(load());
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.hasAttribute('data-pm-col')) {
        const cols = boxes().filter((b) => b.checked).map((b) => Number(b.value));
        save(cols);
        apply(cols);
      }
    });
  }

  // ───────── 絞り込み（ロール・種類）はすぐ表示 ─────────
  const bar = document.querySelector('form[data-pm-autosubmit]');
  if (bar) {
    bar.addEventListener('change', (e) => {
      const t = e.target;
      if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && (t.type === 'radio' || t.type === 'checkbox') && !t.hasAttribute('data-pm-col'))) bar.submit();
    });
  }

  document.addEventListener('click', async (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    // クイック選択
    const quick = t.closest('[data-pm-quick]');
    if (quick && root) {
      const kind = quick.getAttribute('data-pm-quick');
      const all = boxes().map((b) => ({ no: Number(b.value), scope: b.getAttribute('data-scope') }));
      const cols =
        kind === 'all' ? all.map((x) => x.no) : kind === 'main' ? MAIN : kind === 'text' ? all.filter((x) => x.scope !== 'voice').map((x) => x.no) : kind === 'voice' ? all.filter((x) => x.scope !== 'text').map((x) => x.no) : [];
      save(cols);
      apply(cols);
      return;
    }
    // 列を選ぶ画面を閉じる
    if (t.closest('[data-pm-close]')) {
      t.closest('details')?.removeAttribute('open');
      return;
    }
    // カテゴリをたたむ・ひらく
    const fold = t.closest('[data-pm-fold]');
    if (fold) {
      const id = fold.getAttribute('data-pm-fold');
      const open = fold.getAttribute('aria-expanded') !== 'true';
      fold.setAttribute('aria-expanded', String(open));
      fold.textContent = open ? '▼' : '▶';
      for (const r of document.querySelectorAll(`[data-pm-parent="${id}"]`)) r.hidden = !open;
      return;
    }
    const foldAll = t.closest('[data-pm-foldall]');
    if (foldAll) {
      const close = foldAll.getAttribute('data-open') !== 'false';
      foldAll.setAttribute('data-open', String(!close));
      foldAll.textContent = close ? '📂 すべてひらく' : '📁 すべて折りたたみ';
      for (const f of document.querySelectorAll('[data-pm-fold]')) {
        f.setAttribute('aria-expanded', String(!close));
        f.textContent = close ? '▶' : '▼';
      }
      for (const r of document.querySelectorAll('[data-pm-parent]')) if (r.getAttribute('data-pm-parent')) r.hidden = close;
      return;
    }
    // 🖱 ホイールで変える（ON/OFF）
    if (t.closest('[data-pm-wheel]')) {
      setWheel(!wheelOn());
      return;
    }
    // ✏ まとめて変える（ボタンを出す・しまう）
    const mode = t.closest('[data-pm-bulkmode]');
    if (mode && root) {
      const on = root.classList.toggle('pm-bulk-on');
      mode.setAttribute('aria-pressed', String(on));
      return;
    }
    // 行（チャンネル）・列（権限）をまとめて変える
    const bulk = t.closest('[data-pm-rowset],[data-pm-colset]');
    if (bulk && root && !bulk.disabled) {
      const to = bulk.getAttribute('data-to');
      const shownCell = (b) => !b.closest('td')?.hidden && !b.closest('tr')?.hidden;
      let targets;
      if (bulk.hasAttribute('data-pm-rowset')) {
        const row = bulk.closest('tr');
        targets = row ? [...row.querySelectorAll('button.pm-cell[data-ch]')].filter(shownCell) : [];
      } else {
        targets = [...root.querySelectorAll(`button.pm-cell[data-bit="${bulk.getAttribute('data-pm-colset')}"]`)].filter(shownCell);
      }
      targets = targets.filter((b) => b.getAttribute('data-cell') !== to);
      const status = document.querySelector('[data-pm-status]');
      if (!targets.length) {
        if (status) status.textContent = `変わるところはありません（もう全部${LABEL[to]}です）。`;
        return;
      }
      if (!confirm(`${bulk.getAttribute('data-what')}「${LABEL[to]}」にします（${targets.length} マス）。すぐ Discord に反映されます。よろしいですか？`)) return;
      const body = new URLSearchParams({ _csrf: root.getAttribute('data-csrf') || '', role: root.getAttribute('data-role') || '', cell: to });
      for (const ch of new Set(targets.map((b) => b.getAttribute('data-ch')))) body.append('channels', ch);
      for (const bit of new Set(targets.map((b) => b.getAttribute('data-bit')))) body.append('bits', bit);
      for (const b of targets) b.disabled = true;
      if (status) status.textContent = `変えています…（${targets.length} マス）`;
      // 前に押したマスを送り終えてから（順番が入れかわらないように）
      for (const [b, timer] of waiting) {
        clearTimeout(timer);
        waiting.delete(b);
        void send(b);
      }
      await enqueue(async () => {
        try {
          const res = await fetch('/channels/perms/bulk', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': root.getAttribute('data-csrf') || '' },
            body,
          });
          const r = await res.json().catch(() => ({ ok: false, cells: [] }));
          const want = new Set(targets.map((b) => `${b.getAttribute('data-ch')}:${b.getAttribute('data-bit')}`));
          let n = 0;
          for (const x of r.cells || []) {
            if (!want.has(`${x.ch}:${x.bit}`)) continue;
            const b = root.querySelector(`button.pm-cell[data-ch="${x.ch}"][data-bit="${x.bit}"]`);
            if (b) {
              clearTimeout(waiting.get(b));
              waiting.delete(b);
              paint(b, x.cell);
              n++;
            }
          }
          if (status) status.textContent = r.ok ? `${n} マスを${LABEL[to]}にしました。` : `途中で Discord に断られました（${n} マスは変えました。BOT が持っていない権限は許可できません）。ページを読み直してください。`;
        } catch {
          if (status) status.textContent = '変えられませんでした。ページを読み直してください。';
        } finally {
          for (const b of targets) b.disabled = false;
        }
      });
      return;
    }
    // マスを押した
    const cell = t.closest('button.pm-cell[data-ch]');
    if (cell && root && !cell.disabled) {
      // 見た目をすぐ変えて、少しだけ待って送る（すばやく何回か押したら、最後の値を 1 回だけ送る）
      change(cell, NEXT[cell.getAttribute('data-cell')] || 'neutral', 250);
      return;
    }
    // 一括で当てる: チャンネルをまとめて選ぶ
    const check = t.closest('[data-pm-check]');
    if (check) {
      const kind = check.getAttribute('data-pm-check');
      for (const b of document.querySelectorAll('form[data-pm-apply] input[name="channels"]')) {
        const k = b.getAttribute('data-kind');
        if (kind === 'none') b.checked = false;
        else if (kind === 'all' || k === kind) b.checked = true;
      }
      return;
    }
    // テンプレート: 全部「変えない」に
    if (t.closest('[data-pm-tpl-reset]')) {
      for (const s of document.querySelectorAll('form.pm-tpl select[name^="p."]')) s.value = 'keep';
    }
  });

  // 一括で当てる: カテゴリにチェックすると中のチャンネルも
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.hasAttribute('data-cat')) return;
    for (const b of document.querySelectorAll(`input[data-in="${t.getAttribute('data-cat')}"]`)) b.checked = t.checked;
  });
})();

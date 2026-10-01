// 🧮 チャンネル権限のマトリクス: マスを押すと 中立 → 許可 → 拒否 と変える。出す列はこのブラウザに覚える
(() => {
  const root = document.querySelector('[data-pm]');
  const MAIN = [1, 6, 7, 11, 12, 15, 18, 20, 21, 22, 23, 24, 25, 26];
  const KEY = 'pm-cols';
  const NEXT = { neutral: 'allow', allow: 'deny', deny: 'neutral' };
  const MARK = { allow: '✓', deny: '✕', neutral: '-' };
  const LABEL = { allow: '許可', deny: '拒否', neutral: '中立' };

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
      if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type === 'radio')) bar.submit();
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
    // マスを押した
    const cell = t.closest('button.pm-cell[data-ch]');
    if (cell && root && !cell.disabled) {
      const next = NEXT[cell.getAttribute('data-cell')] || 'neutral';
      const status = document.querySelector('[data-pm-status]');
      cell.disabled = true;
      try {
        const res = await fetch('/channels/perms/cell', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': root.getAttribute('data-csrf') || '' },
          body: new URLSearchParams({ _csrf: root.getAttribute('data-csrf') || '', channel: cell.getAttribute('data-ch'), role: root.getAttribute('data-role'), bit: cell.getAttribute('data-bit'), cell: next }),
        });
        const r = await res.json().catch(() => ({ ok: false }));
        if (!r.ok) throw new Error(r.error || 'failed');
        cell.setAttribute('data-cell', r.cell);
        cell.className = `pm-cell ${r.cell}`;
        cell.textContent = MARK[r.cell];
        cell.title = (cell.title || '').replace(/[^:]*$/, ` ${LABEL[r.cell]}`);
        if (status) status.textContent = `保存しました（${LABEL[r.cell]}）`;
      } catch {
        if (status) status.textContent = '変えられませんでした（BOT が持っていない権限は許可できません）。ページを読み直してください。';
      } finally {
        cell.disabled = false;
      }
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

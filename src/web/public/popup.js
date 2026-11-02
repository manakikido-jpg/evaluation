// 詳細を元の画面から離れずに確認する。JSがないときは通常のリンクで開く。
(() => {
  const dialog = document.getElementById('popup');
  const body = document.getElementById('popup-body');
  const title = document.getElementById('popup-title');
  const full = dialog?.querySelector('[data-popup-full]');
  if (!(dialog instanceof HTMLDialogElement) || !body) return;
  let controller;
  let requestId = 0;
  dialog.addEventListener('close', () => {
    ++requestId;
    controller?.abort();
    body.replaceChildren();
    body.removeAttribute('aria-busy');
  });
  document.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target.closest('[data-popup]') : null;
    if (target) {
      const url = new URL(target.getAttribute('data-popup') || '', location.href);
      if (url.origin !== location.origin) return;
      event.preventDefault();
      controller?.abort();
      controller = new AbortController();
      const id = ++requestId;
      const heading = target.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) || '詳細を確認';
      if (title) title.textContent = heading;
      if (full) {
        const href = new URL(target.getAttribute('href') || url.href, location.href);
        full.hidden = href.origin !== location.origin;
        if (!full.hidden) full.href = href.href;
      }
      body.textContent = '読み込み中…';
      body.setAttribute('aria-busy', 'true');
      if (!dialog.open) dialog.showModal();
      try {
        const response = await fetch(url.href, { headers: { 'hx-request': 'true' }, credentials: 'same-origin', signal: controller.signal });
        if (id !== requestId || !dialog.open) return;
        if (!response.ok || response.redirected || response.headers.get('hx-redirect')) throw new Error('unavailable');
        const html = await response.text();
        if (id !== requestId || !dialog.open) return;
        // 同じ社務所が返したHTMLだけを表示（入力のエスケープ・権限確認はサーバー側）。
        body.innerHTML = html;
      } catch {
        if (id === requestId && dialog.open) body.textContent = '読み込めませんでした。「ページで開く」からログイン状態や接続を確認してください。';
      } finally {
        if (id === requestId) body.removeAttribute('aria-busy');
      }
      return;
    }
    if (event.target instanceof Element && event.target.closest('[data-popup-close]')) { dialog.close(); return; }
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    }
  });
})();

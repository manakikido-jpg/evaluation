(() => {
  'use strict';
  const main = document.getElementById('main-content');
  const search = document.getElementById('office-search');
  const outline = document.getElementById('office-outline');
  const input = search?.querySelector('[data-office-search-input]');
  if (!main || !(search instanceof HTMLDialogElement) || !(outline instanceof HTMLDialogElement) || !input) return;
  document.body.classList.add('office-desktop-ready');
  const dock = document.getElementById('office-dock');
  const dockToggle = dock?.querySelector('[data-office-dock-toggle]');
  const compactDock = compact => {
    if (!dock || !dockToggle) return;
    dock.dataset.compact = String(compact);
    dockToggle.setAttribute('aria-expanded', String(!compact));
    dockToggle.setAttribute('aria-label', compact ? '操作バーを開く' : '操作バーを小さくする');
    dockToggle.querySelector('span').textContent = compact ? '☷' : '−';
  };
  try { compactDock(localStorage.getItem('office-dock-compact') === '1'); } catch { /* 保存できない環境でも使える */ }
  dockToggle?.addEventListener('click', () => {
    const compact = dock.dataset.compact !== 'true';
    compactDock(compact);
    try { localStorage.setItem('office-dock-compact', compact ? '1' : '0'); } catch { /* その画面だけで使う */ }
  });
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase('ja').trim();
  const items = [...search.querySelectorAll('[data-office-search-item]')];
  const results = () => items.filter(item => !item.hidden);
  const filter = () => {
    const words = normalize(input.value).split(/\s+/).filter(Boolean);
    items.forEach(item => { item.hidden = !words.every(word => normalize(`${item.textContent} ${item.dataset.searchCategory || ''}`).includes(word)); });
    search.querySelectorAll('[data-office-search-group]').forEach(group => { group.hidden = ![...group.querySelectorAll('[data-office-search-item]')].some(item => !item.hidden); });
    const count = results().length;
    search.querySelector('[data-office-search-status]').textContent = count ? `${count}ページから選べます` : '見つかりません。別の言葉で探してください。';
  };
  const open = dialog => {
    if (document.querySelector('dialog[open]')) return false;
    // スマホの外付けキーボードでも、メニューとダイアログの焦点を競合させない。
    const toggle = document.getElementById('nav-toggle');
    if (toggle?.checked && matchMedia('(max-width: 900px)').matches) { toggle.checked = false; toggle.dispatchEvent(new Event('change')); }
    dialog.showModal();
    return true;
  };
  const openSearch = () => {
    if (search.open || open(search)) { filter(); input.focus(); input.select(); }
  };
  input.addEventListener('input', filter);
  search.addEventListener('keydown', event => {
    const list = results();
    if (event.isComposing || !list.length) return;
    const index = list.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // 閉じるボタンなどの操作には干渉しない。
      if (document.activeElement !== input && index < 0) return;
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? (index + 1) % list.length : index <= 0 ? list.length - 1 : index - 1;
      list[next].focus();
    } else if (event.key === 'Enter' && document.activeElement === input) { event.preventDefault(); list[0].click(); }
  });
  const jumpTo = heading => {
    let parent = heading.parentElement;
    while (parent && parent !== main) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const openOutline = () => {
    const list = outline.querySelector('[data-office-outline-list]');
    list.replaceChildren();
    // 開いていないdetailsの見出しも選べる。非表示の検索結果などは含めない。
    const headings = [...main.querySelectorAll('h2, h3')].filter(h => h.textContent.trim() && !h.closest('[hidden], [aria-hidden="true"]'));
    if (!headings.length) { const p = document.createElement('p'); p.textContent = 'この画面に見出しはありません。'; list.append(p); }
    for (const heading of headings) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = heading.textContent.trim();
      if (heading.tagName === 'H3') button.classList.add('office-outline-child');
      button.addEventListener('click', () => {
        outline.addEventListener('close', () => jumpTo(heading), { once: true });
        outline.close();
      });
      list.append(button);
    }
    open(outline);
  };
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-office-search-open]')) openSearch();
    if (event.target.closest('[data-office-outline-open]')) openOutline();
    if (event.target.closest('[data-office-top]')) jumpTo(main.querySelector('h1') || main);
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    const current = document.querySelector('dialog[open]');
    if (current && current !== search) return;
    event.preventDefault(); openSearch();
  });
  for (const dialog of [search, outline]) dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
})();

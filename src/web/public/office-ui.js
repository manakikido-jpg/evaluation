// 社務所の共通操作。表示するリンクはサーバー側で権限を確認したものだけ。
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('nav-toggle');
  const side = document.getElementById('main-navigation');
  const main = document.getElementById('main-content');
  const mobileNav = document.querySelector('.mobile-nav');
  if (!(toggle instanceof HTMLInputElement) || !side || !main) return;
  const media = matchMedia('(min-width: 901px)');
  const buttons = [...document.querySelectorAll('[data-nav-toggle]')];
  const search = side.querySelector('[data-nav-search]');
  const status = side.querySelector('[data-nav-status]');
  let returnFocus;
  let mobileOpen = false;
  const focusable = () => [...side.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),summary')].filter(el => el.getClientRects().length && !el.closest('[hidden]'));
  const sync = () => {
    const open = !media.matches && toggle.checked;
    buttons.forEach(button => button.setAttribute('aria-expanded', String(media.matches ? !toggle.checked : open)));
    side.inert = media.matches ? toggle.checked : !open;
    main.inert = open;
    if (mobileNav) mobileNav.inert = open;
    document.body.classList.toggle('nav-is-open', open);
    if (open && !mobileOpen) {
      returnFocus = document.activeElement;
      side.querySelector('[data-nav-close]')?.focus();
    } else if (!open && mobileOpen && returnFocus instanceof HTMLElement && returnFocus.isConnected) {
      returnFocus.focus();
    }
    mobileOpen = open;
  };
  const set = checked => { toggle.checked = checked; toggle.dispatchEvent(new Event('change')); };
  buttons.forEach(button => button.addEventListener('click', () => set(!toggle.checked)));
  side.querySelector('[data-nav-close]')?.addEventListener('click', () => set(false));
  toggle.addEventListener('change', sync);
  window.addEventListener('pageshow', sync);
  media.addEventListener('change', () => {
    let collapsed = false;
    try { collapsed = localStorage.getItem('side-collapsed') === '1'; } catch { /* 記憶なしでも使える */ }
    set(media.matches ? collapsed : false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !media.matches && mobileOpen) { event.preventDefault(); set(false); sync(); }
    if (event.key === 'Tab' && mobileOpen) {
      const all = focusable();
      if (!all.length) return;
      const first = all[0], last = all[all.length - 1];
      if (event.shiftKey && (document.activeElement === first || !side.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !side.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  });
  // 以前のEscape処理がチェックを先に外した場合も焦点を戻す。
  document.addEventListener('keyup', event => { if (event.key === 'Escape') sync(); });
  sync();

  if (search instanceof HTMLInputElement) {
    search.disabled = false;
    const groups = [...side.querySelectorAll('details[data-group]')];
    let savedOpen = null;
    const normal = value => value.normalize('NFKC').toLocaleLowerCase('ja').trim();
    const filter = () => {
      const words = normal(search.value).split(/\s+/).filter(Boolean);
      if (words.length && !savedOpen) savedOpen = groups.map(group => group.open);
      let matches = 0;
      groups.forEach((group, index) => {
        const links = [...group.querySelectorAll('.nav-items a')];
        links.forEach(link => { link.hidden = !words.every(word => normal(link.textContent).includes(word)); if (!link.hidden) matches++; });
        group.hidden = words.length > 0 && links.every(link => link.hidden);
        if (words.length) group.open = true;
        else if (savedOpen) group.open = savedOpen[index];
      });
      // 検索のために開閉した状態は通常の折りたたみの記憶へ書き込まない。
      side.dataset.filtering = words.length || savedOpen ? 'true' : 'false';
      if (!words.length) { savedOpen = null; setTimeout(() => { side.dataset.filtering = 'false'; }, 0); }
      if (status) status.textContent = words.length ? matches ? `${matches}ページ見つかりました` : '見つかりません。別の言葉で探してください。' : '';
    };
    search.addEventListener('input', filter);
    document.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      set(!media.matches);
      search.focus(); search.select();
    });
  }

  // 横長の表だけに、キーボードで動かせる横スクロール枠と案内を付ける。
  const scrolls = new Map();
  const measure = () => scrolls.forEach((hint, box) => {
    const over = box.scrollWidth > box.clientWidth + 2;
    box.tabIndex = over ? 0 : -1;
    hint.hidden = !over;
  });
  const resize = new ResizeObserver(measure);
  const tables = () => {
    main.querySelectorAll('table').forEach(table => {
      if (table.closest('.admin-table-scroll')) return;
      let box = table.closest('.table-wrap,.guide-table,.table-scroll,.table-overflow');
      if (!box) { box = document.createElement('div'); table.before(box); box.append(table); }
      box.classList.add('admin-table-scroll');
      box.setAttribute('role', 'region');
      box.setAttribute('aria-label', '表（横にスクロールできます）');
      const hint = document.createElement('p'); hint.className = 'table-scroll-hint'; hint.textContent = '↔ 横にスクロールして続きを確認できます'; hint.hidden = true;
      box.before(hint); scrolls.set(box, hint); resize.observe(box);
    });
    scrolls.forEach((hint, box) => { if (!box.isConnected) { resize.unobserve(box); scrolls.delete(box); } });
    measure();
  };
  tables();
  document.addEventListener('htmx:afterSwap', tables);
});

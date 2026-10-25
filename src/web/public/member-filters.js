// メンバー一覧のロール絞り込み。実際のメンバーのロールは変更しない。
(() => {
  if (window.memberRoleFiltersReady) return;
  window.memberRoleFiltersReady = true;
  const initialized = new WeakSet();
  const boxes = root => [...root.querySelectorAll('input[name="roles"]')];
  const count = root => {
    const n = boxes(root).filter(input => input.checked).length;
    root.querySelector('[data-member-role-summary]').textContent = n ? `${n} こ選択中` : 'すべて';
    root.querySelector('[data-member-role-count]').textContent = `${n}こ選択中`;
  };
  const position = root => {
    if (!root.open) return;
    const panel = root.querySelector('.member-role-popover');
    const anchor = root.querySelector('summary').getBoundingClientRect();
    const margin = 12, gap = 8;
    const viewport = window.visualViewport;
    const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
    const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
    panel.style.maxHeight = `${Math.max(80, height - margin * 2)}px`;
    const size = panel.getBoundingClientRect();
    let top = anchor.bottom + gap;
    if (anchor.bottom < y || anchor.top > y + height) top = parseFloat(panel.style.top) || margin;
    else if (top + size.height > y + height - margin) top = anchor.top - size.height - gap;
    panel.style.top = `${Math.max(y + margin, Math.min(top, y + height - margin - size.height))}px`;
    panel.style.left = `${Math.max(x + margin, Math.min(anchor.left, x + width - margin - size.width))}px`;
  };
  const close = (root, focus = false) => {
    root.open = false;
    if (focus) root.querySelector('summary').focus();
  };
  const init = () => document.querySelectorAll('.member-role-filter').forEach(root => {
    if (initialized.has(root)) return;
    initialized.add(root);
    root.classList.add('member-role-floating');
    root.querySelector('[data-member-role-close]').hidden = false;
    const search = root.querySelector('[data-member-role-search]');
    search.closest('label').hidden = false;
    const searchRows = () => {
      const q = search.value.normalize('NFKC').trim().toLocaleLowerCase('ja');
      root.querySelectorAll('.office-multi-options label').forEach(row => { row.hidden = !row.textContent.normalize('NFKC').toLocaleLowerCase('ja').includes(q); });
    };
    search.addEventListener('input', event => { event.stopPropagation(); searchRows(); });
    search.addEventListener('change', event => event.stopPropagation());
    root.addEventListener('change', event => { if (event.target.matches('input[name="roles"]')) count(root); });
    root.addEventListener('toggle', () => { if (root.open) position(root); });
    root.querySelector('[data-member-role-close]').addEventListener('click', () => close(root, true));
    root.querySelector('[data-member-role-reset]').addEventListener('click', event => {
      event.preventDefault();
      boxes(root).forEach(input => { input.checked = false; });
      search.value = ''; searchRows(); count(root);
      // 条件をまとめて変更したあと、検索は1回だけ。ほかの条件は触らない。
      root.closest('form').dispatchEvent(new Event('change', { bubbles: true }));
    });
    searchRows(); count(root); position(root);
  });
  document.addEventListener('pointerdown', event => {
    document.querySelectorAll('.member-role-filter[open]').forEach(root => { if (!root.contains(event.target)) close(root); });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const opened = [...document.querySelectorAll('.member-role-filter[open]')];
    if (opened.length) { event.preventDefault(); opened.forEach(root => close(root, true)); }
  });
  window.addEventListener('resize', () => document.querySelectorAll('.member-role-filter[open]').forEach(position));
  window.visualViewport?.addEventListener('resize', () => document.querySelectorAll('.member-role-filter[open]').forEach(position));
  window.visualViewport?.addEventListener('scroll', () => document.querySelectorAll('.member-role-filter[open]').forEach(position));
  document.addEventListener('office:updated', init);
  document.addEventListener('htmx:historyRestore', () => {
    init();
    const selected = new Set(new URLSearchParams(location.search).getAll('roles'));
    document.querySelectorAll('.member-role-filter').forEach(root => { boxes(root).forEach(input => { input.checked = selected.has(input.value); }); count(root); position(root); });
  });
  init();
})();

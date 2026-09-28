// ☰ メニュー: パソコンでは閉じたかどうかを覚える（スマホは毎回閉じた状態から）
(() => {
  const toggle = document.getElementById('nav-toggle');
  if (!(toggle instanceof HTMLInputElement)) return;
  const wide = () => window.matchMedia('(min-width: 901px)').matches;
  try {
    if (wide() && localStorage.getItem('side-collapsed') === '1') toggle.checked = true;
  } catch {
    // 覚えられなくても動く
  }
  toggle.addEventListener('change', () => {
    if (!wide()) return;
    try {
      localStorage.setItem('side-collapsed', toggle.checked ? '1' : '0');
    } catch {
      // そのまま
    }
  });
  // スマホで開いたメニューは Esc で閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !wide()) toggle.checked = false;
  });
  // 戻るボタンで戻ったとき、スマホのメニューは閉じておく
  window.addEventListener('pageshow', () => {
    if (!wide()) toggle.checked = false;
  });
})();

// 左のメニューの仲間（見る・メンバー対応 など）は見出しで折りたためる。閉じた仲間を覚える（今いるページの仲間は開く）
document.addEventListener('DOMContentLoaded', () => {
  const KEY = 'nav-closed';
  let closed = [];
  try {
    closed = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(closed)) closed = [];
  } catch {
    closed = [];
  }
  const groups = document.querySelectorAll('details.nav-group[data-group]');
  groups.forEach((d) => {
    if (!(d instanceof HTMLDetailsElement)) return;
    const name = d.dataset.group || '';
    if (closed.includes(name) && !d.querySelector('a.on')) d.open = false;
    d.addEventListener('toggle', () => {
      const set = new Set(closed);
      if (d.open) set.delete(name);
      else set.add(name);
      closed = [...set];
      try {
        localStorage.setItem(KEY, JSON.stringify(closed));
      } catch {
        // 覚えられなくても動く
      }
    });
  });
});

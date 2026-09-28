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

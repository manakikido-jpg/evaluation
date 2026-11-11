// ❓ 各ページの「このページの使い方」を出す・隠す（「💡」ボタン）。ブラウザごとに覚える（保存できないときは毎回出す）
(() => {
  const KEY = 'officeHints';
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* 保存できなくても続ける */ } };
  const apply = (off) => {
    if (off) document.documentElement.setAttribute('data-hints', 'off');
    else document.documentElement.removeAttribute('data-hints');
    document.querySelectorAll('[data-hints-toggle]').forEach((b) => b.setAttribute('aria-pressed', off ? 'false' : 'true'));
  };
  // 読みこみの最初に決めて、ちらつかないようにする
  apply(read() === 'off');
  document.addEventListener('DOMContentLoaded', () => apply(read() === 'off'));
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-hints-toggle]') : null;
    if (!b) return;
    const off = document.documentElement.getAttribute('data-hints') !== 'off';
    write(off ? 'off' : 'on');
    apply(off);
    // 出したときは、このページの使い方を開いて見せる
    if (!off) document.querySelector('[data-page-hint]')?.setAttribute('open', '');
  });
})();

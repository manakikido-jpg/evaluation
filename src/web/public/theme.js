/* 表示色はこの端末だけで覚える。描画の前に反映して色のちらつきを抑える。 */
(() => {
  'use strict';
  const KEY = 'shamusho-theme';
  const valid = value => ['light', 'dark', 'auto'].includes(value) ? value : 'auto';
  const root = document.documentElement;
  let mode = 'auto';
  try { mode = valid(localStorage.getItem(KEY)); } catch { /* 保存できなくても切り替えは使える */ }
  let media;
  try { media = window.matchMedia('(prefers-color-scheme: dark)'); } catch { /* 端末設定が読めなければライト */ }
  const apply = () => {
    root.dataset.theme = mode === 'auto' ? (media && media.matches ? 'dark' : 'light') : mode;
    document.querySelectorAll('[data-theme-choice]').forEach(select => { select.value = mode; });
  };
  apply();
  const changed = () => { if (mode === 'auto') apply(); };
  if (media && media.addEventListener) media.addEventListener('change', changed);
  else if (media && media.addListener) media.addListener(changed);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-choice]').forEach(select => {
      select.disabled = false;
      select.value = mode;
      select.addEventListener('change', () => {
        mode = valid(select.value);
        apply();
        let message = '表示モードを保存しました。';
        try { localStorage.setItem(KEY, mode); } catch { message = '表示は切り替えました。この端末では保存できません。'; }
        document.querySelectorAll('[data-theme-status]').forEach(status => { status.textContent = message; });
      });
    });
  });
  window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) { mode = valid(event.newValue); apply(); } });
})();

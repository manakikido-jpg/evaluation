// 咲楽ノ宮カジノ: 確かめてから送る・2 回押しを防ぐ（ページの中にスクリプトは書けないので、ここに置く）
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('.c-confirm') : null;
  if (b && !window.confirm(b.getAttribute('data-confirm') || 'よろしいですか？')) e.preventDefault();
});
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || form.dataset.sent === '1') {
    if (form instanceof HTMLFormElement) e.preventDefault();
    return;
  }
  form.dataset.sent = '1';
  // 押したボタンの値を送ってから、押せなくする
  setTimeout(() => form.querySelectorAll('button').forEach((x) => { x.disabled = true; }), 0);
});
// 戻るボタンで戻ってきたときは、また押せるように
window.addEventListener('pageshow', () => {
  document.querySelectorAll('form[data-sent]').forEach((f) => {
    delete f.dataset.sent;
    f.querySelectorAll('button').forEach((x) => { x.disabled = false; });
  });
});

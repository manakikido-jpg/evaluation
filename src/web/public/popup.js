// ポップアップ: data-popup="URL" の付いたものを押すと、その URL の中身を画面の上に出す
// （JS が動かないときは、ふつうのリンクとして href のページを開く）
(() => {
  const dialog = document.getElementById('popup');
  const body = document.getElementById('popup-body');
  if (!(dialog instanceof HTMLDialogElement) || !body) return;
  document.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-popup]') : null;
    if (target) {
      e.preventDefault();
      body.textContent = '読み込み中…';
      dialog.showModal();
      try {
        const res = await fetch(target.getAttribute('data-popup') || '', { headers: { 'hx-request': 'true' }, credentials: 'same-origin' });
        if (!res.ok) throw new Error(String(res.status));
        // 中身は社務所Web が作った HTML（入力はエスケープ済み）
        body.innerHTML = await res.text();
      } catch {
        body.textContent = '読み込めませんでした。もう一度お試しください。';
      }
      return;
    }
    // 閉じるボタン・外側（うしろの暗いところ）を押したら閉じる
    if ((e.target instanceof Element && e.target.closest('[data-popup-close]')) || e.target === dialog) dialog.close();
  });
})();

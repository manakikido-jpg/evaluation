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

// ───── みんなで座る卓: 1.5 秒ごとに変わったか確かめて、変わっていたら中身だけ差し替える ─────
(() => {
  const live = () => document.getElementById('c-live');
  const el = live();
  if (!el) return;
  const id = el.dataset.table;
  let version = el.dataset.v;
  // サーバーとの時計のずれ
  let skew = Number(el.dataset.now || Date.now()) - Date.now();
  // 選んでいる途中（カードを選んだ・数を入れている）は差し替えを少し待つ
  let dirtyAt = 0;
  document.addEventListener('input', (e) => {
    if (live()?.contains(e.target)) dirtyAt = Date.now();
  });
  const tickCountdowns = () => {
    document.querySelectorAll('[data-deadline]').forEach((n) => {
      const left = Math.max(0, Math.ceil((Number(n.getAttribute('data-deadline')) - (Date.now() + skew)) / 1000));
      const b = n.querySelector('b');
      if (b) b.textContent = String(left);
      n.classList.toggle('soon', left <= 5);
    });
  };
  setInterval(tickCountdowns, 250);
  let busy = false;
  const refresh = async () => {
    const res = await fetch(`/casino/t/${id}/frag`, { headers: { accept: 'text/html' }, credentials: 'same-origin' });
    if (res.status !== 200) return;
    const html = await res.text();
    const box = document.createElement('div');
    box.innerHTML = html;
    const next = box.querySelector('#c-live');
    const cur = live();
    if (!next || !cur) return;
    cur.replaceWith(next);
    version = next.getAttribute('data-v');
    skew = Number(next.getAttribute('data-now') || Date.now()) - Date.now();
    dirtyAt = 0;
    tickCountdowns();
  };
  const poll = async () => {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const res = await fetch(`/casino/t/${id}/poll`, { credentials: 'same-origin' });
      if (res.redirected || res.status === 401) {
        location.href = '/casino';
        return;
      }
      const j = await res.json();
      skew = j.now - Date.now();
      const changed = String(j.v) !== String(version);
      // 選んでいる途中なら 15 秒まで待つ（そのあいだに時間切れになれば、そのまま差し替え）
      if (changed && (Date.now() - dirtyAt > 15000 || !dirtyAt)) await refresh();
    } catch {
      // つながらないときは次にまた
    } finally {
      busy = false;
    }
  };
  setInterval(poll, 1500);
})();

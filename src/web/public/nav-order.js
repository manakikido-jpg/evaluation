// 🧭 メニューの並び方: ページをドラッグ＆ドロップで並べ替え・カテゴリへ移す。カテゴリの名前を変える。最後に保存する。
(() => {
  const root = document.querySelector('.nav-order-app');
  if (!root) return;
  const data = JSON.parse(root.dataset.nav);
  const csrf = root.dataset.csrf;
  const info = new Map(data.catalog.map(i => [i.key, i]));
  // 並びにないページは、もとのカテゴリへ足しておく
  let groups = data.groups.map(g => ({ title: g.title, keys: g.keys.filter(k => info.has(k)) }));
  const used = new Set(groups.flatMap(g => g.keys));
  for (const i of data.catalog) if (!used.has(i.key)) { (groups.find(g => g.title === i.group) ?? groups[groups.length - 1] ?? (groups.push({ title: i.group, keys: [] }), groups[0])).keys.push(i.key); }
  let dirty = false;
  let dragKey = null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const btn = (label, title, fn) => { const b = el('button', 'org-btn', label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); return b; };
  const status = el('p', 'org-status'); status.setAttribute('role', 'status');
  const changed = () => { dirty = true; status.textContent = 'まだ保存していません。'; render(); };
  function moveTo(key, gi, index) {
    for (const g of groups) { const i = g.keys.indexOf(key); if (i >= 0) { g.keys.splice(i, 1); if (g === groups[gi] && i < index) index--; } }
    groups[gi].keys.splice(Math.max(0, Math.min(index, groups[gi].keys.length)), 0, key);
    changed();
  }
  async function save() {
    status.textContent = '保存しています…';
    try {
      const r = await fetch('/nav-order', { method: 'POST', body: new URLSearchParams({ _csrf: csrf, data: JSON.stringify({ groups }) }), headers: { 'x-csrf-token': csrf } });
      if (!r.ok) throw new Error(await r.text());
      dirty = false; status.textContent = '保存しました。ほかのページを開くと、新しい並びになります。';
    } catch (e) { status.textContent = '保存できませんでした: ' + (e.message || e); }
  }
  addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
  function render() {
    root.replaceChildren();
    const bar = el('div', 'org-bar');
    bar.append(btn('💾 保存する', '保存する', save), btn('＋ カテゴリを足す', 'カテゴリを足す', () => { const t = prompt('カテゴリの名前', '新しいカテゴリ'); if (t?.trim()) { groups.push({ title: t.trim().slice(0, 20), keys: [] }); changed(); } }), status);
    root.append(bar);
    const cols = el('div', 'nav-order-cols');
    groups.forEach((g, gi) => {
      const col = el('section', 'nav-order-col card');
      const head = el('div', 'org-node-head');
      const title = el('input', 'nav-order-title'); title.value = g.title; title.maxLength = 20; title.setAttribute('aria-label', 'カテゴリの名前');
      title.addEventListener('change', () => { if (title.value.trim()) { g.title = title.value.trim(); dirty = true; status.textContent = 'まだ保存していません。'; } });
      head.append(title, el('span', 'org-tools'));
      head.lastChild.append(
        btn('←', 'カテゴリを前へ', () => { if (gi > 0) { [groups[gi - 1], groups[gi]] = [groups[gi], groups[gi - 1]]; changed(); } }),
        btn('→', 'カテゴリを後ろへ', () => { if (gi < groups.length - 1) { [groups[gi + 1], groups[gi]] = [groups[gi], groups[gi + 1]]; changed(); } }),
        btn('🗑', 'カテゴリを消す', () => {
          if (groups.length <= 1) return alert('カテゴリは 1 つ以上必要です。');
          if (g.keys.length && !confirm(`「${g.title}」を消しますか？（中のページは、ひとつ前のカテゴリへ移ります）`)) return;
          const to = groups[gi === 0 ? 1 : gi - 1]; to.keys.push(...g.keys); groups.splice(gi, 1); changed();
        }));
      col.append(head);
      const ul = el('ul', 'nav-order-list');
      g.keys.forEach((k, ki) => {
        const it = info.get(k);
        const li = el('li', 'org-side-item', `${it.icon} ${it.label}${it.gujiOnly ? '（宮司だけ）' : ''}`);
        li.draggable = true;
        li.addEventListener('dragstart', (e) => { dragKey = k; e.dataTransfer.setData('text/plain', k); });
        li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('org-over'); });
        li.addEventListener('dragleave', () => li.classList.remove('org-over'));
        li.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); li.classList.remove('org-over'); if (dragKey && dragKey !== k) moveTo(dragKey, gi, ki); dragKey = null; });
        // キーボード・スマホ向け: 上下ボタン
        li.append(el('span', 'org-tools'));
        li.lastChild.append(btn('↑', '上へ', () => moveTo(k, gi, ki - 1)), btn('↓', '下へ', () => moveTo(k, gi, ki + 2)));
        ul.append(li);
      });
      // カテゴリの空いたところに落とすと、いちばん後ろへ
      col.addEventListener('dragover', (e) => e.preventDefault());
      col.addEventListener('drop', (e) => { e.preventDefault(); if (dragKey) moveTo(dragKey, gi, g.keys.length); dragKey = null; });
      col.append(ul);
      cols.append(col);
    });
    root.append(cols);
  }
  render();
})();

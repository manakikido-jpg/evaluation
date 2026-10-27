// 🏯 組織図: 左の人を部署へドラッグ＆ドロップで置く。部署・段階の名前を変える。最後に保存する。
(() => {
  const root = document.querySelector('.org-app');
  if (!root) return;
  const data = JSON.parse(root.dataset.org);
  const csrf = root.dataset.csrf;
  const edit = data.canEdit;
  let chart = data.chart;
  let dirty = false;
  const names = { ...data.names };
  for (const g of data.groups) for (const m of g.members) names[m.id] = m.name;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const btn = (label, title, fn) => { const b = el('button', 'org-btn', label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); return b; };
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const rankName = (id) => chart.ranks.find(r => r.id === id)?.name ?? '';
  const changed = () => { dirty = true; render(); };

  // ───── 置く・動かす ─────
  function place(memberId, nodeId, fromNode) {
    if (fromNode === nodeId) return;
    if (fromNode) chart.placements = chart.placements.filter(p => !(p.memberId === memberId && p.nodeId === fromNode));
    if (chart.placements.some(p => p.memberId === memberId && p.nodeId === nodeId)) return changed();
    chart.placements.push({ memberId, nodeId, rankId: chart.ranks[chart.ranks.length - 1].id });
    changed();
  }
  function dropZone(target, nodeId) {
    if (!edit) return;
    target.addEventListener('dragover', (e) => { e.preventDefault(); target.classList.add('org-over'); });
    target.addEventListener('dragleave', () => target.classList.remove('org-over'));
    target.addEventListener('drop', (e) => {
      e.preventDefault(); target.classList.remove('org-over');
      try { const d = JSON.parse(e.dataTransfer.getData('text/plain')); if (/^\d{17,20}$/.test(d.memberId)) place(d.memberId, nodeId, d.fromNode); } catch { /* ほかのものを落とした */ }
    });
  }
  function draggable(node, memberId, fromNode) {
    if (!edit) return;
    node.draggable = true;
    node.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ memberId, fromNode })); e.dataTransfer.effectAllowed = 'move'; });
  }

  // ───── 部署（木） ─────
  function nodeBox(n) {
    const li = el('li');
    const box = el('div', 'org-node');
    const head = el('div', 'org-node-head');
    head.append(el('strong', '', n.name));
    if (edit) {
      const tools = el('span', 'org-tools');
      tools.append(
        btn('＋', '下に部署を足す', () => { const name = prompt('新しい部署の名前', '新しい部署'); if (name?.trim()) { chart.nodes.push({ id: newId('n'), name: name.trim().slice(0, 30), parentId: n.id, pages: [] }); changed(); } }),
        btn('✎', '名前を変える', () => { const name = prompt('部署の名前', n.name); if (name?.trim()) { n.name = name.trim().slice(0, 30); changed(); } }),
        btn('←', '前へ', () => move(n, -1)),
        btn('→', '後ろへ', () => move(n, 1)),
        btn('⤴', 'ひとつ上の部署へ移す', () => { const parent = chart.nodes.find(x => x.id === n.parentId); if (parent) { n.parentId = parent.parentId; changed(); } }),
        btn('🗑', '消す（下の部署も一緒に消える）', () => { if (confirm(`「${n.name}」と、その下の部署を消しますか？（置いた人は外れます）`)) { remove(n.id); changed(); } }),
      );
      head.append(tools);
    }
    box.append(head);
    const people = el('ul', 'org-people');
    const here = chart.placements.filter(p => p.nodeId === n.id).sort((a, b) => chart.ranks.findIndex(r => r.id === a.rankId) - chart.ranks.findIndex(r => r.id === b.rankId));
    for (const p of here) {
      const chip = el('li', 'org-chip');
      draggable(chip, p.memberId, n.id);
      if (edit) {
        const sel = el('select', 'org-rank');
        sel.setAttribute('aria-label', `${names[p.memberId] ?? p.memberId} の段階`);
        for (const r of chart.ranks) { const o = el('option', '', r.name); o.value = r.id; o.selected = r.id === p.rankId; sel.append(o); }
        sel.addEventListener('change', () => { p.rankId = sel.value; changed(); });
        chip.append(sel);
      } else chip.append(el('span', 'org-rank-label', rankName(p.rankId)));
      chip.append(el('span', 'org-name', names[p.memberId] ?? p.memberId));
      if (edit) chip.append(btn('×', 'この部署から外す', () => { chart.placements = chart.placements.filter(x => x !== p); changed(); }));
      people.append(chip);
    }
    if (!here.length) people.append(el('li', 'org-empty', edit ? 'ここへ人をドロップ' : 'まだいません'));
    box.append(people);
    if (n.pages.length || edit) {
      const det = el('details', 'org-pages');
      det.append(el('summary', '', `社務所Webで使えるページ（${n.pages.length}）`));
      for (const pg of data.pages) {
        const lab = el('label', 'org-page');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = n.pages.includes(pg.key); cb.disabled = !edit;
        cb.addEventListener('change', () => { n.pages = cb.checked ? [...n.pages, pg.key] : n.pages.filter(k => k !== pg.key); dirty = true; status.textContent = 'まだ保存していません。'; });
        lab.append(cb, document.createTextNode(' ' + pg.label));
        det.append(lab);
      }
      box.append(det);
    }
    dropZone(box, n.id);
    li.append(box);
    const kids = chart.nodes.filter(x => x.parentId === n.id);
    if (kids.length) { const ul = el('ul'); for (const k of kids) ul.append(nodeBox(k)); li.append(ul); }
    return li;
  }
  function move(n, d) {
    const sibs = chart.nodes.filter(x => x.parentId === n.parentId);
    const j = sibs.indexOf(n) + d;
    if (j < 0 || j >= sibs.length) return;
    const a = chart.nodes.indexOf(n), b = chart.nodes.indexOf(sibs[j]);
    [chart.nodes[a], chart.nodes[b]] = [chart.nodes[b], chart.nodes[a]];
    changed();
  }
  function remove(id) {
    for (const k of chart.nodes.filter(x => x.parentId === id)) remove(k.id);
    chart.nodes = chart.nodes.filter(x => x.id !== id);
    chart.placements = chart.placements.filter(p => p.nodeId !== id);
  }

  // ───── 段階（統括・副統括など） ─────
  function rankEditor() {
    const sec = el('section', 'card org-ranks');
    sec.append(el('h2', '', '段階（上から順に）'));
    const ul = el('ol');
    chart.ranks.forEach((r, i) => {
      const li = el('li');
      if (edit) {
        const inp = el('input'); inp.value = r.name; inp.maxLength = 20; inp.setAttribute('aria-label', `段階 ${i + 1} の名前`);
        inp.addEventListener('change', () => { if (inp.value.trim()) { r.name = inp.value.trim(); changed(); } });
        li.append(inp,
          btn('↑', '上へ', () => { if (i > 0) { [chart.ranks[i - 1], chart.ranks[i]] = [chart.ranks[i], chart.ranks[i - 1]]; changed(); } }),
          btn('↓', '下へ', () => { if (i < chart.ranks.length - 1) { [chart.ranks[i + 1], chart.ranks[i]] = [chart.ranks[i], chart.ranks[i + 1]]; changed(); } }),
          btn('🗑', '消す', () => {
            if (chart.ranks.length <= 1) return alert('段階は 1 つ以上必要です。');
            if (!confirm(`「${r.name}」を消しますか？（この段階の人は、いちばん下の段階になります）`)) return;
            chart.ranks.splice(i, 1);
            const last = chart.ranks[chart.ranks.length - 1].id;
            for (const p of chart.placements) if (p.rankId === r.id) p.rankId = last;
            changed();
          }));
      } else li.append(el('span', '', r.name));
      ul.append(li);
    });
    sec.append(ul);
    if (edit) sec.append(btn('＋ 段階を足す', '段階を足す', () => { if (chart.ranks.length >= 12) return alert('段階は 12 個までです。'); const name = prompt('段階の名前', '補佐'); if (name?.trim()) { chart.ranks.push({ id: newId('r'), name: name.trim().slice(0, 20) }); changed(); } }));
    return sec;
  }

  // ───── 左の人の一覧（役職ごと） ─────
  function sidebar() {
    const side = el('aside', 'org-side');
    side.append(el('h2', '', '役職ごとのメンバー'));
    const search = el('input', 'org-search'); search.type = 'search'; search.placeholder = '名前でさがす'; search.setAttribute('aria-label', '名前でさがす');
    side.append(search);
    const lists = [];
    for (const g of data.groups) {
      const det = el('details'); det.open = g.members.length <= 30;
      det.append(el('summary', '', `${g.name}（${g.members.length}）`));
      const ul = el('ul', 'org-side-list');
      for (const m of g.members) {
        const li = el('li', 'org-side-item', m.name);
        const count = chart.placements.filter(p => p.memberId === m.id).length;
        if (count) li.append(el('small', '', ` ・${count} か所`));
        li.dataset.name = m.name.toLowerCase();
        draggable(li, m.id, null);
        ul.append(li);
        lists.push(li);
      }
      det.append(ul);
      side.append(det);
    }
    search.addEventListener('input', () => { const q = search.value.trim().toLowerCase(); for (const li of lists) li.hidden = !!q && !li.dataset.name.includes(q); });
    return side;
  }

  // ───── 画面 ─────
  const status = el('p', 'org-status');
  status.setAttribute('role', 'status');
  async function save() {
    status.textContent = '保存しています…';
    const body = new URLSearchParams({ _csrf: csrf, data: JSON.stringify(chart) });
    try {
      const r = await fetch('/org', { method: 'POST', body, headers: { 'x-csrf-token': csrf } });
      if (!r.ok) throw new Error(await r.text());
      chart = await r.json();
      dirty = false; render(); status.textContent = '保存しました。';
    } catch (e) { status.textContent = '保存できませんでした: ' + (e.message || e); }
  }
  addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

  function render() {
    const keepScroll = root.querySelector('.org-tree-wrap')?.scrollLeft ?? 0;
    root.replaceChildren();
    const bar = el('div', 'org-bar');
    if (edit) bar.append(btn('💾 保存する', '保存する', save), btn('＋ 一番上に部署を足す', '一番上に部署を足す', () => { const name = prompt('部署の名前', '新しい部署'); if (name?.trim()) { chart.nodes.push({ id: newId('n'), name: name.trim().slice(0, 30), parentId: null, pages: [] }); changed(); } }));
    if (dirty && !status.textContent.startsWith('保存して')) status.textContent = 'まだ保存していません。';
    bar.append(status);
    root.append(bar);
    const main = el('div', 'org-main');
    if (edit) main.append(sidebar());
    const wrap = el('div', 'org-tree-wrap');
    const tree = el('ul', 'org-tree');
    for (const n of chart.nodes.filter(x => !x.parentId)) tree.append(nodeBox(n));
    if (!chart.nodes.length) tree.append(el('li', 'org-empty', '部署がありません。'));
    wrap.append(tree);
    main.append(wrap);
    root.append(main, rankEditor());
    wrap.scrollLeft = keepScroll;
  }
  render();
})();

// 🏯 組織図: 四角を自由に置く・大きさを変える。線でつなぎ、曲がり角を動かす。Shift でまっすぐ。左の人をドラッグ＆ドロップで置く。
(() => {
  const root = document.querySelector('.org-app');
  if (!root) return;
  const data = JSON.parse(root.dataset.org);
  const csrf = root.dataset.csrf;
  const edit = data.canEdit;
  let chart = data.chart;
  const people = { ...data.people };
  for (const g of data.groups) for (const m of g.members) people[m.id] = m;
  const COLORS = { plain: '色なし', sakura: '桜', sky: '空', leaf: '若葉', gold: '金', violet: '藤', ink: '墨' };
  const MIN_W = 120, MIN_H = 60;
  let view = { x: 20, y: 20, s: 1 };
  let sel = null; // { type: 'node'|'edge', id }
  let grid = true;
  let dirty = false;
  const past = [], future = [];

  // ───── 小さな道具 ─────
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const btn = (label, title, fn, cls = 'org-btn') => { const b = el('button', cls, label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); return b; };
  const newId = (p) => (p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 40);
  const node = (id) => chart.nodes.find(n => n.id === id);
  const snap = (v, e) => (grid && !e?.altKey ? Math.round(v / 10) * 10 : Math.round(v));
  const snapshot = () => JSON.stringify(chart);
  function commit(before) { past.push(before ?? snapshot()); if (past.length > 100) past.shift(); future.length = 0; dirty = true; setStatus('まだ保存していません。'); }
  function undo() { if (!past.length) return; future.push(snapshot()); chart = JSON.parse(past.pop()); dirty = true; fixSel(); render(); }
  function redo() { if (!future.length) return; past.push(snapshot()); chart = JSON.parse(future.pop()); dirty = true; fixSel(); render(); }
  function fixSel() { if (sel?.type === 'node' && !node(sel.id)) sel = null; if (sel?.type === 'edge' && !chart.edges.some(e => e.id === sel.id)) sel = null; }
  const status = el('p', 'org-status'); status.setAttribute('role', 'status');
  const setStatus = (t) => { status.textContent = t; };

  // ───── 画面の骨組み ─────
  const bar = el('div', 'org-bar');
  const main = el('div', 'org-main');
  const side = el('aside', 'org-side');
  const stage = el('div', 'org-stage');
  stage.tabIndex = 0;
  stage.setAttribute('aria-label', '組織図の画面');
  const world = el('div', 'org-world');
  const svg = svgEl('svg', { class: 'org-lines', width: '40000', height: '40000', viewBox: '-20000 -20000 40000 40000' });
  const defs = svgEl('defs');
  const marker = svgEl('marker', { id: 'org-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
  marker.append(svgEl('path', { d: 'M0 0 L10 5 L0 10 z', class: 'org-arrow' }));
  defs.append(marker); svg.append(defs);
  const edgeLayer = svgEl('g'), handleLayer = svgEl('g'), tempLayer = svgEl('g');
  svg.append(edgeLayer, handleLayer, tempLayer);
  const boxLayer = el('div', 'org-boxes');
  world.append(svg, boxLayer);
  stage.append(world);
  const inspect = el('aside', 'org-inspect');
  main.append(...(edit ? [side] : []), stage, inspect);
  root.replaceChildren(bar, main);

  const applyView = () => { world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`; zoomLabel.textContent = Math.round(view.s * 100) + '%'; };
  const toWorld = (ev) => { const r = stage.getBoundingClientRect(); return { x: (ev.clientX - r.left - view.x) / view.s, y: (ev.clientY - r.top - view.y) / view.s }; };

  // ───── 上の帯 ─────
  const zoomLabel = el('span', 'org-zoom', '100%');
  function zoomAt(f, cx, cy) {
    const s = Math.min(2.5, Math.max(0.25, view.s * f));
    const r = stage.getBoundingClientRect();
    const px = cx ?? r.width / 2, py = cy ?? r.height / 2;
    view.x = px - (px - view.x) * (s / view.s); view.y = py - (py - view.y) * (s / view.s); view.s = s; applyView();
  }
  function fit() {
    if (!chart.nodes.length) { view = { x: 20, y: 20, s: 1 }; return applyView(); }
    const minX = Math.min(...chart.nodes.map(n => n.x)), minY = Math.min(...chart.nodes.map(n => n.y));
    const maxX = Math.max(...chart.nodes.map(n => n.x + n.w)), maxY = Math.max(...chart.nodes.map(n => n.y + n.h));
    const r = stage.getBoundingClientRect();
    const s = Math.min(1.5, Math.max(0.25, Math.min((r.width - 40) / (maxX - minX || 1), (r.height - 40) / (maxY - minY || 1))));
    view = { s, x: 20 - minX * s + Math.max(0, (r.width - 40 - (maxX - minX) * s) / 2), y: 20 - minY * s };
    applyView();
  }
  function addBox(x, y) {
    const before = snapshot();
    const r = stage.getBoundingClientRect();
    const n = { id: newId('n'), name: '新しい部署', pages: [], x: snap(x ?? (r.width / 2 - view.x) / view.s - 110), y: snap(y ?? (r.height / 2 - view.y) / view.s - 60), w: 220, h: 120, color: 'plain' };
    chart.nodes.push(n); sel = { type: 'node', id: n.id }; commit(before); render();
  }
  function buildBar() {
    bar.replaceChildren();
    if (edit) {
      bar.append(btn('💾 保存する', '保存する', save, 'org-btn org-primary'), btn('＋ 四角を足す', '四角を足す', () => addBox()), btn('↶', '戻す（Ctrl+Z）', undo), btn('↷', 'やり直す（Ctrl+Y）', redo));
      const g = el('label', 'org-check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = grid; cb.addEventListener('change', () => { grid = cb.checked; }); g.append(cb, document.createTextNode(' 目盛りにそろえる'));
      bar.append(g);
    }
    bar.append(btn('−', '小さく', () => zoomAt(1 / 1.2)), zoomLabel, btn('＋', '大きく', () => zoomAt(1.2)), btn('全体', '全体を見る', fit), status);
  }

  // ───── 線 ─────
  /** 四角のふちの、target へ向かう点 */
  function borderPoint(n, t) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2, dx = t.x - cx, dy = t.y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const k = Math.min(Math.abs((n.w / 2) / (dx || 1e-9)), Math.abs((n.h / 2) / (dy || 1e-9)));
    return { x: cx + dx * k, y: cy + dy * k };
  }
  const center = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
  function edgePoints(e) {
    const a = node(e.from), b = node(e.to);
    if (!a || !b) return null;
    const first = e.bends[0] ?? center(b), last = e.bends[e.bends.length - 1] ?? center(a);
    return [borderPoint(a, first), ...e.bends, borderPoint(b, last)];
  }
  const pathOf = (pts) => 'M' + pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L');
  function drawEdges() {
    edgeLayer.replaceChildren(); handleLayer.replaceChildren();
    for (const e of chart.edges) {
      const pts = edgePoints(e); if (!pts) continue;
      const on = sel?.type === 'edge' && sel.id === e.id;
      const g = svgEl('g', { class: 'org-edge' + (on ? ' org-on' : '') });
      const line = svgEl('path', { d: pathOf(pts), class: 'org-edge-line' + (e.dashed ? ' org-dashed' : ''), 'marker-end': 'url(#org-arrow)' });
      const hit = svgEl('path', { d: pathOf(pts), class: 'org-edge-hit' });
      g.append(line, hit);
      if (edit) {
        hit.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); sel = { type: 'edge', id: e.id }; renderInspect(); drawEdges(); });
        hit.addEventListener('dblclick', (ev) => { ev.stopPropagation(); addBend(e, toWorld(ev)); });
      }
      edgeLayer.append(g);
      if (on && edit) e.bends.forEach((b, i) => {
        const h = svgEl('circle', { cx: b.x, cy: b.y, r: 7 / view.s, class: 'org-bend' });
        h.addEventListener('pointerdown', (ev) => dragBend(ev, e, i));
        const drop = (ev) => { ev.preventDefault(); ev.stopPropagation(); const before = snapshot(); e.bends.splice(i, 1); commit(before); drawEdges(); };
        h.addEventListener('dblclick', drop); h.addEventListener('contextmenu', drop);
        handleLayer.append(h);
      });
    }
  }
  function addBend(e, p) {
    const before = snapshot();
    const pts = edgePoints(e);
    // いちばん近い区間に入れる
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], l = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l));
      const d = (a.x + t * (b.x - a.x) - p.x) ** 2 + (a.y + t * (b.y - a.y) - p.y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (e.bends.length >= 12) return;
    e.bends.splice(best, 0, { x: snap(p.x), y: snap(p.y) });
    sel = { type: 'edge', id: e.id }; commit(before); drawEdges(); renderInspect();
  }
  /** 直角に曲げる（縦→横→縦） */
  function elbow(e) {
    const a = node(e.from), b = node(e.to); if (!a || !b) return;
    const before = snapshot();
    const ca = center(a), cb = center(b), midY = snap((a.y + a.h + b.y) / 2);
    e.bends = Math.abs(ca.x - cb.x) < 2 ? [] : (b.y > a.y + a.h ? [{ x: ca.x, y: midY }, { x: cb.x, y: midY }] : [{ x: snap((ca.x + cb.x) / 2), y: ca.y }, { x: snap((ca.x + cb.x) / 2), y: cb.y }]);
    commit(before); drawEdges();
  }

  // ───── ドラッグ（四角・大きさ・曲がり角・線を引く・画面） ─────
  function drag(ev, onMove, onEnd) {
    ev.preventDefault();
    const target = ev.currentTarget; target.setPointerCapture?.(ev.pointerId);
    const move = (e) => onMove(e);
    const up = (e) => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); onEnd?.(e); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  }
  function moveBox(ev, n, box) {
    if (!edit || ev.button !== 0) return;
    sel = { type: 'node', id: n.id }; markSel(); renderInspect();
    const start = toWorld(ev), ox = n.x, oy = n.y, before = snapshot(); let moved = false;
    drag(ev, (e) => {
      const p = toWorld(e); let dx = p.x - start.x, dy = p.y - start.y;
      // Shift: 横か縦だけ（まっすぐ）
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      n.x = snap(ox + dx, e); n.y = snap(oy + dy, e); moved = true;
      box.style.left = n.x + 'px'; box.style.top = n.y + 'px'; drawEdges();
    }, () => { if (moved) commit(before); });
  }
  function resizeBox(ev, n, box) {
    if (!edit) return; ev.stopPropagation();
    const start = toWorld(ev), ow = n.w, oh = n.h, before = snapshot(); let moved = false;
    drag(ev, (e) => {
      const p = toWorld(e); let w = ow + p.x - start.x, h = oh + p.y - start.y;
      // Shift: 形（縦横の比）をそのまま
      if (e.shiftKey) { const k = Math.max(w / ow, h / oh); w = ow * k; h = oh * k; }
      n.w = Math.min(1200, Math.max(MIN_W, snap(w, e))); n.h = Math.min(1200, Math.max(MIN_H, snap(h, e))); moved = true;
      box.style.width = n.w + 'px'; box.style.height = n.h + 'px'; drawEdges();
    }, () => { if (moved) commit(before); });
  }
  function dragBend(ev, e, i) {
    ev.stopPropagation();
    const before = snapshot(); let moved = false;
    drag(ev, (m) => {
      const p = toWorld(m); let x = snap(p.x, m), y = snap(p.y, m);
      // Shift: 前後の点と縦か横がそろうように（線がまっすぐになる）
      if (m.shiftKey) {
        const pts = edgePoints(e), prev = pts[i], next = pts[i + 2];
        const cands = [prev, next].filter(Boolean);
        const bx = cands.reduce((a, c) => (Math.abs(c.x - x) < Math.abs(a - x) ? c.x : a), Infinity);
        const by = cands.reduce((a, c) => (Math.abs(c.y - y) < Math.abs(a - y) ? c.y : a), Infinity);
        if (Math.abs(bx - x) < Math.abs(by - y)) x = bx; else y = by;
      }
      e.bends[i] = { x, y }; moved = true; drawEdges();
    }, () => { if (moved) commit(before); });
  }
  function drawLink(ev, n) {
    ev.stopPropagation();
    const a = center(n);
    const tmp = svgEl('path', { class: 'org-edge-line org-temp' });
    tempLayer.append(tmp);
    drag(ev, (m) => {
      let p = toWorld(m);
      if (m.shiftKey) { if (Math.abs(p.x - a.x) > Math.abs(p.y - a.y)) p = { x: p.x, y: a.y }; else p = { x: a.x, y: p.y }; }
      tmp.setAttribute('d', pathOf([borderPoint(n, p), p]));
    }, (m) => {
      tmp.remove();
      const under = document.elementFromPoint(m.clientX, m.clientY)?.closest('.org-box');
      const to = under?.dataset.id;
      if (!to || to === n.id || chart.edges.some(e => e.from === n.id && e.to === to)) return;
      const before = snapshot();
      const e = { id: newId('e'), from: n.id, to, bends: [], dashed: false };
      chart.edges.push(e); sel = { type: 'edge', id: e.id }; commit(before); render();
    });
  }
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.target !== stage && ev.target !== world && ev.target !== svg && ev.target !== boxLayer) return;
    sel = null; markSel(); renderInspect(); drawEdges(); stage.focus();
    const sx = ev.clientX, sy = ev.clientY, ox = view.x, oy = view.y;
    drag(ev, (e) => { view.x = ox + e.clientX - sx; view.y = oy + e.clientY - sy; applyView(); });
  });
  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = stage.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey) zoomAt(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev.clientX - r.left, ev.clientY - r.top);
    else { view.x -= ev.deltaX; view.y -= ev.deltaY; applyView(); }
  }, { passive: false });

  // ───── 人（チップ）を置く ─────
  function place(memberId, nodeId, fromNode) {
    if (fromNode === nodeId) return;
    const before = snapshot();
    if (fromNode) chart.placements = chart.placements.filter(p => !(p.memberId === memberId && p.nodeId === fromNode));
    if (!chart.placements.some(p => p.memberId === memberId && p.nodeId === nodeId)) chart.placements.push({ memberId, nodeId, rankId: chart.ranks[chart.ranks.length - 1].id });
    commit(before); render();
  }
  const avatar = (id) => {
    const m = people[id];
    if (m?.avatar && /^https:\/\/cdn\.discordapp\.com\//.test(m.avatar)) { const img = el('img', 'org-avatar'); img.src = m.avatar; img.alt = ''; img.loading = 'lazy'; img.width = 24; img.height = 24; return img; }
    return el('span', 'org-avatar org-avatar-none', (m?.name ?? '?').slice(0, 1));
  };
  const dragPerson = (item, memberId, fromNode) => {
    if (!edit) return;
    item.draggable = true;
    item.addEventListener('dragstart', (e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', JSON.stringify({ memberId, fromNode })); e.dataTransfer.effectAllowed = 'move'; });
  };

  // ───── 四角 ─────
  function boxOf(n) {
    const box = el('div', `org-box org-c-${n.color}`);
    box.dataset.id = n.id;
    box.style.left = n.x + 'px'; box.style.top = n.y + 'px'; box.style.width = n.w + 'px'; box.style.height = n.h + 'px';
    const head = el('div', 'org-box-head', n.name);
    head.addEventListener('pointerdown', (e) => moveBox(e, n, box));
    if (edit) head.addEventListener('dblclick', () => rename(n));
    box.append(head);
    const list = el('ul', 'org-box-people');
    const here = chart.placements.filter(p => p.nodeId === n.id).sort((a, b) => chart.ranks.findIndex(r => r.id === a.rankId) - chart.ranks.findIndex(r => r.id === b.rankId));
    for (const p of here) {
      const chip = el('li', 'org-chip');
      dragPerson(chip, p.memberId, n.id);
      chip.append(avatar(p.memberId), el('span', 'org-name', people[p.memberId]?.name ?? p.memberId));
      if (edit) {
        const s = el('select', 'org-rank'); s.setAttribute('aria-label', '段階');
        for (const r of chart.ranks) { const o = el('option', '', r.name); o.value = r.id; o.selected = r.id === p.rankId; s.append(o); }
        s.addEventListener('pointerdown', (e) => e.stopPropagation());
        s.addEventListener('change', () => { const before = snapshot(); p.rankId = s.value; commit(before); render(); });
        chip.append(s, btn('×', 'この四角から外す', () => { const before = snapshot(); chart.placements = chart.placements.filter(x => x !== p); commit(before); render(); }, 'org-x'));
      } else chip.append(el('span', 'org-rank-label', chart.ranks.find(r => r.id === p.rankId)?.name ?? ''));
      list.append(chip);
    }
    if (!here.length && edit) list.append(el('li', 'org-empty', 'ここへ人をドロップ'));
    box.append(list);
    if (edit) {
      // 線を出す「●」: 下・右・左・上
      const ports = ['b', 'r', 'l', 't'].map(side => { const port = el('span', `org-port org-port-${side}`); port.title = 'ドラッグしてほかの四角とつなぐ'; port.addEventListener('pointerdown', (e) => drawLink(e, n)); return port; });
      const grip = el('span', 'org-resize'); grip.title = 'ドラッグで大きさを変える（Shift で形をそのまま）';
      grip.addEventListener('pointerdown', (e) => resizeBox(e, n, box));
      box.append(...ports, grip);
      box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('org-over'); });
      box.addEventListener('dragleave', () => box.classList.remove('org-over'));
      box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('org-over'); try { const d = JSON.parse(e.dataTransfer.getData('text/plain')); if (/^\d{17,20}$/.test(d.memberId)) place(d.memberId, n.id, d.fromNode); } catch { /* ほかのもの */ } });
    }
    box.addEventListener('pointerdown', () => { if (sel?.id !== n.id) { sel = { type: 'node', id: n.id }; markSel(); renderInspect(); drawEdges(); } });
    return box;
  }
  function rename(n) { const v = prompt('名前', n.name); if (v?.trim()) { const before = snapshot(); n.name = v.trim().slice(0, 30); commit(before); render(); } }
  function markSel() { for (const b of boxLayer.children) b.classList.toggle('org-on', sel?.type === 'node' && b.dataset.id === sel.id); }
  function removeSel() {
    if (!sel || !edit) return;
    const before = snapshot();
    if (sel.type === 'node') {
      const n = node(sel.id); if (!n || !confirm(`「${n.name}」を消しますか？（置いた人とつながる線も外れます）`)) return;
      chart.nodes = chart.nodes.filter(x => x.id !== n.id); chart.edges = chart.edges.filter(e => e.from !== n.id && e.to !== n.id); chart.placements = chart.placements.filter(p => p.nodeId !== n.id);
    } else chart.edges = chart.edges.filter(e => e.id !== sel.id);
    sel = null; commit(before); render();
  }
  function duplicate() {
    if (sel?.type !== 'node') return; const n = node(sel.id); if (!n) return;
    const before = snapshot();
    const c = { ...structuredClone(n), id: newId('n'), name: (n.name + 'のコピー').slice(0, 30), x: n.x + 30, y: n.y + 30 };
    chart.nodes.push(c); sel = { type: 'node', id: c.id }; commit(before); render();
  }

  // ───── 右の欄（選んだもの・段階・ロール） ─────
  function renderInspect() {
    inspect.replaceChildren();
    if (sel?.type === 'node' && node(sel.id)) {
      const n = node(sel.id);
      const sec = el('section', 'card'); sec.append(el('h2', '', '四角'));
      if (edit) {
        const name = el('input'); name.value = n.name; name.maxLength = 30; name.setAttribute('aria-label', '名前');
        name.addEventListener('change', () => { if (name.value.trim()) { const before = snapshot(); n.name = name.value.trim(); commit(before); render(); } });
        const color = el('select'); color.setAttribute('aria-label', '色');
        for (const [k, v] of Object.entries(COLORS)) { const o = el('option', '', v); o.value = k; o.selected = n.color === k; color.append(o); }
        color.addEventListener('change', () => { const before = snapshot(); n.color = color.value; commit(before); render(); });
        const l1 = el('label', 'org-field', '名前'); l1.append(name);
        const l2 = el('label', 'org-field', '色'); l2.append(color);
        sec.append(l1, l2, el('p', 'note', `大きさ ${n.w}×${n.h}`), btn('複製（Ctrl+D）', '複製', duplicate), btn('消す（Delete）', '消す', removeSel, 'org-btn danger-link'));
      } else sec.append(el('p', '', n.name));
      const det = el('details', 'org-pages'); det.open = true;
      det.append(el('summary', '', `社務所Webで使えるページ（${n.pages.length}）`));
      for (const pg of data.pages) {
        const lab = el('label', 'org-page'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = n.pages.includes(pg.key); cb.disabled = !edit;
        cb.addEventListener('change', () => { const before = snapshot(); n.pages = cb.checked ? [...n.pages, pg.key] : n.pages.filter(k => k !== pg.key); commit(before); det.firstChild.textContent = `社務所Webで使えるページ（${n.pages.length}）`; });
        lab.append(cb, document.createTextNode(' ' + pg.label)); det.append(lab);
      }
      sec.append(det); inspect.append(sec);
    } else if (sel?.type === 'edge' && edit) {
      const e = chart.edges.find(x => x.id === sel.id);
      if (e) {
        const sec = el('section', 'card'); sec.append(el('h2', '', '線'));
        const lab = el('label', 'org-check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = e.dashed;
        cb.addEventListener('change', () => { const before = snapshot(); e.dashed = cb.checked; commit(before); drawEdges(); });
        lab.append(cb, document.createTextNode(' 点線にする'));
        sec.append(lab, el('p', 'note', 'ダブルクリックで曲がり角を足し、角をドラッグで動かします（Shift でまっすぐ）。'),
          btn('直角に曲げる', '直角に曲げる', () => elbow(e)), btn('まっすぐにする', '曲がり角を全部消す', () => { const before = snapshot(); e.bends = []; commit(before); drawEdges(); }),
          btn('向きを逆にする', '向きを逆にする', () => { const before = snapshot(); [e.from, e.to] = [e.to, e.from]; e.bends.reverse(); commit(before); drawEdges(); }),
          btn('消す（Delete）', '消す', removeSel, 'org-btn danger-link'));
        inspect.append(sec);
      }
    } else inspect.append(el('p', 'note', edit ? '四角か線を選ぶと、ここで変えられます。' : '四角を選ぶと、使えるページが出ます。'));
    inspect.append(rankEditor());
    if (edit) inspect.append(rolePicker());
  }
  function rankEditor() {
    const sec = el('details', 'card org-ranks'); sec.append(el('summary', '', '段階（上から順に）'));
    const ol = el('ol');
    chart.ranks.forEach((r, i) => {
      const li = el('li');
      if (edit) {
        const inp = el('input'); inp.value = r.name; inp.maxLength = 20; inp.setAttribute('aria-label', `段階 ${i + 1}`);
        inp.addEventListener('change', () => { if (inp.value.trim()) { const before = snapshot(); r.name = inp.value.trim(); commit(before); render(); } });
        li.append(inp,
          btn('↑', '上へ', () => { if (i > 0) { const before = snapshot(); [chart.ranks[i - 1], chart.ranks[i]] = [chart.ranks[i], chart.ranks[i - 1]]; commit(before); render(); } }),
          btn('↓', '下へ', () => { if (i < chart.ranks.length - 1) { const before = snapshot(); [chart.ranks[i + 1], chart.ranks[i]] = [chart.ranks[i], chart.ranks[i + 1]]; commit(before); render(); } }),
          btn('🗑', '消す', () => {
            if (chart.ranks.length <= 1) return alert('段階は 1 つ以上必要です。');
            if (!confirm(`「${r.name}」を消しますか？（この段階の人は、いちばん下の段階になります）`)) return;
            const before = snapshot(); chart.ranks.splice(i, 1); const last = chart.ranks[chart.ranks.length - 1].id;
            for (const p of chart.placements) if (p.rankId === r.id) p.rankId = last;
            commit(before); render();
          }));
      } else li.append(el('span', '', r.name));
      ol.append(li);
    });
    sec.append(ol);
    if (edit) sec.append(btn('＋ 段階を足す', '段階を足す', () => { if (chart.ranks.length >= 12) return alert('段階は 12 個までです。'); const v = prompt('段階の名前', '補佐'); if (v?.trim()) { const before = snapshot(); chart.ranks.push({ id: newId('r'), name: v.trim().slice(0, 20) }); commit(before); render(); } }));
    return sec;
  }
  function rolePicker() {
    const sec = el('details', 'card org-roles'); sec.append(el('summary', '', `左の一覧に出すロール（${chart.roles.length || '役職'}）`));
    sec.append(el('p', 'note', '選ばないときは役職のロールを出します。変えたら保存して、ページを開き直すと一覧に出ます。'));
    const find = el('input'); find.type = 'search'; find.placeholder = 'ロールをさがす'; find.setAttribute('aria-label', 'ロールをさがす');
    const box = el('div', 'org-role-list');
    const rows = data.roles.map(r => {
      const lab = el('label', 'org-page'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = chart.roles.includes(r.id);
      cb.addEventListener('change', () => { const before = snapshot(); chart.roles = cb.checked ? [...chart.roles, r.id] : chart.roles.filter(x => x !== r.id); commit(before); sec.firstChild.textContent = `左の一覧に出すロール（${chart.roles.length || '役職'}）`; });
      lab.append(cb, document.createTextNode(' ' + r.name)); lab.dataset.name = r.name.toLowerCase(); box.append(lab); return lab;
    });
    find.addEventListener('input', () => { const q = find.value.trim().toLowerCase(); for (const l of rows) l.hidden = !!q && !l.dataset.name.includes(q); });
    sec.append(find, box);
    return sec;
  }

  // ───── 左の一覧（ロールごと・名前とアイコン） ─────
  function renderSide() {
    side.replaceChildren(el('h2', '', 'メンバー'));
    const search = el('input', 'org-search'); search.type = 'search'; search.placeholder = '名前でさがす'; search.setAttribute('aria-label', '名前でさがす');
    side.append(search);
    const items = [];
    for (const g of data.groups) {
      const det = el('details'); det.open = g.members.length <= 30;
      det.append(el('summary', '', `${g.name}（${g.members.length}）`));
      const ul = el('ul', 'org-side-list');
      for (const m of g.members) {
        const li = el('li', 'org-side-item');
        li.append(avatar(m.id), el('span', 'org-name', m.name));
        const count = chart.placements.filter(p => p.memberId === m.id).length;
        if (count) li.append(el('small', '', `${count}`));
        li.dataset.name = m.name.toLowerCase();
        dragPerson(li, m.id, null);
        ul.append(li); items.push(li);
      }
      det.append(ul); side.append(det);
    }
    search.addEventListener('input', () => { const q = search.value.trim().toLowerCase(); for (const li of items) li.hidden = !!q && !li.dataset.name.includes(q); });
  }

  // ───── キーボード ─────
  document.addEventListener('keydown', (e) => {
    if (!edit || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSel(); }
    else if (sel?.type === 'node' && e.key.startsWith('Arrow')) {
      e.preventDefault(); const n = node(sel.id); if (!n) return; const d = e.shiftKey ? 10 : 1; const before = snapshot();
      if (e.key === 'ArrowLeft') n.x -= d; if (e.key === 'ArrowRight') n.x += d; if (e.key === 'ArrowUp') n.y -= d; if (e.key === 'ArrowDown') n.y += d;
      commit(before); render();
    }
  });

  // ───── 保存 ─────
  async function save() {
    setStatus('保存しています…');
    try {
      const r = await fetch('/org', { method: 'POST', body: new URLSearchParams({ _csrf: csrf, data: JSON.stringify(chart) }), headers: { 'x-csrf-token': csrf } });
      if (!r.ok) throw new Error(await r.text());
      chart = await r.json(); fixSel(); dirty = false; render(); setStatus('保存しました。');
    } catch (err) { setStatus('保存できませんでした: ' + (err.message || err)); }
  }
  addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

  function render() {
    boxLayer.replaceChildren(...chart.nodes.map(boxOf));
    markSel(); drawEdges(); renderInspect();
    if (edit) renderSide();
  }
  buildBar(); render(); fit();
})();

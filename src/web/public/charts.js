// 📈 グラフにマウスを乗せた（スマホは押した）ところの数字を、見やすいカードで出す（data-tip: 1 行目が見出し）
(() => {
  let tip = null;
  const show = (el, x, y) => {
    const text = el.getAttribute('data-tip');
    if (!text) return;
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.setAttribute('role', 'status');
      document.body.appendChild(tip);
    }
    const [head, ...lines] = text.split('\n');
    tip.textContent = '';
    const h = document.createElement('b');
    h.textContent = head;
    tip.appendChild(h);
    for (const l of lines) {
      const d = document.createElement('div');
      d.textContent = l;
      tip.appendChild(d);
    }
    tip.hidden = false;
    // 画面からはみ出さないように
    const r = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
    const top = y + r.height + 20 > window.innerHeight ? y - r.height - 14 : y + 14;
    tip.style.left = `${left + window.scrollX}px`;
    tip.style.top = `${top + window.scrollY}px`;
    document.querySelectorAll('.chart [data-tip].on').forEach((x) => x !== el && x.classList.remove('on'));
    el.classList.add('on');
  };
  const hide = () => {
    if (tip) tip.hidden = true;
    document.querySelectorAll('.chart [data-tip].on').forEach((x) => x.classList.remove('on'));
  };
  // ふつうの吹き出し（title）と二重にならないように、title は読み上げ用に残して見た目だけ消す
  for (const el of document.querySelectorAll('.chart [data-tip]')) {
    const t = el.querySelector('title');
    if (t) {
      el.setAttribute('aria-label', t.textContent || '');
      t.remove();
    }
  }
  document.addEventListener('pointermove', (e) => {
    const el = e.target instanceof Element ? e.target.closest('.chart [data-tip]') : null;
    if (el) show(el, e.clientX, e.clientY);
    else if (e.pointerType === 'mouse') hide();
  });
  document.addEventListener('pointerdown', (e) => {
    const el = e.target instanceof Element ? e.target.closest('.chart [data-tip]') : null;
    if (el) show(el, e.clientX, e.clientY);
    else hide();
  });
  document.addEventListener('scroll', () => tip && !tip.hidden && hide(), { passive: true });
})();

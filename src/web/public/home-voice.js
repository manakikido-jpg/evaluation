// 🎙 ホームの「いま通話にいる人」を 10 秒ごとに読み直して書きかえる（画面が見えているときだけ）
(() => {
  const box = document.getElementById('home-voice');
  if (!box) return;
  const list = box.querySelector('[data-voice-list]');
  const totalEl = box.querySelector('[data-voice-total]');
  const updated = box.querySelector('[data-voice-updated]');
  const links = box.dataset.links === '1';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const render = (channels) => {
    list.replaceChildren();
    let total = 0;
    if (!channels.length) list.append(el('p', 'note', 'いまはだれも通話にいません（AFK はのぞく）。'));
    for (const ch of channels) {
      total += ch.members.length;
      const card = el('article', 'voice-ch');
      const h = el('h3', '', `🔊 ${ch.name} `);
      h.append(el('small', '', `${ch.members.length} 人`));
      const ul = el('ul');
      for (const m of ch.members) {
        const li = el('li');
        if (links) {
          const a = el('a', '', m.name);
          a.href = `/members/${encodeURIComponent(m.id)}`;
          li.append(a);
        } else li.textContent = m.name;
        ul.append(li);
      }
      card.append(h, ul);
      list.append(card);
    }
    totalEl.textContent = String(total);
    const t = new Date();
    updated.textContent = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')} に更新`;
  };
  const load = async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(box.dataset.src, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.channels)) render(data.channels);
    } catch {
      // 読めなかったら、次の回にまた読む
    }
  };
  setInterval(load, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();

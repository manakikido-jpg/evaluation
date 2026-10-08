// ☰ メニュー: パソコンでは閉じたかどうかを覚える（スマホは毎回閉じた状態から）
(() => {
  const toggle = document.getElementById('nav-toggle');
  if (!(toggle instanceof HTMLInputElement)) return;
  const wide = () => window.matchMedia('(min-width: 901px)').matches;
  try {
    if (wide() && localStorage.getItem('side-collapsed') === '1') toggle.checked = true;
  } catch {
    // 覚えられなくても動く
  }
  toggle.addEventListener('change', () => {
    if (!wide()) return;
    try {
      localStorage.setItem('side-collapsed', toggle.checked ? '1' : '0');
    } catch {
      // そのまま
    }
  });
  // スマホで開いたメニューは Esc で閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !wide()) toggle.checked = false;
  });
  // 戻るボタンで戻ったとき、スマホのメニューは閉じておく
  window.addEventListener('pageshow', () => {
    if (!wide()) toggle.checked = false;
  });
})();

// 左のメニューの仲間（見る・メンバー対応 など）は見出しで折りたためる。閉じた仲間を覚える（今いるページの仲間は開く）
document.addEventListener('DOMContentLoaded', () => {
  const KEY = 'nav-closed';
  let closed = [];
  try {
    closed = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(closed)) closed = [];
  } catch {
    closed = [];
  }
  const groups = document.querySelectorAll('details.nav-group[data-group]');
  groups.forEach((d) => {
    if (!(d instanceof HTMLDetailsElement)) return;
    const name = d.dataset.group || '';
    if (closed.includes(name) && !d.querySelector('a.on')) d.open = false;
    d.addEventListener('toggle', () => {
      const set = new Set(closed);
      if (d.open) set.delete(name);
      else set.add(name);
      closed = [...set];
      try {
        localStorage.setItem(KEY, JSON.stringify(closed));
      } catch {
        // 覚えられなくても動く
      }
    });
  });
});

// 🦊 AT 機の絵: 選んだらその場で見せて、何枚選んだかを保存ボタンの横に出す（保存はまとめて 1 回）
document.addEventListener('change', (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || !input.matches('[data-art-input]')) return;
  const slot = input.closest('.art-slot');
  const box = slot && slot.querySelector('.art-preview');
  const file = input.files && input.files[0];
  if (slot) slot.classList.toggle('picked', Boolean(file));
  if (box && file) {
    box.textContent = '';
    const img = document.createElement('img');
    img.alt = '';
    img.src = URL.createObjectURL(file);
    box.append(img);
    if (file.size > 4 * 1024 * 1024) {
      const warn = document.createElement('span');
      warn.className = 'art-warn';
      warn.textContent = '4MB をこえています（保存できません）';
      box.append(warn);
    }
  }
  const form = input.closest('form[data-art-form]');
  const count = form && form.querySelector('[data-art-count]');
  if (count) {
    const picked = [...form.querySelectorAll('[data-art-input]')].filter((x) => x.files && x.files.length > 0);
    const total = picked.reduce((a, x) => a + x.files[0].size, 0);
    count.textContent = picked.length
      ? `${picked.length} 枚選んでいます（${(total / 1024 / 1024).toFixed(1)}MB）。「選んだ絵を保存」で入ります。`
      : '絵を選んだら、ここで保存します（何枚でもまとめて）。';
    form.classList.toggle('dirty', picked.length > 0);
  }
});

// 📋 ロールの権限のテンプレート: 選んで「当てはめる」と、権限のチェックがまとめて変わる（保存するまで Discord は変わらない）
document.addEventListener('click', (e) => {
  const btn = e.target instanceof Element ? e.target.closest('[data-perm-apply]') : null;
  if (!btn) return;
  const form = btn.closest('form');
  const select = form && form.querySelector('[data-perm-template]');
  const opt = select && select.selectedOptions[0];
  if (!form || !opt) return;
  const bits = new Set((opt.getAttribute('data-bits') || '').split(',').filter(Boolean));
  form.querySelectorAll('input[type=checkbox][name=perm]').forEach((box) => {
    if (!box.disabled) box.checked = bits.has(box.value);
  });
  const note = form.querySelector('[data-perm-applied]');
  if (note) note.hidden = false;
});

// 消すなど、確かめてから送るフォーム（data-confirm の文で聞く）
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f instanceof HTMLFormElement && f.hasAttribute('data-confirm') && !window.confirm(f.getAttribute('data-confirm') || 'よろしいですか？')) e.preventDefault();
});

// 📎 アイデア・共有: 選んだ写真・ファイルの名前を出す。スクショは Ctrl+V で貼り付けても入る（今まで選んだものに足す）
function showPickedFiles(input) {
  const list = input.closest('.idea-files-pick') && input.closest('.idea-files-pick').querySelector('[data-file-list]');
  if (!list) return;
  const files = [...(input.files || [])];
  list.textContent = files.length ? `選んだもの（${files.length} 個）: ${files.map((f) => f.name).join('・')}` : '';
}
document.addEventListener('change', (e) => {
  const input = e.target;
  if (input instanceof HTMLInputElement && input.matches('[data-file-input]')) showPickedFiles(input);
});
document.addEventListener('paste', (e) => {
  const form = e.target instanceof Element ? e.target.closest('form[data-paste-files]') : null;
  const input = form && form.querySelector('[data-file-input]');
  const pasted = e.clipboardData ? [...e.clipboardData.files] : [];
  if (!input || !pasted.length || typeof DataTransfer === 'undefined') return;
  e.preventDefault();
  const dt = new DataTransfer();
  [...(input.files || [])].forEach((f) => dt.items.add(f));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  pasted.forEach((f, k) => {
    // 貼り付けた画像は名前が「image.png」になるので、日時の名前にする
    const name = /^image\.(png|jpe?g|gif|webp)$/i.test(f.name) ? `paste-${stamp}-${k + 1}.${f.name.split('.').pop()}` : f.name;
    dt.items.add(new File([f], name, { type: f.type }));
  });
  input.files = dt.files;
  showPickedFiles(input);
});

// スマホの下部メニューも同じ開閉状態を使う。
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('nav-toggle');
  const buttons = document.querySelectorAll('[data-nav-toggle]');
  if (!(toggle instanceof HTMLInputElement)) return;
  const sync = () => buttons.forEach(button => button.setAttribute('aria-expanded', String(toggle.checked)));
  buttons.forEach(button => button.addEventListener('click', () => { toggle.checked = !toggle.checked; toggle.dispatchEvent(new Event('change')); }));
  toggle.addEventListener('change', sync);
  window.addEventListener('pageshow', sync);
  sync();
});

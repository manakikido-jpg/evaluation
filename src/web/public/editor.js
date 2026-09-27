// 掲示の本文の飾りボタン（太字・見出しなど）と、メンションの選び方の手助け。
// JS が動かなくても、本文に直接 **太字** などと書けば同じになる。
(() => {
  'use strict';

  /** 選んでいる所を text に置き換えて、[selStart, selEnd] を選び直す（元に戻す（Ctrl+Z）が効くように insertText を使う） */
  function replace(ta, start, end, text, selStart, selEnd) {
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch {
      ok = false;
    }
    if (!ok || ta.value.slice(start, start + text.length) !== text) {
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(selStart, selEnd);
  }

  /** **太字** など、選んだ文字を前後で囲む（もう囲んであれば外す） */
  function wrap(ta, before, after, placeholder) {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const sel = v.slice(s, e);
    if (sel && v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      replace(ta, s - before.length, e + after.length, sel, s - before.length, e - before.length);
      return;
    }
    const inner = sel || placeholder;
    replace(ta, s, e, before + inner + after, s + before.length, s + before.length + inner.length);
  }

  /** # 見出し・- 箇条書きなど、選んだ行の頭に付ける（全部に付いていれば外す） */
  function linePrefix(ta, prefix, numbered) {
    const { selectionStart: s, value: v } = ta;
    let e = ta.selectionEnd;
    if (e > s && v[e - 1] === '\n') e--;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', e);
    if (le < 0) le = v.length;
    const lines = v.slice(ls, le).split('\n');
    const has = (l) => (numbered ? /^\d+\. /.test(l) : l.startsWith(prefix));
    const strip = (l) => (numbered ? l.replace(/^\d+\. /, '') : l.slice(prefix.length));
    // 見出しを付け替えるとき（# → ##）は前の印を外す
    const clean = (l) => (prefix.startsWith('#') || prefix === '-# ' ? l.replace(/^(?:#{1,3}|-#) /, '') : l);
    const off = lines.every((l) => !l.trim() || has(l));
    const out = lines.map((l, i) => (!l.trim() && lines.length > 1 ? l : off ? strip(l) : (numbered ? `${i + 1}. ` : prefix) + clean(l))).join('\n');
    replace(ta, ls, le, out, ls, ls + out.length);
  }

  function codeBlock(ta) {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const inner = v.slice(s, e) || 'コード';
    const lead = s > 0 && v[s - 1] !== '\n' ? '\n' : '';
    const text = `${lead}\`\`\`\n${inner}\n\`\`\``;
    const at = s + lead.length + 4;
    replace(ta, s, e, text, at, at + inner.length);
  }

  function link(ta) {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const label = v.slice(s, e) || 'リンクの文字';
    const text = `[${label}](https://)`;
    const at = s + label.length + 3;
    replace(ta, s, e, text, at, at + 8);
  }

  function insert(ta, text) {
    const { selectionStart: s, selectionEnd: e } = ta;
    replace(ta, s, e, text, s + text.length, s + text.length);
  }

  function run(ta, b) {
    const d = b.dataset;
    if (d.md === 'wrap') wrap(ta, d.before, d.after ?? d.before, d.placeholder || '文字');
    else if (d.md === 'line') linePrefix(ta, d.prefix, d.numbered === 'yes');
    else if (d.md === 'code') codeBlock(ta);
    else if (d.md === 'link') link(ta);
    else if (d.md === 'insert') insert(ta, d.text);
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('[data-md]') : null;
    if (!b) return;
    const ta = document.getElementById(b.dataset.target || '');
    if (!(ta instanceof HTMLTextAreaElement)) return;
    ev.preventDefault();
    run(ta, b);
  });

  // Ctrl+B 太字・Ctrl+I 斜体・Ctrl+U 下線（Mac は ⌘）
  const KEYS = { b: ['**', '**'], i: ['*', '*'], u: ['__', '__'] };
  document.addEventListener('keydown', (ev) => {
    const ta = ev.target;
    if (!(ta instanceof HTMLTextAreaElement) || !ta.hasAttribute('data-md-editor')) return;
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
    const k = KEYS[ev.key.toLowerCase()];
    if (!k) return;
    ev.preventDefault();
    wrap(ta, k[0], k[1], '文字');
  });

  // 写真: 選んだらすぐプレビューに出す（送るのは保存のとき）。プレビューが描き直されたら入れ直す
  let picked = '';
  function showPicked() {
    if (!picked) return;
    for (const img of document.querySelectorAll('img[data-image-slot]')) {
      img.src = picked;
      img.hidden = false;
      const card = img.closest('.notice-img-card');
      if (card instanceof HTMLElement) card.hidden = false;
    }
  }
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement) || !el.hasAttribute('data-image-input')) return;
    if (picked) URL.revokeObjectURL(picked);
    const f = el.files && el.files[0];
    picked = f ? URL.createObjectURL(f) : '';
    if (picked) showPicked();
    else if (el.form) el.form.querySelector('[name="style"]')?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  document.addEventListener('htmx:afterSettle', showPicked);

  // ロールにチェックを入れたら「ロール」を選んだことにする。ほかを選んだらロールのチェックを外す
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement) || !el.form) return;
    if (el.name === 'mentionRoles' && el.checked) {
      const r = el.form.querySelector('input[name="mentionKind"][value="roles"]');
      if (r instanceof HTMLInputElement) r.checked = true;
    } else if (el.name === 'mentionKind' && el.value !== 'roles') {
      for (const c of el.form.querySelectorAll('input[name="mentionRoles"]')) if (c instanceof HTMLInputElement) c.checked = false;
    }
  });
})();

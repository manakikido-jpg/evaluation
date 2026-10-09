'use strict';
(() => {
  const input = document.querySelector('[data-photo-input]');
  const preview = document.querySelector('[data-photo-preview]');
  const hint = document.querySelector('[data-image-hint]');
  let url;
  input?.addEventListener('change', () => {
    input.setCustomValidity('');
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      input.setCustomValidity('画像は8MBまでです。小さくして選び直してください。');
      input.reportValidity();
      if (hint) hint.textContent = '画像が大きすぎます（8MBまで）。';
      return;
    }
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(file);
    preview.src = url;
    preview.hidden = false;
    if (hint) hint.textContent = '保存前の見本です。「画像を保存」で反映します。';
  });
  document.querySelector('[data-menu-kind]')?.addEventListener('change', event => {
    const form = event.target.form;
    const call = event.target.value === 'call';
    form.elements.minutes.readOnly = !call;
    if (!call) form.elements.minutes.value = '0';
    else if (form.elements.minutes.value === '0') form.elements.minutes.value = '30';
    form.elements.price.readOnly = event.target.value === 'consult';
    if (event.target.value === 'consult') form.elements.price.value = '0';
  });
  document.querySelectorAll('form').forEach(form => form.addEventListener('submit', event => {
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) { event.preventDefault(); return; }
    form.querySelectorAll('button[type="submit"],button:not([type])').forEach(button => { button.disabled = true; button.textContent = '処理中…'; });
  }));
  window.addEventListener('pageshow', () => { document.querySelectorAll('button:disabled').forEach(button => { button.disabled = false; }); });
})();

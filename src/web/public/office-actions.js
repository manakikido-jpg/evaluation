// 通常フォームをその場で保存する。送信結果が不明な場合は自動再送しない。
(() => {
  const main = document.getElementById('main-content');
  if (!main) return;
  const dirty = new WeakSet();
  let busy = false;
  const message = (text, error = false) => {
    let box = document.getElementById('office-action-status');
    if (!box) {
      box = document.createElement('p'); box.id = 'office-action-status';
      box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
      document.body.append(box);
    }
    box.className = `office-action-status${error ? ' warn' : ''}`;
    box.textContent = text;
  };
  document.addEventListener('input', event => { const form = event.target.closest?.('form'); if (form) dirty.add(form); });
  document.addEventListener('change', event => { const form = event.target.closest?.('form'); if (form) dirty.add(form); });
  const key = form => `${form.method}:${form.getAttribute('action') || location.pathname}`;
  const forms = root => [...root.querySelectorAll('form')];
  const hasChanges = form => dirty.has(form) || [...form.elements].some(el => {
    if (el instanceof HTMLSelectElement) return [...el.options].some(option => option.selected !== option.defaultSelected);
    if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) return el.checked !== el.defaultChecked;
    return 'defaultValue' in el && el.value !== el.defaultValue;
  });
  const scripts = root => [...root.querySelectorAll('script[src]')].map(el => el.getAttribute('src')).sort().join('|');

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !main.contains(form) || event.defaultPrevented) return;
    // 専用の送信処理、ファイル、別ウインドウは従来どおり。
    if (!main.hasAttribute('data-office-inplace') || form.method !== 'post' || form.target ||
      form.querySelector('input[type=file]') || form.closest('[hx-post],[hx-boost],[data-native-submit]') ||
      form.querySelector('[hx-post]') || event.submitter?.hasAttribute('formaction') || event.submitter?.hasAttribute('formmethod')) return;
    const action = new URL(form.getAttribute('action') || location.href, location.href);
    if (action.origin !== location.origin) return;
    event.preventDefault();
    if (busy) { message('前の送信が終わるまでお待ちください。'); return; }
    busy = true;
    const data = new FormData(form);
    if (event.submitter?.name) data.append(event.submitter.name, event.submitter.value);
    const buttons = [...form.elements].filter(el => 'disabled' in el && !el.disabled);
    buttons.forEach(el => { el.disabled = true; });
    form.setAttribute('aria-busy', 'true');
    message('保存しています…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    let received = false;
    try {
      const response = await fetch(action, { method: 'POST', body: data, credentials: 'same-origin', signal: controller.signal });
      received = true;
      const url = new URL(response.url);
      if (url.origin !== location.origin) throw new Error('origin');
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (!response.ok) {
        const reason = doc.querySelector('.flash.warn, [role="alert"]')?.textContent.trim();
        message(reason || (response.status === 403
          ? '操作の権限やログインを確認できませんでした。入力は残しています。別タブでログイン状態を確認してください。'
          : `サーバーからエラーが返りました（HTTP ${response.status}）。入力は残しています。再送する前に別タブで結果を確認してください。`), true);
        return;
      }
      const next = doc.getElementById('main-content');
      // ログイン切れや、別ページ・専用スクリプトへ移る処理はGETで開く。POSTは繰り返さない。
      if (url.pathname !== location.pathname || !next?.hasAttribute('data-office-inplace') || scripts(doc) !== scripts(document)) {
        location.assign(url.href); return;
      }
      const oldForms = forms(main), newForms = forms(next);
      const submittedIndex = oldForms.filter(item => key(item) === key(form)).indexOf(form);
      const resultCode = url.searchParams.get('msg') || url.searchParams.get('e') || '';
      const invalid = /invalid|failed|error|denied|locked|dup|guji|missing/.test(resultCode);
      const keep = oldForms.filter(other => (other !== form && hasChanges(other)) || (other === form && invalid));
      const pairs = keep.map(other => {
        const same = oldForms.filter(item => key(item) === key(other));
        return [other, newForms.filter(item => key(item) === key(other))[same.indexOf(other)]];
      });
      if (pairs.some(([, replacement]) => !replacement)) {
        message('送信は完了しました。ほかの入力を残しています。画面の再読み込みで最新の結果を確認できます。');
        dirty.delete(form); return;
      }
      const detailKey = el => el.id || el.querySelector('summary')?.textContent;
      const opened = new Map([...main.querySelectorAll('details')].filter(el => !el.closest('.office-multi')).map(el => [detailKey(el), el.open]));
      const y = scrollY;
      // 入力中の別フォームはDOMごと残す。ファイル・選択・イベントも失わない。
      pairs.forEach(([original, replacement]) => replacement.replaceWith(original));
      main.replaceChildren(...next.childNodes);
      main.querySelectorAll('details').forEach(el => { if (opened.has(detailKey(el))) el.open = opened.get(detailKey(el)); });
      document.title = doc.title;
      history.replaceState(null, '', url.pathname + url.search + location.hash);
      window.htmx?.process(main);
      document.dispatchEvent(new Event('office:updated'));
      buttons.forEach(el => { el.disabled = false; });
      const savedForm = forms(main).filter(item => key(item) === key(form))[submittedIndex];
      (savedForm?.querySelector('button[type=submit],button:not([type]),input[type=submit]') || main).focus({preventScroll:true});
      window.scrollTo(0, y);
      const result = main.querySelector('.flash');
      message(result?.textContent.trim() || '送信が完了しました。画面の結果を確認してください。');
    } catch {
      message(received
        ? '応答を受信しましたが、結果の表示に失敗しました。入力は残しています。二重送信を避けるため、再送する前に別タブで結果を確認してください。'
        : '通信を確認できませんでした。入力は残しています。二重送信を避けるため、再送する前に別タブで結果を確認してください。', true);
    } finally {
      clearTimeout(timer); busy = false;
      buttons.forEach(el => { el.disabled = false; });
      form.removeAttribute('aria-busy');
    }
  });

  // multiple selectを、追加選択に特殊キーが要らないチェックと確定に置き換える。
  let serial = 0;
  const enhance = () => main.querySelectorAll('select[multiple]').forEach(select => {
    if (select.dataset.officePicker || select.disabled || select.required || select.closest('[data-native-select]')) return;
    select.dataset.officePicker = 'true';
    const label = select.closest('label');
    const title = label?.querySelector('span')?.textContent || select.getAttribute('aria-label') || '複数選択';
    const wrapper = document.createElement('div'); wrapper.className = 'office-multi field';
    const heading = document.createElement('span'); heading.textContent = title; wrapper.append(heading);
    const details = document.createElement('details');
    const summary = document.createElement('summary'); details.append(summary);
    const filter = document.createElement('input'); filter.type = 'search'; filter.placeholder = '名前で絞り込む'; filter.setAttribute('aria-label', `${title}を検索`); details.append(filter);
    const list = document.createElement('div'); list.className = 'office-multi-options'; details.append(list);
    const entries = [...select.options].map(option => {
      const row = document.createElement('label'); row.className = 'check';
      const input = document.createElement('input'); input.type = 'checkbox'; input.disabled = option.disabled || !!option.closest('optgroup:disabled');
      const text = document.createElement('span'); text.textContent = option.textContent;
      row.append(input, text); list.append(row); return {option, row, input};
    });
    const buttons = document.createElement('div'); buttons.className = 'row-actions';
    const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = '選択を決定';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'やめる';
    buttons.append(apply, cancel); details.append(buttons); wrapper.append(details);
    const update = () => { summary.textContent = `${[...select.selectedOptions].length}件を選択中・変更`; };
    const reset = () => { entries.forEach(({option,input,row}) => { input.defaultChecked = option.defaultSelected; input.checked = option.selected; row.hidden = false; }); filter.value = ''; };
    details.addEventListener('toggle', () => { if (details.open) reset(); });
    filter.addEventListener('input', () => { const q = filter.value.normalize('NFKC').toLocaleLowerCase('ja'); entries.forEach(({row}) => { row.hidden = !row.textContent.normalize('NFKC').toLocaleLowerCase('ja').includes(q); }); });
    apply.addEventListener('click', () => {
      entries.forEach(({option,input}) => { if (!input.disabled) option.selected = input.checked; });
      select.dispatchEvent(new Event('change', {bubbles:true})); update(); details.open = false; summary.focus();
    });
    cancel.addEventListener('click', () => { reset(); details.open = false; summary.focus(); });
    select.addEventListener('change', update);
    select.form?.addEventListener('reset', () => setTimeout(() => { update(); reset(); }, 0));
    const anchor = label || select; anchor.after(wrapper); anchor.hidden = true; anchor.classList.add('office-multi-source');
    details.id = `office-multi-${++serial}`;
    update(); reset();
  });
  enhance();
  document.addEventListener('office:updated', enhance);
})();

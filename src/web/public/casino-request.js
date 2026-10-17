// 通信に失敗しても、賭けをもう一度POSTしない。確認はGETだけで行う。
(() => {
  let blocked = false;
  let warning;
  const timeoutMs = 20000;
  function recoveryUrl(action, data) {
    const current = new URL(location.href);
    const match = /^\/casino\/(slots|atslot)(?:\/\d+)?$/.exec(action.pathname);
    if (!match) return current.href;
    const url = new URL(`/casino/${match[1]}`, location.origin);
    url.searchParams.set('recover', '1');
    const machine = data.get('m') || current.searchParams.get('m');
    if (/^\d{1,2}$/.test(machine || '')) url.searchParams.set('m', machine);
    return url.href;
  }
  async function read(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, credentials: 'same-origin', signal: controller.signal });
      if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) throw new Error('response');
      const target = new URL(response.url || url, location.href);
      if (target.origin !== location.origin || !/^\/casino(?:\/|$)/.test(target.pathname)) throw new Error('destination');
      const html = await response.text();
      if (!new DOMParser().parseFromString(html, 'text/html').querySelector('.c-main')) throw new Error('page');
      return { html, url: target.href, redirected: response.redirected };
    } finally { clearTimeout(timer); }
  }
  function clear() {
    blocked = false;
    warning?.remove(); warning = undefined;
    document.dispatchEvent(new Event('c-request-recovered'));
  }
  function showRecovery(url, swap) {
    warning?.remove();
    warning = document.createElement('section');
    warning.className = 'c-network-warning';
    warning.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.textContent = '通信または画面の更新に失敗しました。賭けは受け付け済みの場合があります。もう一度賭けずに、結果を確認してください。';
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = '結果を確認して復帰';
    const link = document.createElement('a');
    link.href = url; link.textContent = '画面を開き直して確認';
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true; text.textContent = '結果を確認しています…';
      try {
        const result = await read(url, { method: 'GET', cache: 'no-store' });
        swap(result.html, result.url);
        clear();
      } catch {
        text.textContent = 'まだ確認できません。電波が戻ってから、もう一度「結果を確認して復帰」を押してください。賭けは送り直しません。';
        button.disabled = false;
      }
    });
    warning.append(text, button, link);
    const main = document.querySelector('.c-main');
    if (main) main.before(warning); else document.body.prepend(warning);
  }
  window.CasinoRequests = {
    blocked: () => blocked,
    async submit(form, submitter, swap) {
      if (blocked) return;
      const action = new URL(form.getAttribute('action') || location.href, location.href);
      const data = new FormData(form);
      if (submitter?.name && !data.has(submitter.name)) data.append(submitter.name, submitter.value);
      const recovery = recoveryUrl(action, data);
      blocked = true;
      try {
        const result = await read(action.href, { method: 'POST', body: new URLSearchParams(data), cache: 'no-store' });
        // POSTがその場でHTMLを返した場合も、履歴には元のGETページを残す。
        swap(result.html, result.redirected ? result.url : location.href);
        clear();
      } catch {
        // サーバーで処理済みか分からない。再送・操作用URLへの移動はしない。
        showRecovery(recovery, swap);
      }
    },
  };
})();

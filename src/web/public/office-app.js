(() => {
  'use strict';
  let installPrompt;
  const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const installHelp = text => document.querySelectorAll('[data-office-install-help]').forEach(el => { el.textContent = text; });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
  window.addEventListener('appinstalled', () => { installPrompt = null; installHelp('ホーム画面に追加しました。'); });
  if (installed()) installHelp('アプリとして開いています。');
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => installHelp('アプリの準備ができませんでした。接続を確認して再読み込みしてください。'));
  document.addEventListener('click', async event => {
    if (!event.target.closest('[data-office-install]')) return;
    if (installed()) return installHelp('アプリとして開いています。');
    if (!installPrompt) return installHelp('iPhone・iPad：Safariの共有 →「ホーム画面に追加」。Android：ブラウザのメニュー →「アプリをインストール」。項目がなければ対応ブラウザで開いてください。');
    await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null;
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || new URL(form.action, location.href).pathname !== '/logout' || form.dataset.officeLoggingOut) return;
    event.preventDefault();
    try {
      const subscription = await Promise.race([
        navigator.serviceWorker?.getRegistration('/').then(r => r?.pushManager.getSubscription()),
        new Promise(resolve => setTimeout(() => resolve(null), 1500)),
      ]);
      if (subscription) {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = 'pushEndpoint'; input.value = subscription.endpoint; form.append(input);
        void subscription.unsubscribe().catch(() => {});
      }
    } catch { /* 通知APIが使えなくてもログアウトは続ける。 */ } finally { form.dataset.officeLoggingOut = 'yes'; form.requestSubmit(); }
  }, true);
  const panel = document.getElementById('office-panel');
  document.querySelectorAll('[data-office-panel]').forEach(button => button.addEventListener('click', () => {
    const navToggle = document.getElementById('nav-toggle');
    if (navToggle?.checked && window.matchMedia('(max-width: 900px)').matches) { navToggle.checked = false; navToggle.dispatchEvent(new Event('change', { bubbles: true })); }
    panel?.showModal();
  }));
  panel?.addEventListener('click', event => { if (event.target === panel) { const r = panel.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) panel.close(); } });
  function initControls() {
  document.querySelectorAll('[data-office-preset]:not([data-office-bound])').forEach(button => { button.dataset.officeBound = 'yes'; button.addEventListener('click', () => {
    const pages = button.dataset.pages.split(','); const writes = button.dataset.writes.split(',');
    button.closest('form').querySelectorAll('select[name^="page_"]').forEach(select => { const page = select.name.slice(5); select.value = writes.includes(page) ? 'write' : pages.includes(page) ? 'read' : 'none'; });
    const confirm = button.closest('form').querySelector('[name="confirm"]'); if (confirm) confirm.checked = false;
  }); });
  document.querySelectorAll('[data-office-grant]:not([data-office-bound])').forEach(form => { form.dataset.officeBound = 'yes'; form.addEventListener('submit', event => {
    if (form.dataset.confirmed === 'yes') { delete form.dataset.confirmed; return; }
    event.preventDefault(); event.stopImmediatePropagation();
    const dialog = document.createElement('dialog'); dialog.className = 'office-sheet'; dialog.setAttribute('aria-label', '権限の保存確認');
    const title = document.createElement('h2'); title.textContent = 'この権限で保存しますか？';
    const content = document.createElement('p');
    const selects = [...form.querySelectorAll('select[name^="page_"]')];
    content.textContent = `見るだけ：${selects.filter(s => s.value === 'read').length}ページ ／ 操作できる：${selects.filter(s => s.value === 'write').length}ページ。保存後、次のアクセスから反映されます。`;
    const save = document.createElement('button'); save.type = 'button'; save.textContent = '保存する';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = '戻って見直す';
    save.addEventListener('click', () => { form.dataset.confirmed = 'yes'; dialog.close(); form.requestSubmit(); }); cancel.addEventListener('click', () => dialog.close());
    dialog.append(title, content, cancel, save); document.body.append(dialog); dialog.addEventListener('close', () => { dialog.remove(); form.querySelector('button[type="submit"]')?.focus(); }); dialog.showModal(); cancel.focus();
  }, true); });
  }
  initControls();
  document.addEventListener('office:updated', initControls);
  document.addEventListener('htmx:afterSwap', initControls);
  const writes = document.body.dataset.officeWrites;
  if (writes !== undefined) {
    const prefixes = JSON.parse(writes);
    const applyReadonly = () => document.querySelectorAll('form[method="post"]').forEach(form => {
      const path = new URL(form.action, location.href).pathname;
      if (['/logout', '/office/push/subscribe', '/office/push/unsubscribe'].includes(path) || prefixes.includes(path.split('/')[1] || '')) return;
      form.querySelectorAll('button, input:not([type="hidden"]), select, textarea').forEach(el => { el.disabled = true; });
      if (!form.dataset.officeReadonly) { form.dataset.officeReadonly = 'yes'; const note = document.createElement('p'); note.className = 'office-readonly'; note.textContent = 'この操作は閲覧のみです。変更する場合は宮司にご相談ください。'; form.prepend(note); }
    });
    applyReadonly(); document.addEventListener('htmx:afterSwap', applyReadonly); document.addEventListener('office:updated', applyReadonly);
    new MutationObserver(changes => { if (changes.some(c => [...c.addedNodes].some(n => n.nodeType === 1 && (n.matches?.('form') || n.querySelector?.('form'))))) applyReadonly(); }).observe(document.body, { childList: true, subtree: true });
  }
  function initPush() {
  const form = document.querySelector('[data-office-push]:not([data-office-bound])'); if (!form) return;
  form.dataset.officeBound = 'yes';
  const status = form.querySelector('[data-office-push-status]');
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  if (!supported) status.textContent = 'この環境では通知を利用できません。対応ブラウザ、またはホーム画面に追加したアプリから開いてください。';
  const getRegistration = async () => { const r = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' }); return r.active ? r : await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('アプリの準備に時間がかかっています。再読み込みしてください。')), 10000))]); };
  const post = async (path, data) => { const response = await fetch(path, { method: 'POST', body: data, headers: { 'x-csrf-token': form.elements._csrf.value } }); if (response.redirected) throw new Error('ログインし直してから設定してください。'); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || '設定を保存できませんでした。ログイン状態と接続を確認してください。'); };
  const busy = value => form.querySelectorAll('button').forEach(b => { b.disabled = value; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!supported) return;
    if (!form.querySelector('[name="topic"]:checked')) { status.textContent = '通知する項目を1つ以上選んでください。'; return; }
    busy(true);
    try {
      // 許可の要求はボタンを押した直後だけに行う。
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('通知が許可されていません。端末やブラウザの通知設定を確認してください。');
      const registration = await getRegistration();
      const base64 = form.dataset.publicKey.replace(/-/g, '+').replace(/_/g, '/');
      const key = Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), c => c.charCodeAt(0));
      let subscription = await registration.pushManager.getSubscription();
      const existingKey = subscription?.options.applicationServerKey;
      if (subscription && existingKey && (new Uint8Array(existingKey).length !== key.length || new Uint8Array(existingKey).some((v, i) => v !== key[i]))) { await subscription.unsubscribe(); subscription = null; }
      subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const data = new FormData(form); data.set('subscription', JSON.stringify(subscription));
      await post('/office/push/subscribe', data); status.textContent = '通知を登録しました。新しい対応待ちを約1分ごとにまとめてお知らせします。';
    } catch (error) { status.textContent = error.message; } finally { busy(false); }
  });
  form.querySelector('[data-office-unsubscribe]').addEventListener('click', async () => {
    busy(true);
    try {
      const registration = supported ? await navigator.serviceWorker.getRegistration('/') : undefined;
      const subscription = await registration?.pushManager.getSubscription();
      const data = new FormData(); if (subscription) data.set('endpoint', subscription.endpoint);
      await post('/office/push/unsubscribe', data); await subscription?.unsubscribe(); status.textContent = 'この端末への通知を止めました。';
    } catch (error) { status.textContent = error.message; } finally { busy(false); }
  });
  }
  initPush();
  document.addEventListener('office:updated', initPush);
})();

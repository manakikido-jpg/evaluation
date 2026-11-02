/* 管理画面・API・個人情報をキャッシュへ保存しない。 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.mode !== 'navigate' || url.origin !== self.location.origin || !url.pathname.startsWith('/office/')) return;
  event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>社務所</title><h1>通信につながっていません</h1><p>接続を確認して、もう一度開いてください。</p><a href="/office/app">もう一度開く</a></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })));
});
self.addEventListener('push', event => {
  // 配信内容をそのまま表示せず、決まった案内だけを出す。
  event.waitUntil(self.registration.showNotification('咲楽ノ宮 社務所', {
    body: '確認が必要なお知らせがあります。社務所を開いて確認してください。',
    icon: '/office-icon/192.png', badge: '/office-icon/192.png', tag: 'office-pending',
    data: { url: '/office/app' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL('/office/app', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url === url);
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  })());
});

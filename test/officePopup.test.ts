import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
const script = readFileSync(new URL('../src/web/public/popup.js', import.meta.url), 'utf8');
function browser() {
  const handlers: Record<string, Function> = {}, events: Record<string, Function> = {};
  class Element { textContent = '参加した人'; getAttribute(key: string) { return key === 'href' ? '/members/diff' : '/members/diff?popup=1'; } closest(selector: string) { return selector === '[data-popup]' ? this : null; } }
  const full = { hidden: true, href: '' };
  class Dialog extends Element {
    open = false;
    addEventListener(key: string, fn: Function) { handlers[key] = fn; }
    showModal() { this.open = true; }
    close() { this.open = false; handlers.close?.(); }
    querySelector() { return full; }
    closest() { return null; }
    getBoundingClientRect() { return { left: 100, right: 600, top: 20, bottom: 700 }; }
  }
  const dialog = new Dialog(), target = new Element();
  const body = { textContent: '', innerHTML: '', attrs: new Map(), setAttribute(k: string, v: string) { this.attrs.set(k, v); }, removeAttribute(k: string) { this.attrs.delete(k); }, replaceChildren() { this.innerHTML = ''; this.textContent = ''; } };
  const title = { textContent: '' };
  const pending: { resolve: (v: unknown) => void; signal: AbortSignal }[] = [];
  const fetch = vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise(resolve => pending.push({ resolve, signal: options.signal })));
  runInNewContext(script, { document: { getElementById: (id: string) => ({ popup: dialog, 'popup-body': body, 'popup-title': title })[id], addEventListener: (key: string, fn: Function) => { events[key] = fn; } }, HTMLDialogElement: Dialog, Element, URL, location: { origin: 'https://office.test', href: 'https://office.test/' }, AbortController, fetch });
  const click = (item: Element = target, x = 150, y = 100) => events.click!({ target: item, clientX: x, clientY: y, preventDefault: vi.fn() });
  const respond = (index: number, text: string, redirected = false) => pending[index]!.resolve({ ok: true, redirected, headers: { get: () => null }, text: async () => text });
  return { dialog, body, full, fetch, pending, click, respond };
}
it('閉じた詳細の遅い応答で、次の詳細を上書きしない', async () => {
  const b = browser();
  const first = b.click(); b.dialog.close();
  expect(b.pending[0]!.signal.aborted).toBe(true);
  const second = b.click();
  b.respond(1, '新しい詳細'); await second;
  b.respond(0, '古い詳細'); await first;
  expect(b.body.innerHTML).toBe('新しい詳細');
  expect(b.full.href).toBe('https://office.test/members/diff');
  b.dialog.close(); expect(b.body.innerHTML).toBe('');
});
it('パネル内の余白では閉じず、外側を押した場合だけ閉じる', async () => {
  const b = browser(); const loading = b.click();
  await b.click(b.dialog, 150, 100); expect(b.dialog.open).toBe(true);
  await b.click(b.dialog, 50, 100); expect(b.dialog.open).toBe(false);
  b.respond(0, '遅い詳細'); await loading;
  expect(b.body.innerHTML).toBe('');
});
it('ログインへの転送を詳細として埋め込まず、ページで開く案内を出す', async () => {
  const b = browser(); const loading = b.click(); b.respond(0, 'ログインフォーム', true); await loading;
  expect(b.body.innerHTML).toBe(''); expect(b.body.textContent).toContain('ページで開く');
  expect(b.body.attrs.has('aria-busy')).toBe(false);
});

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const script = readFileSync(new URL('../src/web/public/casino-request.js', import.meta.url), 'utf8');
class Element {
  children: Element[] = [];
  textContent = ''; disabled = false; href = ''; type = ''; className = '';
  events = new Map<string, () => Promise<void>>();
  setAttribute() {}
  append(...nodes: Element[]) { this.children.push(...nodes); }
  addEventListener(name: string, fn: () => Promise<void>) { this.events.set(name, fn); }
  remove() {}
}
function browser() {
  let notice: Element | undefined;
  const fetch = vi.fn();
  const location = { href: 'https://casino.example/casino/slots?m=2', origin: 'https://casino.example' };
  const main = { before: (el: Element) => { notice = el; } };
  const document = { createElement: () => new Element(), querySelector: () => main, body: { prepend: (el: Element) => { notice = el; } }, dispatchEvent: vi.fn() };
  const form = { getAttribute: () => '/casino/slots', submit: vi.fn(), data: [['m', '2'], ['bet', '30']] };
  const window: { CasinoRequests?: { blocked: () => boolean; submit: (f: unknown, by: unknown, swap: unknown) => Promise<void> } } = {};
  class FormData extends Map { constructor(f: typeof form) { super(); for (const [k,v] of f.data) this.set(k!, v!); } append(k: string, v: string) { this.set(k, v); } }
  class DOMParser { parseFromString(html: string) { return { querySelector: () => html.includes('class="c-main"') ? {} : null }; } }
  runInNewContext(script, { window, document, location, fetch, URL, URLSearchParams, FormData, DOMParser, AbortController, setTimeout, clearTimeout, Event });
  const swap = vi.fn();
  return { fetch, form, swap, location, api: window.CasinoRequests!, notice: () => notice!, recover: () => notice!.children[1]!.events.get('click')!() };
}
function response(opts: { ok?: boolean; html?: string; url?: string; type?: string; redirected?: boolean } = {}) {
  return { ok: opts.ok ?? true, url: opts.url ?? 'https://casino.example/casino/slots?g=12', redirected: opts.redirected ?? true,
    headers: new Headers({ 'content-type': opts.type ?? 'text/html' }), text: async () => opts.html ?? '<main class="c-main">結果</main>' };
}
describe('カジノの通信失敗からの復帰', () => {
  it('送信後の通信切れでもPOSTは一度だけ。画面を残し、復帰はGETだけ', async () => {
    const b = browser();
    b.fetch.mockRejectedValueOnce(new Error('response lost'));
    await b.api.submit(b.form, null, b.swap);
    expect(b.form.submit).not.toHaveBeenCalled();
    expect(b.fetch).toHaveBeenCalledTimes(1);
    expect(b.swap).not.toHaveBeenCalled();
    expect(b.location.href).toContain('?m=2');
    expect(b.api.blocked()).toBe(true);
    expect(b.notice().children[0]!.textContent).toContain('受け付け済み');
    await b.api.submit(b.form, null, b.swap);
    expect(b.fetch).toHaveBeenCalledTimes(1);
    b.fetch.mockResolvedValueOnce(response());
    await b.recover();
    expect(b.fetch.mock.calls[1]![0]).toBe('https://casino.example/casino/slots?recover=1&m=2');
    expect(b.fetch.mock.calls[1]![1].method).toBe('GET');
    expect(b.swap).toHaveBeenCalledOnce();
    expect(b.api.blocked()).toBe(false);
  });
  it.each([
    response({ ok: false }),
    response({ type: 'application/json' }),
    response({ html: '<h1>見つかりません</h1>' }),
    response({ url: 'https://other.example/casino' }),
  ])('HTTPエラーや画面が不完全な場合も、ページ移動・再送をしない', async result => {
    const b = browser(); b.fetch.mockResolvedValueOnce(result);
    await b.api.submit(b.form, null, b.swap);
    expect(b.swap).not.toHaveBeenCalled();
    expect(b.form.submit).not.toHaveBeenCalled();
    expect(b.api.blocked()).toBe(true);
    expect(b.location.href).toContain('/casino/slots?m=2');
  });
  it('復帰に失敗しても、次の確認もGETだけで再試行できる', async () => {
    const b = browser(); b.fetch.mockRejectedValue(new Error('offline'));
    await b.api.submit(b.form, null, b.swap); await b.recover(); await b.recover();
    expect(b.fetch.mock.calls.map(c => c[1].method)).toEqual(['POST', 'GET', 'GET']);
    expect(b.notice().children[1]!.disabled).toBe(false);
    expect(b.api.blocked()).toBe(true);
  });
  it('画面差し替えのJSが失敗しても、賭けを送り直さない', async () => {
    const b = browser(); b.fetch.mockResolvedValueOnce(response()); b.swap.mockImplementationOnce(() => { throw new Error('render'); });
    await b.api.submit(b.form, null, b.swap);
    expect(b.fetch).toHaveBeenCalledOnce(); expect(b.form.submit).not.toHaveBeenCalled(); expect(b.api.blocked()).toBe(true);
  });
  it('POSTがHTMLを直接返した場合、操作専用URLをブラウザ履歴へ入れない', async () => {
    const b = browser(); b.form.getAttribute = () => '/casino/slots/12';
    b.fetch.mockResolvedValueOnce(response({ redirected: false, url: 'https://casino.example/casino/slots/12' }));
    await b.api.submit(b.form, { name: 'action', value: 'assist' }, b.swap);
    expect(b.swap.mock.calls[0]![1]).toBe(b.location.href);
    expect(String(b.fetch.mock.calls[0]![1].body)).toContain('action=assist');
  });
  it('返事が来ない場合はタイムアウトで画面上に案内する', async () => {
    vi.useFakeTimers();
    try {
      const b = browser();
      b.fetch.mockImplementation((_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted')))));
      const sending = b.api.submit(b.form, null, b.swap);
      await vi.advanceTimersByTimeAsync(20000); await sending;
      expect(b.notice().children[0]!.textContent).toContain('通信');
      expect(b.form.submit).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
it('購入後の部分更新で削る操作を初期化し、同じ画面には二重登録しない', () => {
  let current: ReturnType<typeof ticket> | null = null;
  const events = new Map<string, () => void>();
  function ticket() {
    const ctx = { fillRect: vi.fn(), fillText: vi.fn() };
    const canvas = { getContext: () => ctx, addEventListener: vi.fn(), width: 600, height: 280 };
    const form = { addEventListener: vi.fn() };
    return { dataset: { opened: 'no' }, ctx, canvas, form, querySelector: (selector: string) => selector === 'canvas' ? canvas : selector === '[data-scratch-form]' ? form : {} };
  }
  runInNewContext(readFileSync(new URL('../src/web/public/fortune.js', import.meta.url), 'utf8'), { document: { querySelectorAll: () => [], querySelector: () => current, addEventListener: (name: string, fn: () => void) => events.set(name, fn) } });
  expect(events.has('c-page-swapped')).toBe(true);
  current = ticket();events.get('c-page-swapped')!();
  expect(current.ctx.fillRect).toHaveBeenCalledOnce();
  expect(current.canvas.addEventListener.mock.calls.map(c => c[0])).toEqual(['pointerdown','pointermove','pointerup','pointercancel']);
  expect(current.form.addEventListener).toHaveBeenCalledWith('submit', expect.any(Function));
  events.get('c-page-swapped')!();expect(current.ctx.fillRect).toHaveBeenCalledOnce();
  current = ticket();events.get('c-page-swapped')!();expect(current.ctx.fillRect).toHaveBeenCalledOnce();
});

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../src/web/public/theme.js', import.meta.url), 'utf8');
function browser(saved: string | null = null, dark = false, blocked = false) {
  const events = new Map<string, (e?: any) => void>();
  const root = { dataset: {} as Record<string, string> };
  const status = { textContent: '' };
  const select = { value: '', disabled: true, addEventListener: (key: string, fn: () => void) => events.set(`select:${key}`, fn) };
  const media = { matches: dark, addEventListener: (_: string, fn: () => void) => events.set('media', fn) };
  const document = { documentElement: root, querySelectorAll: (q: string) => q === '[data-theme-choice]' ? [select] : [status], addEventListener: (key: string, fn: () => void) => events.set(key, fn) };
  const storage = { getItem: () => { if (blocked) throw Error('blocked'); return saved; }, setItem: (_: string, value: string) => { if (blocked) throw Error('blocked'); saved = value; } };
  runInNewContext(script, { document, localStorage: storage, window: { matchMedia: () => media, addEventListener: (key: string, fn: (e: any) => void) => events.set(key, fn) } });
  events.get('DOMContentLoaded')!();
  return { root, select, status, saved: () => saved, choose: (value: string) => { select.value = value; events.get('select:change')!(); }, system: (value: boolean) => { media.matches = value; events.get('media')!(); }, otherTab: (value: string | null) => events.get('storage')!({ key: 'shamusho-theme', newValue: value }) };
}
describe('社務所の表示色', () => {
  it('保存したライトは暗い端末でも優先し、選んだ色を次の画面まで覚える', () => {
    const b = browser('light', true);
    expect(b.root.dataset.theme).toBe('light');
    expect(b.select.disabled).toBe(false);
    b.choose('dark');
    expect(b.saved()).toBe('dark');
    expect(browser(b.saved()).root.dataset.theme).toBe('dark');
    b.system(false);
    expect(b.root.dataset.theme).toBe('dark');
  });
  it('端末に合わせる選択は、開いている間の端末変更にも従う', () => {
    const b = browser('invalid');
    expect(b.select.value).toBe('auto');
    b.system(true);
    expect(b.root.dataset.theme).toBe('dark');
    b.choose('light');
    b.system(true);
    expect(b.root.dataset.theme).toBe('light');
    b.choose('auto');
    expect(b.root.dataset.theme).toBe('dark');
  });
  it('保存が禁止されていても色を切り替え、保存できないことを知らせる', () => {
    const b = browser(null, false, true);
    b.choose('dark');
    expect(b.root.dataset.theme).toBe('dark');
    expect(b.status.textContent).toContain('保存できません');
  });
  it('ほかのタブの変更と保存の削除を反映する', () => {
    const b = browser('light', true);
    b.otherTab('dark');
    expect(b.select.value).toBe('dark');
    b.otherTab(null);
    expect(b.select.value).toBe('auto');
    expect(b.root.dataset.theme).toBe('dark');
  });
});

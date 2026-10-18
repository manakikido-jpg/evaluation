import { expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

it('作業の入口から参照する引き継ぎ資料と、そのローカルリンクが存在する', () => {
  const root = resolve(import.meta.dirname, '..');
  for (const relative of ['AGENTS.md', 'docs/admin.md', 'docs/user-decisions.md', 'docs/work-notes.md']) {
    const file = resolve(root, relative);
    const content = readFileSync(file, 'utf8');
    if (relative !== 'docs/user-decisions.md') expect(content).toMatch(/\]\([^)]*user-decisions\.md\)/);
    if (relative !== 'docs/work-notes.md') expect(content).toMatch(/\]\([^)]*work-notes\.md\)/);
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+\.md)(?:#[^)]*)?\)/g)) {
      if (/^https?:/.test(match[1]!)) continue;
      expect(existsSync(resolve(dirname(file), match[1]!)), `${relative}: ${match[1]}`).toBe(true);
    }
  }
});

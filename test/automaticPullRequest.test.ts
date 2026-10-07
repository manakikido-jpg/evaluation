import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const openPullRequest = createRequire(import.meta.url)('../.github/scripts/open-pull-request.cjs');

function fixture() {
  const context = { repo: { owner: 'example', repo: 'bot' }, eventName: 'push', ref: 'refs/heads/codex/fix', sha: 'checked', serverUrl: 'https://github.com', runId: 123 };
  const create = vi.fn(async () => ({ data: { html_url: 'https://github.com/example/bot/pull/1' } }));
  const list = vi.fn(async () => ({ data: [] as { html_url: string }[] }));
  const getRef = vi.fn(async () => ({ data: { object: { sha: 'checked' } } }));
  const compare = vi.fn(async () => ({ data: { ahead_by: 1 } }));
  const github = { rest: { git: { getRef }, pulls: { create, list }, repos: { compareCommitsWithBasehead: compare } } };
  return { context, github, core: { info: vi.fn() }, create, list, getRef, compare };
}
describe('確認用PRの自動作成', () => {
  it('確認済みコミットから本番向けの下書きPRを作る', async () => {
    const f = fixture(); await openPullRequest(f);
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ base: 'claude/compassionate-sagan-8fqy8p', head: 'codex/fix', draft: true, body: expect.stringContaining('actions/runs/123') }));
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it('既存PRを重複作成せず、説明も上書きしない', async () => {
    const f = fixture(); f.list.mockResolvedValue({ data: [{ html_url: 'existing' }] });
    await openPullRequest(f); expect(f.create).not.toHaveBeenCalled(); expect(f.compare).not.toHaveBeenCalled();
  });
  it('新しい未確認のpushや合流済みの変更からは作らない', async () => {
    const f = fixture(); f.getRef.mockResolvedValue({ data: { object: { sha: 'new-unchecked' } } });
    await openPullRequest(f); expect(f.create).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled();
    const merged = fixture(); merged.compare.mockResolvedValue({ data: { ahead_by: 0 } });
    await openPullRequest(merged); expect(merged.create).not.toHaveBeenCalled();
  });
  it('本番・別のブランチ・PRのイベントでは操作しない', async () => {
    for (const values of [{ ref: 'refs/heads/claude/compassionate-sagan-8fqy8p' }, { ref: 'refs/heads/other' }, { eventName: 'pull_request' }]) {
      const f = fixture(); Object.assign(f.context, values); await openPullRequest(f);
      expect(f.getRef).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
    }
  });
});

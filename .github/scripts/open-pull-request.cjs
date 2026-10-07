/** テストに通った自分のブランチから、Claude確認用の下書きPRを作る。 */
module.exports = async function openPullRequest({ github, context, core }) {
  const { owner, repo } = context.repo;
  if (context.eventName !== 'push' || !context.ref.startsWith('refs/heads/codex/')) return;
  const head = context.ref.slice('refs/heads/'.length);
  const base = 'claude/compassionate-sagan-8fqy8p';
  const { data: ref } = await github.rest.git.getRef({ owner, repo, ref: `heads/${head}` });
  if (ref.object.sha !== context.sha) {
    core.info('新しいpushがあるため、そのテストの完了を待ちます。');
    return;
  }
  const { data: existing } = await github.rest.pulls.list({ owner, repo, state: 'open', head: `${owner}:${head}`, base });
  if (existing.length) {
    core.info(`確認用PRは作成済みです: ${existing[0].html_url}`);
    return;
  }
  const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${base}...${head}` });
  if (!comparison.ahead_by) {
    core.info('本番へ追加するコミットはありません。');
    return;
  }
  const run = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
  const { data: pr } = await github.rest.pulls.create({
    owner, repo, head, base, draft: true,
    title: `確認をお願いします: ${head}`,
    body: [
      `\`${head}\` の変更を、本番担当のClaudeが確認するための下書きPRです。`,
      `CIで依存関係のインストール・型チェック・全テスト・ビルドが成功しました。\n[確認結果](${run})\n確認したコミット: \`${context.sha}\``,
      '変更の説明は差分内の `src/changelog.ts` と `docs/admin.md` を確認してください。',
      'Claudeが中身を確認し、本番の最新変更との競合を調整して、全テストを通してから合流してください。承認・合流は自動で行いません。',
    ].join('\n\n'),
  });
  core.info(`確認用PRを作りました: ${pr.html_url}`);
};

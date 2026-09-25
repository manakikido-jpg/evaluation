/**
 * 起動時によくある失敗を、日本語の直し方つきで説明する。
 * （コードの不具合ではなく、Developer Portal や .env の設定が原因のもの）
 */
export function explainStartupError(err: unknown): string | undefined {
  const message = err instanceof Error ? err.message : String(err);
  if (/disallowed intents/i.test(message)) {
    return [
      'Developer Portal で「SERVER MEMBERS INTENT」が OFF になっています。',
      '→ https://discord.com/developers/applications → アプリ → 左の「Bot」→「Privileged Gateway Intents（特権ゲートウェイインテント）」の',
      '  「SERVER MEMBERS INTENT（サーバーメンバーインテント）」のスイッチを ON にして「変更を保存する」。',
      '  保存すると、BOT は自動で起動し直します（すぐ試すなら docker compose restart bot）。',
    ].join('\n');
  }
  if (/invalid token|TokenInvalid|401/i.test(message)) {
    return [
      'BOT のトークンが正しくありません。',
      '→ Developer Portal → 左の「Bot」→「Reset Token」で新しいトークンを出し、.env の DISCORD_TOKEN に貼り直してください',
      '  （前後に空白や " を入れない）。そのあと docker compose restart bot。',
    ].join('\n');
  }
  if (/ECONNREFUSED|getaddrinfo .*db|password authentication failed/i.test(message)) {
    return [
      'データベースに接続できません。',
      '→ docker compose ps で db が動いているか確認してください。.env の DATABASE_URL は見本のままにしておくのがおすすめです。',
    ].join('\n');
  }
  if (/ENOENT.*guild\.json|EISDIR/i.test(message)) {
    return [
      'config/guild.json が見つかりません（または、フォルダになってしまっています）。',
      '→ docker compose run --rm setup --guild （サーバー ID） で作るか、config/guild.example.json をコピーして作ってください。',
      '  config/guild.json がフォルダになっていたら、rm -r config/guild.json で消してから作り直してください。',
    ].join('\n');
  }
  return undefined;
}

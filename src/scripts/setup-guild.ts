/**
 * ロールとチャンネルを自動で作り、config/guild.json を書く。
 *
 *   npm run setup-guild -- --guild <サーバー ID> [--minimal] [--dry-run] [--post-panels]
 *   （Docker: docker compose run --rm setup --guild <サーバー ID>）
 *
 * 何度実行しても安全（同じ名前のロール・チャンネルがあれば作らずに使う）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseGuildConfig } from '../config.js';
import { applyLayout, mergeIntoConfig, SetupError, type SetupApi } from '../setup/apply.js';
import { FULL, MINIMAL } from '../setup/layout.js';

const API = 'https://discord.com/api/v10';

function createSetupApi(token: string): SetupApi {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { authorization: `Bot ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      // 作る数が多いと Discord に「少し待って」と言われるので、言われた秒数だけ待つ
      if (res.status === 429 && attempt < 10) {
        const j = (await res.json().catch(() => ({}))) as { retry_after?: number };
        await new Promise((r) => setTimeout(r, Math.ceil((j.retry_after ?? 1) * 1000) + 250));
        continue;
      }
      if (res.status === 401) throw new SetupError('トークンが正しくありません（.env の DISCORD_TOKEN を確認してください）。');
      if (res.status === 403) throw new SetupError(`権限が足りません（${method} ${path}）。BOT に「管理者」権限を付けてから実行してください。`);
      if (res.status === 404 && path.startsWith('/guilds/') && method === 'GET') {
        throw new SetupError('サーバーが見つかりません。サーバー ID が正しいか、BOT がそのサーバーに招待されているか確認してください。');
      }
      if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text().catch(() => '')}`);
      return (res.status === 204 ? undefined : await res.json()) as T;
    }
  };
  return {
    me: () => call('GET', '/users/@me'),
    guild: (g) => call('GET', `/guilds/${g}`),
    roles: (g) => call('GET', `/guilds/${g}/roles`),
    member: (g, u) => call('GET', `/guilds/${g}/members/${u}`),
    createRole: (g, body) => call('POST', `/guilds/${g}/roles`, body),
    channels: (g) => call('GET', `/guilds/${g}/channels`),
    createChannel: (g, body) => call('POST', `/guilds/${g}/channels`, body),
    modifyGuild: async (g, body) => void (await call('PATCH', `/guilds/${g}`, body)),
    sendMessage: async (c, body) => void (await call('POST', `/channels/${c}/messages`, body)),
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  // 「（123…）」のように手順書のかっこごと貼られても、数字だけ取り出す
  const guildId = arg('guild')?.replace(/[\s()（）<>＜＞「」]/g, '');
  const configPath = arg('config') ?? process.env.GUILD_CONFIG ?? 'config/guild.json';
  if (!token) throw new SetupError('.env に DISCORD_TOKEN を書いてください。');
  if (!guildId || !/^\d{17,20}$/.test(guildId)) {
    throw new SetupError('サーバー ID を指定してください: --guild 123456789012345678（サーバー名を右クリック →「サーバー ID をコピー」）');
  }
  const layout = flag('minimal') ? MINIMAL : FULL;
  const dryRun = flag('dry-run');

  console.log(`⛩ セットアップを始めます（${flag('minimal') ? 'テスト用の最小構成' : '全部の構成'}${dryRun ? '・確認だけ' : ''}）`);
  const r = await applyLayout(createSetupApi(token), guildId, layout, { postPanels: flag('post-panels'), dryRun });

  console.log(`\nサーバー: ${r.guildName}`);
  console.log(`ロール: 作成 ${r.created.roles.length} ・ 既存を使用 ${r.reused.roles}`);
  for (const n of r.created.roles) console.log(`  + ${n}`);
  console.log(`チャンネル: 作成 ${r.created.channels.length} ・ 既存を使用 ${r.reused.channels}`);
  for (const n of r.created.channels) console.log(`  + ${n}`);
  for (const p of r.panelsPosted) console.log(`申請ボタンを置きました: ${p}`);
  for (const w of r.warnings) console.log(`\n⚠️  ${w}`);

  if (dryRun) {
    console.log('\n（確認だけなので、何も作っていません。--dry-run を外すと作ります）');
    return;
  }

  const base = JSON.parse(readFileSync(existsSync(configPath) ? configPath : 'config/guild.example.json', 'utf8')) as Record<string, unknown>;
  const merged = mergeIntoConfig(base, guildId, r);
  parseGuildConfig(merged); // おかしな設定なら書き込まない
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\n✅ ${configPath} に ID を書き込みました。`);
  console.log('次にすること:');
  let n = 1;
  if (r.warnings.length) console.log(`  ${n++}. サーバー設定 → ロール で、BOT のロールをいちばん上にドラッグして保存（上の ⚠️ のとおり）`);
  console.log(`  ${n++}. 自分に「⛩ 宮司」ロールを付ける`);
  console.log(`  ${n++}. BOT の「管理者」権限を OFF に戻す（そのままでも動きます）`);
  console.log(`  ${n++}. BOT を起動（または再起動）: docker compose restart bot（初めてなら docs/deploy-vps.md の「6. 起動」）`);
}

main().catch((err) => {
  console.error(err instanceof SetupError ? `\n❌ ${err.message}` : err);
  process.exit(1);
});

/**
 * 社務所Web の ID とパスワードを、VPS から作る・直す（最初の宮司の分など）。
 *
 *   docker compose run --rm web node dist/scripts/web-account.js add <ID> [--guji | --shinshoku] [--name 名前]
 *   docker compose run --rm web node dist/scripts/web-account.js reset <ID>     … パスワードを作り直す
 *   docker compose run --rm web node dist/scripts/web-account.js enable <ID>    … 止めたのを戻す（ロックも外す）
 *   docker compose run --rm web node dist/scripts/web-account.js list
 *
 * パスワードは画面に 1 回だけ出す（DB にはハッシュだけ）。標準は --guji。
 */
import { connectDb } from '../db/client.js';
import { accountByLoginId, createAccount, listAccounts, resetPassword, setDisabled } from '../services/webAccounts.js';

async function main(): Promise<void> {
  const [cmd, loginId, ...rest] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL がありません（.env を確かめてください）');
  const { db, close } = await connectDb(url);
  try {
    if (cmd === 'list') {
      for (const a of await listAccounts(db)) {
        console.log(`${a.loginId}\t${a.level === 'guji' ? '宮司' : '神職'}\t${a.name}${a.disabled ? '\t（止めている）' : ''}`);
      }
      return;
    }
    if (!loginId) throw new Error('ID を入れてください（例: add miyaji --guji --name 宮司）');
    if (cmd === 'add') {
      const nameAt = rest.indexOf('--name');
      const name = nameAt >= 0 ? (rest[nameAt + 1] ?? '') : loginId;
      const level = rest.includes('--shinshoku') ? 'shinshoku' : 'guji';
      const r = await createAccount(db, { loginId, name, level, pages: null }, 'cli');
      if (r.status === 'bad_id') throw new Error('ID は英小文字・数字・「_ . -」で 3〜32 文字にしてください');
      if (r.status === 'taken') throw new Error('その ID はもうあります（パスワードを作り直すなら reset）');
      if (r.status === 'bad_name') throw new Error('名前を入れてください');
      console.log(`\n✅ ${level === 'guji' ? '宮司' : '神職'}のアカウントを作りました\n   ID: ${r.account.loginId}\n   パスワード: ${r.password}\n\n（パスワードはこの 1 回だけ出ます。メモしてから、この画面を閉じてください）\n`);
      return;
    }
    const a = await accountByLoginId(db, loginId);
    if (!a) throw new Error('その ID のアカウントはありません（list で見られます）');
    if (cmd === 'reset') {
      const r = await resetPassword(db, a.id);
      if (r.status === 'ok') console.log(`\n✅ パスワードを作り直しました\n   ID: ${a.loginId}\n   パスワード: ${r.password}\n`);
      return;
    }
    if (cmd === 'enable') {
      await setDisabled(db, a.id, false);
      console.log(`✅ ${a.loginId} を使えるようにしました`);
      return;
    }
    throw new Error('使い方: add <ID> [--guji|--shinshoku] [--name 名前] / reset <ID> / enable <ID> / list');
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

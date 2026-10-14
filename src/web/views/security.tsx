import type { AdminSession, SecurityWatchRow } from '../../db/schema.js';
import { WATCH_REASON_MAX } from '../../services/securityWatch.js';
import { Layout } from './layout.js';

const FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  added: { text: '🛡 要注意リストに入れました。この人が入ってきたら、ログに知らせます。案内人はロールを付けられません。', kind: 'ok' },
  removed: { text: '要注意リストから外しました。', kind: 'ok' },
  invalid: { text: 'ユーザーID（数字）と理由を入れてください。', kind: 'warn' },
  not_found: { text: 'リストにいない人です。', kind: 'warn' },
  guard_saved: { text: '🛡 ロールの見張りの設定を保存しました。', kind: 'ok' },
  guard_invalid: { text: 'BOT のID（数字）を 1 行に 1 つずつ入れてください。', kind: 'warn' },
};

const fmtDate = (d: Date) => d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' });

/** 🛡 荒らし対策: 要注意リスト */
export function SecurityPage(props: { session: AdminSession; rows: SecurityWatchRow[]; names: Map<string, string>; flash?: string; guard: { roleGuard: 'off' | 'alert' | 'revert'; trustedBotIds: string[] } }) {
  const { session } = props;
  const guji = session.level === 'guji';
  const f = props.flash && Object.hasOwn(FLASH, props.flash) ? FLASH[props.flash] : undefined;
  const csrf = <input type="hidden" name="_csrf" value={session.csrfToken} />;
  return (
    <Layout title="荒らし対策" session={session} nav="security">
      <h1>🛡 荒らし対策</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <section class="card">
        <h2>BOT を通さないロールの変更</h2>
        <p class="note">
          このBOT・下の「信用する BOT」・宮司・サーバーの持ち主・本人の選択（参加時の質問など）以外の人がロールを変えたら、ログに知らせます。「元に戻す」にすると、BOT
          がすぐ元に戻します。案内人・神職がロールを変えるときは、BOT のボタンやコマンドを使ってください。いまの設定:{' '}
          <b>{props.guard.roleGuard === 'off' ? '見張らない' : props.guard.roleGuard === 'alert' ? '知らせるだけ' : '元に戻して知らせる'}</b>
        </p>
        {guji && (
          <form method="post" action="/security/settings">
            {csrf}
            <label class="field">
              <span>見張り方</span>
              <select name="roleGuard">
                <option value="off" selected={props.guard.roleGuard === 'off'}>見張らない</option>
                <option value="alert" selected={props.guard.roleGuard === 'alert'}>知らせるだけ</option>
                <option value="revert" selected={props.guard.roleGuard === 'revert'}>元に戻して知らせる</option>
              </select>
            </label>
            <label class="field">
              <span>信用する BOT のID（1 行に 1 つ。K-PRO の認証・リアクションロールなど、ロールを付ける BOT を入れてください）</span>
              <textarea name="trustedBotIds" rows={3}>{props.guard.trustedBotIds.join('\n')}</textarea>
            </label>
            <button type="submit" class="ok">保存する</button>
          </form>
        )}
      </section>
      <section class="card">
        <h2>要注意リスト</h2>
        <p class="note">
          他のサーバーで荒らしをしている人などを入れておきます。この人が入ってくると、運営のログに知らせます。案内待ちのまま止まり、案内人は参拝者ロールを付けられません。入鯖申請も自動では承認しません。どうするか（案内する・BAN
          する）は、神職・宮司が決めてください。
        </p>
        <form method="post" action="/security/watch">
          {csrf}
          <label class="field">
            <span>ユーザーID（Discord の「ユーザーIDをコピー」で取れる数字）</span>
            <input type="text" name="memberId" inputmode="numeric" pattern="\d{15,25}" required />
          </label>
          <label class="field">
            <span>理由（どこで何をしたか。運営だけが見ます）</span>
            <input type="text" name="reason" maxlength={WATCH_REASON_MAX} required />
          </label>
          <button type="submit" class="ok">リストに入れる</button>
        </form>
        {props.rows.length === 0 ? (
          <p class="note">まだだれもいません。</p>
        ) : (
          <table class="compact">
            <thead>
              <tr>
                <th>人</th>
                <th>理由</th>
                <th>入れた人・日時</th>
                {guji && <th></th>}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((r) => (
                <tr>
                  <td>
                    <a href={`/members/${r.memberId}`}>{props.names.get(r.memberId) ?? r.memberId}</a>
                    <br />
                    <small class="note">{r.memberId}</small>
                  </td>
                  <td>{r.reason}</td>
                  <td>
                    {props.names.get(r.addedBy) ?? r.addedBy}
                    <br />
                    <small class="note">{fmtDate(r.addedAt)}</small>
                  </td>
                  {guji && (
                    <td>
                      <form method="post" action={`/security/watch/${r.memberId}/delete`}>
                        {csrf}
                        <button type="submit" class="danger">外す</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p class="note">リストに入れるのは神職・宮司、外すのは宮司だけです。どちらも記録に残ります。</p>
      </section>
    </Layout>
  );
}

import type { AdminSession, RoleRequestRow, SecurityWatchRow } from '../../db/schema.js';
import { WATCH_REASON_MAX } from '../../services/securityWatch.js';
import type { RaidState } from '../../services/raid.js';
import { Layout } from './layout.js';

const FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  added: { text: '🛡 要注意リストに入れました。この人が入ってきたら、ログに知らせます。案内人はロールを付けられません。', kind: 'ok' },
  removed: { text: '要注意リストから外しました。', kind: 'ok' },
  invalid: { text: 'ユーザーID（数字）と理由を入れてください。', kind: 'warn' },
  not_found: { text: 'リストにいない人です。', kind: 'warn' },
  guard_saved: { text: '🛡 ロールの見張りの設定を保存しました。', kind: 'ok' },
  guard_invalid: { text: 'BOT のID（数字）を 1 行に 1 つずつ入れてください。', kind: 'warn' },
  raid_started: { text: '🚨 警戒モードにしました。', kind: 'ok' },
  raid_ended: { text: '警戒モードを終えました。', kind: 'ok' },
  raid_invalid: { text: '数字を確かめてください。', kind: 'warn' },
};

const fmtDate = (d: Date) => d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' });

/** 🛡 荒らし対策: 要注意リスト */
export function SecurityPage(props: {
  session: AdminSession;
  rows: SecurityWatchRow[];
  names: Map<string, string>;
  flash?: string;
  guard: { roleGuard: 'off' | 'alert' | 'revert'; trustedBotIds: string[]; roleApproval: boolean; freeRoleIds: string[]; raidJoins: number; raidMinutes: number; raidHoldMinutes: number; newAccountDays: number };
  raid: RaidState | null;
  roles: { id: string; name: string }[];
  requests: RoleRequestRow[];
}) {
  const { session } = props;
  const guji = session.level === 'guji';
  const f = props.flash && Object.hasOwn(FLASH, props.flash) ? FLASH[props.flash] : undefined;
  const csrf = <input type="hidden" name="_csrf" value={session.csrfToken} />;
  return (
    <Layout title="荒らし対策" session={session} nav="security">
      <h1>🛡 荒らし対策</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <section class="card">
        <h2>🚨 警戒モード（レイド検知）</h2>
        <p class="note">
          {props.guard.raidJoins > 0
            ? `${props.guard.raidMinutes} 分で ${props.guard.raidJoins} 人以上入ると、自動で ${props.guard.raidHoldMinutes} 分の警戒モードになり、ログに知らせます。`
            : '自動の検知はオフです。'}
          警戒モードの間は、案内人のロール付与と入鯖申請の自動承認を止めます（荒らしのタイムアウトは K-PRO に任せます）。作って {props.guard.newAccountDays} 日以内のアカウントが入ったら、ログと案内の通知に「🐣 新しいアカウント」と出します（0 日で出さない）。
        </p>
        <p>
          いま:{' '}
          <b>{props.raid ? `🚨 警戒モード中（${fmtDate(new Date(props.raid.until))} まで）` : 'ふだんどおり'}</b>
        </p>
        <form method="post" action={props.raid ? '/security/raid/end' : '/security/raid/start'}>
          {csrf}
          <button type="submit" class={props.raid ? 'ok' : 'danger'}>
            {props.raid ? '警戒モードを終える' : `いますぐ警戒モードにする（${props.guard.raidHoldMinutes} 分）`}
          </button>
        </form>
        {guji && (
          <form method="post" action="/security/raid/settings">
            {csrf}
            <label class="field">
              <span>何分で</span>
              <input type="number" name="raidMinutes" min={1} max={60} value={String(props.guard.raidMinutes)} required />
            </label>
            <label class="field">
              <span>何人入ったら（0 で自動の検知をしない）</span>
              <input type="number" name="raidJoins" min={0} max={1000} value={String(props.guard.raidJoins)} required />
            </label>
            <label class="field">
              <span>警戒モードの長さ（分）</span>
              <input type="number" name="raidHoldMinutes" min={5} max={1440} value={String(props.guard.raidHoldMinutes)} required />
            </label>
            <label class="field">
              <span>新しいアカウントとして知らせる日数（0 で知らせない）</span>
              <input type="number" name="newAccountDays" min={0} max={365} value={String(props.guard.newAccountDays)} required />
            </label>
            <button type="submit" class="ok">保存する</button>
          </form>
        )}
      </section>
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
        <h2>ロールの承認制</h2>
        <p class="note">
          神職が <code>/ロール</code>・<code>/一時ロール</code> で、下で選んだ「承認なしで付けてよいロール」以外を付け外ししようとすると、承認待ちになります。ログのチャンネルに出る「承認する」を、頼んだ人とは別の神職・宮司が押すと、BOT
          が付け外しします。宮司は承認なしでできます。いまの設定: <b>{props.guard.roleApproval ? '承認制（オン）' : 'オフ'}</b>
        </p>
        {guji && (
          <form method="post" action="/security/approval">
            {csrf}
            <label class="field">
              <span>
                <input type="checkbox" name="roleApproval" value="yes" checked={props.guard.roleApproval} /> 承認制にする
              </span>
            </label>
            <fieldset class="field">
              <legend>承認なしで付けてよいロール</legend>
              {props.roles.map((r) => (
                <label class="check">
                  <input type="checkbox" name="freeRoleIds" value={r.id} checked={props.guard.freeRoleIds.includes(r.id)} /> {r.name}
                </label>
              ))}
            </fieldset>
            <button type="submit" class="ok">保存する</button>
          </form>
        )}
        {props.requests.length > 0 && (
          <table class="compact">
            <thead>
              <tr>
                <th>#</th>
                <th>中身</th>
                <th>頼んだ人</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              {props.requests.map((q) => (
                <tr>
                  <td>{q.id}</td>
                  <td>
                    {props.names.get(q.memberId) ?? q.memberId} に {props.roles.find((r) => r.id === q.roleId)?.name ?? q.roleId}（{q.kind === 'remove' ? '外す' : q.kind === 'temp' ? `一時 ${q.minutes} 分` : '付ける'}）
                  </td>
                  <td>{props.names.get(q.requestedBy) ?? q.requestedBy}</td>
                  <td>
                    {{ pending: '⏳ 承認待ち', approved: '✅ 承認', rejected: '❌ 却下', failed: '⚠ 承認したが失敗' }[q.status] ?? q.status}
                    {q.decidedBy && `（${props.names.get(q.decidedBy) ?? q.decidedBy}）`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

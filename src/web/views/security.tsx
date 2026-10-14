import type { AdminSession, SecurityWatchRow } from '../../db/schema.js';
import { WATCH_REASON_MAX } from '../../services/securityWatch.js';
import { Layout } from './layout.js';

const FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  added: { text: '🛡 要注意リストに入れました。この人が入ってきたら、ログに知らせます。案内人はロールを付けられません。', kind: 'ok' },
  removed: { text: '要注意リストから外しました。', kind: 'ok' },
  invalid: { text: 'ユーザーID（数字）と理由を入れてください。', kind: 'warn' },
  not_found: { text: 'リストにいない人です。', kind: 'warn' },
};

const fmtDate = (d: Date) => d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' });

/** 🛡 荒らし対策: 要注意リスト */
export function SecurityPage(props: { session: AdminSession; rows: SecurityWatchRow[]; names: Map<string, string>; flash?: string }) {
  const { session } = props;
  const guji = session.level === 'guji';
  const f = props.flash && Object.hasOwn(FLASH, props.flash) ? FLASH[props.flash] : undefined;
  const csrf = <input type="hidden" name="_csrf" value={session.csrfToken} />;
  return (
    <Layout title="荒らし対策" session={session} nav="security">
      <h1>🛡 荒らし対策</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
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

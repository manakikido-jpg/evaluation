import type { AdminSession } from '../../db/schema.js';
import type { ShofukuConfig, ShofukuRank, ShofukuRow } from '../../services/shofuku.js';
import { Layout } from './layout.js';

const MSG: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '設定を保存しました。', kind: 'ok' },
  invalid: { text: '入力を確かめてください（期間の始まりは終わりより前）。', kind: 'warn' },
  guji: { text: '設定を変えられるのは宮司だけです。', kind: 'warn' },
  rewarded: { text: '招いた人に銭を渡しました。', kind: 'ok' },
  rewarded_all: { text: '条件を満たした人の分を、まとめて渡しました。', kind: 'ok' },
  not_qualified: { text: 'まだ条件を満たしていません。', kind: 'warn' },
  done: { text: 'もう渡してあります（二重には渡しません）。', kind: 'warn' },
  excluded: { text: '対象外にしました。', kind: 'ok' },
  included: { text: '対象に戻しました。', kind: 'ok' },
  locked: { text: '銭を渡したあとは、対象外にできません。', kind: 'warn' },
  achieved: { text: '達成報酬を渡した印を付けました。', kind: 'ok' },
  grant_done: { text: '『招福』ロールを付けました。', kind: 'ok' },
  grant_confirm: { text: '「確かめました」にチェックを入れてから押してください。', kind: 'warn' },
  grant_no_role: { text: '先に、下の設定で『招福』ロールを選んで保存してください。', kind: 'warn' },
  grant_invalid: { text: '日付を確かめてください。', kind: 'warn' },
};
const fmt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
const hm = (m: number) => `${Math.floor(m / 60)}時間${m % 60}分`;

/** 🎍 招福詣（招待イベント）の集計 */
export function ShofukuPage(p: { session: AdminSession; config: ShofukuConfig; rows: ShofukuRow[]; ranking: ShofukuRank[]; roles: { id: string; name: string }[]; msg?: string; coin: string; grant?: { since: string; count: number; hasRole: boolean; valid: boolean; guji: boolean }; granted?: { n: number; f: number; r: number } }) {
  const c = p.config;
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  const flash = p.msg ? MSG[p.msg] : undefined;
  const ready = p.rows.filter(r => r.qualified && !r.rewardedAt).length;
  return <Layout title="招福詣" nav="invites" session={p.session} wide>
    <div class="page-head"><h1>🎍 招福詣（招待イベント）</h1><a href="/invites">招待へ</a></div>
    {flash && <p class={`flash ${flash.kind}`}>{flash.text}</p>}
    <p class="note">{c.start} 0:00 〜 {c.end} 23:59（日本時間）に、自分専用の招待リンクで初めて入った人が対象です（出戻りの人はのぞく）。招かれた人が「浮上 {hm(c.minMinutes)}以上」「入ってから {c.stayDays}日以上いる」を満たすと、招いた人にポイントが入ります（男性 {c.malePoints}PT・女性 {c.femalePoints}PT）。浮上は、入った日からの通話の時間（AFKをのぞく）です。</p>
    <p class="note">銭と達成報酬は、運営がこの画面で確かめてから渡します（自動では渡しません）。自作自演が疑われるときは「対象外にする」を使ってください。</p>

    <section class="card">
      <h2>🏆 ランキング（目標 {c.targetPoints}PT）</h2>
      {p.ranking.length ? <div class="table-wrap"><table>
        <thead><tr><th>順位</th><th>招いた人</th><th>ポイント</th><th>条件を満たした人</th><th>まだの人</th><th>達成報酬</th></tr></thead>
        <tbody>{p.ranking.map((r, n) => <tr>
          <td>{n + 1}</td><td><a href={`/members/${r.inviterId}`}>{r.name}</a></td><td><strong>{r.points}PT</strong></td><td>{r.qualified}人</td><td>{r.pending}人</td>
          <td>{r.achievedAt ? `渡した（${fmt(r.achievedAt)}）` : r.points >= c.targetPoints
            ? <form method="post" action={`/invites/shofuku/achieve/${r.inviterId}`}>{csrf}<input type="hidden" name="points" value={String(r.points)} /><button type="submit">🎁 渡した印を付ける</button></form>
            : '—'}</td>
        </tr>)}</tbody>
      </table></div> : <p class="note">まだ対象の人はいません。</p>}
    </section>

    <section class="card">
      <h2>🌸 招かれた人（{p.rows.length}人）</h2>
      {ready > 0 && <form method="post" action="/invites/shofuku/reward-all">{csrf}<button type="submit" class="ok">条件を満たした {ready}人の分を、まとめて渡す（1人 {c.reward}{p.coin}）</button></form>}
      {p.rows.length ? <div class="table-wrap"><table>
        <thead><tr><th>入った日</th><th>招かれた人</th><th>招いた人</th><th>性別</th><th>浮上</th><th>滞在</th><th>判定</th><th>銭</th><th>運営</th></tr></thead>
        <tbody>{p.rows.map(r => <tr>
          <td>{fmt(r.joinedAt)}</td>
          <td><a href={`/members/${r.memberId}`}>{r.name}</a>{r.omairiExtendedAt ? ' 🎍' : ''}</td>
          <td><a href={`/members/${r.inviterId}`}>{r.inviterName}</a></td>
          <td>{r.gender === 'male' ? '♂' : r.gender === 'female' ? '♀' : '？'}</td>
          <td>{hm(r.minutes)}</td>
          <td>{r.leftAt ? '退出' : `${r.stayDays}日`}</td>
          <td>{r.qualified ? <span class="tag green">✅ {r.points}PT</span> : <span class="tag gray">{r.missing.join('・')}</span>}</td>
          <td>{r.rewardedAt ? `渡した（${r.reward}${p.coin}）` : r.qualified
            ? <form method="post" action={`/invites/shofuku/reward/${r.memberId}`}>{csrf}<button type="submit" class="ok">{c.reward}{p.coin}を渡す</button></form>
            : '—'}</td>
          <td>{r.rewardedAt ? '' : <form method="post" action={`/invites/shofuku/${r.excluded ? 'include' : 'exclude'}/${r.memberId}`}>{csrf}<input type="hidden" name="inviterId" value={r.inviterId} />{!r.excluded && <input type="text" name="note" maxlength={200} placeholder="理由（任意）" />}<button type="submit">{r.excluded ? '対象に戻す' : '対象外にする'}</button></form>}{r.note ? <div class="note">{r.note}</div> : ''}</td>
        </tr>)}</tbody>
      </table></div> : <p class="note">まだいません。</p>}
      <p class="note">🎍 は、お参り期間を延ばした人です（🔰参拝者になったあと、毎分の確認で延ばし、『招福』ロールを付けます）。</p>
    </section>

    {p.grant && <section class="card">
      <h2>🎍 まとめて『招福』ロールを付ける</h2>
      <p class="note">指定した日（日本時間 0:00）から入った、いま在籍中の人全員に『招福』ロールを付けます（BOT・もう付いている人はのぞく）。招待リンクで入ったかどうかは見ません。1 回に 300 人までなので、残りがあるときは、もう一度押してください。</p>
      {p.granted && <p class="flash ok">付けた人: {p.granted.n}人{p.granted.f ? `／付けられなかった人: ${p.granted.f}人（BOT のロールの位置・権限を確かめてください）` : ''}{p.granted.r ? `／残り: ${p.granted.r}人（もう一度押すと続きから）` : ''}</p>}
      <form method="get" action="/invites/shofuku" class="fields">
        <label class="field"><span>この日から入った人</span><input type="date" name="since" value={p.grant.since} required /></label>
        <button type="submit" class="small">対象の人数を確かめる</button>
      </form>
      {!p.grant.valid ? <p class="note">日付を確かめてください。</p> : !p.grant.hasRole ? <p class="note">先に、下の設定で『招福』ロールを選んで保存してください。</p> : <p><strong>いまの対象: {p.grant.count}人</strong>（{p.grant.since} 以降に入って、まだ『招福』がない人）</p>}
      {p.grant.guji ? p.grant.valid && p.grant.hasRole && p.grant.count > 0 && <form method="post" action="/invites/shofuku/grant-since">
        {csrf}<input type="hidden" name="since" value={p.grant.since} />
        <label><input type="checkbox" name="confirm" value="yes" /> 対象 {p.grant.count}人に『招福』ロールを付けることを確かめました</label>
        <button type="submit" class="ok">まとめて付ける</button>
      </form> : <p class="note">付けられるのは宮司だけです。</p>}
    </section>}

    <form method="post" action="/invites/shofuku/settings" class="card">
      {csrf}
      <h2>⚙ 設定（宮司だけ）</h2>
      <label><input type="checkbox" name="enabled" value="yes" checked={c.enabled} /> 有効にする（招かれた人のお参り延長と『招福』ロールを自動で行う）</label>
      <div class="fields">
        <label class="field"><span>始まりの日</span><input type="date" name="start" value={c.start} required /></label>
        <label class="field"><span>終わりの日（この日の 23:59 まで）</span><input type="date" name="end" value={c.end} required /></label>
        <label class="field"><span>男性1人のポイント</span><input type="number" name="malePoints" min={0} max={1000} value={c.malePoints} required /></label>
        <label class="field"><span>女性1人のポイント</span><input type="number" name="femalePoints" min={0} max={1000} value={c.femalePoints} required /></label>
        <label class="field"><span>達成報酬の目標ポイント</span><input type="number" name="targetPoints" min={1} max={100000} value={c.targetPoints} required /></label>
        <label class="field"><span>浮上の条件（分）</span><input type="number" name="minMinutes" min={0} max={100000} value={c.minMinutes} required /></label>
        <label class="field"><span>滞在の条件（日）</span><input type="number" name="stayDays" min={0} max={365} value={c.stayDays} required /></label>
        <label class="field"><span>招いた人に渡す銭（1人ごと）</span><input type="number" name="reward" min={0} max={1000000} value={c.reward} required /></label>
        <label class="field"><span>お参り期間を延ばす日数</span><input type="number" name="extendDays" min={0} max={30} value={c.extendDays} required /></label>
        <label class="field"><span>『招福』ロール</span><select name="roleId"><option value="">付けない</option>{p.roles.map(r => <option value={r.id} selected={c.roleId === r.id}>{r.name}</option>)}</select></label>
      </div>
      <button type="submit">設定を保存</button>
    </form>
  </Layout>;
}

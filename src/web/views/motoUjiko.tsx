import type { AdminSession } from '../../db/schema.js';
import type { EmaThresholdCounts } from '../../domain/ema.js';
import type { MotoBulkRow } from '../../services/ujikoKeep.js';
import { Layout } from './layout.js';

const day = (d: Date) => d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });

const FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  confirm: { text: '切り替えるときは、確かめのチェックを入れてください。', kind: 'warn' },
  none: { text: 'だれも選ばれていません。', kind: 'warn' },
  not_started: { text: '新制度がまだ始まっていません（③④を押してから使えます）。', kind: 'warn' },
  no_role: { text: '元氏子のロールが未設定です。評価ページでロール ID を入れてください。', kind: 'warn' },
};

/** 🍂 まとめて：氏子 ⇄ 元氏子（宮司だけ） */
export function MotoUjikoPage(props: {
  session: AdminSession; active: boolean; roleSet: boolean; ujiko: MotoBulkRow[]; moto: MotoBulkRow[];
  shortOnly: boolean; th: EmaThresholdCounts; flash?: string; done?: number; failed?: number;
  /** 「残す人」の名簿で絞ったとき：貼った文・残る氏子の数・氏子でない名前・見つからない名前 */
  keep?: { text: string; kept: number; notUjiko: string[]; unknown: string[] };
}) {
  const { session, ujiko, moto, th } = props;
  const ready = props.active && props.roleSet;
  const Rows = (p: { rows: MotoBulkRow[] }) => (
    <tbody>{p.rows.map((x) => (
      <tr>
        <td><input type="checkbox" name="ids" value={x.id} aria-label={x.name} /><input type="hidden" name="listed" value={x.id} /></td>
        <td><a href={'/members/' + x.id}>{x.name}</a> <small class="muted">{x.username}</small></td>
        <td class="num">{x.total} / {x.need}</td>
        <td class="num">{x.fromSanpai} / {x.needSanpai}</td>
        <td>{x.met ? <span class="tag green">足りている</span> : <span class="tag gray">あと {x.short}</span>}</td>
        <td>{x.judgeAt ? day(x.judgeAt) : '—'}</td>
      </tr>
    ))}</tbody>
  );
  const Head = () => <thead><tr><th>選ぶ</th><th>名前</th><th class="num">絵馬</th><th class="num">参拝者から</th><th>ようす</th><th>次の判定</th></tr></thead>;
  return (
    <Layout title="氏子 ⇄ 元氏子（まとめて）" session={session} nav="evaluation">
      <p class="crumbs"><a href="/evaluation">評価</a> / 氏子 ⇄ 元氏子（まとめて）</p>
      {props.flash && FLASH[props.flash] && <p class={`flash ${FLASH[props.flash]!.kind}`} role="status">{FLASH[props.flash]!.text}</p>}
      {(props.flash === 'done' || props.flash === 'back') && (
        <p class={`flash ${props.failed ? 'warn' : 'ok'}`} role="status">
          {props.flash === 'done' ? '🍂 元氏子にしました' : '🍃 氏子に戻しました'}：{props.done ?? 0} 人。
          {props.failed ? `⚠️ そのうち ${props.failed} 人は、Discord のロールを変更できませんでした（#記録 を見て、手で直してください）。` : '本人に DM し、#記録 に残しました。'}
        </p>
      )}
      {!ready && (
        <p class="flash warn" role="alert">
          {!props.active ? '新制度がまだ始まっていません。③④を押してから使えます。' : <>元氏子のロールが未設定です。<a href="/evaluation#ns-roles">評価ページ</a>でロール ID を入れてください。</>}
        </p>
      )}
      <section class="card" id="keep-list">
        <h2>📋 「残す人」の名簿から決める</h2>
        <p class="note">氏子として残す人の Discord のユーザー名を、1行に1つ貼ります（頭の「1. 」のような番号は外します）。「絞りこむ」を押すと、名簿にない氏子だけが下の一覧に出ます。ここでは、まだ何も変えません。</p>
        <form method="post" action="/evaluation/moto-ujiko/keep">
          <input type="hidden" name="_csrf" value={session.csrfToken} />
          <label>残す人（1行に1つ）<textarea name="keep" rows={8} cols={40} required>{props.keep?.text ?? ''}</textarea></label>
          <p><button type="submit">名簿にない氏子を絞りこむ</button></p>
        </form>
        {props.keep && (
          <div>
            <p class="flash ok" role="status">名簿で残る氏子 <strong>{props.keep.kept} 人</strong>／名簿にない氏子（元氏子にする候補） <strong>{ujiko.length} 人</strong></p>
            {props.keep.unknown.length > 0 && <p class="flash warn" role="alert">見つからない名前（書きまちがい・退出かもしれません）：{props.keep.unknown.join('、')}</p>}
            {props.keep.notUjiko.length > 0 && <p class="flash warn" role="alert">いま氏子ではない人（世話役以上・参拝者など。変わりません）：{props.keep.notUjiko.join('、')}</p>}
            <p class="note">下の一覧を確かめてから、「この一覧の全員を元氏子にする」を押してください。</p>
          </div>
        )}
      </section>
      <section class="card">
        <h2>🍂 氏子 → 元氏子</h2>
        <p class="note">氏子でいるには、絵馬 {th.keepNeed}（うち {th.keepFromSanpai} は参拝者から・招待で {th.keepInviteMax} まで）。足りない人から並べています。選んだ人の氏子ロールを外し、参拝者・元氏子ロールを付けて、本人に DM します。</p>
        <p>{props.keep ? <a href="/evaluation/moto-ujiko">名簿の絞りこみをやめる</a> : props.shortOnly ? <a href="/evaluation/moto-ujiko">全員を出す</a> : <a href="/evaluation/moto-ujiko?short=1">足りない人だけ出す</a>}　{props.keep ? '名簿にない氏子' : '氏子'} <strong>{ujiko.length} 人</strong></p>
        {ujiko.length === 0 ? <p class="empty">いません。</p> : (
          <form method="post" action="/evaluation/moto-ujiko">
            <input type="hidden" name="_csrf" value={session.csrfToken} />
            <input type="hidden" name="to" value="moto" />
            <div class="table-wrap"><table class="compact"><Head /><Rows rows={ujiko} /></table></div>
            <p><label><input type="checkbox" name="confirm" value="yes" required /> 元氏子にしてよい（本人に DM が届きます）</label></p>
            <p>
              <button type="submit" name="mode" value="selected" class="danger" disabled={!ready}>🍂 選んだ人を元氏子にする</button>{' '}
              <button type="submit" name="mode" value="all" class="danger" disabled={!ready}>🍂 この一覧の全員（{ujiko.length} 人）を元氏子にする</button>
            </p>
          </form>
        )}
      </section>
      <section class="card">
        <h2>🍃 元氏子 → 氏子（戻す）</h2>
        <p class="note">元氏子は、なってからの絵馬 {th.motoNeed}（うち {th.motoFromSanpai} は参拝者から）がそろうと、BOT が自動で氏子に戻します。ここからは、手で戻せます。</p>
        <p>元氏子 <strong>{moto.length} 人</strong></p>
        {moto.length === 0 ? <p class="empty">いません。</p> : (
          <form method="post" action="/evaluation/moto-ujiko">
            <input type="hidden" name="_csrf" value={session.csrfToken} />
            <input type="hidden" name="to" value="ujiko" />
            <div class="table-wrap"><table class="compact"><Head /><Rows rows={moto} /></table></div>
            <p><label><input type="checkbox" name="confirm" value="yes" required /> 氏子に戻してよい</label></p>
            <p>
              <button type="submit" name="mode" value="selected" disabled={!ready}>🍃 選んだ人を氏子に戻す</button>{' '}
              <button type="submit" name="mode" value="all" disabled={!ready}>🍃 この一覧の全員（{moto.length} 人）を氏子に戻す</button>
            </p>
          </form>
        )}
      </section>
    </Layout>
  );
}

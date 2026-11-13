import type { SpecialGoen } from '../../db/schema.js';
import { SPECIAL_GOEN_MAX } from '../../services/specialGoen.js';
import { fmtDateTime } from '../format.js';

type Names = Map<string, string>;
const who = (names: Names, id: string | null) => (id ? (names.get(id) ?? `ID ${id}`) : '—');

/**
 * ✨ 特別ご縁（メンバー詳細）。記録はだれでも見られ、振る・取り消すのは宮司だけ。
 * nonce: 宮司のときだけ（画面を開いたときに作る番号。二度押しで 2 回振らない）
 */
export function SpecialGoenSection(props: { memberId: string; csrf: string; rows: SpecialGoen[]; special: number; names: Names; nonce?: string }) {
  const base = `/members/${props.memberId}/special-goen`;
  return (
    <section class="card anchor" id="sec-goen">
      <h2>
        ✨ 特別ご縁 <span class={props.special ? 'tag' : 'tag gray'}>今 +{props.special}</span>
      </h2>
      <p class="note">運営から、朱印とは別にご縁を振れます。ご縁の合計に足され、役職の昇格にも数えます（番付には入りません）。取り消すとご縁は減りますが、上がった役職は下げません。</p>
      {props.nonce && (
        <form method="post" action={base} class="actions">
          <input type="hidden" name="_csrf" value={props.csrf} />
          <input type="hidden" name="nonce" value={props.nonce} />
          <h3>特別ご縁を振る（宮司）</h3>
          <input type="number" name="amount" min={1} max={SPECIAL_GOEN_MAX} placeholder="ご縁の量" required />
          <input type="text" name="reason" maxlength={200} placeholder="理由（必須・本人への DM と #記録 に載る）" required />
          <button type="submit" class="ok">
            振る
          </button>
        </form>
      )}
      {props.rows.length === 0 ? (
        <p class="empty">まだありません。</p>
      ) : (
        <table class="compact">
          <tbody>
            {props.rows.map((r) => (
              <tr class={r.revokedAt ? 'revoked' : ''}>
                <td>{fmtDateTime(r.createdAt)}</td>
                <td class="num">+{r.amount}</td>
                <td>
                  {r.reason}
                  <small class="reason">
                    振った人: {who(props.names, r.grantedBy)}
                    {r.revokedAt && ` ／ 取り消し（${who(props.names, r.revokedBy)}） ${fmtDateTime(r.revokedAt)}`}
                  </small>
                </td>
                <td>
                  {r.revokedAt ? (
                    <span class="tag gray">取り消し</span>
                  ) : (
                    props.nonce && (
                      <form method="post" action={`${base}/${r.id}/revoke`} data-confirm={`特別ご縁 +${r.amount}（${r.reason}）を取り消します。よいですか？`}>
                        <input type="hidden" name="_csrf" value={props.csrf} />
                        <button type="submit" class="small">
                          取り消す
                        </button>
                      </form>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** 🔄 出戻りの人の御朱印をリセット（宮司だけ）。受け取った朱印を全部取り消し、押した人がまた押せるようにする */
export function ShuinResetSection(props: { memberId: string; csrf: string; received: number; goen: number; returner: boolean; last?: { at: Date; remaining: number; specialRemaining: number } }) {
  const base = `/members/${props.memberId}/shuin-reset`;
  return (
    <section class="card anchor" id="sec-shuin-reset">
      <h2>🔄 御朱印をリセット（出戻り）{props.returner && <span class="tag">出戻り</span>}</h2>
      <p class="note">
        この人が受け取った朱印を全部取り消して、はじめからにします（いま {props.received} 人・ご縁 {props.goen}）。取り消した朱印は、押した人がまた押せます（押し直すと今の格で数えます）。役職・銭・券は変えません。本人に DM は送りません。操作は記録に残ります。
      </p>
      <form method="post" action={base} class="actions" data-confirm="この人が受け取った朱印を全部取り消します。よいですか？">
        <input type="hidden" name="_csrf" value={props.csrf} />
        <label class="field check">
          <input type="checkbox" name="withSpecial" value="yes" />
          <span>✨ 特別ご縁も取り消す</span>
        </label>
        <label class="field check">
          <input type="checkbox" name="confirm" value="yes" required />
          <span>受け取った朱印を全部取り消す</span>
        </label>
        <button type="submit" class="danger">リセットする</button>
      </form>
      {props.last && (
        <form method="post" action={`${base}/undo`} class="actions" data-confirm="いちばん新しいリセットを元に戻します。よいですか？">
          <input type="hidden" name="_csrf" value={props.csrf} />
          <p class="note">
            {fmtDateTime(props.last.at)} のリセットを元に戻せます（取り消したままの朱印 {props.last.remaining} 件{props.last.specialRemaining ? `・特別ご縁 ${props.last.specialRemaining} 件` : ''}。そのあと押し直された朱印はそのまま）。
          </p>
          <button type="submit">元に戻す</button>
        </form>
      )}
    </section>
  );
}

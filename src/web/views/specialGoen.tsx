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

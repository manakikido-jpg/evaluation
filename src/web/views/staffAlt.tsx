import type { StaffAlt } from '../../services/staffAlts.js';

/** 🕶 運営のサブアカウント（宮司だけが登録・解除できる） */
export function StaffAltSection(p: { memberId: string; csrf: string; alt?: StaffAlt; guji: boolean }) {
  if (!p.alt && !p.guji) return null;
  return (
    <section class="card" id="sec-staff-alt">
      <h2>🕶 運営のサブアカウント</h2>
      {p.alt ? (
        <p>この人は運営のサブアカウントです（本アカウント: <a href={`/members/${p.alt.ownerId}`}>{p.alt.ownerId}</a>{p.alt.note ? `・${p.alt.note}` : ''}）。銭は持たず、朱印・招待のお礼には入らず、社務所Web には入れません。</p>
      ) : (
        <p class="note">見え方の確認・BOT やカジノを試す・名前を出さずに見回るためのアカウントにします。銭を持たず（今の銭は 0 にします）、朱印を押せず・押されず、招待の記録とお礼に入らず、社務所Web に入れません。メンバーから分かる目印（ロールなど）は付けません。</p>
      )}
      {p.guji && (
        <form method="post" action={`/members/${p.memberId}/staff-alt`}>
          <input type="hidden" name="_csrf" value={p.csrf} />
          <input type="hidden" name="on" value={p.alt ? 'no' : 'yes'} />
          {!p.alt && <label>本アカウントのユーザー ID<input name="ownerId" required pattern="\d{17,20}" inputmode="numeric" /></label>}
          {!p.alt && <label>メモ（なくても大丈夫）<input name="note" maxlength={200} /></label>}
          <button type="submit" class={p.alt ? 'danger' : undefined}>{p.alt ? '運営のサブアカウントから外す' : '運営のサブアカウントにする'}</button>
        </form>
      )}
    </section>
  );
}

import type { SlotSeat } from '../../services/casino/slotSeats.js';

/** アイコンがない・読めないときも名前の頭文字を出す。 */
export function SlotPlayer(p: { player: Pick<SlotSeat, 'memberId' | 'name' | 'avatar'>; me: string }) {
  const name = p.player.name || 'メンバー';
  return <span class={`c-slot-player${p.player.memberId === p.me ? ' me' : ''}`}>
    <span class="c-slot-avatar">
      {p.player.avatar && <img src={p.player.avatar} alt="" loading="lazy" referrerpolicy="no-referrer" data-seat-avatar />}
      <span hidden={Boolean(p.player.avatar)}>{Array.from(name)[0]}</span>
    </span>
    <span>{name}{p.player.memberId === p.me ? '（あなた）' : ''}</span>
  </span>;
}

export function SlotSeatControls(p: { seat?: SlotSeat; me: string; csrf: string; machine: number; game: 'slots' | 'atslot'; busy?: boolean }) {
  return <section class="c-slot-seating" aria-label="台の利用者">
    {p.seat ? <>
      <SlotPlayer player={p.seat} me={p.me} />
      <span class="c-muted">{p.seat.away ? `離席中 · ${p.seat.until.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}まで確保（日本時間）` : '遊技中'}</span>
      {p.seat.memberId === p.me && <form method="post" action={`/casino/${p.game}/seat`} class="c-slot-seat-actions">
        <input type="hidden" name="_csrf" value={p.csrf} />
        <input type="hidden" name="m" value={String(p.machine)} />
        <button class="c-btn c-btn-small" name="action" value={p.seat.away ? 'return' : 'away'} disabled={p.busy}>{p.seat.away ? '戻る' : '離席（5分）'}</button>
        <button class="c-btn c-btn-small c-btn-ghost" name="action" value="leave" disabled={p.busy}>退席</button>
      </form>}
      {p.busy && p.seat.memberId === p.me && <small>この回を終えてから離席できます。</small>}
    </> : <span class="c-muted">空き台 · レバーを押すと着席します。</span>}
  </section>;
}

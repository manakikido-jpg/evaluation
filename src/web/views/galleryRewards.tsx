import { Layout, type SessionView } from './layout.js';
import { GALLERY_KINDS, GALLERY_LABEL, type GalleryKind, type GalleryPrices } from '../../services/galleryRewards.js';
import type { GalleryReward } from '../../db/schema.js';
const statuses: Record<string, string> = { pending: '土日終了待ち', paid: '支払い済み', removed: '削除・添付変更・退会で対象外', cancelled: '運営が取り消し', daily_limit: '同日の上限', weekly_limit: '週の上限' };
export function GalleryRewardsPage({ session, prices, rows, guildId, coin, message }: { session: SessionView; prices: GalleryPrices; rows: GalleryReward[]; guildId: string; coin: string; message?: string }) {
  const csrf = <input type="hidden" name="_csrf" value={session.csrfToken} />;
  return <Layout session={session} nav="gallery" title="写真館・動画館の報酬">
    <h1>📷 写真館・動画館の報酬</h1>
    {message && <p role="status">{message}</p>}
    <section class="card"><h2>報酬のきまり</h2><p>日本時間の月曜0時〜金曜23時59分の投稿が対象です。投稿と添付を土日が終わるまで残すと、月曜0時以降に自動で支払います。</p>
      <p>写真館・動画館を合わせて1人1日1投稿・週2回まで。同じ日は高い金額を優先し、週の金額が高い2日分を選びます。同額なら先の投稿を優先します。土日の新規投稿は対象外です。</p>
      <p>運営は内容をDiscordで確認し、その週の日曜が終わる前に登録してください。登録時の金額で確定します。途中で削除したり、確認した添付を外した投稿は対象外です。添付画像・音声・動画が必要です（外部リンクだけは対象外）。</p>
    </section>
    <section class="card"><h2>報酬の金額</h2><form method="post" action="/economy/gallery/prices">{csrf}
      {GALLERY_KINDS.map(k => <p><label>{GALLERY_LABEL[k]}（{coin}）<br /><input type="number" name={k} min="0" max="10000" required value={prices[k]} disabled={session.level !== 'guji'} /></label></p>)}
      <p>0〜10,000。0は新しい登録を停止。金額変更は次の登録から有効です。締め切り・回数・保持条件は固定です。</p>
      {session.level === 'guji' && <button type="submit">金額を保存</button>}
    </form></section>
    <section class="card"><h2>確認した投稿を登録</h2><form method="post" action="/economy/gallery/register">{csrf}
      <p><label>Discordの投稿リンク<br /><input name="link" type="url" required placeholder="https://discord.com/channels/…" /></label></p>
      <p><label>運営が確認した区分<br /><select name="kind">{GALLERY_KINDS.map(k => <option value={k}>{GALLERY_LABEL[k]}</option>)}</select></label></p>
      <button type="submit">登録する</button>
    </form></section>
    <section class="card"><h2>最近の登録（100件）</h2><div class="table-wrap"><table><thead><tr><th>投稿</th><th>区分</th><th>金額</th><th>対象週</th><th>状態</th><th>操作</th></tr></thead><tbody>
      {rows.map(r => <tr><td><a href={`https://discord.com/channels/${guildId}/${r.channelId}/${r.messageId}`} target="_blank" rel="noreferrer">{r.day}・{r.memberId}</a></td><td>{GALLERY_LABEL[r.kind as GalleryKind]}</td><td>{r.amount} {coin}</td><td>{r.week}〜</td><td>{statuses[r.status] ?? r.status}</td><td>{r.status === 'pending' && <form method="post" action="/economy/gallery/cancel">{csrf}<input type="hidden" name="messageId" value={r.messageId} /><button type="submit">取り消す</button></form>}</td></tr>)}
    </tbody></table></div></section>
  </Layout>;
}

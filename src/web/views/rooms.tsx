import type { AdminSession } from '../../db/schema.js';
import { Layout } from './layout.js';

export type RoomListRow = {
  channelId: string; name: string | null; ownerId: string; ownerName: string;
  kind: 'public' | 'invite' | 'secret'; stay: 'day' | 'hourly' | null; keepUntil: Date | null; invited: number; createdAt: Date;
};

const KIND: Record<RoomListRow['kind'], string> = { public: '🔓 公開', invite: '🔑 招待限定', secret: '🔒 シークレット' };
const MSG: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  deleted: { text: '宿を削除しました。', kind: 'ok' },
  not_found: { text: 'その宿はもうありません。', kind: 'warn' },
  confirm: { text: '「確かめました」にチェックを入れてから押してください。', kind: 'warn' },
  failed: { text: 'Discord のチャンネルを消せませんでした（BOT の「チャンネルの管理」の権限を確かめてください）。', kind: 'warn' },
};
const fmt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

/** 🏨 今ある宿の一覧（運営が削除できる） */
export function RoomsPage(p: { session: AdminSession; rows: RoomListRow[]; msg?: string }) {
  const flash = p.msg ? MSG[p.msg] : undefined;
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  return <Layout title="宿の一覧" nav="rooms" session={p.session}>
    <div class="page-head"><h1>🏨 宿の一覧</h1><a href="/voice">通話の記録へ</a></div>
    {flash && <p class={`flash ${flash.kind}`}>{flash.text}</p>}
    <p class="note">いまある自分の通話部屋（宿坊・宵宮・🏨 24時間の宿・⏱ 1時間ごとの宿）です。「削除」で、その通話チャンネルを今すぐ消します（中にいる人は通話から抜けます。払った宿代は戻りません）。部屋主は、Discord の「⚙ 部屋の設定」の「🗑 宿を削除する」でも消せます。</p>
    <section class="card">
      {p.rows.length ? <div class="table-wrap"><table>
        <thead><tr><th>宿</th><th>部屋主</th><th>種類</th><th>期限</th><th>入室許可者</th><th>できた時刻</th><th>運営</th></tr></thead>
        <tbody>{p.rows.map((r) => <tr>
          <td>{r.name ?? <span class="note">（Discord に見つかりません）</span>}</td>
          <td><a href={`/members/${r.ownerId}`}>{r.ownerName}</a></td>
          <td>{KIND[r.kind]}{r.stay === 'day' ? '・🏨 24時間' : r.stay === 'hourly' ? '・⏱ 1時間ごと' : ''}</td>
          <td>{r.keepUntil ? fmt(r.keepUntil) : '—'}</td>
          <td>{r.invited}人</td>
          <td>{fmt(r.createdAt)}</td>
          <td><form method="post" action={`/voice/rooms/${r.channelId}/delete`}>{csrf}
            <label><input type="checkbox" name="confirm" value="yes" /> 確かめました</label>
            <button type="submit" class="danger">削除</button>
          </form></td>
        </tr>)}</tbody>
      </table></div> : <p class="note">いまある宿はありません。</p>}
    </section>
  </Layout>;
}

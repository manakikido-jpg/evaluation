import type { AdminSession, ArchivedMessage } from '../../db/schema.js';
import type { GuildChannel } from '../../lib/discordRest.js';
import { ARCHIVE_DAYS } from '../../services/messageArchive.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

/** 📚 書き込みの記録（宮司だけ） */
export function MessageArchivePage(p: { session: AdminSession; rows: ArchivedMessage[]; channels: GuildChannel[]; names: Map<string, string>; q: Record<string, string> }) {
  const name = (id: string | null) => (id && p.names.get(id)) || id || '';
  return <Layout title="書き込みの記録" nav="msgarchive" session={p.session}>
    <h1>📚 書き込みの記録</h1>
    <p class="note">サーバーの書き込み（文・写真）を、書いた人・時刻・書きかえ・消した時刻と消した人つきで残しています。写真は 8MB まで中身も残し、動画などは名前と大きさだけです。{ARCHIVE_DAYS} 日たったものは自動で消えます。消した人は、本人が消したときは Discord が教えないので「本人か不明」になります。宮司だけが見られます。</p>
    <form method="get" action="/message-archive" class="card"><div class="fields">
      <label class="field"><span>書いた人（名前か ユーザー ID）</span><input name="author" value={p.q.author ?? ''} maxlength={100} /></label>
      <label class="field"><span>チャンネル</span><select name="channel"><option value="">すべて</option>{p.channels.filter((c) => c.type !== 4).map((c) => <option value={c.id} selected={c.id === p.q.channel}>#{c.name}</option>)}</select></label>
      <label class="field"><span>文にふくむ言葉</span><input name="text" value={p.q.text ?? ''} maxlength={100} /></label>
      <label class="field"><span>日付（から）</span><input type="date" name="from" value={p.q.from ?? ''} /></label>
      <label class="field"><span>日付（まで）</span><input type="date" name="to" value={p.q.to ?? ''} /></label>
      <label class="check"><input type="checkbox" name="deleted" value="yes" checked={p.q.deleted === 'yes'} /><span>消されたものだけ</span></label>
    </div><button type="submit">さがす</button></form>
    <section class="card"><h2>新しい順（{p.rows.length} 件）</h2>
      {!p.rows.length ? <p class="note">ありません。</p> : <div class="table-wrap"><table class="compact"><thead><tr><th>時刻</th><th>書いた人</th><th>チャンネル</th><th>内容</th><th>消した</th></tr></thead><tbody>
        {p.rows.map((r) => <tr class={r.deletedAt ? 'row-deleted' : ''}>
          <td>{fmtDateTime(r.createdAt)}</td>
          <td>{r.authorName || name(r.authorId)}<div class="note">{r.authorId}</div></td>
          <td>#{p.channels.find((c) => c.id === r.channelId)?.name ?? (r.channelName || r.channelId)}</td>
          <td class="wrap"><div class="archive-text">{r.content || <span class="note">（文なし）</span>}</div>
            {r.edits.length > 0 && <details><summary>書きかえ前（{r.edits.length}）</summary>{r.edits.map((e) => <div class="note">{fmtDateTime(new Date(e.at))} まで: {e.content}</div>)}</details>}
            {r.attachments.map((a) => a.fileId ? <a href={`/message-archive/file/${a.fileId}`} target="_blank" rel="noopener"><img class="archive-img" src={`/message-archive/file/${a.fileId}`} alt={a.name} loading="lazy" /></a> : <div class="note">📎 {a.name}（{Math.ceil(a.size / 1024).toLocaleString('ja-JP')} KB）</div>)}
          </td>
          <td>{r.deletedAt ? <>{fmtDateTime(r.deletedAt)}<div class="note">{r.deletedBy ? name(r.deletedBy) : '本人か不明'}</div></> : ''}</td>
        </tr>)}
      </tbody></table></div>}
    </section>
  </Layout>;
}

import type { AdminSession, GuideThread } from '../../db/schema.js';
import type { GuildChannel } from '../../lib/discordRest.js';
import { timesFor, type GuideThreadConfig } from '../../services/guideThreads.js';
import { Layout } from './layout.js';

const WD = ['日', '月', '火', '水', '木', '金', '土'];

/** 🧵 入った人の案内スレッド（設定と、いま開いているスレッド） */
export function GuideThreadsPage(p: { session: AdminSession; config: GuideThreadConfig; channels: GuildChannel[]; days: string[]; threads: GuideThread[]; guildId: string; names: Map<string, string>; flash?: string; error?: string }) {
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  const c = p.config;
  return <Layout title="案内スレッド" nav="guide" session={p.session}>
    <h1>🧵 案内スレッド</h1>
    <p><a href="/guide">案内・給与へ戻る</a></p>
    {p.flash === 'saved' && <p role="status">保存しました。</p>}
    {p.error && <p class="flash warn" role="alert">{p.error}</p>}
    <p>入った人に、本人と @案内人 だけのプライベートスレッドを BOT が作り、あいさつと時間のボタンを送ります。時間を押すと、スレッドで @案内人 に知らせ、10 分前にもお知らせします。「今から」は案内所へ、「時間外」は希望の日時を書いてもらいます。案内待ちが外れた・抜けたら、スレッドを閉じます。</p>
    <form method="post" action="/guide/thread" class="fields">{csrf}
      <section class="card"><h2>基本</h2>
        <label class="field check"><input type="checkbox" name="enabled" value="yes" checked={c.enabled} />案内スレッドを使う（これから入った人から）</label>
        <label class="field"><span>スレッドを作るチャンネル</span><select name="channelId"><option value="">選んでください</option>{p.channels.filter(ch => ch.type === 0).map(ch => <option value={ch.id} selected={c.channelId === ch.id}>#{ch.name}</option>)}</select></label>
        <p class="note">入った人には見えないチャンネルでも大丈夫です（スレッドに入れた人だけが見られます）。BOT に「プライベートスレッドの作成」「スレッドの管理」「スレッドでメッセージを送信」が必要です。</p>
        <label class="field"><span>あいさつの文（1500 文字まで）</span><textarea name="message" rows={9} maxlength={1500}>{c.message}</textarea></label>
      </section>
      <section class="card"><h2>時間</h2>
        <label class="field"><span>いつもの時間（空白かカンマで区切る。24:00 は次の日の 0 時）</span><input name="defaultTimes" value={c.defaultTimes.join(' ')} placeholder="21:00 22:00 23:00 24:00" /></label>
        <p class="note">日ごとに変えるときは、下に書きます。空のままなら、いつもの時間。「なし」と書くと、その日は時間のボタンを出しません（今からと時間外だけ）。ボタンには、今日のまだ来ていない時間（なければ明日の時間）を 5 つまで出します。</p>
        <div class="table-wrap"><table class="compact"><thead><tr><th>日</th><th>その日の時間</th><th>いま使われる時間</th></tr></thead><tbody>
          {p.days.map(d => <tr><td>{Number(d.slice(5, 7))}/{Number(d.slice(8, 10))}（{WD[new Date(d + 'T00:00:00Z').getUTCDay()]}）</td><td><input name={`day_${d}`} value={c.days[d] ? (c.days[d]!.length ? c.days[d]!.join(' ') : 'なし') : ''} placeholder="いつもの時間" /></td><td>{timesFor(c, d).join(' ') || 'なし'}</td></tr>)}
        </tbody></table></div>
      </section>
      <button type="submit">保存する</button>
    </form>
    <section class="card"><h2>いま開いているスレッド（{p.threads.length}）</h2>
      {!p.threads.length ? <p class="note">ありません。</p> : <div class="table-wrap"><table class="compact"><thead><tr><th>人</th><th>希望の時間</th><th>スレッド</th></tr></thead><tbody>
        {p.threads.map(t => <tr><td>{p.names.get(t.memberId) ?? t.memberId}{t.watched ? '（👁 要注意）' : ''}</td><td>{t.slotLabel ?? '—'}</td><td><a href={`https://discord.com/channels/${p.guildId}/${t.threadId}`} target="_blank" rel="noopener noreferrer">開く</a></td></tr>)}
      </tbody></table></div>}
    </section>
  </Layout>;
}

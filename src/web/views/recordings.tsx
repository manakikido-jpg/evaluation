import type { Recording } from '../../db/schema.js';
import { Layout, type SessionView } from './layout.js';
import type { GuildConfig } from '../../config.js';
export function RecordingsPage({ session, rows, cfg }: { session: SessionView; rows: Recording[]; cfg: GuildConfig['recording'] }) {
  return <Layout title="録音・録画" nav="recordings" session={session} scripts={['recordings.js']}>
    <h1>🎥 咲楽ノ宮の録音・録画</h1>
    <p>記録を見られるのは、始めた人と宮司です。保存は {cfg.retentionDays} 日。期限が来ると消えます。</p>
    <p>映る人・声が入る人に、先に確認してください。画面の共有先・通知にも気をつけてください。</p>
    {!cfg.enabled ? <p>現在は無効です。宮司が設定で有効にしてから使えます。</p> : <section id="recorder" data-csrf={session.csrfToken} data-max-minutes={cfg.maxMinutes} data-max-bytes={cfg.maxFileMB * 1024 * 1024}>
      <h2>自分で録画する</h2>
      <label>名前 <input id="recording-title" maxlength={80} placeholder="集まりの記録" /></label>
      <label>録るもの <select id="recording-mode"><option value="screen">画面・ウィンドウ・Webのタブ</option><option value="camera">自分のカメラとマイク</option></select></label>
      <label><input type="checkbox" id="recording-mic" />画面録画に自分のマイクも入れる</label>
      <label><input type="checkbox" id="recording-consent" />映る人・声が入る人に確認しました</label>
      <p>画面共有・カメラは、ブラウザで自分が選んだものを録ります。音声が録れるかはブラウザ・OSで違います。停止までこのページを開いてください。</p>
      <video id="recording-preview" muted playsinline controls></video>
      <p><button type="button" id="recording-start">● 録画を始める</button> <button type="button" id="recording-stop" disabled>■ 止めて保存する</button></p>
      <p id="recording-status" role="status" aria-live="polite">最大 {cfg.maxMinutes} 分・{cfg.maxFileMB} MBです。</p>
      <a id="recording-local" hidden download="sakuranomiya-recording.webm">手元にも保存する</a>
    </section>}
    {session.level === 'guji' && <details><summary>宮司用の設定</summary><form method="post" action="/recordings/settings">
      <input type="hidden" name="_csrf" value={session.csrfToken} />
      <label><input type="checkbox" name="enabled" value="yes" checked={cfg.enabled} />録音・録画を有効にする</label>
      <label>VC録音を許可する通話のID（空白・改行で区切る）<textarea name="voiceChannelIds">{cfg.voiceChannelIds.join('\n')}</textarea></label>
      <label>保存日数（1〜30）<input name="retentionDays" type="number" min="1" max="30" value={cfg.retentionDays} /></label>
      <label>1回の上限（分・1〜60）<input name="maxMinutes" type="number" min="1" max="60" value={cfg.maxMinutes} /></label>
      <label>1回の容量（MB・10〜512）<input name="maxFileMB" type="number" min="10" max="512" value={cfg.maxFileMB} /></label>
      <label>保存先全体（MB・512〜10240）<input name="maxTotalMB" type="number" min="512" max="10240" value={cfg.maxTotalMB} /></label>
      <p>初期値は無効。VCは指定した部屋だけです。録音中に無効にすると止まります。保存日数の変更は、新しく始める記録から反映されます。</p>
      <button type="submit">録音・録画の設定を保存する</button>
    </form></details>}
    <h2>VCの音声</h2><p>神職・宮司が、許可されたVCで <code>/録音</code> を使います。参加者全員が同意してから開始。人が入れ替わると止まります。最初は同時に1部屋です。</p>
    <h2>保存した記録</h2>
    {!rows.length && <p>まだ記録がありません。</p>}
    {rows.map(r => <article class="recording-entry"><h3>{r.title}</h3><p>{r.kind === 'voice' ? 'VC音声' : r.kind === 'screen' ? '画面' : 'カメラ'}・{r.createdAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}・{Math.ceil(r.bytes / 1024 / 1024)} MB・{r.status === 'ready' ? '保存済み' : '保存中'}</p><p>削除される日時：{r.expiresAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</p>
      {r.status === 'ready' && (r.kind === 'voice' ? <audio controls preload="none" src={`/recordings/${r.id}/media`} /> : <video controls preload="none" src={`/recordings/${r.id}/media`} />)}
      {r.status === 'ready' && <p><a href={`/recordings/${r.id}/media?download=1`}>ダウンロード</a></p>}
      {r.kind !== 'voice' || r.status !== 'writing' ? <form method="post" action={`/recordings/${r.id}/delete`}><input type="hidden" name="_csrf" value={session.csrfToken} /><button type="submit">この記録を消す</button></form> : <p>VC録音はDiscordの停止ボタンで止めてください。</p>}
    </article>)}
  </Layout>;
}

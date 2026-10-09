import type { AdminSession, guideEmployees, guideReceptions, employeePayroll } from '../../db/schema.js';
import type { GuildChannel, GuildRole } from '../../lib/discordRest.js';
import type { GuideConfig } from '../../services/guideReception.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';
const STATE = { pending: '承認待ち', active: '在籍', paused: '休止', waiting: '対応待ち', assigned: '案内中', done: '完了', left: '退出済み' };
export function GuidePage(p: { session: AdminSession; config: GuideConfig; employees: (typeof guideEmployees.$inferSelect)[]; receptions: (typeof guideReceptions.$inferSelect)[]; payroll: (typeof employeePayroll.$inferSelect)[]; names: Map<string, string>; channels: GuildChannel[]; roles: GuildRole[]; flash?: string }) {
  const csrf = () => <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  const channelName = (id: string) => p.channels.find(c => c.id === id)?.name ?? `見つからない部屋（${id}）`;
  const voices = p.channels.filter(c => c.type === 2);
  const categories = [...new Set(voices.map(c => c.parent_id))];
  const name = (id: string) => p.names.get(id) ?? id;
  return <Layout title="案内・給与" nav="guide" session={p.session} scripts={['guide.js']}>
    <h1>案内・給与</h1>
    <nav class="guide-nav" aria-label="案内管理の項目">{p.session.level === 'guji' && <><a href="#guide-setup">初期設定</a><a href="#guide-links">案内リンク</a></>}<a href="#guide-team">案内人</a><a href="#guide-history">対応履歴</a><a href="#guide-payroll">給与</a></nav>
    <div class="guide-overview"><span>監視する部屋 <strong>{p.config.voiceChannelIds.length}</strong></span><span>待機中の案内人 <strong>{p.employees.filter(e => e.status === 'active' && e.waiting).length}</strong></span><span>完了1件 <strong>{p.config.salary.toLocaleString('ja-JP')}銭</strong></span></div>
    {p.flash && <p role="status">{p.flash === 'saved' ? '保存しました。' : p.flash === 'posted' ? '受付パネルを出しました。' : p.flash === 'status' ? '登録を変更しました。' : p.flash === 'invalid' ? '保存できませんでした。部屋・ロール・絵文字・リンクを確認してください。保存前の設定は残っています。' : '設定・権限・BOTの接続を確認してください。'}</p>}
    <p>案内待ちロールの人が案内VCに入ると知らせ、各部屋にリンク案内を出します。音声接続は不要です。給与は完了時に支払います。同じ利用者は日本時間で1日1件まで給与対象です。</p>
    {p.session.level === 'guji' && <section class="card guide-section" id="guide-setup"><h2>1. 受付の設定</h2><form method="post" action="/guide/settings">{csrf()}
      <fieldset class="guide-voice"><legend>監視する案内VC（複数選べます）</legend>
        <p>保存した部屋は固定されます。変更するときだけ「変更する」を押してください。</p>
        <ul class="guide-selected">{p.config.voiceChannelIds.map(id => <li>🔊 {channelName(id)}</li>)}</ul>
        {!p.config.voiceChannelIds.length && <p>まだ選ばれていません。</p>}
        <details data-voice-editor open={!p.config.voiceChannelIds.length}><summary>{p.config.voiceChannelIds.length ? '変更する' : '案内VCを選ぶ'}</summary>
          <div class="guide-voice-tools"><label>部屋を検索<input type="search" data-voice-search placeholder="部屋名・カテゴリ名・ID" /></label><p data-voice-count role="status">{p.config.voiceChannelIds.length} / 20部屋を選択</p><button type="button" data-voice-reset>変更を取り消す</button></div>
          <div class="guide-voice-list">{categories.map(parent => <div class="guide-voice-group"><h3>{parent ? channelName(parent) : 'カテゴリなし'}</h3>{voices.filter(c => c.parent_id === parent).sort((a,b) => a.position - b.position).map(c => <label class="guide-voice-option" data-voice-option data-search={`${c.name} ${c.id} ${parent ? channelName(parent) : ''}`}><input type="checkbox" name="voiceChannelIds" value={c.id} checked={p.config.voiceChannelIds.includes(c.id)} /><span>🔊 {c.name}</span></label>)}</div>)}
          {p.config.voiceChannelIds.filter(id => !voices.some(c => c.id === id)).map(id => <label class="guide-voice-option" data-voice-option data-search={id}><input type="checkbox" name="voiceChannelIds" value={id} checked /><span>{channelName(id)}（削除するならチェックを外す）</span></label>)}</div>
          <p data-voice-empty hidden>一致する部屋がありません。</p>
          <p>チェックしたあと、下の「設定を保存」で確定します。選べる部屋は20個までです。</p>
        </details>
      </fieldset>
      <label>通知先<select name="staffChannelId"><option value="">設定済みの「記録」</option>{p.config.staffChannelId && !p.channels.some(c => c.type === 0 && c.id === p.config.staffChannelId) && <option value={p.config.staffChannelId} selected>現在の通知先（{p.config.staffChannelId}・取得できませんでした）</option>}{p.channels.filter(c => c.type === 0).map(c => <option value={c.id} selected={p.config.staffChannelId === c.id}>{c.name}</option>)}</select></label>
      <label>案内人ロール<select name="roleId"><option value="">名前に「案内人」を含むロール（1つだけのとき）</option>{p.config.roleId && !p.roles.some(r => !r.managed && r.id === p.config.roleId) && <option value={p.config.roleId} selected>現在のロール（{p.config.roleId}・取得できませんでした）</option>}{p.roles.filter(r => !r.managed).map(r => <option value={r.id} selected={p.config.roleId === r.id}>{r.name}</option>)}</select></label>
      <label>完了1件の給与（銭。0で支払い停止）<input type="number" name="salary" min={0} max={1000000} value={p.config.salary} required /></label>
      <button type="submit">設定を保存</button>
      <h3 id="guide-links">2. 案内リンク（上から順に表示）</h3><p>絵文字を貼り付け、チャンネルのリンクまたはIDを入れてください。1行に3つまで、空白で区切って入れられます。空欄の行は表示しません。</p>
      <div class="guide-table"><table><thead><tr><th>絵文字</th><th>チャンネルのリンク・ID</th></tr></thead><tbody>{Array.from({ length: 10 }, (_, n) => { const l = p.config.links[n]; return <tr><td><input name={`emoji_${n}`} aria-label={`案内${n + 1}の絵文字`} value={l ? `<:${l.emojiName}:${l.emojiId}>` : ''} /></td><td><input name={`links_${n}`} aria-label={`案内${n + 1}のチャンネル`} value={l ? l.channelIds.join(' ') : ''} /></td></tr>; })}</tbody></table></div>
      <label>いまの案内文をまとめて貼る（任意）<textarea name="bulkLinks" rows={5} placeholder="絵文字とDiscordのチャンネルリンクを、1案内につき1行で貼ってください。" /></label><p>ここに貼った場合は、上の一覧をその内容に置き換えて保存します。空欄なら一覧の設定を使います。</p>
      <button type="submit">設定を保存</button></form>
      <h3>3. 案内人の受付パネル</h3><p>設定を保存したあと、案内人が登録・待機を切り替えるパネルを出します。</p><form method="post" action="/guide/panel">{csrf()}<label>案内人の受付パネルを出す場所<select name="channelId" required><option value="">選んでください</option>{p.channels.filter(c => c.type === 0).map(c => <option value={c.id}>{c.name}</option>)}</select></label><button type="submit">受付パネルを出す</button></form>
    </section>}
    <section class="card guide-section" id="guide-team"><h2>案内人の登録</h2><p>本人が受付パネルから申請し、宮司が承認すると案内人ロールが付きます。承認済みの本人が待機・停止を切り替えます。</p>{!p.employees.length && <p>登録はまだありません。受付パネルから申請すると、ここに表示されます。</p>}<div class="guide-table"><table><thead><tr><th>名前</th><th>登録</th><th>待機</th><th>操作</th></tr></thead><tbody>{p.employees.map(e => <tr><td>{name(e.memberId)}</td><td>{STATE[e.status]}</td><td>{e.waiting ? '待機中' : '受付停止'}</td><td>{p.session.level === 'guji' && <form method="post" action={`/guide/employees/${e.memberId}`}>{csrf()}<button name="status" value={e.status === 'active' ? 'paused' : 'active'}>{e.status === 'active' ? '休止する' : e.status === 'paused' ? '再開する' : '承認する'}</button></form>}</td></tr>)}</tbody></table></div></section>
    <section class="card guide-section" id="guide-history"><h2>最近の案内（直近100件）</h2><p>案内待ちの人の受付を記録します。「案内を開始する」を押した案内人が担当欄に表示されます。</p>{!p.receptions.length && <p>まだ案内の記録がありません。設定したVCへの入室があると表示されます。</p>}<div class="guide-table"><table><thead><tr><th>入室</th><th>利用者</th><th>担当</th><th>状態</th><th>通知</th></tr></thead><tbody>{p.receptions.map(r => <tr><td>{fmtDateTime(r.createdAt)}</td><td>{name(r.visitorId)}</td><td>{r.guideId ? name(r.guideId) : '未定'}</td><td>{STATE[r.status]}</td><td>{r.notifiedAt ? '通知済み' : r.status === 'left' ? '退出済み' : '未通知・設定と権限を確認'}</td></tr>)}</tbody></table></div></section>
    <section class="card guide-section" id="guide-payroll"><h2>給与明細（直近100件・支払済み）</h2><p>案内完了時に支払います。同じ利用者は日本時間で1日1件まで給与対象です。</p>{!p.payroll.length && <p>支払いはまだありません。</p>}<div class="guide-table"><table><thead><tr><th>日付</th><th>従業員</th><th>仕事</th><th>対象</th><th>給与</th></tr></thead><tbody>{p.payroll.map(r => <tr><td>{r.date}</td><td>{name(r.memberId)}</td><td>案内</td><td>{name(r.visitorId)}</td><td>{r.amount.toLocaleString('ja-JP')}銭</td></tr>)}</tbody></table></div></section>
  </Layout>;
}

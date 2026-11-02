import { WEB_PAGES, type WebAccessEntry } from '../../config.js';
import { OFFICE_PRESETS } from '../../domain/officeAccess.js';
import { OFFICE_TOPICS, type OfficeSignal } from '../../services/officeNotifications.js';
import type { WebAccount } from '../../db/schema.js';
import { Layout, type SessionView } from './layout.js';

function Csrf({ session }: { session: SessionView }) { return <input type="hidden" name="_csrf" value={session.csrfToken} />; }
function GrantMatrix({ pages, writePages }: { pages: readonly string[] | null; writePages?: readonly string[] | null }) {
  return <div class="office-grant-grid">{WEB_PAGES.map(p => {
    const view = pages === null || pages.includes('*') || pages.includes(p.key);
    const value = !view ? 'none' : writePages == null || writePages.includes(p.key) ? 'write' : 'read';
    return <label class="office-grant-row"><span>{p.label}</span><select name={`page_${p.key}`} aria-label={`${p.label}の権限`}>
      <option value="none" selected={value === 'none'}>渡さない</option><option value="read" selected={value === 'read'}>見るだけ</option><option value="write" selected={value === 'write'}>見る・操作する</option>
    </select></label>;
  })}</div>;
}
function Presets() { return <div class="office-presets" aria-label="担当セット">{OFFICE_PRESETS.map(p => <button type="button" class="secondary" data-office-preset data-pages={p.pages.join(',')} data-writes={p.writePages.join(',')}>{p.label}</button>)}</div>; }
export function OfficeAccessPage(props: { session: SessionView; entries: WebAccessEntry[]; accounts: WebAccount[]; roles: { id: string; name: string }[]; names: Map<string, string>; flash?: string }) {
  const { session } = props;
  return <Layout title="権限を渡す" session={session}>
    <section class="office-hero"><p class="office-eyebrow">社務所 / 運営の引き継ぎ</p><h1>担当に合わせて、権限を渡す。</h1><p>セットを選び、ページごとに調整して保存します。セットを押すと、このフォームの選択を入れ替えます。</p><a href="/office/app">アプリ・通知設定へ →</a></section>
    {props.flash && <p class="notice" role="status">{props.flash === 'saved' ? '権限を保存しました。次のアクセスから反映されます。' : '保存できませんでした。対象と確認欄を見直してください。'}</p>}
    <div class="office-grid"><section class="card"><h2>権限の決まり</h2><ul><li>宮司は全ページを使えます。ここでは宮司の任命はしません。</li><li>個人の調整は、神職ロール・担当ロール・組織図より優先します。</li><li>神職の基本権限は全部です。絞る場合は「個人」で保存してください。</li><li>担当ロールが複数ある場合は、使える範囲を合わせます。</li><li>設定や銭の一部操作など、宮司専用の操作は渡せません。</li></ul></section>
    <section class="card"><h2>ほかの権限の出どころ</h2><p>組織図の部署や、従来の運営ロールでも権限が付く場合があります。個人の調整を保存した人は、ここで選んだ範囲に固定します。</p><a href="/org">組織図を確認</a> · <a href="/settings#sec-webaccess">従来の設定を確認</a> · <a href="/settings#sec-accounts">ID・パスワードの発行と停止</a></section></div>
    <section class="card"><h2>新しく渡す・個人を調整する</h2><form method="post" action="/office/access" data-office-grant><Csrf session={session} />
      <div class="office-grid"><label>対象<select name="kind"><option value="member">個人</option><option value="role">Discordのロール</option></select></label><label>個人の名前またはDiscord ID<input name="member" maxlength={100} placeholder="個人の場合に入力" /></label><label>Discordのロール<select name="roleId"><option value="">ロールの場合に選択</option>{props.roles.map(r => <option value={r.id}>{r.name}</option>)}</select></label></div>
      <Presets /><GrantMatrix pages={[]} writePages={[]} /><label class="office-confirm"><input type="checkbox" name="confirm" value="yes" required /> 対象と権限を確認しました</label><button type="submit">権限を確認して保存</button>
    </form></section>
    <h2>登録済みの人・ロール</h2>{!props.entries.length && <p>個別の登録はまだありません。</p>}{props.entries.map(e => <details class="card office-access-card"><summary>{e.kind === 'role' ? 'ロール' : '個人'}：{props.names.get(e.id) ?? e.id}<small>閲覧 {e.pages.includes('*') ? '全部' : e.pages.length} / 操作 {e.writePages === undefined ? '閲覧と同じ' : e.writePages.length}</small></summary><form method="post" action="/office/access" data-office-grant><Csrf session={session} /><input type="hidden" name="kind" value={e.kind} /><input type="hidden" name="member" value={e.id} /><input type="hidden" name="roleId" value={e.id} /><Presets /><GrantMatrix pages={e.pages} writePages={e.writePages} /><label class="office-confirm"><input type="checkbox" name="confirm" value="yes" required /> この対象の変更を確認しました</label><button type="submit">権限を確認して保存</button></form></details>)}
    <h2>IDでログインするアカウント</h2>{props.accounts.map(a => <details class="card office-access-card"><summary>{a.name}<small>{a.disabled ? '停止中' : a.level === 'guji' ? '宮司（全部）' : '神職'}</small></summary>{a.level === 'guji' ? <p>宮司の権限は、この画面から変更しません。</p> : <form method="post" action="/office/access" data-office-grant><Csrf session={session} /><input type="hidden" name="kind" value="account" /><input type="hidden" name="accountId" value={a.id} /><Presets /><GrantMatrix pages={a.pages} writePages={a.writePages} /><label class="office-confirm"><input type="checkbox" name="confirm" value="yes" required /> このアカウントの変更を確認しました</label><button type="submit">権限を確認して保存</button></form>}</details>)}
  </Layout>;
}
export function OfficeAppPage(props: { session: SessionView; signals: OfficeSignal[]; publicKey: string; iconVersion: string; topics: readonly string[]; flash?: string }) {
  const { session } = props;
  const topics = OFFICE_TOPICS.filter(t => session.level === 'guji' || !session.pages || session.pages.includes(t.page));
  return <Layout title="アプリ・お知らせ" session={session}>
    <section class="office-hero"><div class="office-app-title"><img src={`/office-icon/192.png?v=${props.iconVersion}`} alt="" width="72" height="72" /><div><p class="office-eyebrow">咲楽ノ宮 / 社務所</p><h1>手のひらの社務所。</h1></div></div><p>対応待ちの確認も、担当の仕事も、スマホから。</p></section>
    {props.flash && <p class="notice" role="status">{props.flash === 'saved' ? 'アイコンを保存しました。ホーム画面の反映には時間がかかる場合があります。' : '保存できませんでした。PNG・JPEG・WebP、2MBまでの画像を選んでください。'}</p>}
    <section class="card"><div class="office-section-heading"><h2>いま確認すること</h2><a href="/office/app">更新</a></div><div class="office-inbox">{topics.map(t => <a class="office-inbox-item" href={t.href}><span>{t.label}</span><strong>{props.signals.filter(s => s.topic === t.key).length}<small>件</small></strong><span aria-hidden="true">→</span></a>)}</div>{!topics.length && <p>今の担当に通知対象のページはありません。</p>}<p class="muted">自分が見られるページだけを表示しています。</p></section>
    <div class="office-grid"><section class="card"><h2>ホーム画面へ追加</h2><p>いつものブラウザで一度ログインしてから追加すると、専用のウィンドウで開けます。</p><button type="button" data-office-install>ホーム画面に追加する</button><p data-office-install-help role="status">iPhone・iPadはSafariの共有メニュー →「ホーム画面に追加」。Androidはブラウザのメニュー →「アプリをインストール」。</p></section>
    <section class="card"><h2>この端末への通知</h2><form method="post" action="/office/push/subscribe" data-office-push data-public-key={props.publicKey}><Csrf session={session} />{topics.map(t => <label class="office-topic"><input type="checkbox" name="topic" value={t.key} checked={props.topics.includes(t.key)} />{t.label}</label>)}<div class="office-presets"><button type="submit">通知を受け取る・設定を保存</button><button type="button" class="secondary" data-office-unsubscribe>この端末の通知を止める</button></div><p data-office-push-status role="status" aria-live="polite"></p></form><p class="muted">通知には人名や相談本文を載せません。iPhone・iPadはiOS 16.4以降でホーム画面に追加してから設定します。30日で登録が切れるため、通知設定を保存し直してください。ログアウトすると、このログインで登録した通知は止まります。</p></section></div>
    {session.level === 'guji' && <section class="card"><h2>共通のアプリアイコン</h2><p>すべての運営が使うアイコンです。中央に余白がある正方形の画像がおすすめです。</p><form method="post" action="/office/icon" enctype="multipart/form-data"><Csrf session={session} /><label>PNG・JPEG・WebP（2MBまで）<input type="file" name="icon" accept="image/png,image/jpeg,image/webp" required /></label><button type="submit">アイコンを保存</button></form><form method="post" action="/office/icon/reset"><Csrf session={session} /><button class="secondary" type="submit">標準の鳥居アイコンに戻す</button></form><p class="muted">端末によって、反映に再追加が必要な場合があります。</p><a href="/office/access">担当別の権限を整理する →</a></section>}
  </Layout>;
}

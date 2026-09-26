import type { GuildConfig } from '../../config.js';
import type { AdminSession, Application, Omairi, Soudan, SoudanMessage } from '../../db/schema.js';
import { AGE_LABEL, fmtAgo, fmtDate, fmtDateTime, memberRankLabel } from '../format.js';
import { Avatar, Layout } from './layout.js';

type Names = Map<string, string>;
const who = (names: Names, id: string | null) => (id ? (id === 'system' ? '自動' : names.get(id) ?? `ID ${id}`) : '—');

const KIND_LABEL: Record<string, string> = { join: '入鯖', yoimairi: '🔞 宵参り' };
const STATUS_LABEL: Record<string, string> = { pending: '待ち', approved: '承認', rejected: '却下' };
const SOUDAN_STATUS: Record<string, string> = { open: '未対応', in_progress: '対応中', done: '完了' };
const OMAIRI_STATUS: Record<string, string> = { ongoing: 'お参り期間中', review: '判定待ち', promoted: '完了（昇格）', removed: '退出' };

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

export const ADMISSION_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  approved: { text: '承認しました。本人に DM で知らせました。', kind: 'ok' },
  rejected: { text: '却下しました。', kind: 'ok' },
  already_decided: { text: 'この申請はすでに判定済みです。', kind: 'warn' },
  not_adult: { text: '18 歳以上と申告していないため、宵参りを承認できません。', kind: 'warn' },
  omairi_ok: { text: 'お参り期間を判定しました。', kind: 'ok' },
  omairi_missing: { text: 'すでに判定済みか、お参り期間中ではありません。', kind: 'warn' },
  replied: { text: '返信を送りました。', kind: 'ok' },
  replied_nodm: { text: '返信を記録しましたが、DM が届きませんでした（DM を受け取らない設定の可能性）。', kind: 'warn' },
  soudan_done: { text: '完了にしました。', kind: 'ok' },
  saved: { text: '設定を保存しました。BOT には 1 分以内に反映されます。', kind: 'ok' },
  bonus_given: { text: 'まだもらっていない人に初期配布を配りました。', kind: 'ok' },
  coins_all_given: { text: '今いる人みんなに送りました。', kind: 'ok' },
  coins_dup: { text: 'この操作はもう済んでいます（二度押しなどで 2 回送られないようにしています）。', kind: 'warn' },
  coins_invalid: { text: '枚数（1〜100,000）と理由を入れて、「送る」にチェックしてください。', kind: 'warn' },
  saved_notices: { text: '設定を保存しました。BOT には 1 分以内に反映されます。投稿済みの掲示の数字も書き換えました。', kind: 'ok' },
  settings_invalid: { text: '設定を保存できませんでした。値を確認してください（昇格ラインは役職ごとに違う値にする必要があります）。', kind: 'warn' },
  age_changed: { text: '年齢区分を変更しました。', kind: 'ok' },
  yoimairi_removed: { text: '宵参りを外しました。', kind: 'ok' },
  forbidden: { text: '宮司のみできる操作です。', kind: 'warn' },
  invalid: { text: '入力が足りません。', kind: 'warn' },
};

function Flash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(ADMISSION_FLASH, props.code) ? ADMISSION_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}

// ───────── 申請 ─────────

type PendingRow = { app: Application; displayName: string | null; username: string | null; avatarUrl: string | null; joinedAt: Date | null };

export function ApplicationsPage(props: {
  session: AdminSession;
  pending: PendingRow[];
  decided: { app: Application; displayName: string | null }[];
  names: Names;
  now: Date;
  flash?: string;
}) {
  return (
    <Layout title="申請" session={props.session} nav="applications">
      <h1>申請</h1>
      <Flash code={props.flash} />
      <p class="note">
        Discord の #申請受付 のボタンと同じ処理です。どちらで判定しても、もう片方に反映されます。 <a href="/omairi">お参り期間の一覧 →</a>
      </p>
      {props.pending.length === 0 ? (
        <p class="empty">待っている申請はありません。</p>
      ) : (
        props.pending.map(({ app, displayName, username, avatarUrl }) => (
          <section class="card application">
            <div class="who">
              <Avatar url={avatarUrl} />
              <span>
                <a href={`/members/${app.memberId}`}>{displayName ?? `ID ${app.memberId}`}</a>
                {username && <small>@{username}</small>}
              </span>
              <span class="tag red">{KIND_LABEL[app.kind] ?? app.kind}</span>
              <small>
                #{app.id} ・ {fmtAgo(app.createdAt, props.now)}
              </small>
            </div>
            {app.kind === 'join' && (
              <dl class="facts">
                <div>
                  <dt>呼び名</dt>
                  <dd>{app.answers.name}</dd>
                </div>
                <div>
                  <dt>年齢区分</dt>
                  <dd>{AGE_LABEL[app.answers.age ?? 'unknown']}</dd>
                </div>
                <div>
                  <dt>やりたいこと</dt>
                  <dd>{app.answers.purpose}</dd>
                </div>
                {app.answers.message && (
                  <div class="wide">
                    <dt>ひとこと</dt>
                    <dd>{app.answers.message}</dd>
                  </div>
                )}
              </dl>
            )}
            <form method="post" action={`/applications/${app.id}/decide`} class="inline-actions">
              <Csrf session={props.session} />
              <input type="text" name="note" maxlength={300} placeholder="メモ（任意・却下の理由など。本人には送られません）" />
              <button type="submit" name="approve" value="yes" class="ok">
                承認
              </button>
              <button type="submit" name="approve" value="no" class="danger">
                却下
              </button>
            </form>
          </section>
        ))
      )}
      <section class="card">
        <h2>最近の判定</h2>
        {props.decided.length === 0 ? (
          <p class="empty">まだありません。</p>
        ) : (
          <table class="compact">
            <tbody>
              {props.decided.map(({ app, displayName }) => (
                <tr>
                  <td>{fmtDateTime(app.reviewedAt)}</td>
                  <td>
                    <a href={`/members/${app.memberId}`}>{displayName ?? app.memberId}</a>
                  </td>
                  <td>{KIND_LABEL[app.kind]}</td>
                  <td>{STATUS_LABEL[app.status]}</td>
                  <td>{who(props.names, app.reviewedBy)}</td>
                  <td>{app.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Layout>
  );
}

// ───────── お参り期間 ─────────

type OmairiRow = { o: Omairi; displayName: string | null; username: string | null; avatarUrl: string | null; roleIds: string[] | null; leftAt: Date | null };

export function OmairiPage(props: { session: AdminSession; cfg: GuildConfig; review: OmairiRow[]; ongoing: OmairiRow[]; now: Date; flash?: string }) {
  const Table = (p: { rows: OmairiRow[]; actions: boolean }) =>
    p.rows.length === 0 ? (
      <p class="empty">いません。</p>
    ) : (
      <div class="table-wrap">
        <table class="members">
          <thead>
            <tr>
              <th>名前</th>
              <th>役職</th>
              <th>期限</th>
              <th>延長</th>
              {p.actions && <th>判定</th>}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr>
                <td>
                  <a class="who" href={`/members/${r.o.memberId}`}>
                    <Avatar url={r.avatarUrl} />
                    <span>
                      {r.displayName ?? r.o.memberId}
                      {r.username && <small>@{r.username}</small>}
                    </span>
                  </a>
                </td>
                <td>{memberRankLabel(props.cfg, r.roleIds ?? [])}</td>
                <td>
                  {fmtDate(r.o.endsAt)}（{r.o.endsAt > props.now ? `あと ${Math.ceil((r.o.endsAt.getTime() - props.now.getTime()) / 86_400_000)} 日` : '終了'}）
                </td>
                <td>{r.o.extendedCount} 回</td>
                {p.actions && (
                  <td>
                    <form method="post" action={`/omairi/${r.o.memberId}`} class="inline-actions">
                      <Csrf session={props.session} />
                      <button type="submit" name="action" value="extend">
                        延長
                      </button>
                      <button type="submit" name="action" value="promote" class="ok">
                        昇格
                      </button>
                      <button type="submit" name="action" value="remove" class="danger">
                        退出
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <Layout title="お参り期間" session={props.session} nav="applications">
      <h1>お参り期間</h1>
      <Flash code={props.flash} />
      <p class="note">
        期間は {props.cfg.omairi.days} 日。届かなければ 1 回だけ自動で {props.cfg.omairi.extendDays} 日延長し、それでも届かなければここに「判定待ち」として出ます。
      </p>
      <section class="card">
        <h2>判定待ち</h2>
        <Table rows={props.review} actions />
      </section>
      <section class="card">
        <h2>お参り期間中</h2>
        <Table rows={props.ongoing} actions={false} />
      </section>
    </Layout>
  );
}

// ───────── 相談 ─────────

export function SoudanListPage(props: {
  session: AdminSession;
  rows: (Soudan & { firstBody: string; messageCount: number })[];
  status: string;
  names: Names;
  now: Date;
}) {
  const tabs = [
    ['active', '未対応・対応中'],
    ['done', '完了'],
  ];
  return (
    <Layout title="相談" session={props.session} nav="soudan">
      <h1>📮 相談</h1>
      <p class="note">相談した人の名前は表示されません。返信は BOT から本人へ DM で届きます（神職の名前は出ません）。</p>
      <nav class="tabs">
        {tabs.map(([k, v]) => (
          <a href={`/soudan?status=${k}`} class={props.status === k ? 'on' : ''}>
            {v}
          </a>
        ))}
      </nav>
      {props.rows.length === 0 ? (
        <p class="empty">相談はありません。</p>
      ) : (
        <div class="table-wrap">
          <table class="members">
            <thead>
              <tr>
                <th>番号</th>
                <th>内容</th>
                <th>状態</th>
                <th>担当</th>
                <th>更新</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((r) => (
                <tr>
                  <td>
                    <a href={`/soudan/${r.id}`}>#{r.id}</a>
                  </td>
                  <td class="wrap">
                    <a href={`/soudan/${r.id}`}>{r.firstBody.slice(0, 60)}{r.firstBody.length > 60 ? '…' : ''}</a>
                    <small> （{r.messageCount} 件）</small>
                  </td>
                  <td>
                    <span class={r.status === 'open' ? 'tag red' : 'tag gray'}>{SOUDAN_STATUS[r.status]}</span>
                  </td>
                  <td>{who(props.names, r.assigneeId)}</td>
                  <td>{fmtAgo(r.updatedAt, props.now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}

export function SoudanPage(props: {
  session: AdminSession;
  soudan: Soudan;
  messages: SoudanMessage[];
  names: Names;
  revealed?: string;
  flash?: string;
}) {
  const s = props.soudan;
  const isGuji = props.session.level === 'guji';
  return (
    <Layout title={`相談 #${s.id}`} session={props.session} nav="soudan">
      <p class="crumbs">
        <a href="/soudan">相談</a> / #{s.id}
      </p>
      <h1>
        📮 相談 #{s.id} <span class={s.status === 'open' ? 'tag red' : 'tag gray'}>{SOUDAN_STATUS[s.status]}</span>
      </h1>
      <Flash code={props.flash} />
      <section class="card">
        <ul class="chat">
          {props.messages.map((m) => (
            <li class={m.fromRole}>
              <div class="meta">
                {m.fromRole === 'sender' ? '相談した人（匿名）' : `神職: ${who(props.names, m.staffId)}`} ・ {fmtDateTime(m.createdAt)}
              </div>
              <div class="body">{m.body}</div>
            </li>
          ))}
        </ul>
        <form method="post" action={`/soudan/${s.id}/reply`} class="memo-form">
          <Csrf session={props.session} />
          <textarea name="body" rows={3} maxlength={1500} placeholder="返信（BOT から DM で届きます。あなたの名前は出ません）" required></textarea>
          <button type="submit" class="ok">
            返信する
          </button>
        </form>
        {s.status !== 'done' && (
          <form method="post" action={`/soudan/${s.id}/done`}>
            <Csrf session={props.session} />
            <button type="submit">完了にする</button>
          </form>
        )}
      </section>
      {isGuji && (
        <section class="card">
          <h2>相談した人を確認（宮司のみ・緊急時）</h2>
          {props.revealed ? (
            <p>
              相談した人: <a href={`/members/${props.revealed}`}>{who(props.names, props.revealed)}</a>（確認したことは操作の記録に残りました）
            </p>
          ) : (
            <form method="post" action={`/soudan/${s.id}/reveal`} class="inline-actions">
              <Csrf session={props.session} />
              <input type="text" name="reason" maxlength={300} placeholder="確認する理由（必須・記録に残ります）" required />
              <button type="submit" class="danger">
                確認する
              </button>
            </form>
          )}
        </section>
      )}
    </Layout>
  );
}

// ───────── メンバー詳細に足す: 年齢区分・宵参り・申請の履歴 ─────────

export function MemberAdmissionSection(props: {
  session: AdminSession;
  cfg: GuildConfig;
  memberId: string;
  ageGroup: string;
  roleIds: string[];
  omairi?: Omairi;
  applications: Application[];
  names: Names;
}) {
  const isGuji = props.session.level === 'guji';
  const yoi = props.cfg.roles.yoimairi;
  const hasYoi = Boolean(yoi && props.roleIds.includes(yoi));
  return (
    <div class="grid2">
      <section class="card">
        <h2>年齢区分・宵参り・お参り期間</h2>
        <dl class="facts">
          <div>
            <dt>年齢区分</dt>
            <dd>{AGE_LABEL[props.ageGroup] ?? props.ageGroup}</dd>
          </div>
          <div>
            <dt>🔞 宵参り</dt>
            <dd>{hasYoi ? 'あり' : 'なし'}</dd>
          </div>
          <div>
            <dt>お参り期間</dt>
            <dd>{props.omairi ? `${OMAIRI_STATUS[props.omairi.status]}（${fmtDate(props.omairi.endsAt)} まで）` : '—'}</dd>
          </div>
        </dl>
        {isGuji && (
          <form method="post" action={`/members/${props.memberId}/age`} class="inline-actions">
            <Csrf session={props.session} />
            <select name="age">
              {['minor', 'adult', 'unknown'].map((k) => (
                <option value={k} {...(props.ageGroup === k ? { selected: true } : {})}>
                  {AGE_LABEL[k]}
                </option>
              ))}
            </select>
            <button type="submit">年齢区分を変更（宮司）</button>
          </form>
        )}
        {hasYoi && (
          <form method="post" action={`/members/${props.memberId}/yoimairi/remove`} class="inline-actions">
            <Csrf session={props.session} />
            <input type="text" name="reason" maxlength={300} placeholder="宵参りを外す理由（必須）" required />
            <button type="submit" class="danger">
              宵参りを外す
            </button>
          </form>
        )}
      </section>
      <section class="card">
        <h2>申請の履歴</h2>
        {props.applications.length === 0 ? (
          <p class="empty">申請はありません。</p>
        ) : (
          <table class="compact">
            <tbody>
              {props.applications.map((a) => (
                <tr>
                  <td>{fmtDateTime(a.createdAt)}</td>
                  <td>{KIND_LABEL[a.kind]}</td>
                  <td>{STATUS_LABEL[a.status]}</td>
                  <td>{who(props.names, a.reviewedBy)}</td>
                  <td class="wrap">{a.kind === 'join' ? `${a.answers.name ?? ''} / ${AGE_LABEL[a.answers.age ?? 'unknown']} / ${a.answers.purpose ?? ''}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ───────── 設定（宮司） ─────────

export function SettingsPage(props: { session: AdminSession; cfg: GuildConfig; fileCfg: GuildConfig; flash?: string; error?: string; coinsNonce?: string }) {
  const { cfg, fileCfg } = props;
  const e = cfg.economy;
  // いちばん下の自動役職（参拝者）は入鯖時に付くので、昇格ラインは 0 で固定
  const firstAutoKey = [...cfg.ranks].filter((x) => x.auto).sort((a, b) => a.requiredGoen - b.requiredGoen)[0]?.key;
  const f = fileCfg.economy;
  const Num = (p: { name: string; label: string; value: number; file: number; min?: number }) => (
    <label class="field">
      <span>{p.label}</span>
      <input type="number" name={p.name} value={String(p.value)} min={p.min ?? 0} required />
      {p.value !== p.file && <small>ファイルの値: {p.file}</small>}
    </label>
  );
  return (
    <Layout title="設定" session={props.session} nav="settings">
      <h1>設定（宮司のみ）</h1>
      <Flash code={props.flash} />
      {props.error && <p class="flash warn">{props.error}</p>}
      <p class="note">ここで変えた値は config/guild.json の値より優先されます。BOT には 1 分以内に反映されます。チャンネル・ロールの ID はファイルで設定してください。</p>
      <form method="post" action="/settings" class="settings">
        <Csrf session={props.session} />
        <section class="card">
          <h2>{e.currencyEmoji} 通貨と免罪符</h2>
          <div class="fields">
            <label class="field">
              <span>通貨の名前</span>
              <input type="text" name="currencyName" value={e.currencyName} maxlength={20} required />
            </label>
            <label class="field">
              <span>通貨の絵文字</span>
              <input type="text" name="currencyEmoji" value={e.currencyEmoji} maxlength={10} />
            </label>
            <Num name="menzaifuPrice" label="免罪符の値段" value={e.menzaifuPrice} file={f.menzaifuPrice} min={1} />
            <Num name="menzaifuMaxUses" label="免罪符を買える回数（1 人あたり）" value={e.menzaifuMaxUses} file={f.menzaifuMaxUses} />
            <Num name="voicePer10Min" label="通話 10 分ごとにもらえる量" value={e.voicePer10Min} file={f.voicePer10Min} />
            <Num name="voiceDailyCap" label="通話でもらえる 1 日の上限" value={e.voiceDailyCap} file={f.voiceDailyCap} />
            <Num name="shuinGive" label="朱印を押すともらえる量" value={e.shuinGive} file={f.shuinGive} />
            <Num name="shuinReceive" label="朱印を頂くともらえる量" value={e.shuinReceive} file={f.shuinReceive} />
            <Num name="giftMin" label="贈り物: 1 回に贈れる最小" value={e.giftMin} file={f.giftMin} min={1} />
            <Num name="giftMax" label="贈り物: 1 回に贈れる最大" value={e.giftMax} file={f.giftMax} min={1} />
            <Num name="giftDailyLimit" label="贈り物: 1 人が 1 日に贈れる合計" value={e.giftDailyLimit} file={f.giftDailyLimit} />
            <Num name="joinBonus" label="初期配布（入鯖が承認されたときに 1 回だけ。0 で配らない）" value={e.joinBonus} file={f.joinBonus} />
            <Num name="omikujiBase" label="おみくじの基本の量（吉でこの量・大吉は 3 倍・凶は半分。0 でなし）" value={e.omikujiBase} file={f.omikujiBase} />
          </div>
        </section>
        <section class="card">
          <h2>🏮 コアタイム</h2>
          <p class="note">
            みんなが集まる時間（日本時間）。この間の通話は{e.currencyName}が増えます（増えた分は 1 日の上限に数えません。端数は四捨五入）。#境内 に、前日と始まる少し前に予告を出します。曜日ごとに 1 つ。空けた曜日はコアタイムなし。終わりを 00:00 にすると 24 時まで。
          </p>
          <table class="compact coretime">
            <thead>
              <tr>
                <th>曜日</th>
                <th>始まり</th>
                <th>終わり</th>
              </tr>
            </thead>
            <tbody>
              {['日', '月', '火', '水', '木', '金', '土'].map((w, d) => {
                const slot = cfg.coreTime.slots.find((s) => s.day === d);
                return (
                  <tr>
                    <td>{w}曜</td>
                    <td>
                      <input type="time" name={`ct.${d}.start`} value={slot?.start ?? ''} aria-label={`${w}曜の始まり`} />
                    </td>
                    <td>
                      <input type="time" name={`ct.${d}.end`} value={slot ? (slot.end === '24:00' ? '00:00' : slot.end) : ''} aria-label={`${w}曜の終わり`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div class="fields">
            <Num name="coreTimePercent" label="通話の花びら（%。150 で 1.5 倍）" value={e.coreTimePercent} file={f.coreTimePercent} min={100} />
            <label class="field">
              <span>前日の予告の時刻（空で出さない）</span>
              <input type="time" name="ctNoticeDayBefore" value={cfg.coreTime.noticeDayBefore} />
            </label>
            <label class="field">
              <span>始まる何分前に予告（0 で出さない）</span>
              <input type="number" name="ctNoticeMinutesBefore" value={String(cfg.coreTime.noticeMinutesBefore)} min={0} max={720} required />
            </label>
          </div>
        </section>
        <section class="card">
          <h2>🏮 ブースト（奉納）のお礼</h2>
          <p class="note">
            ブースト 1 回ごとに、#慶事 でお知らせ・本人に DM・{e.currencyName}を贈ります（2 回なら 2 回分）。続けてくれている間は 30 日ごとにまた贈ります（1 人 1 回分）。割引は何回ブーストしても同じです。#番付 に今奉納してくれている人の「奉納板」も出します。
            <br />
            ブースト 1 回ごとに数えるには、Discord のサーバー設定 →「システムメッセージチャンネル」を選び、「サーバーがブーストされた時にメッセージを送信する」を ON にしてください（OFF だと 1 人 1 回分になります）。
          </p>
          <div class="fields">
            <Num name="boostThanks" label={`お礼の${e.currencyName}（ブースト 1 回あたり。0 で贈らない）`} value={e.boostThanks} file={f.boostThanks} />
            <Num name="boostDiscountPercent" label="授与品の割引 %（免罪符・贈り物はのぞく。0 で割引なし。90 まで）" value={e.boostDiscountPercent} file={f.boostDiscountPercent} />
          </div>
          <label class="field">
            <span>#慶事 に出すお知らせ（{'{名前}'} が奉納した人になります。通知は飛びません）</span>
            <textarea name="boostAnnounce" rows={3} maxlength={1000} required>
              {cfg.boost.announceText}
            </textarea>
          </label>
          <label class="field">
            <span>本人への DM の最初の文（お礼の{e.currencyName}・割引の案内は BOT が下に足します）</span>
            <textarea name="boostDm" rows={3} maxlength={1000} required>
              {cfg.boost.dmText}
            </textarea>
          </label>
        </section>
        <section class="card">
          <h2>役職（朱印の格・昇格ライン）</h2>
          <table class="compact">
            <thead>
              <tr>
                <th>役職</th>
                <th>朱印の格</th>
                <th>昇格に必要なご縁</th>
              </tr>
            </thead>
            <tbody>
              {[...cfg.ranks]
                .sort((a, b) => b.weight - a.weight)
                .map((r) => {
                  const fr = fileCfg.ranks.find((x) => x.key === r.key);
                  return (
                    <tr>
                      <td>
                        {r.emoji} {r.name}
                      </td>
                      <td>
                        <input type="number" name={`rank.${r.key}.weight`} value={String(r.weight)} min={1} required />
                        {fr && fr.weight !== r.weight && <small> ファイル: {fr.weight}</small>}
                      </td>
                      <td>
                        {r.key === firstAutoKey ? (
                          <>
                            入鯖時
                            <input type="hidden" name={`rank.${r.key}.requiredGoen`} value="0" />
                          </>
                        ) : r.auto ? (
                          <>
                            <input type="number" name={`rank.${r.key}.requiredGoen`} value={String(r.requiredGoen)} min={0} required />
                            {fr && fr.requiredGoen !== r.requiredGoen && <small> ファイル: {fr.requiredGoen}</small>}
                          </>
                        ) : (
                          '任命制'
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
        <section class="card">
          <h2>入鯖申請・お参り期間</h2>
          <div class="fields">
            <Num name="omairiDays" label="お参り期間（日）" value={cfg.omairi.days} file={fileCfg.omairi.days} min={1} />
            <Num name="omairiExtendDays" label="自動延長（日・0 で延長しない）" value={cfg.omairi.extendDays} file={fileCfg.omairi.extendDays} />
            <Num
              name="autoApproveAccountDays"
              label="半自動承認: アカウント作成からこの日数以上なら自動で承認（0 で全員を手動）"
              value={cfg.applications.autoApproveAccountDays}
              file={fileCfg.applications.autoApproveAccountDays}
            />
            <label class="field check">
              <input type="checkbox" name="kickOnReject" value="yes" {...(cfg.applications.kickOnReject ? { checked: true } : {})} />
              <span>入鯖申請を却下した人をキックする</span>
            </label>
          </div>
        </section>
        <p>
          <button type="submit" class="ok">
            保存する
          </button>
        </p>
      </form>
      <form method="post" action="/settings/join-bonus-all" class="card">
        <Csrf session={props.session} />
        <h2>{e.currencyEmoji} 今いる人に初期配布を配る</h2>
        <p class="note">
          役職のある今いる人のうち、まだ初期配布をもらっていない人に {e.joinBonus} 枚ずつ配ります。もらい済みの人には配らないので、何度押しても 2 回目はありません。
        </p>
        <label class="field check">
          <input type="checkbox" name="confirm" value="yes" required />
          <span>配る</span>
        </label>
        <button type="submit" class="ok">
          配る
        </button>
      </form>
      {props.coinsNonce && (
        <form method="post" action="/settings/coins-all" class="card">
          <Csrf session={props.session} />
          <input type="hidden" name="nonce" value={props.coinsNonce} />
          <h2>{e.currencyEmoji} 今いる人みんなに{e.currencyName}を送る</h2>
          <p class="note">
            イベントのお礼・お詫びなどに。役職のある今いる人（BOT・退出した人を除く）全員に同じ枚数を送ります。DM は送らないので、{'#御触書'} などで知らせてください。1 人ずつ送るときは、メンバーのページから送れます。
          </p>
          <div class="fields">
            <label class="field">
              <span>1 人あたりの枚数</span>
              <input type="number" name="amount" min={1} max={100000} required />
            </label>
            <label class="field">
              <span>理由（記録に残る）</span>
              <input type="text" name="note" maxlength={200} required />
            </label>
          </div>
          <label class="field check">
            <input type="checkbox" name="confirm" value="yes" required />
            <span>全員に送る</span>
          </label>
          <button type="submit" class="ok">
            送る
          </button>
        </form>
      )}
      <form method="post" action="/settings/reset">
        <Csrf session={props.session} />
        <button type="submit" class="link">
          すべてファイルの値に戻す
        </button>
      </form>
    </Layout>
  );
}

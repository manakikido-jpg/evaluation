import { OMIKUJI_SPECIAL_MAX, WEB_PAGES, webAccessEntries, type GachaTier, type GuildConfig, type WebAccessEntry } from '../../config.js';
import { contactSummary } from '../../services/contact.js';
import type { AdminSession, Application, Omairi, Soudan, SoudanMessage, WebAccount } from '../../db/schema.js';
import { AGE_LABEL, fmtAgo, fmtDate, fmtDateTime, memberRankLabel } from '../format.js';
import { GENDER_LABEL, isGender } from '../../services/admission.js';
import { recruitWaits } from '../../services/recruit.js';
import { specialPercent } from '../../services/omikuji.js';
import { TICKET_GROUPS, TICKET_LABEL } from '../../services/tickets.js';
import { Avatar, Layout } from './layout.js';
import { OmikujiTextsSection } from './omikujiTexts.js';

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
  notify_started: { text: '🔔 通知OK・🔕 通知NG のロールを用意しました。今いる人に 🔔 通知OK を少しずつ付けています（このページで進み具合が見られます）。', kind: 'ok' },
  notify_failed: { text: 'できませんでした。BOT に「ロールの管理」の権限があるか、BOT のロールが上のほうにあるかを確かめてください。', kind: 'warn' },
  notify_panel: { text: 'ボタンを置きました。', kind: 'ok' },
  notify_panel_invalid: { text: '置くチャンネルを選んでください（先にロールを用意してください）。', kind: 'warn' },
  settings_invalid: { text: '設定を保存できませんでした。値を確認してください（昇格ラインは役職ごとに違う値にする必要があります）。', kind: 'warn' },
  age_changed: { text: '年齢区分を変更しました。', kind: 'ok' },
  nickname_changed: { text: 'ニックネームを変えました（Discord に反映しました）。', kind: 'ok' },
  nickname_failed: { text: 'ニックネームを変えられませんでした。BOT に「ニックネームの管理」の権限があるか、相手のロールが BOT のロールより下か確かめてください（サーバーの持ち主は変えられません）。', kind: 'warn' },
  yoimairi_removed: { text: '宵参りを外しました。', kind: 'ok' },
  forbidden: { text: '宮司のみできる操作です。', kind: 'warn' },
  invalid: { text: '入力が足りません。', kind: 'warn' },
  webaccess_not_found: { text: 'ロール・人が見つかりませんでした（人は ID・ユーザー名・表示名で入れてください）。', kind: 'warn' },
  webaccess_ambiguous: { text: '同じ名前の人が 2 人以上います。ID で入れてください。', kind: 'warn' },
  webaccess_no_pages: { text: 'ロールは、見られるページを 1 つ以上選んでください（外すときは「外す」）。', kind: 'warn' },
  webaccess_removed: { text: '外しました。次に開いたときから入れなくなります。', kind: 'ok' },
  account_bad_id: { text: 'ID は英小文字・数字・「_ . -」で 3〜32 文字にしてください。', kind: 'warn' },
  account_taken: { text: 'その ID はもう使われています。', kind: 'warn' },
  account_bad_name: { text: '名前を入れてください。', kind: 'warn' },
  account_saved: { text: 'アカウントを保存しました（ログイン中の人にも、次に開いたときから効きます）。', kind: 'ok' },
  account_disabled: { text: '止めました。ログイン中だった人も入れなくなりました。', kind: 'ok' },
  account_enabled: { text: '使えるようにしました。', kind: 'ok' },
  account_deleted: { text: '消しました。', kind: 'ok' },
  unei_saved: { text: '🎴 運営吉を保存しました（BOT には 1 分以内に反映されます）。', kind: 'ok' },
  unei_partial: { text: '🎴 運営吉を保存しましたが、入らなかった絵があります（PNG・JPEG・WebP・GIF で 4MB まで）。', kind: 'warn' },
  unei_invalid: { text: '🎴 運営吉を保存できませんでした。確率（0〜100）・間隔（1〜365 日）・倍率・名前（20 文字まで）を確かめてください。', kind: 'warn' },
  unei_gap: { text: '🎴 名前は 1 枠目からつめて入れてください（途中の枠を空にはできません。絵は枠の番号で決まります）。', kind: 'warn' },
  unei_art_deleted: { text: '🎴 絵を消しました。', kind: 'ok' },
  unei_trial: { text: '🧪 運営のチャンネル（呼び鈴の知らせ先か #記録）に、運営吉を試しに出しました。ガラガラ → 光る → 絵 → 紙 の順に、6 秒ほどで全部出ます（くじは引いていません・銭は動きません）。', kind: 'ok' },
  unei_trial_noslot: { text: '🧪 その枠には名前が入っていません。名前を入れて「保存する」を押してから試してください。', kind: 'warn' },
  unei_trial_nochannel: { text: '🧪 試しを出すチャンネルがありません（呼び鈴の知らせ先か #記録 を決めてください）。', kind: 'warn' },
  unei_trial_failed: { text: '🧪 試しを出せませんでした（BOT がそのチャンネルに書けるか確かめてください）。', kind: 'warn' },
  account_last_guji: { text: '使える宮司が 1 人もいなくなるので、できません（先にほかの宮司を発行してください）。', kind: 'warn' },
  account_member_not_found: { text: 'Discord の人が見つかりませんでした（ID で入れてみてください）。', kind: 'warn' },
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
      <h1>📝 申請</h1>
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
                {isGender(app.answers.gender) && (
                  <div>
                    <dt>性別</dt>
                    <dd>{GENDER_LABEL[app.answers.gender]}</dd>
                  </div>
                )}
                {typeof app.answers.inviter === 'string' && (
                  <div>
                    <dt>招待してくれた人</dt>
                    <dd>
                      <a href={`/members/${app.answers.inviter}`}>{props.names.get(app.answers.inviter) ?? app.answers.inviter}</a>
                    </dd>
                  </div>
                )}
                {contactSummary(app.answers) && (
                  <div>
                    <dt>DM・フレンド</dt>
                    <dd>{contactSummary(app.answers)}</dd>
                  </div>
                )}
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
      <h1>🗓 お参り期間</h1>
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
      <h1>💌 相談</h1>
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
  invitedBy?: string;
  inviteCount?: { joined: number; pending: number };
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
          <div>
            <dt>招待してくれた人</dt>
            <dd>{props.invitedBy ? <a href={`/members/${props.invitedBy}`}>{props.names.get(props.invitedBy) ?? props.invitedBy}</a> : '—'}</dd>
          </div>
          <div>
            <dt>招待した人</dt>
            <dd>
              {props.inviteCount ? `参拝者になった ${props.inviteCount.joined} 人${props.inviteCount.pending ? `・まだ ${props.inviteCount.pending} 人` : ''}` : '—'}
            </dd>
          </div>
        </dl>
        <form method="post" action={`/members/${props.memberId}/nickname`} class="inline-actions">
          <Csrf session={props.session} />
          <input type="text" name="nickname" maxlength={32} placeholder="ニックネーム（空で元の名前）" aria-label="ニックネーム" />
          <button type="submit">ニックネームを変える</button>
        </form>
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

/** 設定の項目（左の目次。id は section の sec-○○） */
const SETTINGS_SECTIONS: [string, string][] = [
  ['coins', '🪙 {通貨}と免罪符'],
  ['rooms', '🚪 通話部屋の値段'],
  ['voicegroups', '🔊 自動で増える通話'],
  ['voicechat', '💬 通話のチャット'],
  ['bell', '🔔 呼び鈴'],
  ['opswatch', '⏰ 対応待ちのお知らせ・週報'],
  ['recruit', '📣 募集（荒らし対策）'],
  ['market', '🏮 市場'],
  ['coretime', '🕘 コアタイム'],
  ['boost', '💝 ブースト（奉納）'],
  ['join', '📝 入鯖申請・お参り'],
  ['notify', '🔔 通知 OK／NG'],
  ['unei', '🎴 運営吉（おみくじ）'],
  ['omikujitexts', '📜 おみくじの文と紙'],
  ['give', '🎁 今いる人に配る'],
  ['accounts', '🪪 社務所Web のアカウント'],
  ['webaccess', '🔑 Discord ログインで入れる人'],
];

/** 見られるページのチェック（「全部」は、これから増えるページも） */
function PageChecks(props: { pages: WebAccessEntry['pages'] }) {
  const all = props.pages.includes('*');
  return (
    <div class="role-checks page-checks">
      <label class="check">
        <input type="checkbox" name="pages" value="*" checked={all} />
        <span>
          <b>全部</b>（これから増えるページも）
        </span>
      </label>
      {WEB_PAGES.map((p) => (
        <label class="check">
          <input type="checkbox" name="pages" value={p.key} checked={!all && (props.pages as string[]).includes(p.key)} />
          <span>{p.label}</span>
        </label>
      ))}
    </div>
  );
}

const LEVEL_NAME = { guji: '⛩ 宮司', shinshoku: '🎐 神職' } as const;

/** アカウントの入力欄（発行・直す）。a があれば今の値 */
function AccountFields(props: { account?: WebAccount; memberName?: string }) {
  const a = props.account;
  return (
    <>
      <div class="grid2">
        {!a && (
          <label class="field">
            <span>ID（英小文字・数字・「_ . -」で 3〜32 文字）</span>
            <input type="text" name="loginId" required minlength={3} maxlength={32} pattern="[a-zA-Z0-9_.\-]{3,32}" autocomplete="off" />
          </label>
        )}
        <label class="field">
          <span>名前（画面・記録に出る）</span>
          <input type="text" name="name" required maxlength={40} value={a?.name ?? ''} />
        </label>
        <label class="field">
          <span>権限</span>
          <select name="level">
            <option value="shinshoku" selected={a?.level !== 'guji'}>
              🎐 神職（見られるページを選べる）
            </option>
            <option value="guji" selected={a?.level === 'guji'}>
              ⛩ 宮司（全部）
            </option>
          </select>
        </label>
        <label class="field">
          <span>Discord の人（ID・ユーザー名・表示名。なくてもよい。記録に名前が出る）</span>
          <input type="text" name="member" maxlength={100} value={a?.memberId ?? ''} placeholder={props.memberName ? `今: ${props.memberName}` : '例: 123456789012345678'} />
        </label>
      </div>
      <p class="note">神職のとき見られるページ:</p>
      <PageChecks pages={a?.pages ? (a.pages as WebAccessEntry['pages']) : ['*']} />
    </>
  );
}

function AccountRow(props: { session: AdminSession; account: WebAccount; memberName?: string }) {
  const a = props.account;
  const Hidden = () => (
    <>
      <Csrf session={props.session} />
    </>
  );
  return (
    <div class="webaccess-row">
      <form method="post" action={`/settings/accounts/${a.id}`}>
        <Hidden />
        <h3>
          🪪 {a.name} <small>（ID: {a.loginId}・{LEVEL_NAME[a.level]}）</small>
          {a.disabled && <small class="webaccess-off">（止めている）</small>}
        </h3>
        <p class="note">
          {a.lastLoginAt ? `最後のログイン: ${fmtDateTime(a.lastLoginAt)}` : 'まだログインしていません'}
          {a.memberId ? `・Discord: ${props.memberName ?? a.memberId}` : ''}
        </p>
        <AccountFields account={a} memberName={props.memberName} />
        <div class="inline-actions">
          <button type="submit" class="ok">
            保存する
          </button>
        </div>
      </form>
      <div class="inline-actions">
        <form method="post" action={`/settings/accounts/${a.id}/reset`}>
          <Hidden />
          <button type="submit">🔁 パスワードを作り直す</button>
        </form>
        <form method="post" action={`/settings/accounts/${a.id}/toggle`}>
          <Hidden />
          <button type="submit">{a.disabled ? '▶ 使えるようにする' : '⏸ 止める'}</button>
        </form>
        <form method="post" action={`/settings/accounts/${a.id}/delete`} class="inline-actions">
          <Hidden />
          <label class="check">
            <input type="checkbox" name="confirm" value="yes" required />
            <span>消す</span>
          </label>
          <button type="submit" class="danger">
            消す
          </button>
        </form>
      </div>
    </div>
  );
}

/** 発行・作り直したパスワード（この画面だけで見せる） */
export function AccountIssuedPage(props: { session: AdminSession; loginId: string; name: string; password: string; reset?: boolean; entryHint?: boolean }) {
  return (
    <Layout title="アカウント" session={props.session} nav="settings">
      <h1>🪪 {props.reset ? 'パスワードを作り直しました' : 'アカウントを発行しました'}</h1>
      <section class="card">
        <p>
          <b>{props.name}</b> さんに、次の ID とパスワードを伝えてください（DM など、ほかの人に見られないところで）。
        </p>
        <dl class="kv">
          <dt>ID</dt>
          <dd>
            <code>{props.loginId}</code>
          </dd>
          <dt>パスワード</dt>
          <dd>
            <code class="secret">{props.password}</code>
          </dd>
        </dl>
        <p class="flash warn">パスワードはこの画面だけで見られます。閉じたり戻ったりすると、もう出ません（わからなくなったら作り直してください）。</p>
        {props.entryHint && <p class="note">ログインの画面は、秘密の入口の URL から開きます（入口の URL も一緒に伝えてください）。</p>}
        <a class="button" href="/settings?at=accounts#sec-accounts">
          設定に戻る
        </a>
      </section>
    </Layout>
  );
}

function WebAccessRow(props: { session: AdminSession; entry: WebAccessEntry; name: string }) {
  const { entry } = props;
  return (
    <div class="webaccess-row">
      <form method="post" action="/settings/web-access">
        <Csrf session={props.session} />
        <input type="hidden" name="kind" value={entry.kind} />
        <input type="hidden" name={entry.kind === 'role' ? 'roleId' : 'member'} value={entry.id} />
        <h3>
          {props.name}
          {!entry.pages.length && <small class="webaccess-off">（入れない）</small>}
        </h3>
        <PageChecks pages={entry.pages} />
        <div class="inline-actions">
          <button type="submit" class="ok">
            保存する
          </button>
        </div>
      </form>
      <form method="post" action="/settings/web-access/remove" class="inline-actions">
        <Csrf session={props.session} />
        <input type="hidden" name="kind" value={entry.kind} />
        <input type="hidden" name="id" value={entry.id} />
        <button type="submit" class="danger">
          外す
        </button>
      </form>
    </div>
  );
}

/** 🔔 通知 OK／NG（ロールを用意する・今いる人に OK を付ける・ボタンを置く） */
function NotifySection(props: {
  session: AdminSession;
  notify: NonNullable<Parameters<typeof SettingsPage>[0]['notify']>;
  flash?: string;
  textChannels: { id: string; name: string; category?: string }[];
  botCanMentionAll?: boolean;
}) {
  const n = props.notify;
  const st = n.setup;
  const running = st && !st.finishedAt;
  return (
    <section class="card anchor" id="sec-notify">
      <h2>🔔 通知 OK／NG</h2>
      <p class="note">
        メンバーが「🔔 通知OK」か「🔕 通知NG」を選べるようにします。用意すると、<b>募集（「〇〇を募集する」）</b>と、掲示・面談告知・プレゼントのお知らせの<b>「⛩ すべての役職」</b>は、🔔 通知OK の人だけに鳴ります（@everyone・@here・選んだロールはそのまま）。はじめは今いる人（役職のある人）全員を 🔔 通知OK にし、新しく承認した人も 🔔 通知OK から。本人は #授与所 などのボタンで切り替えます。
      </p>
      {props.flash && <Flash code={props.flash} />}
      {!n.ready ? (
        <form method="post" action="/settings/notify/create" class="inline-actions">
          <Csrf session={props.session} />
          <button type="submit" class="ok">
            🔔 ロールを用意して、今いる人を全員 通知OK にする
          </button>
        </form>
      ) : (
        <>
          <ul class="notify-counts">
            <li>
              🔔 <b>{n.okName ?? '通知OK'}</b>: {(n.ok ?? 0).toLocaleString('ja-JP')} 人
            </li>
            <li>
              🔕 <b>{n.ngName ?? '通知NG'}</b>: {(n.ng ?? 0).toLocaleString('ja-JP')} 人
            </li>
            <li>どちらもない: {(n.none ?? 0).toLocaleString('ja-JP')} 人（この人たちは鳴りません）</li>
          </ul>
          {running ? (
            <p class="note">
              🔔 通知OK を付けています: {st.done} / {st.targets.length} 人
            </p>
          ) : (
            st && st.failed.length > 0 && <p class="note">付けられなかった人: {st.failed.length} 人（抜けた人など）。下のボタンでもう一度付けられます。</p>
          )}
          {props.botCanMentionAll === false && (
            <p class="note warn">⚠ BOT に「@everyone、@here、全てのロールにメンション」の権限がないので、通知が鳴りません。BOT のロールに付けてください。</p>
          )}
          <form method="post" action="/settings/notify/create" class="inline-actions">
            <Csrf session={props.session} />
            <button type="submit" disabled={running}>
              まだどちらもない人に 🔔 通知OK を付ける
            </button>
          </form>
          <form method="post" action="/settings/notify/panel" class="fields">
            <Csrf session={props.session} />
            <label class="field">
              <span>切り替えのボタンを置くチャンネル（#授与所 など）</span>
              <select name="channelId" required>
                <option value="">選ぶ</option>
                {props.textChannels.map((ch) => (
                  <option value={ch.id}>
                    {ch.category ? `${ch.category} / ` : ''}#{ch.name}
                  </option>
                ))}
              </select>
            </label>
            <div class="inline-actions">
              <button type="submit" class="ok">
                ボタンを置く
              </button>
            </div>
          </form>
          <p class="note">Discord の `/パネル 通知` でも置けます。</p>
        </>
      )}
    </section>
  );
}

/** 🎴 運営吉: おみくじでまれに出る、運営の特別な運勢（名前・ひとこと・絵）。絵と設定は 1 つのフォームでまとめて保存 */
function UneiSection(props: { session: AdminSession; cfg: GuildConfig; art: Record<number, string>; flash?: string; daily: number }) {
  const sp = props.cfg.omikujiSpecial;
  const daily = props.daily;
  const now = specialPercent(sp, daily);
  const fmtPct = (v: number) => String(Math.round(v * 10000) / 10000);
  const e = props.cfg.economy;
  const slots = [...Array(OMIKUJI_SPECIAL_MAX).keys()].map((i) => i + 1);
  const coins = e.omikujiBase > 0 ? Math.max(1, Math.round(e.omikujiBase * sp.mult)) : 0;
  return (
    <section class="card anchor" id="sec-unei">
      <h2>🎴 運営吉（おみくじ）</h2>
      <p class="note">
        /おみくじ で、決めた確率で運営の特別な運勢（「小林吉」など）が出ます。出たら「御神籤が光りだした…！？」→ 絵を大きく → 運営吉の特別な紙、の順に出して、#慶事 でも絵つきでお知らせします（「もう 1 回」で引いたときも）。名前を入れた枠だけ使います。何枠あっても、全部合わせた確率で出て、その中から同じ確率で 1 つ選びます。絵は縦長の PNG・JPEG・WebP（1 枚 4MB まで）。
      </p>
      {props.flash && <Flash code={props.flash} />}
      <form method="post" action="/settings/omikuji-special" enctype="multipart/form-data" id="unei-form" data-art-form>
        <Csrf session={props.session} />
        <div class="fields">
          <label class="field check">
            <input type="checkbox" name="enabled" value="yes" {...(sp.enabled ? { checked: true } : {})} />
            <span>運営吉を出す</span>
          </label>
          <fieldset class="field unei-mode">
            <legend>出る確率の決め方</legend>
            <label class="check">
              <input type="radio" name="mode" value="interval" {...(sp.mode === 'interval' ? { checked: true } : {})} />
              <span>
                <strong>出したい間隔で決める</strong>（最近 30 日のおみくじの回数から、BOT が毎回確率を計算。鯖が大きくなるほど下がる）
              </span>
            </label>
            <label class="check">
              <input type="radio" name="mode" value="fixed" {...(sp.mode !== 'interval' ? { checked: true } : {})} />
              <span>決めた確率で出す</span>
            </label>
          </fieldset>
          <label class="field">
            <span>出したい間隔（日。全部の枠を合わせて、だいたい何日に 1 回）</span>
            <input type="number" name="everyDays" value={String(sp.everyDays)} min={1} max={365} step="0.5" />
          </label>
          <label class="field">
            <span>確率の下限・上限（%・間隔で決めるとき。この中におさめる）</span>
            <span class="inline-fields">
              <input type="number" name="minPercent" value={String(sp.minPercent)} min={0} max={100} step="0.001" aria-label="下限（%）" />
              〜
              <input type="number" name="maxPercent" value={String(sp.maxPercent)} min={0} max={100} step="0.001" aria-label="上限（%）" />
            </span>
          </label>
          <label class="field">
            <span>決めた確率（%・全部合わせて。小数も OK。1 なら 100 回に 1 回）</span>
            <input type="number" name="percent" value={String(sp.percent)} min={0} max={100} step="0.001" required />
          </label>
          <p class="note unei-now">
            最近 30 日のおみくじ: 1 日 平均 {daily.toFixed(1)} 回 → いまの確率 <strong>{fmtPct(now)}%</strong>（{now > 0 ? `約 ${Math.round(100 / now).toLocaleString('ja-JP')} 回に 1 回` : '出ない'}
            {now > 0 && daily > 0 ? `・約 ${Math.round(100 / now / daily).toLocaleString('ja-JP')} 日に 1 回` : ''}。1 人ずつはこれを枠の数で割ったもの）
          </p>
          <label class="field">
            <span>
              {e.currencyName}の倍率（おみくじの基本の量 {e.omikujiBase} に掛ける。大吉は 3）→ いま {coins} 枚
            </span>
            <input type="number" name="mult" value={String(sp.mult)} min={0} max={100} step="0.5" required />
          </label>
        </div>
        <div class="art-grid">
          {slots.map((n) => {
            const s = sp.list[n - 1];
            const hash = props.art[n];
            return (
              <div class={`art-slot${hash ? ' has' : ''}`} id={`unei-${n}`}>
                <div class="art-preview">{hash ? <img src={`/settings/omikuji-art/${n}?v=${hash}`} alt={s?.name ?? `${n} 枠目`} loading="lazy" /> : <span class="note">絵はまだ</span>}</div>
                <strong>{n} 枠目</strong>
                <label class="field">
                  <span>名前（例: 小林吉。空にするとこの枠は使わない）</span>
                  <input type="text" name={`name.${n}`} value={s?.name ?? ''} maxlength={20} />
                </label>
                <label class="field">
                  <span>ひとこと（紙に出る。空なら決まった文）</span>
                  <input type="text" name={`message.${n}`} value={s?.message ?? ''} maxlength={200} />
                </label>
                <label class="field">
                  <span>その人の色（カードと紙の柄）</span>
                  <input type="color" name={`color.${n}`} value={s?.color ?? '#d4a017'} />
                </label>
                <label class="art-pick">
                  <span>{hash ? '別の絵にする' : '絵を選ぶ'}</span>
                  <input type="file" name={`img.${n}`} accept="image/png,image/webp,image/jpeg,image/gif" data-art-input aria-label={`${n} 枠目の絵`} />
                </label>
                {hash && (
                  <button type="submit" form={`unei-del-${n}`} class="art-del">
                    絵を消す
                  </button>
                )}
                {s && (
                  <button type="submit" form={`unei-trial-${n}`} class="small" title="運営のチャンネルにだけ、本番と同じ流れで出します（保存してある名前・絵・台紙で）">
                    🧪 Discord で試す
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div class="art-savebar">
          <span data-art-count>名前・確率・絵をまとめて保存します。「🧪 Discord で試す」は、保存してあるもので試します。</span>
          <button type="submit" class="ok">
            保存する
          </button>
        </div>
      </form>
      {slots
        .filter((n) => props.art[n])
        .map((n) => (
          <form method="post" action={`/settings/omikuji-art/${n}/delete`} id={`unei-del-${n}`} hidden>
            <Csrf session={props.session} />
          </form>
        ))}
      {slots
        .filter((n) => sp.list[n - 1])
        .map((n) => (
          <form method="post" action={`/settings/omikuji-trial/${n}`} id={`unei-trial-${n}`} hidden>
            <Csrf session={props.session} />
          </form>
        ))}
    </section>
  );
}

/** おみくじの連続日数のおまけ（5 行まで。日数を空にした行は使わない） */
function StreakRewards(props: { cfg: GuildConfig; roles: { id: string; name: string }[] }) {
  const rows = props.cfg.omikujiStreak.rewards;
  const e = props.cfg.economy;
  const known = (id?: string) => props.roles.some((r) => r.id === id);
  return (
    <div class="streak-rewards">
      <h3>🔥 おみくじを続けたおまけ</h3>
      <p class="note">
        /おみくじ を毎日続けると、決めた日数の日におまけを渡します（1 日空けると 1 日目から）。「くり返す」にすると、その日数ごと（7 日なら 7・14・21 日目…）に毎回。称号ロールは一度付いたら、続かなくなってもそのまま。ロールは「ロール」のページで先に作ってください（役目のない・危ない権限のないロールだけ選べます）。日数を空にした行は使いません。
      </p>
      <div class="table-wrap">
        <table class="compact streak-table">
          <thead>
            <tr>
              <th>日数</th>
              <th>くり返す</th>
              <th>{e.currencyName}</th>
              <th>券</th>
              <th>枚数</th>
              <th>称号ロール</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4].map((i) => {
              const r = rows[i];
              return (
                <tr>
                  <td>
                    <input type="number" name={`streak.${i}.days`} min={2} max={365} value={r ? String(r.days) : ''} aria-label={`${i + 1} 行目の日数`} />
                  </td>
                  <td>
                    <input type="checkbox" name={`streak.${i}.repeat`} value="yes" checked={r ? r.repeat : true} aria-label={`${i + 1} 行目をくり返す`} />
                  </td>
                  <td>
                    <input type="number" name={`streak.${i}.coins`} min={0} max={1000000} value={String(r?.coins ?? 0)} aria-label={`${i + 1} 行目の${e.currencyName}`} />
                  </td>
                  <td>
                    <select name={`streak.${i}.ticket`} aria-label={`${i + 1} 行目の券`}>
                      <option value="none" selected={!r || r.ticket === 'none'}>
                        なし
                      </option>
                      {TICKET_GROUPS.map((g) => (
                        <optgroup label={g.label}>
                          {g.kinds.map((k) => (
                            <option value={k} selected={r?.ticket === k}>
                              {TICKET_LABEL[k].emoji} {TICKET_LABEL[k].name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="number" name={`streak.${i}.tickets`} min={0} max={100} value={String(r?.tickets ?? 0)} aria-label={`${i + 1} 行目の券の枚数`} />
                  </td>
                  <td>
                    <select name={`streak.${i}.roleId`} aria-label={`${i + 1} 行目の称号ロール`}>
                      <option value="">なし</option>
                      {r?.roleId && !known(r.roleId) && (
                        <option value={r.roleId} selected>
                          （いまのロール）
                        </option>
                      )}
                      {props.roles.map((x) => (
                        <option value={x.id} selected={r?.roleId === x.id}>
                          @{x.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 🏮 今ブーストしている人（だれが何回） */
function BoosterList(props: { boosters: { id: string; name: string; since: Date; boosts: number }[]; log: { memberId: string; name: string | null; count: number; at: Date }[] }) {
  const total = props.boosters.reduce((n, b) => n + b.boosts, 0);
  return (
    <>
      <h3>
        今ブーストしている人（{props.boosters.length} 人・ブースト {total} 回）
      </h3>
      {props.boosters.length === 0 ? (
        <p class="empty">今ブーストしている人はいません。</p>
      ) : (
        <table class="compact">
          <thead>
            <tr>
              <th>名前</th>
              <th>始めた日</th>
              <th>回数</th>
            </tr>
          </thead>
          <tbody>
            {props.boosters.map((b) => (
              <tr>
                <td>
                  <a href={`/members/${b.id}`}>{b.name}</a>
                </td>
                <td>{fmtDate(b.since)}</td>
                <td>{b.boosts} 回</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p class="note">
        回数は、Discord の「ブーストしました」のメッセージを BOT が数えたものです（数えられていない人は 1 回）。数え始める前のブースト・1 人が一部だけやめたブーストは反映されないので、サーバー全体の合計は Discord のサーバー設定 →「サーバーブースト」で確かめてください。
      </p>
      {props.log.length > 0 && (
        <details>
          <summary>最近の「ブーストしました」（{props.log.length} 件まで）</summary>
          <table class="compact">
            <tbody>
              {props.log.map((m) => (
                <tr>
                  <td>{fmtDateTime(m.at)}</td>
                  <td>
                    <a href={`/members/${m.memberId}`}>{m.name ?? m.memberId}</a>
                  </td>
                  <td>{m.count} 回分</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}

export function SettingsPage(props: {
  session: AdminSession;
  cfg: GuildConfig;
  fileCfg: GuildConfig;
  flash?: string;
  error?: string;
  coinsNonce?: string;
  at?: string;
  /** テキストチャンネル（呼び鈴の知らせ先を選ぶ。category はカテゴリ名） */
  textChannels?: { id: string; name: string; category?: string }[];
  /** ロール（呼び鈴で呼べるロールを選ぶ） */
  roles?: { id: string; name: string }[];
  /** 🔔 通知 OK／NG */
  notify?: {
    ready: boolean;
    setup?: { targets: string[]; done: number; failed: string[]; finishedAt?: string };
    okName?: string;
    ngName?: string;
    ok?: number;
    ng?: number;
    none?: number;
  };
  /** おみくじのおまけで付けられるロール（役目のない・危ない権限のないもの） */
  streakRoles?: { id: string; name: string }[];
  /** 物御籤の回数 */
  gachaStats?: { total: number; spent: number; byTier: Record<GachaTier, number>; players: number };
  /** BOT が「メンション不可」のロールも鳴らせるか（分からなければ undefined） */
  botCanMentionAll?: boolean;
  /** 社務所Web に入れる人（人の行）の名前 */
  webAccessNames?: Names;
  /** ID とパスワードのアカウント */
  accounts?: WebAccount[];
  /** アカウントに結びつけた Discord の人の名前 */
  accountNames?: Names;
  /** Discord でログインできるか（止めていれば「Discord ログインで入れる人」は出さない） */
  discordLogin?: boolean;
  /** 🏮 今ブーストしている人と、最近の「ブーストしました」 */
  boosters?: { id: string; name: string; since: Date; boosts: number }[];
  boostLog?: { memberId: string; name: string | null; count: number; at: Date }[];
  /** 🎴 運営吉の絵の印（番号 → hash） */
  omikujiArt?: Record<number, string>;
  /** 📜 おみくじの紙の台紙の印（運勢 → hash） */
  slipBg?: Record<string, string>;
  /** 🎴 最近 30 日のおみくじの 1 日の平均回数（運営吉の確率を出す） */
  omikujiDaily?: number;
}) {
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
  /** 各項目の下の「保存する」（全部の項目をまとめて保存し、この項目に戻ってくる） */
  const Save = (p: { at: string }) => (
    <div class="inline-actions section-save">
      {props.at === p.at && props.flash && <Flash code={props.flash} />}
      {/* 見えていない項目の入力で止まらないよう、確かめはサーバーで */}
      <button type="submit" name="at" value={p.at} class="ok" formnovalidate>
        保存する
      </button>
    </div>
  );
  return (
    <Layout title="設定" session={props.session} nav="settings">
      <div class="page-head">
        <h1>⚙ 設定</h1>
      </div>
      <Flash code={props.flash} />
      {props.error && <p class="flash warn">{props.error}</p>}
      <p class="note">ここで変えた値は config/guild.json の値より優先されます。BOT には 1 分以内に反映されます。チャンネル・ロールの ID はファイルで設定してください。</p>
      <div class="settings-layout">
        <nav class="settings-index card" aria-label="設定の項目">
          <a href="/settings" class="all">すべて表示</a>
          {SETTINGS_SECTIONS.filter(([id]) => id !== 'webaccess' || props.discordLogin !== false).map(([id, label]) => (
            <a href={`#sec-${id}`} class={`to-${id}`}>
              {label.replaceAll('{通貨}', e.currencyName)}
            </a>
          ))}
          <span class="index-sep">ほかのページ</span>
          <a href="/gacha">🎲 物御籤 →</a>
          <a href="/ranks">⛩ 役職 →</a>
          <a href="/economy">🪙 経済の見守り →</a>
        </nav>
        <div class="settings-body">
      <form method="post" action="/settings" class="settings">
        <Csrf session={props.session} />
        <section class="card anchor" id="sec-coins">
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
            <label class="field check">
              <input type="checkbox" name="joinBonusNotify" value="yes" {...(e.joinBonusNotify ? { checked: true } : {})} />
              <span>初期配布を配ったら、運営のチャンネルに知らせる</span>
            </label>
            <label class="field">
              <span>初期配布を知らせるチャンネル（運営だけが見られるところ）</span>
              <select name="joinBonusChannel">
                <option value="" selected={!e.joinBonusChannelId}>
                  #記録（設定ファイルの log）
                </option>
                {(props.textChannels ?? []).map((c) => (
                  <option value={c.id} selected={c.id === e.joinBonusChannelId}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </label>
            <Num name="inviteSanpaishaReward" label="招待のお礼・参拝者（1人1回。0でなし）" value={e.inviteSanpaishaReward} file={f.inviteSanpaishaReward} />
            <Num name="inviteUjikoReward" label="招待のお礼・氏子（参拝者の分に追加。1人1回。0でなし）" value={e.inviteUjikoReward} file={f.inviteUjikoReward} />
            <input type="hidden" name="inviteActiveConfigured" value="yes" />
            <label><input type="checkbox" name="inviteActiveEnabled" value="yes" checked={e.inviteActiveEnabled} /> 昇格報酬とは別に、日ごとの浮上ボーナスを使う</label>
            <Num name="inviteActiveReward" label="招待した人の浮上ボーナス（招待された人が発言・通話 10 分した日ごと。0 でなし）" value={e.inviteActiveReward} file={f.inviteActiveReward} />
            <Num name="inviteActiveDays" label="浮上ボーナスを続ける日数（参拝者になってから）" value={e.inviteActiveDays} file={f.inviteActiveDays} min={1} />
            <Num name="onboardingReward" label="「はじめての参拝」を全部できたときのお祝い（1 人 1 回。0 でなし）" value={e.onboardingReward} file={f.onboardingReward} />
            <Num name="omikujiBase" label="おみくじの基本の量（吉でこの量・大吉は 3 倍・凶は半分。0 でなし）" value={e.omikujiBase} file={f.omikujiBase} />
            <label class="field check">
              <input type="checkbox" name="omikujiVoiceOnly" value="yes" {...(e.omikujiVoiceOnly ? { checked: true } : {})} />
              <span>おみくじは通話に入っているときだけ引ける（AFK・数えない通話はのぞく。「もう 1 回」も同じ）</span>
            </label>
          </div>
          <StreakRewards cfg={cfg} roles={props.streakRoles ?? []} />
          <Save at="coins" />
        </section>
        <section class="card anchor" id="sec-rooms">
          <h2>🚪 通話部屋の値段（宿坊・宵宮）</h2>
          <p class="note">
            「➕ 宿坊をひらく」「➕ 宵宮の部屋をひらく」でできた部屋は、作った人が部屋のチャットの「⚙ 部屋の設定」から種類・人数・招待を選べます。値段は{e.currencyName}の枚数（0 で無料）。宿坊は作った人がひらくたびに 1 回（種類を変えたら差額）。宵宮は入っている人それぞれが 1 時間ごと（入ったときに最初の 1 時間。足りなければ入れず、途中で払えなくなると 5 分後に通話から抜ける）。
          </p>
          <table class="compact rooms">
            <thead>
              <tr>
                <th></th>
                <th>🔓 公開</th>
                <th>🔒 招待限定</th>
                <th>🤫 シークレット</th>
                <th>💞 ツーショット</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['once', '🌙 宿坊（ひらくたびに 1 回）'],
                  ['hourly', '🍶 宵宮（1 人 1 時間ごと）'],
                ] as const
              ).map(([plan, label]) => (
                <tr>
                  <td>{label}</td>
                  {(['public', 'invite', 'secret', 'twoshot'] as const).map((k) => (
                    <td>
                      <input type="number" name={`room.${plan}.${k}`} value={String(cfg.rooms[plan][k])} min={0} required aria-label={`${label} ${k}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div class="fields">
            <label class="field">
              <span>🏮 奉納（ブースト）している人の部屋代の割引 %（100 で無料）</span>
              <input type="number" name="roomBoosterDiscount" value={String(cfg.rooms.boosterDiscountPercent)} min={0} max={100} required />
            </label>
          </div>
          <Save at="rooms" />
        </section>
        <section class="card anchor" id="sec-voicegroups">
          <h2>🔊 自動で増える通話</h2>
          <p class="note">
            「大きな縁側 1」「大きな縁側 2」「大きな縁側 3」のように、名前の後ろに番号を付けた通話をまとめて見ます。全部に人がいたら、いちばん大きい番号のすぐ下に次の番号（4）を作ります。空きが
            2 つ以上になったら、最低の数より大きい番号の空いている通話を消して、いつも空きが 1 つある状態にします。作る通話は、いちばん大きい番号の通話と同じ設定（人数・見える範囲）です。名前を空にすると止めます。
          </p>
          <table class="compact">
            <thead>
              <tr>
                <th>名前（番号の前）</th>
                <th>最低の数</th>
                <th>最大の数</th>
              </tr>
            </thead>
            <tbody>
              {[...cfg.voiceGroups, { name: '', min: 3, max: 20 }, { name: '', min: 3, max: 20 }].slice(0, 10).map((g, i) => (
                <tr>
                  <td>
                    <input type="text" name={`vg.${i}.name`} value={g.name} maxlength={50} placeholder="例: 大きな縁側" aria-label="名前" />
                  </td>
                  <td>
                    <input type="number" name={`vg.${i}.min`} value={String(g.min)} min={1} max={20} aria-label="最低の数" />
                  </td>
                  <td>
                    <input type="number" name={`vg.${i}.max`} value={String(g.max)} min={1} max={50} aria-label="最大の数" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Save at="voicegroups" />
        </section>
        <section class="card anchor" id="sec-bell">
          <h2>🔔 呼び鈴</h2>
          <p class="note">
            メンバーが <code>/呼び鈴</code> やパネルのボタン（<code>/パネル 呼び鈴</code>）で運営を呼ぶと、ここで選んだチャンネルにカードが出ます。神職が「対応する」を押すと、呼んだ人に DM が届きます。
          </p>
          <div class="fields">
            <label class="field">
              <span>知らせ先のチャンネル（運営だけが見られるところ）</span>
              <select name="bellChannel">
                <option value="" selected={!cfg.bell.channelId}>
                  #記録（設定ファイルの log）
                </option>
                {(props.textChannels ?? []).map((c) => (
                  <option value={c.id} selected={c.id === cfg.bell.channelId}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>同じ人が続けて鳴らせない分（0〜120）</span>
              <input type="number" name="bellCooldown" value={String(cfg.bell.cooldownMinutes)} min={0} max={120} required />
            </label>
            <label class="field check">
              <input type="checkbox" name="bellMention" value="yes" checked={cfg.bell.mentionStaff} />
              <span>呼んだロールに通知を飛ばす（@ロール）</span>
            </label>
          </div>
          <fieldset class="perms">
            <legend>呼べるロール（押した人が選ぶ。1 つだけならすぐ呼ぶ。なにも選ばなければ運営の役職）</legend>
            {(props.roles ?? []).map((r) => (
              <label class="field check">
                <input type="checkbox" name="bellRoles" value={r.id} checked={cfg.bell.roleIds.includes(r.id)} />
                <span>{r.name}</span>
              </label>
            ))}
          </fieldset>
          <fieldset class="perms">
            <legend>「🔔 呼び鈴」のボタンを、いつもいちばん下に置くチャンネル</legend>
            {(props.textChannels ?? []).map((c) => (
              <label class="field check">
                <input type="checkbox" name="bellChannels" value={c.id} checked={cfg.bell.channelIds.includes(c.id)} />
                <span>
                  #{c.name}
                  {c.category && <small> {c.category}</small>}
                </span>
              </label>
            ))}
          </fieldset>
          <Save at="bell" />
        </section>
        <section class="card anchor" id="sec-opswatch">
          <h2>⏰ 対応待ちのお知らせ・週報</h2>
          <p class="note">
            申請・相談・お参りの判定・呼び鈴が、決めた時間そのままになっていたら、BOT が運営のチャンネルで知らせます（10 分ごとに見る）。同じものは 1 回だけ、まだそのままなら 1 日ごと（呼び鈴は 3 時間ごと）にもう一度。相談はだれからかを出しません。
          </p>
          <div class="fields">
            <label class="field">
              <span>知らせ先のチャンネル（運営だけが見られるところ）</span>
              <select name="opsChannel">
                <option value="" selected={!cfg.opsWatch.channelId}>
                  #記録（設定ファイルの log）
                </option>
                {(props.textChannels ?? []).map((c) => (
                  <option value={c.id} selected={c.id === cfg.opsWatch.channelId}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </label>
            <label class="field check">
              <input type="checkbox" name="opsRemind" value="yes" checked={cfg.opsWatch.remindEnabled} />
              <span>対応待ちがそのままなら知らせる</span>
            </label>
            <label class="field check">
              <input type="checkbox" name="opsMention" value="yes" checked={cfg.opsWatch.mention} />
              <span>神職・宮司のロールに通知を飛ばす（@ロール）</span>
            </label>
            <label class="field">
              <span>入鯖・宵参り申請: 何時間そのままなら（0 で知らせない）</span>
              <input type="number" name="opsAppHours" value={String(cfg.opsWatch.applicationHours)} min={0} max={168} required />
            </label>
            <label class="field">
              <span>相談（未対応）: 何時間</span>
              <input type="number" name="opsSoudanHours" value={String(cfg.opsWatch.soudanHours)} min={0} max={168} required />
            </label>
            <label class="field">
              <span>お参り期間が終わった人の判定: 何時間</span>
              <input type="number" name="opsOmairiHours" value={String(cfg.opsWatch.omairiHours)} min={0} max={168} required />
            </label>
            <label class="field">
              <span>呼び鈴（だれも「対応する」を押していない）: 何分</span>
              <input type="number" name="opsBellMinutes" value={String(cfg.opsWatch.bellMinutes)} min={0} max={1440} required />
            </label>
            <label class="field">
              <span>夜は知らせない: 何時から（日本時間）</span>
              <input type="number" name="opsQuietStart" value={String(cfg.opsWatch.quietStart)} min={0} max={23} required />
            </label>
            <label class="field">
              <span>何時まで（同じ時にすると夜も知らせる）</span>
              <input type="number" name="opsQuietEnd" value={String(cfg.opsWatch.quietEnd)} min={0} max={23} required />
            </label>
          </div>
          <h3>🗓 週報</h3>
          <p class="note">
            週に 1 回、メンバーの出入り・にぎわい（発言・通話・来た人の数、先週との比べ）・よく来た人・静かになった人（先週は来ていて、この 1 週間は来ていない人）・申請や相談や呼び鈴の対応の数を、同じチャンネルにまとめて流します。
          </p>
          <div class="fields">
            <label class="field check">
              <input type="checkbox" name="opsReport" value="yes" checked={cfg.opsWatch.reportEnabled} />
              <span>週報を流す</span>
            </label>
            <label class="field">
              <span>曜日</span>
              <select name="opsReportWeekday">
                {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                  <option value={String(i)} selected={i === cfg.opsWatch.reportWeekday}>
                    {d}曜日
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>時（日本時間 0〜23）</span>
              <input type="number" name="opsReportHour" value={String(cfg.opsWatch.reportHour)} min={0} max={23} required />
            </label>
          </div>
          <Save at="opswatch" />
        </section>
        <section class="card anchor" id="sec-recruit">
          <h2>📣 募集（荒らし対策）</h2>
          <p class="note">
            #宿帳・#縁日・#手水舎・#御神酒処 のいちばん下の「○○を募集する」ボタンの決まりです。募集すると役職のある人みんな（そのチャンネルを見られる人）に通知が届くので、続けて鳴らないようにします。待ち時間は BOT
            を起動し直しても忘れません。
          </p>
          <div class="fields">
            <label class="field">
              <span>同じ人が続けて募集できない秒（0〜7200。例: 15 秒・600 = 10 分）</span>
              <input type="number" name="recruitCooldownSec" value={String(recruitWaits(cfg.recruit).mine)} min={0} max={7200} required />
            </label>
            <label class="field">
              <span>同じチャンネルで、だれが押しても続けて募集できない秒（0〜7200。例: 15 秒・300 = 5 分）</span>
              <input type="number" name="recruitChannelCooldownSec" value={String(recruitWaits(cfg.recruit).channel)} min={0} max={7200} required />
            </label>
            <label class="field">
              <span>入ってからこの日数は募集できない（0 でなし。運営はいつでも）</span>
              <input type="number" name="recruitNewDays" value={String(cfg.recruit.newMemberDays)} min={0} max={90} required />
            </label>
            <label class="field">
              <span>待ち時間中にこの回数押した人を #記録 に知らせる（0 で知らせない）</span>
              <input type="number" name="recruitSpamAlert" value={String(cfg.recruit.spamAlertCount)} min={0} max={50} required />
            </label>
            <label class="field check">
              <input type="checkbox" name="recruitRequireRank" value="yes" checked={cfg.recruit.requireRank} />
              <span>入鯖が承認された人（🔰参拝者 以上）だけ募集できる</span>
            </label>
            <label class="field check">
              <input type="checkbox" name="recruitBlockYaku" value="yes" checked={cfg.recruit.blockYakudoshi} />
              <span>👹 厄年の人は募集できない</span>
            </label>
          </div>
          {props.botCanMentionAll === false && (
            <p class="flash warn">
              BOT のロールに「@everyone、@here、全てのロールにメンション」の権限がないため、「@ で呼べる」にしていない役職のロールには、募集ボタンからの通知が届きません。Discord
              のサーバー設定 → ロール → BOT のロールで、この権限を付けてください。
            </p>
          )}
          <Save at="recruit" />
        </section>
        <section class="card anchor" id="sec-voicechat">
          <h2>💬 通話のチャット</h2>
          <p class="note">通話チャンネルの中のチャットです。人がいなくなって決めた分だけたっても、まだだれもいなければ、チャットを消します（ピン留めは残します）。BOT に「メッセージの管理」と「メッセージ履歴を読む」の権限が要ります。</p>
          <div class="fields">
            <label class="field check">
              <input type="checkbox" name="vcClear" value="yes" checked={cfg.voiceChat.clearWhenEmpty} />
              <span>人がいなくなった通話のチャットを消す</span>
            </label>
            <label class="field">
              <span>いなくなってから消すまで（分。0〜60）</span>
              <input type="number" name="vcClearDelay" value={String(cfg.voiceChat.delayMinutes)} min={0} max={60} required />
            </label>
          </div>
          <Save at="voicechat" />
        </section>
        <section class="card anchor" id="sec-market">
          <h2>🏪 市場</h2>
          <p class="note">
            開業権利（🏪 開業ロール）を持つ人が #市場 に出品できます。{e.currencyName}だけで、本物のお金は扱いません。買った人の{e.currencyName}は預かっておき、「受け取った」か期限で売った人に渡します（手数料を引いて）。手数料の分は誰にも渡りません。開業権利の値段は「授与所」で変えられます。
          </p>
          <div class="fields">
            <label class="field">
              <span>手数料 %（0〜50）</span>
              <input type="number" name="marketFee" value={String(cfg.market.feePercent)} min={0} max={50} required />
            </label>
            <label class="field">
              <span>自動で売った人に渡すまでの日数（1〜60）</span>
              <input type="number" name="marketAutoRelease" value={String(cfg.market.autoReleaseDays)} min={1} max={60} required />
            </label>
          </div>
          <Save at="market" />
        </section>
        <section class="card anchor" id="sec-gacha">
          <h2>🎁 物御籤</h2>
          <p class="note">
            物御籤の ON/OFF・値段・天井・出やすさ・中身（限定ロール・券・{e.currencyName}・ショップの品）は、<a href="/gacha">🎁 物御籤</a> のページで変えられます。
            {cfg.gacha.enabled ? ` いまは 1 回 ${cfg.gacha.price.toLocaleString('ja-JP')} 枚で引けます。` : ' いまはお休み中です。'}
            {props.gachaStats && ` これまで ${props.gachaStats.total.toLocaleString('ja-JP')} 回引かれました。`}
          </p>
        </section>
        <section class="card anchor" id="sec-coretime">
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
            <Num name="coreTimePercent" label={`コアタイムの通話でもらえる${e.currencyName}（%。150 で 1.5 倍）`} value={e.coreTimePercent} file={f.coreTimePercent} min={100} />
            <label class="field">
              <span>前日の予告の時刻（空で出さない）</span>
              <input type="time" name="ctNoticeDayBefore" value={cfg.coreTime.noticeDayBefore} />
            </label>
            <label class="field">
              <span>始まる何分前に予告（0 で出さない）</span>
              <input type="number" name="ctNoticeMinutesBefore" value={String(cfg.coreTime.noticeMinutesBefore)} min={0} max={720} required />
            </label>
          </div>
          <Save at="coretime" />
        </section>
        <section class="card anchor" id="sec-boost">
          <h2>🏮 ブースト（奉納）のお礼と特典</h2>
          <p class="note">
            ブースト 1 回ごとに、#慶事 でお知らせ・本人に DM を送ります（お金・{e.currencyName}は渡しません）。#番付 に今奉納してくれている人の「奉納板」を出します。奉納している間は授与品が割引になります（何回ブーストしても同じ）。
            <br />
            ブースト 1 回ごとに数えるには、Discord のサーバー設定 →「システムメッセージチャンネル」を選び、「サーバーがブーストされた時にメッセージを送信する」を ON にしてください（OFF だと 1 人 1 回分になります）。
          </p>
          {props.boosters && <BoosterList boosters={props.boosters} log={props.boostLog ?? []} />}
          <div class="fields">
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
          <Save at="boost" />
        </section>
        <section class="card anchor" id="sec-ranks">
          <h2>役職（朱印の格・昇格ライン）</h2>
          <ul>
            {[...cfg.ranks]
              .sort((x, y) => y.weight - x.weight)
              .map((r) => (
                <li>
                  {r.emoji} {r.name} … {!r.auto ? '任命制' : r.key === firstAutoKey ? '入鯖時' : `ご縁 ${r.requiredGoen}`} ・ 格 {r.weight}
                </li>
              ))}
          </ul>
          <p>
            <a class="button-link" href="/ranks">
              役職のページで変える（名前・絵文字・ロール・格・昇格ライン・役職を足す）→
            </a>
          </p>
        </section>
        <section class="card anchor" id="sec-join">
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
          <Save at="join" />
        </section>
      </form>
      {props.notify && <NotifySection session={props.session} notify={props.notify} flash={props.at === 'notify' ? props.flash : undefined} textChannels={props.textChannels ?? []} botCanMentionAll={props.botCanMentionAll} />}
      <UneiSection session={props.session} cfg={cfg} art={props.omikujiArt ?? {}} flash={props.at === 'unei' ? props.flash : undefined} daily={props.omikujiDaily ?? 0} />
      <OmikujiTextsSection session={props.session} cfg={cfg} bg={props.slipBg ?? {}} flash={props.at === 'omikujitexts' ? props.flash : undefined} />
      <section class="card anchor" id="sec-accounts">
        <h2>🪪 社務所Web のアカウント（ID とパスワード）</h2>
        <p class="note">
          社務所Web に入れる人の ID とパスワードを発行します。パスワードは発行・作り直したときに 1 回だけ出ます（DB には暗号にした形だけ）。宮司はいつも全部、神職は見られるページを選べます。止める・消すと、ログイン中の人もすぐ入れなくなります。5 回続けて間違えると 15 分ログインできません。
        </p>
        {props.at === 'accounts' && props.flash && <Flash code={props.flash} />}
        {(props.accounts ?? []).length ? (
          <div class="webaccess-list">
            {(props.accounts ?? []).map((a) => (
              <AccountRow session={props.session} account={a} memberName={a.memberId ? props.accountNames?.get(a.memberId) : undefined} />
            ))}
          </div>
        ) : (
          <p class="note">まだアカウントがありません。</p>
        )}
        <form method="post" action="/settings/accounts" class="webaccess-add">
          <Csrf session={props.session} />
          <h3>＋ 発行する</h3>
          <AccountFields />
          <div class="inline-actions section-save">
            <button type="submit" class="ok">
              発行する（パスワードが出ます）
            </button>
          </div>
        </form>
      </section>
      {props.discordLogin !== false && (
      <section class="card anchor" id="sec-webaccess">
        <h2>🔑 社務所Web に入れる人</h2>
        <p class="note">
          神職・宮司のほかに社務所Web に入れる人を、ロール（例: 神代）か人で選び、見られるページを決めます。入れた人は、見られるページでは神職と同じことができます（宮司だけのページ・Discord の運営コマンドは今のまま）。
          神職は全部のページを見られます。人で選ぶと、神職でもそのページだけになります（ページを 1 つも選ばないと、その人は入れません）。宮司はいつも全部です。変えると、次に開いたときから反映されます。
        </p>
        {webAccessEntries(cfg).length ? (
          <div class="webaccess-list">
            {webAccessEntries(cfg).map((entry) => (
              <WebAccessRow session={props.session} entry={entry} name={entry.kind === 'role' ? `@${props.roles?.find((r) => r.id === entry.id)?.name ?? `ID ${entry.id}`}` : `👤 ${props.webAccessNames?.get(entry.id) ?? `ID ${entry.id}`}`} />
            ))}
          </div>
        ) : (
          <p class="note">まだだれも足していません（神職・宮司だけが入れます）。</p>
        )}
        <form method="post" action="/settings/web-access" class="webaccess-add">
          <Csrf session={props.session} />
          <h3>＋ 足す</h3>
          <div class="chips">
            <label class="chip">
              <input type="radio" name="kind" value="role" checked />
              <span>ロールで</span>
            </label>
            <label class="chip">
              <input type="radio" name="kind" value="member" />
              <span>人で</span>
            </label>
          </div>
          <div class="grid2">
            <label class="field">
              <span>ロール（「ロールで」のとき）</span>
              <select name="roleId">
                <option value="">— 選ぶ —</option>
                {(props.roles ?? []).map((r) => (
                  <option value={r.id}>@{r.name}</option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>人（「人で」のとき。ID・ユーザー名・表示名）</span>
              <input type="text" name="member" maxlength={100} placeholder="例: 123456789012345678" />
            </label>
          </div>
          <PageChecks pages={['*']} />
          <div class="inline-actions section-save">
            {props.at === 'webaccess' && props.flash && <Flash code={props.flash} />}
            <button type="submit" class="ok">
              足す
            </button>
          </div>
        </form>
      </section>
      )}
      <section class="card anchor give" id="sec-give">
      <h2>🎁 今いる人に配る</h2>
      <form method="post" action="/settings/join-bonus-all" class="give-form">
        <Csrf session={props.session} />
        <h3>{e.currencyEmoji} 初期配布を配る</h3>
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
        <form method="post" action="/settings/coins-all" class="give-form">
          <Csrf session={props.session} />
          <input type="hidden" name="nonce" value={props.coinsNonce} />
          <h3>{e.currencyEmoji} みんなに{e.currencyName}を送る</h3>
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
      </section>
        </div>
      </div>
      <form method="post" action="/settings/reset">
        <Csrf session={props.session} />
        <button type="submit" class="link">
          すべてファイルの値に戻す（役職のページで変えたものは残ります）
        </button>
      </form>
    </Layout>
  );
}

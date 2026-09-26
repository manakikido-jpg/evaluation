import type { GuildConfig } from '../../config.js';
import { currentAutoRank, nextAutoRank } from '../../domain/ranks.js';
import type { AdminSession, AuditLog, Member, MemberEvent } from '../../db/schema.js';
import type { GoshuinchoData } from '../../services/shuin.js';
import type { TrendBucket } from '../../services/stats.js';
import { LineChart } from './charts.js';
import type { MemberListQuery, MemberRow } from '../../services/members.js';
import {
  ACTION_LABEL,
  AGE_LABEL,
  EVENT_LABEL,
  fmtAgo,
  fmtDate,
  fmtDateTime,
  memberRankLabel,
  rankNameByKey,
} from '../format.js';
import type { Child } from 'hono/jsx';
import { Avatar, Layout } from './layout.js';
import { Flash } from './moderation.js';

type Names = Map<string, string>;

const who = (names: Names, id: string | null) => (id ? names.get(id) ?? `ID ${id}` : '—');

// ───────── ログイン ─────────

const LOGIN_ERRORS: Record<string, string> = {
  forbidden: '神職・宮司のロールを持っている方だけが入れます。',
  state: 'ログインの確認に失敗しました。もう一度お試しください。',
  failed: 'Discord とのやり取りに失敗しました。時間をおいてもう一度お試しください。',
  expired: 'ログインの期限が切れました。もう一度ログインしてください。',
};

export function LoginPage(props: { error?: string }) {
  const msg = props.error && Object.hasOwn(LOGIN_ERRORS, props.error) ? LOGIN_ERRORS[props.error] : undefined;
  return (
    <Layout title="ログイン">
      <section class="login">
        <div class="torii big">⛩</div>
        <h1>社務所 Web</h1>
        <p class="sub">咲楽ノ宮 管理画面（神職・宮司専用）</p>
        {msg && <p class="error">{msg}</p>}
        <a class="button primary" href="/auth/discord">
          Discord でログイン
        </a>
        <p class="note">Discord のユーザー名とアイコンだけを使います。</p>
      </section>
    </Layout>
  );
}

// ───────── ホーム ─────────

export function HomePage(props: {
  session: AdminSession;
  stats: { members: number; joined: number; left: number; promoted: number; shuin: number; yaku: number };
  todo: { applications: number; omairi: number; soudan: number };
  recent: AuditLog[];
  names: Names;
  now: Date;
  /** 直近 30 日の人数（上のグラフ） */
  trend?: TrendBucket[];
}) {
  const { stats, trend } = props;
  return (
    <Layout title="ホーム" session={props.session} nav="home">
      <h1>今日の社務所</h1>
      {trend && trend.length > 0 && (
        <section class="card">
          <h2>メンバーの推移（30 日）</h2>
          <LineChart
            points={trend.map((b) => ({ label: b.label, title: b.title }))}
            values={trend.map((b) => b.members)}
            unit="人"
            label="直近 30 日のサーバーにいる人数"
          />
          <p class="more">
            <a href="/stats">入った・抜けた・朱印・通話の推移も見る →</a>
          </p>
        </section>
      )}
      <div class="stats">
        <Stat label="メンバー" value={stats.members.toLocaleString('ja-JP')} unit="人" />
        <Stat label="今日の参加" value={`+${stats.joined}`} unit="人" />
        <Stat label="今日の退出" value={`-${stats.left}`} unit="人" />
        <Stat label="今日の朱印" value={String(stats.shuin)} unit="件" />
        <Stat label="今日の昇格" value={String(stats.promoted)} unit="人" />
        <Stat label="👹 厄が付いている方" value={String(stats.yaku)} unit="人" href="/yaku" />
      </div>

      <section class="card">
        <h2>対応待ち</h2>
        <ul class="todo">
          <li>
            <a href="/applications" class={props.todo.applications ? '' : 'zero'}>
              <span>申請（入鯖・宵参り）</span>
              <strong>{props.todo.applications} 件</strong>
            </a>
          </li>
          <li>
            <a href="/omairi" class={props.todo.omairi ? '' : 'zero'}>
              <span>お参り期間の判定待ち</span>
              <strong>{props.todo.omairi} 人</strong>
            </a>
          </li>
          <li>
            <a href="/soudan" class={props.todo.soudan ? '' : 'zero'}>
              <span>未対応の相談</span>
              <strong>{props.todo.soudan} 件</strong>
            </a>
          </li>
        </ul>
      </section>

      <section class="card">
        <h2>最近の操作</h2>
        <AuditTable rows={props.recent} names={props.names} now={props.now} />
        <p class="more">
          <a href="/audit">すべて見る →</a>
        </p>
      </section>
    </Layout>
  );
}

function Stat(props: { label: string; value: string; unit: string; href?: string }) {
  const body = (
    <>
      <div class="label">{props.label}</div>
      <div class="value">
        {props.value}
        <small>{props.unit}</small>
      </div>
    </>
  );
  return props.href ? (
    <a class="stat" href={props.href}>
      {body}
    </a>
  ) : (
    <div class="stat">{body}</div>
  );
}

// ───────── メンバー一覧 ─────────

export function MembersPage(props: {
  session: AdminSession;
  cfg: GuildConfig;
  query: MemberListQuery & { rank?: string };
  result: { rows: MemberRow[]; total: number; page: number; pages: number };
  now: Date;
}) {
  const { query } = props;
  const sel = (a: unknown, b: unknown) => (a === b ? { selected: true } : {});
  return (
    <Layout title="メンバー" session={props.session} nav="members">
      <h1>メンバー</h1>
      <form
        class="filters"
        method="get"
        action="/members"
        hx-get="/members"
        hx-target="#results"
        hx-swap="outerHTML"
        hx-push-url="true"
        hx-trigger="input changed delay:300ms from:input[name=q], change"
      >
        <input type="search" name="q" value={query.q ?? ''} placeholder="名前・ユーザー名・ID で検索" autocomplete="off" />
        <select name="rank" aria-label="役職">
          <option value="">すべての役職</option>
          {[...props.cfg.ranks]
            .sort((a, b) => b.weight - a.weight)
            .map((r) => (
              <option value={r.key} {...sel(query.rank, r.key)}>
                {r.emoji} {r.name}
              </option>
            ))}
        </select>
        <select name="age" aria-label="年齢区分">
          <option value="">すべての年齢区分</option>
          {Object.entries(AGE_LABEL).map(([k, v]) => (
            <option value={k} {...sel(query.ageGroup, k)}>
              {v}
            </option>
          ))}
        </select>
        <select name="inactive" aria-label="活動">
          <option value="">活動: すべて</option>
          {[7, 14, 30, 60].map((d) => (
            <option value={String(d)} {...sel(query.inactiveDays, d)}>
              {d} 日以上来ていない
            </option>
          ))}
        </select>
        <select name="status" aria-label="在籍">
          <option value="active" {...sel(query.status, 'active')}>
            在籍中
          </option>
          <option value="left" {...sel(query.status, 'left')}>
            退出済み
          </option>
          <option value="all" {...sel(query.status, 'all')}>
            全員
          </option>
        </select>
        <select name="sort" aria-label="並べ替え">
          <option value="goen" {...sel(query.sort, 'goen')}>
            ご縁の多い順
          </option>
          <option value="joined" {...sel(query.sort, 'joined')}>
            参加の新しい順
          </option>
          <option value="active" {...sel(query.sort, 'active')}>
            最近の活動順
          </option>
          <option value="name" {...sel(query.sort, 'name')}>
            名前順
          </option>
        </select>
        <noscript>
          <button type="submit">絞り込む</button>
        </noscript>
      </form>
      <MemberResults {...props} />
    </Layout>
  );
}

export function MemberResults(props: {
  cfg: GuildConfig;
  query: MemberListQuery & { rank?: string };
  result: { rows: MemberRow[]; total: number; page: number; pages: number };
  now: Date;
}) {
  const { result } = props;
  const pageLink = (p: number) => {
    const q = new URLSearchParams();
    const { query } = props;
    if (query.q) q.set('q', query.q);
    if (query.rank) q.set('rank', query.rank);
    if (query.ageGroup) q.set('age', query.ageGroup);
    if (query.inactiveDays) q.set('inactive', String(query.inactiveDays));
    if (query.status && query.status !== 'active') q.set('status', query.status);
    if (query.sort && query.sort !== 'goen') q.set('sort', query.sort);
    q.set('page', String(p));
    return `/members?${q}`;
  };
  return (
    <section id="results">
      <p class="count">{result.total.toLocaleString('ja-JP')} 人</p>
      {result.rows.length === 0 ? (
        <p class="empty">当てはまる人はいません。</p>
      ) : (
        <div class="table-wrap">
          <table class="members">
            <thead>
              <tr>
                <th>名前</th>
                <th>役職</th>
                <th class="num">ご縁</th>
                <th>参加日</th>
                <th>最後の活動</th>
                <th>年齢区分</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((m) => (
                <tr class={m.leftAt ? 'left' : ''}>
                  <td>
                    <a class="who" href={`/members/${m.id}`}>
                      <Avatar url={m.avatarUrl} />
                      <span>
                        {m.displayName}
                        <small>@{m.username}</small>
                      </span>
                    </a>
                  </td>
                  <td>{m.leftAt ? <span class="tag gray">退出 {fmtDate(m.leftAt)}</span> : memberRankLabel(props.cfg, m.roleIds)}</td>
                  <td class="num">{m.goen}</td>
                  <td>{fmtDate(m.joinedAt)}</td>
                  <td>{fmtAgo(m.lastActiveAt, props.now)}</td>
                  <td>{AGE_LABEL[m.ageGroup] ?? m.ageGroup}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.pages > 1 && (
        <nav class="pager">
          {result.page > 1 && <a href={pageLink(result.page - 1)}>← 前へ</a>}
          <span>
            {result.page} / {result.pages}
          </span>
          {result.page < result.pages && <a href={pageLink(result.page + 1)}>次へ →</a>}
        </nav>
      )}
    </section>
  );
}

// ───────── メンバー詳細 ─────────

type ShuinRow = { other: string; weight: number; rank: string; at: Date; revokedAt: Date | null };

export function MemberPage(props: {
  session: AdminSession;
  cfg: GuildConfig;
  member: Member;
  card: GoshuinchoData;
  history: { received: ShuinRow[]; given: ShuinRow[] };
  events: MemberEvent[];
  audits: AuditLog[];
  names: Names;
  now: Date;
  flash?: string;
  moderation?: Child;
}) {
  const { member: m, card, cfg } = props;
  const auto = currentAutoRank(cfg.ranks, m.roleIds);
  const next = auto ? nextAutoRank(cfg.ranks, card.goen, auto) : undefined;
  const otherRoles = m.roleIds.filter((id) => !cfg.ranks.some((r) => r.roleId === id));
  return (
    <Layout title={m.displayName} session={props.session} nav="members">
      <p class="crumbs">
        <a href="/members">メンバー</a> / {m.displayName}
      </p>
      <Flash code={props.flash} />
      <section class="profile card">
        <Avatar url={m.avatarUrl} size={64} />
        <div>
          <h1>
            {m.displayName} <small>@{m.username}</small>
          </h1>
          <p class="rank">
            {m.leftAt ? <span class="tag gray">退出済み（{fmtDate(m.leftAt)}）</span> : memberRankLabel(cfg, m.roleIds)}
            {cfg.roles.yakudoshi && m.roleIds.includes(cfg.roles.yakudoshi) && <span class="tag red">👹 厄年</span>}
          </p>
          <dl class="facts">
            <div>
              <dt>ご縁</dt>
              <dd>
                <strong>{card.goen}</strong>
                {next && <small>（{next.rank.name}まで あと {next.remaining}）</small>}
              </dd>
            </div>
            <div>
              <dt>頂いた朱印</dt>
              <dd>{card.receivedCount} 人</dd>
            </div>
            <div>
              <dt>押した朱印</dt>
              <dd>{card.givenCount} 人</dd>
            </div>
            <div>
              <dt>参加日</dt>
              <dd>{fmtDate(m.joinedAt)}</dd>
            </div>
            <div>
              <dt>最後の活動</dt>
              <dd>{fmtAgo(m.lastActiveAt, props.now)}</dd>
            </div>
            <div>
              <dt>年齢区分</dt>
              <dd>{AGE_LABEL[m.ageGroup] ?? m.ageGroup}</dd>
            </div>
            <div>
              <dt>ID</dt>
              <dd class="mono">{m.id}</dd>
            </div>
            <div>
              <dt>ほかのロール</dt>
              <dd>{otherRoles.length} 個</dd>
            </div>
          </dl>
        </div>
      </section>

      {props.moderation}

      <div class="grid2">
        <section class="card">
          <h2>頂いた朱印</h2>
          <ShuinTable rows={props.history.received} cfg={cfg} names={props.names} />
        </section>
        <section class="card">
          <h2>押した朱印</h2>
          <ShuinTable rows={props.history.given} cfg={cfg} names={props.names} />
        </section>
      </div>

      <div class="grid2">
        <section class="card">
          <h2>入退室・昇格の履歴</h2>
          {props.events.length === 0 ? (
            <p class="empty">記録はありません。</p>
          ) : (
            <ul class="timeline">
              {props.events.map((e) => (
                <li>
                  <time>{fmtDateTime(e.at)}</time>
                  <span>
                    {EVENT_LABEL[e.kind] ?? e.kind}
                    {e.kind === 'promote' &&
                      ` ${rankNameByKey(cfg, String(e.detail.from))} → ${rankNameByKey(cfg, String(e.detail.to))}（ご縁 ${String(e.detail.goen)}）`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section class="card">
          <h2>この人への操作の記録</h2>
          <AuditTable rows={props.audits} names={props.names} now={props.now} hideTarget />
        </section>
      </div>
    </Layout>
  );
}

function ShuinTable(props: { rows: ShuinRow[]; cfg: GuildConfig; names: Names }) {
  if (!props.rows.length) return <p class="empty">まだありません。</p>;
  return (
    <table class="compact">
      <tbody>
        {props.rows.map((r) => (
          <tr class={r.revokedAt ? 'revoked' : ''}>
            <td>
              <a href={`/members/${r.other}`}>{who(props.names, r.other)}</a>
            </td>
            <td>{rankNameByKey(props.cfg, r.rank)}</td>
            <td class="num">+{r.weight}</td>
            <td>{fmtDateTime(r.at)}</td>
            <td>{r.revokedAt && <span class="tag gray">取り消し</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ───────── 操作の記録 ─────────

export function AuditPage(props: { session: AdminSession; rows: AuditLog[]; names: Names; now: Date }) {
  return (
    <Layout title="操作の記録" session={props.session} nav="audit">
      <h1>操作の記録</h1>
      <p class="note">神職・宮司の操作はすべてここに残り、消すことはできません。</p>
      <section class="card">
        <AuditTable rows={props.rows} names={props.names} now={props.now} />
      </section>
    </Layout>
  );
}

function AuditTable(props: { rows: AuditLog[]; names: Names; now: Date; hideTarget?: boolean }) {
  if (!props.rows.length) return <p class="empty">記録はありません。</p>;
  return (
    <div class="table-wrap">
      <table class="compact">
        <thead>
          <tr>
            <th>日時</th>
            <th>操作した人</th>
            <th>操作</th>
            {!props.hideTarget && <th>相手</th>}
            <th>経路</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((a) => (
            <tr>
              <td title={fmtDateTime(a.at)}>{fmtDateTime(a.at)}</td>
              <td>
                <a href={`/members/${a.actorId}`}>{who(props.names, a.actorId)}</a>
              </td>
              <td>
                {ACTION_LABEL[a.action] ?? a.action}
                {typeof a.detail.reason === 'string' && <small class="reason">理由: {a.detail.reason}</small>}
              </td>
              {!props.hideTarget && <td>{a.targetId ? <a href={`/members/${a.targetId}`}>{who(props.names, a.targetId)}</a> : '—'}</td>}
              <td>{a.via === 'web' ? 'Web' : a.via === 'discord' ? 'Discord' : 'システム'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NotFoundPage(props: { session?: AdminSession }) {
  return (
    <Layout title="見つかりません" session={props.session}>
      <h1>見つかりません</h1>
      <p>
        <a href="/">ホームへ戻る</a>
      </p>
    </Layout>
  );
}

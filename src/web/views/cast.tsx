import type { AdminSession, Cast, CastSession } from '../../db/schema.js';
import { MINOR, PLAN_LABEL, type CastConfig, type CastStat } from '../../services/cast.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

export const CAST_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '設定を保存しました。', kind: 'ok' },
  invalid: { text: '入力を確かめてください（値段は 1 以上・下限は上限以下・手数料は 0〜90%）。', kind: 'warn' },
  image_saved: { text: 'メニューの画像を入れかえました（メニューも書き換えました）。', kind: 'ok' },
  image_big: { text: '写真は8MBまでです。小さくしてから上げてください。', kind: 'warn' },
  photo_saved: { text: 'キャストの写真を保存しました。紹介と本人の受付に出ます。', kind: 'ok' },
  photo_removed: { text: 'キャストの写真を外しました。', kind: 'ok' },
  image_bad: { text: '画像（PNG・JPEG・GIF・WebP、8MB まで）を選んでください。', kind: 'warn' },
  image_removed: { text: 'メニューの画像を外しました。', kind: 'ok' },
  posted: { text: 'メニューを出しました。', kind: 'ok' },
  post_failed: { text: 'メニューを出せませんでした。チャンネルを選んで保存してから、BOT がそこに書き込めるか確かめてください。', kind: 'warn' },
  approved: { text: '承認しました（キャストのロールを付けて、メニューに並べました）。', kind: 'ok' },
  status: { text: 'キャストの状態を変えました。', kind: 'ok' },
  role_made: { text: '「🎀 キャスト」のロールを作りました。', kind: 'ok' },
  role_failed: { text: 'ロールを作れませんでした（BOT の「ロールの管理」の権限）。', kind: 'warn' },
  paid: { text: 'キャストに渡しました。', kind: 'ok' },
  refunded: { text: 'お客に戻しました。', kind: 'ok' },
  done_already: { text: 'もう終わっています。', kind: 'warn' },
};

const SESSION_STATUS: Record<CastSession['status'], string> = {
  reserved: '📅 予約（返事待ち）',
  accepted: '📅 予約済み',
  requested: '⏳ 返事待ち',
  active: '📞 通話中',
  done: '🎉 終わった',
  declined: '🙇 断り・返事なし',
  canceled: '取り消し',
  disputed: '🚨 通報',
  refunded: '↩ 戻した',
};

type Opt = { id: string; name: string; category?: string | null };

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

function Select(props: { name: string; value?: string; options: Opt[]; empty: string; label: string }) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <select name={props.name}>
        <option value="">{props.empty}</option>
        {props.options.map((o) => (
          <option value={o.id} selected={o.id === props.value}>
            {o.category ? `${o.category} / ` : ''}
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const prices = (c: Cast) => `30分 ${c.price30.toLocaleString('ja-JP')}・1時間 ${c.price60.toLocaleString('ja-JP')}${c.priceNight ? `・寝落ち ${c.priceNight.toLocaleString('ja-JP')}` : ''}`;

export function CastPage(props: {
  session: AdminSession;
  config: CastConfig;
  channels: Opt[];
  categories: Opt[];
  roles: Opt[];
  hasImage: boolean;
  photos: ReadonlyMap<string, string>;
  casts: Cast[];
  stats: CastStat[];
  sessions: CastSession[];
  name: (id: string) => string;
  coin: string;
  flash?: string;
}) {
  const { session, config: c, name } = props;
  const f = props.flash && Object.hasOwn(CAST_FLASH, props.flash) ? CAST_FLASH[props.flash] : undefined;
  const pending = props.casts.filter((x) => x.status === 'pending');
  const members = props.casts.filter((x) => x.status === 'active' || x.status === 'paused');
  const disputed = props.sessions.filter((s) => s.status === 'disputed');
  const stat = (id: string) => props.stats.find((s) => s.castId === id);
  return (
    <Layout title="キャスト" session={session} nav="cast">
      <div class="page-head">
        <h1>🎀 キャスト</h1>
      </div>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        寝落ち・雑談などの通話を銭で受けるキャスト（18 歳以上・運営が承認）。お客が指名すると銭を社務所が預かり、キャストが受けると部屋ができ、時間が来たら手数料を引いてキャストに渡します。2 人だけの部屋・寝落ち・予約は 18 歳以上どうしだけ。18 歳未満（と年齢の分からない）人は、公開の部屋での雑談だけ（{MINOR.maxMinutes} 分まで・{MINOR.startHour}〜{MINOR.endHour} 時）。2 人だけの部屋も運営は見守りのために見られます。
      </p>

      {disputed.length > 0 && (
        <section class="card ch-group">
          <div class="ch-cat">
            <span class="ch-cat-name">🚨 通報（運営が決める）</span>
            <span class="ch-count">{disputed.length}</span>
          </div>
          <ul class="ch-list">
            {disputed.map((s) => (
              <li class="ch-row">
                <span class="ch-icon" aria-hidden="true">
                  🚨
                </span>
                <div class="ch-main">
                  <div class="ch-line">
                    <span class="ch-name">
                      指名 #{s.id}: {name(s.customerId)} → {name(s.castId)}
                    </span>
                    <span class="tag red">
                      {props.coin} {s.price.toLocaleString('ja-JP')} 枚
                    </span>
                  </div>
                  <div class="ch-topic">
                    {PLAN_LABEL[s.plan]} ・ {s.isPublic ? '公開の部屋' : '2 人だけの部屋'} ・ {fmtDateTime(s.createdAt)}
                  </div>
                </div>
                <span class="ch-actions">
                  <form method="post" action={`/cast/sessions/${s.id}/pay`} class="row-actions">
                    <Csrf session={session} />
                    <button type="submit" class="ok">
                      キャストに渡す
                    </button>
                  </form>
                  <form method="post" action={`/cast/sessions/${s.id}/refund`} class="row-actions">
                    <Csrf session={session} />
                    <button type="submit" class="danger">
                      お客に戻す
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">📝 申し込み</span>
          <span class="ch-count">{pending.length}</span>
        </div>
        {pending.length ? (
          <ul class="ch-list">
            {pending.map((x) => (
              <li class="ch-row">
                <span class="ch-icon" aria-hidden="true">
                  🎀
                </span>
                <div class="ch-main">
                  <div class="ch-line">
                    <a class="ch-name" href={`/members/${x.memberId}`}>
                      {name(x.memberId)}
                    </a>
                    <span class="tag gray">{prices(x)}</span>
                    {x.tags.map((t) => (
                      <span class="tag gray">#{t}</span>
                    ))}
                  </div>
                  <div class="ch-topic">
                    {x.bio} ・ {fmtDateTime(x.appliedAt)}
                  </div>
                </div>
                <span class="ch-actions">
                  <form method="post" action={`/cast/casts/${x.memberId}/active`} class="row-actions">
                    <Csrf session={session} />
                    <button type="submit" class="ok">
                      承認
                    </button>
                  </form>
                  <form method="post" action={`/cast/casts/${x.memberId}/removed`} class="row-actions">
                    <Csrf session={session} />
                    <button type="submit" class="danger">
                      断る
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="note ch-empty">申し込みはありません。メンバーはメニューの「🎀 キャストになる」から申し込みます（18 歳以上の方だけ）。</p>
        )}
      </section>

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">🎀 キャスト</span>
          <span class="ch-count">{members.length}</span>
          <span class="note">今月の指名・売り上げ・評価</span>
        </div>
        {members.length ? (
          <ul class="ch-list">
            {members.map((x) => {
              const st = stat(x.memberId);
              return (
                <li class={`ch-row${x.status === 'paused' ? ' off' : ''}`}>
                  <span class="ch-icon" aria-hidden="true">
                    {x.status === 'paused' ? '⏸' : x.available === 'waiting' ? '🟢' : '💤'}
                  </span>
                  <div class="ch-main">
                    <div class="ch-line">
                      <a class="ch-name" href={`/members/${x.memberId}`}>
                        {name(x.memberId)}
                      </a>
                      <span class="tag gray">{prices(x)}</span>
                      <span class="tag gray">
                        今月 {st?.count ?? 0} 回・{(st?.earned ?? 0).toLocaleString('ja-JP')} 枚{st?.ratingAvg != null ? `・⭐ ${st.ratingAvg}` : ''}
                      </span>
                      {!x.minorOk && <span class="tag gray">18 歳未満は受けない</span>}
                    </div>
                    <div class="ch-topic">{x.bio} ・ Discord ID: {x.memberId}</div>
                    {props.photos.has(x.memberId) && <img src={`/cast/casts/${x.memberId}/photo?v=${props.photos.get(x.memberId)}`} alt={`${name(x.memberId)}の紹介写真`} class="cast-profile-preview" />}
                    <form method="post" action={`/cast/casts/${x.memberId}/photo`} enctype="multipart/form-data" class="inline-actions">
                      <Csrf session={session} />
                      <label class="field"><span>{name(x.memberId)}の写真（8MBまで）</span><input type="file" name="image" accept="image/png,image/jpeg,image/gif,image/webp" required /></label>
                      <button type="submit">写真を保存</button>
                    </form>
                    {props.photos.has(x.memberId) && <form method="post" action={`/cast/casts/${x.memberId}/photo/delete`} class="row-actions"><Csrf session={session} /><button type="submit" class="danger">写真を外す</button></form>}
                  </div>
                  <span class="ch-actions">
                    <form method="post" action={`/cast/casts/${x.memberId}/${x.status === 'paused' ? 'active' : 'paused'}`} class="row-actions">
                      <Csrf session={session} />
                      <button type="submit">{x.status === 'paused' ? 'お休みを解く' : 'お休みにする'}</button>
                    </form>
                    <form method="post" action={`/cast/casts/${x.memberId}/removed`} class="row-actions">
                      <Csrf session={session} />
                      <button type="submit" class="danger">
                        外す
                      </button>
                    </form>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p class="note ch-empty">まだキャストはいません。</p>
        )}
      </section>

      <section class="card">
        <h2>🖼 メニューの画像</h2>
        <p class="note">各キャストの写真は上の一覧から登録できます。名前はDiscordの名前を使い、IDで本人を区別します。全体のメニュー画像はPNG・JPEG・GIF・WebP、8MBまでです。作ったメニューの画像を上げると、#キャスト一覧 のメニュー（画像の下に「指名するキャストを選ぶ」）に出ます。キャストの状態（🟢 待機中・📞 通話中・💤 お休み）はメニューの名前の横に出ます。</p>
        {props.hasImage && <img src="/cast/image" alt="いまのメニューの画像" class="cast-menu-preview" />}
        <form method="post" action="/cast/image" enctype="multipart/form-data" class="inline-actions">
          <Csrf session={session} />
          <input type="file" name="image" accept="image/png,image/jpeg,image/gif,image/webp" required />
          <button type="submit" class="ok">
            画像を上げる
          </button>
        </form>
        <div class="inline-actions">
          <form method="post" action="/cast/post" class="row-actions">
            <Csrf session={session} />
            <button type="submit">メニューを出す（出し直す）</button>
          </form>
          {props.hasImage && (
            <form method="post" action="/cast/image/delete" class="row-actions">
              <Csrf session={session} />
              <button type="submit" class="danger">
                画像を外す
              </button>
            </form>
          )}
        </div>
      </section>

      <section class="card">
        <h2>⚙ 設定</h2>
        <form method="post" action="/cast/settings" class="fields">
          <Csrf session={session} />
          <Select name="channelId" label="メニューを出すチャンネル（#キャスト一覧）" value={c.channelId} options={props.channels} empty="選ぶ" />
          <Select name="privateCategoryId" label="2 人だけの部屋を作るカテゴリ（遊郭など）" value={c.privateCategoryId} options={props.categories} empty="メニューと同じカテゴリ" />
          <Select name="publicCategoryId" label="公開の部屋（18 歳未満の方の雑談）を作るカテゴリ" value={c.publicCategoryId} options={props.categories} empty="メニューと同じカテゴリ" />
          <Select name="roleId" label="キャストのロール" value={c.roleId} options={props.roles} empty="なし（付けない）" />
          <label class="field">
            <span>値段の下限（銭）</span>
            <input type="number" name="priceMin" min={1} value={String(c.priceMin)} required />
          </label>
          <label class="field">
            <span>値段の上限（銭）</span>
            <input type="number" name="priceMax" min={1} value={String(c.priceMax)} required />
          </label>
          <label class="field">
            <span>手数料（%。キャストに渡すときに引いて消す）</span>
            <input type="number" name="feePercent" min={0} max={90} value={String(c.feePercent)} required />
          </label>
          <label class="field">
            <span>今すぐの指名の返事を待つ分</span>
            <input type="number" name="acceptMinutes" min={1} max={60} value={String(c.acceptMinutes)} required />
          </label>
          <button type="submit" class="ok">
            保存
          </button>
        </form>
        {!c.roleId && (
          <form method="post" action="/cast/role" class="inline-actions">
            <Csrf session={session} />
            <button type="submit">「🎀 キャスト」のロールを作る</button>
          </form>
        )}
      </section>

      <section class="card">
        <h2>最近の指名</h2>
        {props.sessions.length ? (
          <table class="compact">
            <thead>
              <tr>
                <th>日時</th>
                <th>お客 → キャスト</th>
                <th>時間</th>
                <th class="num">銭</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {props.sessions.map((s) => (
                <tr>
                  <td>{fmtDateTime(s.createdAt)}</td>
                  <td>
                    {name(s.customerId)} → {name(s.castId)}
                    {s.isPublic ? '（公開）' : ''}
                  </td>
                  <td>
                    {PLAN_LABEL[s.plan]}
                    {s.extensions ? `＋${s.extensions * 30} 分` : ''}
                  </td>
                  <td class="num">{s.price.toLocaleString('ja-JP')}</td>
                  <td>
                    {SESSION_STATUS[s.status]}
                    {s.rating ? ` ⭐${s.rating}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="empty">まだありません。</p>
        )}
      </section>
    </Layout>
  );
}

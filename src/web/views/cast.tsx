import type { CastRankRow } from '../../services/castRank.js';
import type { AdminSession, Cast, CastSession } from '../../db/schema.js';
import { GROUP_LABEL, MENU_KINDS, MENU_KIND_LABEL, menuKindOf, type CastMenuItem, MENU_MAX, OPTION_MAX, MENU_MINUTES, MINOR, DELIVERY, menuLabel, menuPriceText, menuOf, menuText, scheduleInput, scheduleText, sessionLabel, sessionStart, type CastConfig, type CastStat } from '../../services/cast.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

export const CAST_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  schedule_saved: { text: '🗓 出勤予定を保存しました（紹介パネルも書き換えます）。', kind: 'ok' },
  schedule_invalid: { text: '出勤予定を読めませんでした。「月水金 21:00-24:00」のように、1 行に 1 つ書いてください（30 分以上・30:00 まで）。', kind: 'warn' },
  canceled: { text: '予約を取り消して、お客に全額戻しました。', kind: 'ok' },
  saved: { text: '設定を保存しました。', kind: 'ok' },
  invalid: { text: '入力を確かめてください（値段は 1 以上・下限は上限以下・手数料は 0〜90%）。', kind: 'warn' },
  image_saved: { text: 'メニューの画像を入れかえました（メニューも書き換えました）。', kind: 'ok' },
  image_big: { text: '写真は8MBまでです。小さくしてから上げてください。', kind: 'warn' },
  sync_pending: { text: '保存しました。紹介投稿の更新は待機中です。BOTの権限を確認してください。毎分再試行します。', kind: 'warn' },
  photo_saved: { text: '写真を保存し、登録済みの紹介投稿にも反映しました。', kind: 'ok' },
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
  registered: { text: '🎀 キャストに登録しました（ロールを付けて、メニューに並べました。本人に DM で知らせました）。写真は下の一覧から保存できます。', kind: 'ok' },
  no_member: { text: 'その人が見つかりません。名前を入れて、出てきた候補から選んでください（鯖にいる人だけ）。', kind: 'warn' },
  reg_not_adult: { text: 'キャストに登録できるのは、18 歳以上（宵参りのロールか、年齢区分が大人）の人だけです。', kind: 'warn' },
  reg_invalid: { text: 'はじめのメニュー（内容・時間・値段）を確かめてください。値段は設定の下限〜上限の数。紹介は 300 文字まで。', kind: 'warn' },
  reg_already: { text: 'その人はもうキャストです。', kind: 'warn' },
  gender_saved: { text: '男性・女性を保存しました（メニューも書き換えました）。', kind: 'ok' },
  intro_posted: { text: '🎀 紹介パネルを出しました（投稿済みなら同じメッセージを更新します）。', kind: 'ok' },
  intro_failed: { text: '紹介パネルを出せませんでした。チャンネルを選んで、BOT がそこに書きこめるか・キャストがお休み中でないか確かめてください。', kind: 'warn' },
  menu_ok: { text: '🎀 メニューを足しました（Discord のメニューにも出ます）。', kind: 'ok' },
  menu_invalid: { text: 'メニューを足せませんでした。内容（30 文字まで）・時間（分）・値段（設定の下限〜上限）を確かめてください。', kind: 'warn' },
  menu_full: { text: `メニューは 1 人 ${MENU_MAX} こまでです。`, kind: 'warn' },
  menu_not_cast: { text: 'その人はキャストではありません。', kind: 'warn' },
  menu_saved: { text: 'メニューを書きかえました（もう入っている指名・予約はそのままです）。', kind: 'ok' },
  menu_none: { text: 'そのメニューはもうありません。', kind: 'warn' },
  template_applied: { text: '📋 テンプレのメニューを入れました。', kind: 'ok' },
  template_failed: { text: 'テンプレを入れられませんでした（テンプレが空か、外したキャストです）。', kind: 'warn' },
  option_ok: { text: '➕ オプションを足しました。', kind: 'ok' },
  option_invalid: { text: 'オプションの名前（30 文字まで）と値段（1 以上・上限まで）を確かめてください。', kind: 'warn' },
  option_full: { text: `オプションは 1 人 ${OPTION_MAX} こまでです。`, kind: 'warn' },
  option_not_cast: { text: 'その人はキャストではありません。', kind: 'warn' },
  option_removed: { text: 'オプションを外しました（もう入っている指名はそのままです）。', kind: 'ok' },
  menu_removed: { text: 'メニューを外しました（もう入っている指名・予約はそのままです）。', kind: 'ok' },
  done_already: { text: 'もう終わっています。', kind: 'warn' },
};

const SESSION_STATUS: Record<CastSession['status'], string> = {
  noshow_cast: '🚫 キャストが来なかった（全額戻した）',
  noshow_customer: '🚫 お客が来なかった',
  reserved: '📅 予約（返事待ち）',
  accepted: '📅 予約済み',
  requested: '⏳ 返事待ち',
  ordered: '📦 納品待ち',
  delivered: '📦 受け取り待ち',
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

const prices = (c: Cast) => menuText(c) || 'メニューなし';

function GenderSelect(props: { value?: string }) {
  return (
    <label class="field">
      <span>男性・女性（出すメニューのチャンネル）</span>
      <select name="gender">
        <option value="" selected={!props.value}>まだ決めない（両方に出る）</option>
        <option value="male" selected={props.value === 'male'}>👨 男性</option>
        <option value="female" selected={props.value === 'female'}>👩 女性</option>
      </select>
    </label>
  );
}

/** メニューの一覧（書きかえる・外す）と、足す欄。キャストのメニューとテンプレで使う */
function MenuList(props: { items: CastMenuItem[]; base: string; session: AdminSession; c: CastConfig; empty: string }) {
  return (
    <>
      {props.items.length ? (
        <ul>
          {props.items.map((m) => (
            <li>
              {menuLabel(m)} ・ {menuPriceText(m)}
              {m.note ? ` ・ ${m.note}` : ''}
              <details>
                <summary>書きかえる</summary>
                <form method="post" action={`${props.base}/${m.id}`} class="fields">
                  <Csrf session={props.session} />
                  <label class="field">
                    <span>内容</span>
                    <input type="text" name="menuName" maxlength={30} required value={m.name} />
                  </label>
                  <label class="field">
                    <span>説明</span>
                    <input type="text" name="menuNote" maxlength={100} value={m.note} />
                  </label>
                  <label class="field">
                    <span>種類（変えると、次の予約・注文から）</span>
                    <select name="menuKind">
                      {MENU_KINDS.map((k) => (
                        <option value={k} selected={menuKindOf(m) === k}>
                          {MENU_KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="field">
                    <span>時間（分。📞 通話だけ。0 で時間フリー）</span>
                    <input type="number" name="menuMinutes" min={0} max={MENU_MINUTES.max} step={5} value={String(m.minutes)} />
                  </label>
                  <label class="field">
                    <span>値段（枚。💬 相談は入れない）</span>
                    <input type="number" name="menuPrice" min={0} max={props.c.priceMax} value={m.consult ? '' : String(m.price)} />
                  </label>
                  <label class="field">
                    <span>🎰 ガチャの中身（1 行に 1 つ。🎰 ガチャのときだけ・1 つ以上）</span>
                    <textarea name="menuGacha" rows={3}>{(m.gacha ?? []).join('\n')}</textarea>
                  </label>
                  <button type="submit" class="ok">保存</button>
                </form>
              </details>
              <form method="post" action={`${props.base}/${m.id}/delete`} class="row-actions">
                <Csrf session={props.session} />
                <button type="submit" class="danger">外す</button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p class="note">{props.empty}</p>
      )}
      <form method="post" action={props.base} class="fields">
        <Csrf session={props.session} />
        <MenuFields c={props.c} />
        <button type="submit" class="ok">メニューを足す</button>
      </form>
    </>
  );
}

/** メニューの欄（内容・説明・時間・値段・寝落ち）。登録とメニューを足すで使う */
function MenuFields(props: { c: CastConfig; optional?: boolean }) {
  const pair = (n: '' | '2' | '3', first: boolean) => (
    <>
      <label class="field">
        <span>時間{n ? ` ${n}` : ''}（分。{MENU_MINUTES.min}〜{MENU_MINUTES.max}・0 で時間フリー）</span>
        <input type="number" name={`menuMinutes${n}`} min={0} max={MENU_MINUTES.max} step={5} placeholder={first ? '30' : n === '2' ? '60' : ''} />
      </label>
      <label class="field">
        <span>値段{n ? ` ${n}` : ''}（{props.c.priceMin.toLocaleString('ja-JP')}〜{props.c.priceMax.toLocaleString('ja-JP')} 枚）</span>
        <input type="number" name={`menuPrice${n}`} min={props.c.priceMin} max={props.c.priceMax} />
      </label>
    </>
  );
  return (
    <>
      <label class="field">
        <span>内容（30 文字まで）</span>
        <input type="text" name="menuName" maxlength={30} required={!props.optional} placeholder="ツーショット・寝かしつけ など" />
      </label>
      <label class="field">
        <span>説明（なくてもよい・100 文字まで）</span>
        <input type="text" name="menuNote" maxlength={100} />
      </label>
      {pair('', true)}
      {pair('2', false)}
      {pair('3', false)}
      <p class="note">同じ内容で 30 分と 1 時間など、時間と値段の組を 3 つまで一度に足せます（使わない組は空のまま）。</p>
      <label class="field check">
        <input type="checkbox" name="menuNight" value="yes" />
        <span>🌙 寝落ち（朝 7 時まで。値段は 1 つめだけ・18 歳以上だけ）</span>
      </label>
      <label class="field check">
        <input type="checkbox" name="menuConsult" value="yes" />
        <span>💬 内容により相談（時間と値段は入れない。お客がお願いを書き、キャストがそのつど時間と値段を出す・18 歳以上だけ）</span>
      </label>
      <label class="field check">
        <input type="checkbox" name="menuDelivery" value="yes" />
        <span>📦 納品（シチュエーションボイスなど。通話しない。時間は入れず、値段は 1 つめだけ・18 歳以上だけ。キャストが 24 時間以内に納品し、お客の「受け取った」で渡す）</span>
      </label>
      <label class="field">
        <span>🎰 ガチャの中身（納品のときだけ。1 行に 1 つ・{DELIVERY.gachaMax} こまで。空ならふつうの納品。どれか 1 つが同じ確率で出る）</span>
        <textarea name="menuGacha" rows={3} placeholder={'おはようボイス\nおやすみボイス\n応援ボイス'} />
      </label>
    </>
  );
}

export function CastPage(props: {
  session: AdminSession;
  config: CastConfig;
  channels: Opt[];
  categories: Opt[];
  roles: Opt[];
  hasImage: boolean;
  hasFemaleImage: boolean;
  photos: ReadonlyMap<string, string>;
  casts: Cast[];
  members: { id: string; name: string }[];
  template: CastMenuItem[];
  stats: CastStat[];
  /** 🏆 くわしいランキング（月ごと） */
  ranking?: { month: string; prev: string; next?: string; rows: CastRankRow[] };
  sessions: CastSession[];
  /** 📅 予約カレンダー（きのう〜7 日後に始まるもの） */
  calendar?: CastSession[];
  /** 🚫 来なかった回数（30 日） */
  noShows?: { cast: ReadonlyMap<string, number>; customer: ReadonlyMap<string, number> };
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
        <a href="/cast-office/login" class="btn">キャスト本人の編集用ログイン</a>
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
                    {sessionLabel(s)} ・ {s.isPublic ? '公開の部屋' : '2 人だけの部屋'} ・ {fmtDateTime(s.createdAt)}
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
          <p class="note ch-empty">申し込みはありません。キャストは下の「➕ キャストを登録」から運営が登録します。</p>
        )}
      </section>

      <form method="post" action="/cast/register" class="card anchor" id="cast-register">
        <Csrf session={session} />
        <h2>➕ キャストを登録</h2>
        <p class="note">登録するとすぐキャストになり、ロールが付いてメニューに並びます（本人に DM）。18 歳以上（宵参りのロールか、年齢区分が大人）の人だけです。メニュー（内容・時間・値段）はキャストごとに決めます。</p>
        <div class="fields">
          <label class="field">
            <span>登録する人（名前か ID）</span>
            <input type="text" name="member" list="cast-members" required autocomplete="off" placeholder="名前を入れると候補が出ます" />
            <datalist id="cast-members">
              {props.members.map((m) => (
                <option value={m.name}>{m.id}</option>
              ))}
            </datalist>
          </label>
          <label class="field">
            <span>紹介（300 文字まで）</span>
            <textarea name="bio" maxlength={300} rows={3}></textarea>
          </label>
          <label class="field">
            <span>得意なこと（「、」で区切る。7 つまで）</span>
            <input type="text" name="tags" maxlength={120} placeholder="雑談、ゲーム、寝落ち" />
          </label>
          <GenderSelect />
          <label class="field check">
            <input type="checkbox" name="useTemplate" value="yes" checked />
            <span>📋 テンプレのメニューで登録する（外すと、下で入れたメニューで登録）</span>
          </label>
          <p class="note">テンプレを使わないときの、はじめのメニュー（あとから一覧でいくつでも足せます）</p>
          <MenuFields c={c} optional />
          <label class="field check">
            <input type="checkbox" name="minorOk" value="yes" checked />
            <span>18 歳未満の人の雑談も受ける（公開の部屋だけ）</span>
          </label>
        </div>
        <button type="submit" class="ok">登録する</button>
      </form>

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
                    <form method="post" action={`/cast/casts/${x.memberId}/gender`} class="inline-actions">
                      <Csrf session={session} />
                      <GenderSelect value={x.gender} />
                      <button type="submit">保存</button>
                    </form>
                    <form method="post" action={`/cast/casts/${x.memberId}/intro`} class="inline-actions">
                      <Csrf session={session} />
                      <Select name="channelId" options={props.channels} empty="その人のメニューのチャンネル" label="紹介パネルを出すチャンネル" />
                      <button type="submit">紹介パネルを出す・更新</button>
                    </form>
                    <div class="ch-topic">
                      🗓 出勤予定: {scheduleText(x.schedule)}
                      {(props.noShows?.cast.get(x.memberId) ?? 0) > 0 && <span class="tag warn">🚫 来なかった {props.noShows!.cast.get(x.memberId)} 回（30 日）</span>}
                    </div>
                    <details>
                      <summary>🗓 出勤予定を変える</summary>
                      <form method="post" action={`/cast/casts/${x.memberId}/schedule`} class="inline-actions">
                        <Csrf session={session} />
                        <label class="field">
                          <span>1 行に 1 つ（例: 月水金 21:00-24:00 ／ 土 20:00-26:00）。空にすると、いつでも予約できます</span>
                          <textarea name="schedule" rows={3} maxlength={500}>{scheduleInput(x.schedule)}</textarea>
                        </label>
                        <button type="submit">保存</button>
                      </form>
                    </details>
                    <details class="anchor" id={`cast-${x.memberId}`}>
                      <summary>🎀 メニュー（{menuOf(x).length}）</summary>
                      <form method="post" action={`/cast/casts/${x.memberId}/menu/template`} class="row-actions">
                        <Csrf session={session} />
                        <button type="submit">📋 テンプレのメニューを入れる（今のメニューと入れかえ）</button>
                      </form>
                      <MenuList items={menuOf(x)} base={`/cast/casts/${x.memberId}/menu`} session={session} c={c} empty="メニューがありません（指名できません）。テンプレを入れるか、下から足してください。" />
                      <h3>➕ オプション（{x.options.length}／{OPTION_MAX}）</h3>
                      <p class="note">お客がメニューを選んだあと、確かめの画面でいくつでも付けられます。値段はメニューに足して払います（30 分のばす値段には入りません）。</p>
                      {x.options.length > 0 && (
                        <ul>
                          {x.options.map((o) => (
                            <li>
                              {o.name} ・ +{o.price.toLocaleString('ja-JP')} 枚
                              <form method="post" action={`/cast/casts/${x.memberId}/options/${o.id}/delete`} class="row-actions">
                                <Csrf session={session} />
                                <button type="submit" class="danger">外す</button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      )}
                      <form method="post" action={`/cast/casts/${x.memberId}/options`} class="inline-actions">
                        <Csrf session={session} />
                        <label class="field">
                          <span>オプションの名前（30 文字まで）</span>
                          <input type="text" name="optionName" maxlength={30} required placeholder="カメラあり・歌 など" />
                        </label>
                        <label class="field">
                          <span>値段（1〜{c.priceMax.toLocaleString('ja-JP')} 枚）</span>
                          <input type="number" name="optionPrice" min={1} max={c.priceMax} required />
                        </label>
                        <button type="submit" class="ok">オプションを足す</button>
                      </form>
                    </details>
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

      <section class="card anchor" id="cast-template">
        <h2>📋 メニューのテンプレ</h2>
        <p class="note">キャストを登録するときや、一覧の「テンプレのメニューを入れる」で、この中身をそのまま入れます。入れたあとは、キャストごとに書きかえられます（テンプレを変えても、もう入れたキャストのメニューは変わりません）。</p>
        <MenuList items={props.template} base="/cast/template" session={session} c={c} empty="テンプレが空です。下から足してください。" />
      </section>

      <section class="card">
        <h2>🖼 メニューの画像</h2>
        <p class="note">各キャストの写真は上の一覧から登録できます。名前はDiscordの名前を使い、IDで本人を区別します。全体のメニュー画像はPNG・JPEG・GIF・WebP、8MBまでです。作ったメニューの画像を上げると、#キャスト一覧 のメニュー（画像の下に「指名するキャストを選ぶ」）に出ます。キャストの状態（🟢 待機中・📞 通話中・💤 お休み）はメニューの名前の横に出ます。</p>
        {(['male', 'female'] as const).map((g) => {
          const has = g === 'female' ? props.hasFemaleImage : props.hasImage;
          return (
            <div>
              <h3>{GROUP_LABEL[g]}のメニューの画像{g === 'female' ? '（なければ男性と同じ画像）' : ''}</h3>
              {has && <img src={`/cast/image?g=${g}`} alt={`${GROUP_LABEL[g]}のメニューの画像`} class="cast-menu-preview" />}
              <form method="post" action="/cast/image" enctype="multipart/form-data" class="inline-actions">
                <Csrf session={session} />
                <input type="hidden" name="group" value={g} />
                <input type="file" name="image" accept="image/png,image/jpeg,image/gif,image/webp" required />
                <button type="submit" class="ok">画像を上げる</button>
              </form>
              {has && (
                <form method="post" action="/cast/image/delete" class="row-actions">
                  <Csrf session={session} />
                  <input type="hidden" name="group" value={g} />
                  <button type="submit" class="danger">画像を外す</button>
                </form>
              )}
            </div>
          );
        })}
        <div class="inline-actions">
          <form method="post" action="/cast/post" class="row-actions">
            <Csrf session={session} />
            <button type="submit">メニューを出す（出し直す）</button>
          </form>
        </div>
      </section>

      <section class="card">
        <h2>⚙ 設定</h2>
        <form method="post" action="/cast/settings" class="fields">
          <Csrf session={session} />
          <Select name="channelId" label="👨 男性キャストのメニューを出すチャンネル" value={c.channelId} options={props.channels} empty="選ぶ" />
          <Select name="femaleChannelId" label="👩 女性キャストのメニューを出すチャンネル（なければ、男性のチャンネルに全員を出す）" value={c.femaleChannelId} options={props.channels} empty="分けない" />
          <Select name="reservationChannelId" label="📅 予約・納品のお部屋をまとめるチャンネル（男女共通）" value={c.reservationChannelId} options={[...props.channels, ...(c.reservationChannelId && !props.channels.some(ch => ch.id === c.reservationChannelId) ? [{ id: c.reservationChannelId, name: '設定済みの予約窓口' }] : [])]} empty="自動で作成（📅 キャスト予約）" />
          <p class="note">一覧は紹介と予約ボタン、やり取りは専用窓口の非公開のお部屋へ分けます。既存の予約は元の場所を使います。指定する場合は参加者がチャンネルを見られ、運営以外がスレッドを管理できない権限にしてください。</p>
          <Select name="privateCategoryId" label="2 人だけの部屋を作るカテゴリ（遊郭など）" value={c.privateCategoryId} options={props.categories} empty="メニューと同じカテゴリ" />
          <Select name="publicCategoryId" label="公開の部屋（18 歳未満の方の雑談）を作るカテゴリ" value={c.publicCategoryId} options={props.categories} empty="メニューと同じカテゴリ" />
          <Select name="roleId" label="キャストのロール" value={c.roleId} options={props.roles} empty="なし（付けない）" />
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
          <label class="field">
            <span>⏳ 直前の取り消し: 始まる何分前より後なら（0 でなし）</span>
            <input type="number" name="lateCancelMinutes" min={0} max={1440} value={String(c.lateCancelMinutes)} required />
          </label>
          <label class="field">
            <span>⏳ 直前の取り消しで、キャストに渡す %（残りはお客に戻す）</span>
            <input type="number" name="lateCancelPercent" min={0} max={100} value={String(c.lateCancelPercent)} required />
          </label>
          <label class="field">
            <span>🚫 始まってから何分で「相手が来ない」を押せるか</span>
            <input type="number" name="noShowMinutes" min={5} max={120} value={String(c.noShowMinutes)} required />
          </label>
          <label class="field">
            <span>🚫 お客が来なかったとき、キャストに渡す %（キャストが来なかったときは全額お客に戻す）</span>
            <input type="number" name="noShowPercent" min={0} max={100} value={String(c.noShowPercent)} required />
          </label>
          <h3>🏆 ランキング</h3>
          <p class="muted">毎月 1 日に、先月の指名の多い上位 3 人を発表します（1 日に BOT が止まっていたら 7 日までに）。今月の上位 3 人は、メニューにもいつも出ます。</p>
          <Select name="rankChannelId" label="先月の上位 3 人を発表するチャンネル" value={c.rankChannelId} options={props.channels} empty="メニューのチャンネル" />
          <Select name="rankRoleId" label="月の 1 位にわたす称号のロール（次の 1 位が決まると外す）" value={c.rankRoleId} options={props.roles} empty="わたさない" />
          <label class="field">
            <span>月の 1 位にわたす銭（0 でなし）</span>
            <input type="number" name="rankBonus" min={0} max={1000000} value={String(c.rankBonus)} required />
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

      {props.ranking && <Ranking {...props.ranking} name={name} coin={props.coin} />}

      {props.calendar && <Calendar sessions={props.calendar} name={name} session={session} noShows={props.noShows} />}

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
                    {sessionLabel(s)}
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

const JST_MS = 9 * 3_600_000;
const dayKey = (d: Date) => new Date(d.getTime() + JST_MS).toISOString().slice(0, 10);
const timeOf = (d: Date) => new Date(d.getTime() + JST_MS).toISOString().slice(11, 16);
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const CANCELABLE: CastSession['status'][] = ['reserved', 'accepted'];

/** 📅 予約カレンダー（日ごと。運営は始まる前の予約を取り消せる＝全額戻す） */
function Calendar(props: { sessions: CastSession[]; name: (id: string) => string; session: AdminSession; noShows?: { cast: ReadonlyMap<string, number>; customer: ReadonlyMap<string, number> } }) {
  const days = new Map<string, CastSession[]>();
  for (const s of props.sessions) {
    const k = dayKey(sessionStart(s));
    days.set(k, [...(days.get(k) ?? []), s]);
  }
  const customers = [...(props.noShows?.customer ?? new Map<string, number>())].filter(([, n]) => n > 0);
  return (
    <section class="card anchor" id="cast-calendar">
      <h2>📅 予約カレンダー（きのう〜7 日後）</h2>
      <p class="note">始まる時刻の順です（日本時間）。「取り消す」は、始まる前の予約を運営が取り消して、お客に全額戻します（キャストとお客に DM）。</p>
      {days.size === 0 && <p class="empty">この間の予約はありません。</p>}
      {[...days].map(([day, list]) => (
        <details open>
          <summary>
            {day.slice(5).replace('-', '/')}（{WEEK[new Date(`${day}T12:00:00Z`).getUTCDay()]}） ・ {list.length} 件
          </summary>
          <table class="compact">
            <thead>
              <tr>
                <th>時刻</th>
                <th>キャスト ← お客</th>
                <th>内容</th>
                <th>状態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr>
                  <td>
                    {timeOf(sessionStart(s))}
                    {s.endsAt ? `〜${timeOf(s.endsAt)}` : ''}
                  </td>
                  <td>
                    {props.name(s.castId)} ← {props.name(s.customerId)}
                  </td>
                  <td>{sessionLabel(s)}</td>
                  <td>{SESSION_STATUS[s.status]}</td>
                  <td>
                    {CANCELABLE.includes(s.status) && (
                      <form method="post" action={`/cast/sessions/${s.id}/cancel`} class="row-actions">
                        <Csrf session={props.session} />
                        <label class="check">
                          <input type="checkbox" name="confirm" value="yes" required /> 取り消す
                        </label>
                        <button type="submit" class="danger small">取り消す</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
      {customers.length > 0 && (
        <p class="note">
          🚫 来なかったお客（30 日）: {customers.map(([id, n]) => `${props.name(id)} ${n} 回`).join('、')}
        </p>
      )}
    </section>
  );
}

/** 🏆 くわしいランキング（運営だけ。月ごと・指名の多い順） */
function Ranking(p: { month: string; prev: string; next?: string; rows: CastRankRow[]; name: (id: string) => string; coin: string }) {
  const [y, m] = p.month.split('-');
  const medal = ['🥇', '🥈', '🥉'];
  return (
    <section class="card" id="cast-ranking">
      <h2>🏆 ランキング（{Number(y)} 年 {Number(m)} 月）</h2>
      <div class="inline-actions">
        <a href={`/cast?rank=${p.prev}#cast-ranking`}>← 前の月</a>
        {p.next && <a href={`/cast?rank=${p.next}#cast-ranking`}>次の月 →</a>}
      </div>
      <p class="muted">終わった指名の回数の多い順（同じなら売り上げの多い順）。売り上げはキャストにわたした銭（手数料を引いたあと）。断った・取り消し・来なかったは、その月に入った指名で数えます。</p>
      {p.rows.length ? (
        <table class="compact">
          <thead>
            <tr>
              <th>順位</th>
              <th>キャスト</th>
              <th class="num">指名</th>
              <th class="num">売り上げ（{p.coin}）</th>
              <th class="num">評価</th>
              <th class="num">お客（2 回以上）</th>
              <th class="num">断った</th>
              <th class="num">取り消し</th>
              <th class="num">来なかった</th>
              <th class="num">通報</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r, k) => (
              <tr>
                <td>{r.count > 0 ? (medal[k] ?? `${k + 1}`) : '―'}</td>
                <td>{p.name(r.castId)}</td>
                <td class="num">{r.count}</td>
                <td class="num">{r.earned.toLocaleString('ja-JP')}</td>
                <td class="num">{r.ratingAvg !== null ? `⭐ ${r.ratingAvg}（${r.ratings}）` : '―'}</td>
                <td class="num">{r.customers}（{r.repeaters}）</td>
                <td class="num">{r.declined}</td>
                <td class="num">{r.canceled}</td>
                <td class="num">{r.noShow}</td>
                <td class="num">{r.disputed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="muted">この月の指名はありません。</p>
      )}
    </section>
  );
}

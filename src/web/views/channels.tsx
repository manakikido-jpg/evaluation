import type { AdminSession } from '../../db/schema.js';
import type { GuildChannel, GuildRole } from '../../lib/discordRest.js';
import { CHANNEL_VISIBILITY, type ChannelMode } from '../../services/channels.js';
import { PERM_LABEL, type OverwriteRow, type PermKey, type Tri } from '../../services/channelPerms.js';
import { Layout } from './layout.js';

export const CHANNEL_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '保存しました。Discord に反映しました。', kind: 'ok' },
  unchanged: { text: '変わったところがありませんでした。', kind: 'ok' },
  invalid: {
    text: '入力を確かめてください（名前は 1〜100 文字、説明は 1024 文字まで、人数の上限は 0〜99）。',
    kind: 'warn',
  },
  failed: {
    text: 'Discord に反映できませんでした。BOT の「チャンネルの管理」「ロールの管理」権限を確かめてください。',
    kind: 'warn',
  },
  created: { text: 'チャンネルを作りました。続けて説明などを整えられます。', kind: 'ok' },
  moved: { text: '並びを変えました。Discord に反映しました。', kind: 'ok' },
  create_invalid: {
    text: '入力を確かめてください（名前は 1〜100 文字。「カテゴリと同じ」はカテゴリを選ぶ。「プライベート」はロールを 1 つ以上選ぶ）。',
    kind: 'warn',
  },
  deleted: { text: 'チャンネルを消しました。', kind: 'ok' },
  perms_saved: { text: '見られる人・ロールを変えました。Discord に反映しました。', kind: 'ok' },
  perms_member_not_found: { text: '人が見つかりませんでした（ID・ユーザー名・表示名で入れてください）。', kind: 'warn' },
  confirm_name: {
    text: '消すときは、確認のためチャンネルの名前をそのまま入力してください。',
    kind: 'warn',
  },
  in_use: {
    text: 'このチャンネルは BOT が使っているので消せません（設定ファイルの ID・通話部屋の入口・募集ボタン）。',
    kind: 'warn',
  },
  has_children: {
    text: '中にチャンネルがあるカテゴリは消せません。先に中のチャンネルを消すか、ほかのカテゴリへ移してください。',
    kind: 'warn',
  },
};

function Flash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(CHANNEL_FLASH, props.code) ? CHANNEL_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

/** 一覧の 1 行・編集ページで使う、チャンネルのようす */
export type ChannelInfo = {
  channel: GuildChannel;
  mode?: ChannelMode;
  /** みんなからは見えない */
  restricted: boolean;
  /** BOT が使っている（消せない）理由 */
  inUse?: string;
};

export const channelIcon = (c: GuildChannel) => (c.type === 4 ? '📁' : c.type === 2 || c.type === 13 ? '🔊' : c.type === 5 ? '📣' : '#');
const kindLabel = (c: GuildChannel) => (c.type === 4 ? 'カテゴリ' : c.type === 2 ? '通話' : c.type === 13 ? 'ステージ' : c.type === 5 ? 'お知らせ' : 'テキスト');

function Tags(props: { info: ChannelInfo }) {
  const { channel: c, mode, restricted, inUse } = props.info;
  return (
    <span class="ch-tags">
      {mode === 'readonly' && <span class="tag gray">読むだけ</span>}
      {restricted && <span class="tag gray">🔒 限定公開</span>}
      {c.nsfw && <span class="tag red">🔞 年齢制限</span>}
      {c.type === 2 && c.user_limit ? <span class="tag gray">{c.user_limit} 人まで</span> : null}
      {inUse && (
        <span class="tag bot" title={inUse}>
          🤖 BOT が使用
        </span>
      )}
    </span>
  );
}

/** ▲▼（一覧から押したときは一覧に戻る） */
function UpDown(props: { session: AdminSession; channel: GuildChannel; from?: 'list' }) {
  return (
    <form method="post" action={`/channels/${props.channel.id}/move`} class="updown">
      <Csrf session={props.session} />
      {props.from && <input type="hidden" name="from" value={props.from} />}
      <button type="submit" name="dir" value="up" aria-label="1 つ上へ" title="1 つ上へ">
        {props.from ? '▲' : '▲ 上へ'}
      </button>
      <button type="submit" name="dir" value="down" aria-label="1 つ下へ" title="1 つ下へ">
        {props.from ? '▼' : '▼ 下へ'}
      </button>
    </form>
  );
}

// ───────── 一覧 ─────────

export function ChannelsPage(props: {
  session: AdminSession;
  groups: { category: ChannelInfo | null; items: ChannelInfo[] }[];
  flash?: string;
  /** 名前で絞り込み */
  q?: string;
  total: number;
  checkSummary?: { total: number; warn: number } | null;
}) {
  const { session } = props;
  const q = (props.q ?? '').trim().toLowerCase();
  const match = (i: ChannelInfo) => !q || i.channel.name.toLowerCase().includes(q) || (i.channel.topic ?? '').toLowerCase().includes(q);
  const groups = props.groups
    .map((g) => ({ ...g, items: g.items.filter(match), catHit: Boolean(q && g.category && match(g.category)) }))
    .filter((g) => !q || g.items.length || g.catHit);
  return (
    <Layout title="チャンネル" session={session} nav="channels">
      <div class="page-head">
        <h1>チャンネル</h1>
        <span class="inline-actions">
          <a class="button-link" href="/channels/check">🔎 権限の点検・見える範囲</a>
          <a class="button-link" href="/channels/perms">
            🧮 権限マトリクス・テンプレート
          </a>
          <a class="button-link primary" href="/channels/new">
            ➕ チャンネルを作る
          </a>
        </span>
      </div>
      <Flash code={props.flash} />
      {props.checkSummary === null && <p class="flash warn">権限の点検データを取得できませんでした。<a href="/channels/check">点検画面で読み直す</a></p>}
      {props.checkSummary && <p class={props.checkSummary.total ? 'flash warn' : 'note'}>権限の点検: 注意{props.checkSummary.warn}件・要確認{props.checkSummary.total - props.checkSummary.warn}件。<a href="/channels/check">理由と見える範囲を確認する</a></p>}

      <form method="get" action="/channels" class="ch-search">
        <input type="search" name="q" value={props.q ?? ''} placeholder="名前・説明で探す" aria-label="チャンネルを探す" />
        <button type="submit">探す</button>
        {q && <a href="/channels">すべて表示</a>}
        <span class="note">{props.total} チャンネル</span>
      </form>
      <details class="card ch-help">
        <summary>使い方と気をつけること</summary>
        <ul>
          <li>名前を押すと、そのチャンネルの名前・説明・「書き込める／読むだけ」・年齢制限・場所を変えたり、消したりできます。▲▼ で並びを変えられます。</li>
          <li>読むだけのチャンネルは、メッセージ・スレッドは送れず、リアクションだけ付けられます（神職・宮司と BOT は書けます）。</li>
          <li>名前を変えても BOT は同じチャンネルとして扱います（ID で覚えているため）。掲示の <code>{'{#絵馬}'}</code> のようなリンクは、飾り（絵文字・記号）を除いて同じ名前なら見つかります。</li>
          <li>🔞 年齢制限を付けると、見るのに Discord の年齢確認が要ります。宵宮は宵参りを承認した人だけが見られるので、付けなくて大丈夫です。</li>
          <li>🤖 BOT が使用 のチャンネルは消せません（設定ファイルの ID・通話部屋の入口・募集ボタン）。</li>
        </ul>
      </details>

      {groups.length === 0 && <p class="empty card">見つかりませんでした。</p>}
      {groups.map((g) => (
        <section class="card ch-group anchor" id={`cat-${g.category?.channel.id ?? 'none'}`}>
          <div class="ch-cat">
            {g.category ? (
              <>
                <a class="ch-cat-name" href={`/channels/${g.category.channel.id}`}>
                  📁 {g.category.channel.name}
                </a>
                <Tags info={g.category} />
                <span class="ch-count">{g.items.length}</span>
                <span class="ch-actions">
                  <a class="small-link" href={`/channels/new?parent=${g.category.channel.id}`} title="このカテゴリに作る">
                    ＋ 作る
                  </a>
                  <UpDown session={session} channel={g.category.channel} from="list" />
                </span>
              </>
            ) : (
              <span class="ch-cat-name">カテゴリなし</span>
            )}
          </div>
          {g.items.length > 0 ? (
            <ul class="ch-list">
              {g.items.map((info) => (
                <li class="ch-row anchor" id={`ch-${info.channel.id}`}>
                  <span class="ch-icon" aria-hidden="true">
                    {channelIcon(info.channel)}
                  </span>
                  <div class="ch-main">
                    <div class="ch-line">
                      <a class="ch-name" href={`/channels/${info.channel.id}`}>
                        {info.channel.name}
                      </a>
                      <Tags info={info} />
                    </div>
                    {info.channel.topic && <div class="ch-topic">{info.channel.topic}</div>}
                  </div>
                  <span class="ch-actions">
                    <UpDown session={session} channel={info.channel} from="list" />
                    <a class="button-link small" href={`/channels/${info.channel.id}`}>
                      編集
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="note ch-empty">チャンネルはありません。</p>
          )}
        </section>
      ))}
    </Layout>
  );
}

// ───────── 1 つのチャンネル ─────────

/** 見られる人・ロールの欄に出すもの */
export type ChannelPermView = {
  keys: PermKey[];
  rows: OverwriteRow[];
  /** 今見られる（@everyone とそのロールだけを持っている人が） */
  viewers: { everyone: boolean; roles: string[] };
  /** カテゴリと同期しているか（カテゴリの中でなければ null） */
  synced: boolean | null;
  /** カテゴリのとき: 同期している中のチャンネルの数 */
  syncedChildren: number;
  /** 足せるロール */
  roles: { id: string; name: string }[];
};

const TRI_LABEL: Record<Tri, string> = { allow: '✅ 許可', deny: '⛔ 拒否', inherit: '／ 決めない' };

function TriSelect(props: { name: string; value: Tri; disabled?: boolean }) {
  return (
    <select name={props.name} disabled={props.disabled} class={`tri tri-${props.value}`}>
      {(Object.keys(TRI_LABEL) as Tri[]).map((t) => (
        <option value={t} selected={t === props.value}>
          {TRI_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

/** 🔐 見られる人・ロール */
function PermsSection(props: { session: AdminSession; channel: GuildChannel; perm: ChannelPermView }) {
  const { perm, channel: c } = props;
  const isCat = c.type === 4;
  return (
    <section class="card perms">
      <h2>🔐 見られる人・ロール</h2>
      <p>
        <b>今見られる:</b>{' '}
        {perm.viewers.everyone ? (
          <span class="tag">みんな（@everyone）</span>
        ) : perm.viewers.roles.length ? (
          perm.viewers.roles.map((n) => <span class="tag gray">@{n}</span>)
        ) : (
          <span class="note">（ロールでは見られない。下の人だけ・管理者だけ）</span>
        )}
      </p>
      {perm.synced === true && <p class="note">📁 カテゴリと同期しています。ここで変えると、このチャンネルだけの設定になります（同期が外れます）。</p>}
      {perm.synced === false && <p class="note">📁 カテゴリとは別の設定です。</p>}
      <form method="post" action={`/channels/${c.id}/perms`}>
        <Csrf session={props.session} />
        <div class="table-wrap">
          <table class="perm-table">
            <thead>
              <tr>
                <th>ロール・人</th>
                {perm.keys.map((k) => (
                  <th>{PERM_LABEL[k]}</th>
                ))}
                <th>外す</th>
              </tr>
            </thead>
            <tbody>
              {perm.rows.map((r, i) => (
                <tr>
                  <td>
                    {r.name}
                    {r.locked && <small class="muted">（BOT・連携のロールはここでは変えない）</small>}
                    {!r.locked && (
                      <>
                        <input type="hidden" name={`ow.${i}.id`} value={r.id} />
                        <input type="hidden" name={`ow.${i}.type`} value={String(r.type)} />
                      </>
                    )}
                  </td>
                  {perm.keys.map((k) => (
                    <td>
                      <TriSelect name={`ow.${i}.${k}`} value={r.tris[k]} disabled={r.locked} />
                    </td>
                  ))}
                  <td>{!r.locked && <input type="checkbox" name={`ow.${i}.remove`} value="yes" aria-label="外す" />}</td>
                </tr>
              ))}
              <tr class="perm-new">
                <td>
                  <select name="new.role" aria-label="足すロール">
                    <option value="">＋ ロールを足す</option>
                    {perm.roles.map((r) => (
                      <option value={r.id}>@{r.name}</option>
                    ))}
                  </select>
                  <input type="text" name="new.member" maxlength={100} placeholder="＋ 人を足す（ID・名前）" aria-label="足す人" />
                </td>
                {perm.keys.map((k) => (
                  <td>
                    <TriSelect name={`new.${k}`} value={k === 'view' ? 'allow' : 'inherit'} />
                  </td>
                ))}
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <input type="hidden" name="rows" value={String(perm.rows.length)} />
        {isCat && perm.syncedChildren > 0 && (
          <label class="field check">
            <input type="checkbox" name="children" value="yes" checked />
            <span>同期している中のチャンネル（{perm.syncedChildren} 個）にも同じ変更をする</span>
          </label>
        )}
        <p class="note">
          ✅ 許可・⛔ 拒否・／ 決めない（{isCat ? 'ロールの権限' : 'カテゴリ・ロールの権限'}に従う）。人の設定はロールより強く、⛔ はほかのロールの ✅ より弱いことに気をつけてください（Discord の決まり）。「外す」にチェックすると、その行の設定を消します。
        </p>
        <button type="submit" class="ok">
          保存して Discord に反映
        </button>
      </form>
    </section>
  );
}

export function ChannelEditPage(props: {
  session: AdminSession;
  /** 見られる人・ロール */
  perm?: ChannelPermView;
  guildId: string;
  info: ChannelInfo;
  parent: GuildChannel | null;
  categories: GuildChannel[];
  /** カテゴリのとき: 中のチャンネル */
  children: ChannelInfo[];
  /** 同じ仲間の中で何番目か（1 から）・何個中 */
  place: { index: number; count: number };
  flash?: string;
}) {
  const { session, info, parent } = props;
  const c = info.channel;
  const isCat = c.type === 4;
  const isVoice = c.type === 2 || c.type === 13;
  const back = `/channels#${isCat ? 'cat' : 'ch'}-${c.id}`;
  return (
    <Layout title={`チャンネル: ${c.name}`} session={session} nav="channels">
      <p class="crumbs">
        <a href={back}>← チャンネル一覧</a>
        {parent && (
          <>
            {' '}
            / <a href={`/channels/${parent.id}`}>📁 {parent.name}</a>
          </>
        )}
      </p>
      <div class="page-head">
        <h1>
          <span class="ch-icon big" aria-hidden="true">
            {channelIcon(c)}
          </span>
          {c.name}
        </h1>
        <Tags info={info} />
        <a class="button-link" href={`https://discord.com/channels/${props.guildId}/${c.id}`} target="_blank" rel="noopener noreferrer">
          Discord で開く ↗
        </a>
      </div>
      <p class="note">
        {kindLabel(c)}
        {parent ? ` ・ 📁 ${parent.name} の中` : isCat ? '' : ' ・ カテゴリなし'}
      </p>
      <Flash code={props.flash} />

      <div class="ch-edit">
        <div>
          {!isCat && !isVoice && (
            <form method="post" action={`/channels/${c.id}`} class="card">
              <Csrf session={session} />
              <h2>基本</h2>
              <label class="field">
                <span>名前</span>
                <input type="text" name="name" value={c.name} maxlength={100} required />
                <small class="note">英字は小文字に、空白は「-」に Discord が変えます。</small>
              </label>
              <label class="field">
                <span>説明（チャンネルの上に出る・1024 文字まで）</span>
                <textarea name="topic" rows={4} maxlength={1024}>
                  {c.topic ?? ''}
                </textarea>
              </label>
              <fieldset class="field mode-pick">
                <legend>書き込み</legend>
                <label class="choice">
                  <input type="radio" name="mode" value="writable" checked={info.mode !== 'readonly'} />
                  <span>
                    <strong>✍ 書き込める</strong>
                    <small>みんながメッセージを送れる</small>
                  </span>
                </label>
                <label class="choice">
                  <input type="radio" name="mode" value="readonly" checked={info.mode === 'readonly'} />
                  <span>
                    <strong>👀 読むだけ</strong>
                    <small>リアクションだけ。神職・宮司と BOT は書ける</small>
                  </span>
                </label>
              </fieldset>
              <input type="hidden" name="nsfwField" value="1" />
              <label class="field check">
                <input type="checkbox" name="nsfw" value="yes" checked={Boolean(c.nsfw)} />
                <span>🔞 Discord の年齢制限（見るのに Discord の年齢確認が要る）</span>
              </label>
              <button type="submit" class="ok">
                保存
              </button>
            </form>
          )}
          {(isCat || isVoice) && (
            <form method="post" action={`/channels/${c.id}/name`} class="card">
              <Csrf session={session} />
              <h2>基本</h2>
              <label class="field">
                <span>名前</span>
                <input type="text" name="name" value={c.name} maxlength={100} required />
              </label>
              {isVoice && (
                <>
                  <label class="field">
                    <span>人数の上限（0 でなし・99 まで）</span>
                    <input type="number" name="userLimit" value={String(c.user_limit ?? 0)} min={0} max={99} />
                  </label>
                  <input type="hidden" name="ageGateField" value="1" />
                  <label class="field check">
                    <input type="checkbox" name="nsfw" value="yes" checked={Boolean(c.nsfw)} />
                    <span>🔞 Discord の年齢制限（見るのに Discord の年齢確認が要る）</span>
                  </label>
                </>
              )}
              <button type="submit" class="ok">
                保存
              </button>
            </form>
          )}

          {isCat && (
            <section class="card">
              <h2>中のチャンネル（{props.children.length}）</h2>
              {props.children.length ? (
                <ul class="ch-list">
                  {props.children.map((ch) => (
                    <li class="ch-row">
                      <span class="ch-icon" aria-hidden="true">
                        {channelIcon(ch.channel)}
                      </span>
                      <div class="ch-main">
                        <div class="ch-line">
                          <a class="ch-name" href={`/channels/${ch.channel.id}`}>
                            {ch.channel.name}
                          </a>
                          <Tags info={ch} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="note">まだありません。</p>
              )}
              <p>
                <a class="button-link" href={`/channels/new?parent=${c.id}`}>
                  ＋ このカテゴリに作る
                </a>
              </p>
            </section>
          )}
        </div>

        <div>
          <section class="card">
            <h2>場所と並び</h2>
            <p class="note">
              {isCat ? 'カテゴリの中で' : isVoice ? '同じカテゴリの通話の中で' : '同じカテゴリのテキストの中で'} {props.place.index} 番目（{props.place.count} 個中）
            </p>
            <UpDown session={session} channel={c} />
            {!isCat && (
              <form method="post" action={`/channels/${c.id}/move`} class="move-to">
                <Csrf session={session} />
                <label class="field">
                  <span>ほかのカテゴリへ移す</span>
                  <select name="parent" aria-label="移すカテゴリ">
                    <option value="none" selected={!c.parent_id}>
                      カテゴリなし
                    </option>
                    {props.categories.map((cat) => (
                      <option value={cat.id} selected={cat.id === c.parent_id}>
                        📁 {cat.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="field check">
                  <input type="checkbox" name="sync" value="yes" />
                  <span>移した先のカテゴリの見える範囲に合わせる</span>
                </label>
                <button type="submit">移す</button>
              </form>
            )}
          </section>

          <section class="card danger-zone">
            <h2>消す</h2>
            {info.inUse ? (
              <p class="note">🔒 BOT が使っているので消せません（{info.inUse}）。</p>
            ) : isCat && props.children.length ? (
              <p class="note">中にチャンネルがあるカテゴリは消せません。先に中のチャンネルを消すか、ほかのカテゴリへ移してください。</p>
            ) : (
              <form method="post" action={`/channels/${c.id}/delete`}>
                <Csrf session={session} />
                <p class="note">
                  中の書き込みも全部消えて、元に戻せません。消すなら、確認のため名前「<strong>{c.name}</strong>」をそのまま入力してください。
                </p>
                <div class="inline-actions">
                  <input type="text" name="confirmName" maxlength={100} required aria-label="確認のための名前" />
                  <button type="submit" class="danger">
                    消す
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
      {/* 表が横に広いので、2 列の下に横いっぱいで出す */}
      {props.perm && <PermsSection session={session} channel={c} perm={props.perm} />}
    </Layout>
  );
}

// ───────── 作る ─────────

const VISIBILITY_NOTE: Record<string, string> = {
  category: '入れるカテゴリと同じ人に見える（いちばんよく使う）',
  public: '入ったばかりで申請前の人にも見える',
  members: '入鯖が承認された人（参拝者以上）に見える',
  private: '下で選んだロールの人だけ',
  staff: '神職・宮司だけ',
  adult: '宵参りが承認された人だけ',
};

export function ChannelNewPage(props: { session: AdminSession; categories: GuildChannel[]; roles: GuildRole[]; parentId?: string; flash?: string }) {
  const { session } = props;
  return (
    <Layout title="チャンネルを作る" session={session} nav="channels">
      <p class="crumbs">
        <a href="/channels">← チャンネル一覧</a>
      </p>
      <h1>➕ チャンネルを作る</h1>
      <Flash code={props.flash} />
      <form method="post" action="/channels/new" class="card ch-create anchor" id="new-channel">
        <Csrf session={session} />
        <fieldset class="field kind-pick">
          <legend>種類</legend>
          <label class="choice">
            <input type="radio" name="kind" value="text" checked />
            <span>
              <strong># テキスト</strong>
              <small>文字で話す</small>
            </span>
          </label>
          <label class="choice">
            <input type="radio" name="kind" value="voice" />
            <span>
              <strong>🔊 通話</strong>
              <small>声で話す</small>
            </span>
          </label>
          <label class="choice">
            <input type="radio" name="kind" value="category" />
            <span>
              <strong>📁 カテゴリ</strong>
              <small>チャンネルをまとめる</small>
            </span>
          </label>
        </fieldset>
        <div class="fields">
          <label class="field">
            <span>名前</span>
            <input type="text" name="name" maxlength={100} required placeholder="例: 雑談" />
          </label>
          <label class="field only-in-category">
            <span>入れるカテゴリ</span>
            <select name="parent">
              <option value="">カテゴリなし（いちばん上）</option>
              {props.categories.map((c) => (
                <option value={c.id} selected={props.parentId === c.id}>
                  📁 {c.name}
                </option>
              ))}
            </select>
          </label>
          <label class="field only-text">
            <span>説明（任意・チャンネルの上に出る）</span>
            <input type="text" name="topic" maxlength={1024} />
          </label>
          <label class="field only-voice">
            <span>人数の上限（0 でなし・99 まで）</span>
            <input type="number" name="userLimit" value="0" min={0} max={99} />
          </label>
        </div>
        <fieldset class="field vis-pick">
          <legend>見える範囲</legend>
          {Object.entries(CHANNEL_VISIBILITY).map(([k, label]) => (
            <label class={`choice vis-${k}`}>
              <input type="radio" name="visibility" value={k} checked={k === 'category'} />
              <span>
                <strong>{label}</strong>
                <small>{VISIBILITY_NOTE[k]}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset class="field role-pick">
          <legend>見られるロール（プライベートのとき。神職・宮司と BOT はいつも見られます）</legend>
          <div class="role-checks">
            {props.roles.map((r) => (
              <label class="check">
                <input type="checkbox" name="roles" value={r.id} />
                <span>{r.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label class="field check only-text">
          <input type="checkbox" name="readOnly" value="yes" />
          <span>👀 読むだけにする（神職・宮司と BOT は書ける）</span>
        </label>
        <div class="inline-actions">
          <button type="submit" class="ok">
            作る
          </button>
          <a href="/channels">やめる</a>
        </div>
      </form>
    </Layout>
  );
}

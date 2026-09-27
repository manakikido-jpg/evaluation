import type { AdminSession } from '../../db/schema.js';
import type { GuildChannel, GuildRole } from '../../lib/discordRest.js';
import { CHANNEL_VISIBILITY, type ChannelMode } from '../../services/channels.js';
import { Layout } from './layout.js';

export const CHANNEL_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '保存しました。Discord に反映しました。', kind: 'ok' },
  unchanged: { text: '変わったところがありませんでした。', kind: 'ok' },
  invalid: {
    text: '入力を確かめてください（名前は 1〜100 文字、説明は 1024 文字まで）。',
    kind: 'warn',
  },
  failed: {
    text: 'Discord に反映できませんでした。BOT の「チャンネルの管理」「ロールの管理」権限を確かめてください。',
    kind: 'warn',
  },
  created: { text: 'チャンネルを作りました。', kind: 'ok' },
  moved: { text: '並びを変えました。Discord に反映しました。', kind: 'ok' },
  create_invalid: {
    text: '入力を確かめてください（名前は 1〜100 文字。「カテゴリと同じ」はカテゴリを選ぶ。「プライベート」はロールを 1 つ以上選ぶ）。',
    kind: 'warn',
  },
  deleted: { text: 'チャンネルを消しました。', kind: 'ok' },
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

/** Discord の年齢制限（見るのに Discord の年齢確認が要る） */
function AgeGate(props: { channel: GuildChannel }) {
  return (
    <label class="field check">
      <input type="checkbox" name="nsfw" value="yes" checked={Boolean(props.channel.nsfw)} />
      <span>🔞 Discord の年齢制限（見るのに Discord の年齢確認が要る）</span>
    </label>
  );
}

/** 消す（確認のため名前を入力。BOT が使っているものは出さない） */
function DeleteForm(props: { session: AdminSession; channel: GuildChannel; inUse?: string }) {
  if (props.inUse) return <p class="note">🔒 BOT が使っているので消せません（{props.inUse}）</p>;
  return (
    <details class="delete-channel">
      <summary>🗑 消す</summary>
      <form method="post" action={`/channels/${props.channel.id}/delete`} class="inline-actions">
        <input type="hidden" name="_csrf" value={props.session.csrfToken} />
        <span class="note">
          中の書き込みも全部消えて、元に戻せません。消すなら名前「
          {props.channel.name}」を入力:
        </span>
        <input type="text" name="confirmName" maxlength={100} required aria-label="確認のための名前" />
        <button type="submit" class="danger">
          消す
        </button>
      </form>
    </details>
  );
}

/** ▲▼ で入れ替える。カテゴリ以外は、ほかのカテゴリへ移せる */
function MoveForm(props: { session: AdminSession; channel: GuildChannel; categories: GuildChannel[] }) {
  const { channel } = props;
  return (
    <div class="inline-actions move-channel">
      <form method="post" action={`/channels/${channel.id}/move`} class="inline-actions">
        <input type="hidden" name="_csrf" value={props.session.csrfToken} />
        <button type="submit" name="dir" value="up" aria-label="1 つ上へ" title="1 つ上へ">
          ▲
        </button>
        <button type="submit" name="dir" value="down" aria-label="1 つ下へ" title="1 つ下へ">
          ▼
        </button>
      </form>
      {channel.type !== 4 && (
        <form method="post" action={`/channels/${channel.id}/move`} class="inline-actions">
          <input type="hidden" name="_csrf" value={props.session.csrfToken} />
          <select name="parent" aria-label="移すカテゴリ">
            <option value="none" selected={!channel.parent_id}>
              カテゴリなし
            </option>
            {props.categories.map((c) => (
              <option value={c.id} selected={c.id === channel.parent_id}>
                {c.name}
              </option>
            ))}
          </select>
          <label class="field check">
            <input type="checkbox" name="sync" value="yes" />
            <span>移した先の権限に合わせる</span>
          </label>
          <button type="submit">移す</button>
        </form>
      )}
    </div>
  );
}

/** 新しいチャンネル・カテゴリを作る */
function CreateForm(props: { session: AdminSession; categories: GuildChannel[]; roles: GuildRole[] }) {
  return (
    <form method="post" action="/channels/new" class="card anchor" id="new-channel">
      <input type="hidden" name="_csrf" value={props.session.csrfToken} />
      <h2>➕ チャンネルを作る</h2>
      <div class="fields">
        <label class="field">
          <span>種類</span>
          <select name="kind">
            <option value="text">💬 テキスト</option>
            <option value="voice">🔊 通話</option>
            <option value="category">📁 カテゴリ</option>
          </select>
        </label>
        <label class="field">
          <span>名前</span>
          <input type="text" name="name" maxlength={100} required />
        </label>
        <label class="field">
          <span>入れるカテゴリ（カテゴリを作るときは使わない）</span>
          <select name="parent">
            <option value="">カテゴリなし（いちばん上）</option>
            {props.categories.map((c) => (
              <option value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>説明（テキストのとき・任意）</span>
          <input type="text" name="topic" maxlength={1024} />
        </label>
        <label class="field">
          <span>人数の上限（通話のとき。0 でなし・99 まで）</span>
          <input type="number" name="userLimit" value="0" min={0} max={99} />
        </label>
      </div>
      <fieldset class="perms">
        <legend>見える範囲</legend>
        {Object.entries(CHANNEL_VISIBILITY).map(([k, label]) => (
          <label class="field check">
            <input type="radio" name="visibility" value={k} checked={k === 'category'} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset class="perms">
        <legend>プライベートのとき、見られるロール（神職・宮司と BOT はいつも見られます）</legend>
        {props.roles.map((r) => (
          <label class="field check">
            <input type="checkbox" name="roles" value={r.id} />
            <span>{r.name}</span>
          </label>
        ))}
      </fieldset>
      <div class="inline-actions">
        <label class="field check">
          <input type="checkbox" name="readOnly" value="yes" />
          <span>読むだけ（テキストのとき。神職・宮司と BOT は書ける）</span>
        </label>
        <button type="submit" class="ok">
          作る
        </button>
      </div>
    </form>
  );
}

/** 名前を変えるフォーム（カテゴリ・通話。通話は年齢制限も） */
function RenameForm(props: { session: AdminSession; channel: GuildChannel; label: string; ageGate?: boolean }) {
  return (
    <form method="post" action={`/channels/${props.channel.id}/name`} class="inline-actions rename">
      <input type="hidden" name="_csrf" value={props.session.csrfToken} />
      <span class="note">{props.label}</span>
      <input type="text" name="name" value={props.channel.name} maxlength={100} required aria-label={`${props.label}の名前`} />
      {props.ageGate && (
        <>
          <input type="hidden" name="ageGateField" value="1" />
          <AgeGate channel={props.channel} />
        </>
      )}
      {props.channel.type === 2 && (
        <label class="field inline">
          <span>人数の上限（0 でなし）</span>
          <input type="number" name="userLimit" value={String(props.channel.user_limit ?? 0)} min={0} max={99} aria-label="人数の上限" />
        </label>
      )}
      <button type="submit">保存</button>
    </form>
  );
}

export function ChannelsPage(props: {
  session: AdminSession;
  groups: {
    category: GuildChannel | null;
    items: { channel: GuildChannel; mode: ChannelMode }[];
    voice: GuildChannel[];
  }[];
  flash?: string;
  roles?: GuildRole[];
  inUse?: Map<string, string>;
}) {
  const { session } = props;
  const inUse = (id: string) => props.inUse?.get(id);
  const categories = props.groups.flatMap((g) => (g.category ? [g.category] : []));
  return (
    <Layout title="チャンネル" session={session} nav="channels">
      <h1>チャンネル</h1>
      <Flash code={props.flash} />
      <p class="note">
        チャンネル・カテゴリ・通話の名前、チャンネルの上に出る説明（トピック）、「書き込める／読むだけ」を変えられます。読むだけのチャンネルは、メッセージ・スレッドは送れず、リアクションだけ付けられます（神職・宮司と
        BOT は書けます）。見える範囲は変わりません。
      </p>
      <p class="note">
        🔞 Discord の年齢制限を付けると、見るのに Discord
        の年齢確認が要ります。宵宮は、宵参り申請を運営が承認した人だけが見られるので、年齢制限は付けなくて大丈夫です（その代わり、性的な画像・動画・露骨な話は出さないでください。出す部屋を作るなら、その部屋にだけ年齢制限を付けます）。
      </p>
      <p class="note">
        名前を変えても BOT は同じチャンネルとして扱います（ID で覚えているため）。テキストチャンネルの名前は、Discord が英字を小文字に、空白を「-」に変えます。掲示の{' '}
        <code>{'{#絵馬}'}</code> のようなリンクは、飾り（絵文字・記号）を除いて同じ名前なら見つかります。まったく別の名前にしたときは、掲示の <code>{'{#…}'}</code>{' '}
        も新しい名前に直してください。
      </p>
      <nav class="card toc" id="toc" aria-label="チャンネル一覧">
        <h2>一覧（押すとそこへ移動）</h2>
        {props.groups.map((g) => (
          <div class="toc-group">
            <a class="toc-cat" href={`#cat-${g.category?.id ?? 'none'}`}>
              {g.category ? g.category.name : 'カテゴリなし'}
            </a>
            <ul>
              {g.items.map(({ channel, mode }) => (
                <li>
                  <a href={`#ch-${channel.id}`}>
                    #{channel.name}
                    {mode === 'readonly' && <small> 読むだけ</small>}
                  </a>
                </li>
              ))}
              {g.voice.map((v) => (
                <li>
                  <a href={`#ch-${v.id}`}>
                    🔊 {v.name}
                    {v.user_limit ? <small> {v.user_limit} 人まで</small> : null}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <p>
        <a href="#new-channel">➕ チャンネルを作る</a>
      </p>
      {props.groups.map((g) => (
        <section class="card anchor" id={`cat-${g.category?.id ?? 'none'}`}>
          <h2 class="with-top">
            <span>{g.category ? g.category.name : 'カテゴリなし'}</span>
            <a href="#toc" class="to-top">
              ▲ 一覧へ
            </a>
          </h2>
          {g.category && <RenameForm session={session} channel={g.category} label="カテゴリ" />}
          {g.category && <MoveForm session={session} channel={g.category} categories={categories} />}
          {g.category && <DeleteForm session={session} channel={g.category} inUse={inUse(g.category.id)} />}
          <div class="shop-items">
            {g.items.map(({ channel, mode }) => (
              <div class="shop-item anchor" id={`ch-${channel.id}`}>
                <form method="post" action={`/channels/${channel.id}`}>
                  <input type="hidden" name="_csrf" value={session.csrfToken} />
                  <div class="shop-item-head">
                    <strong>#{channel.name}</strong>
                    <span class={`tag ${mode === 'readonly' ? 'gray' : 'green'}`}>{mode === 'readonly' ? '読むだけ' : '書き込める'}</span>
                  </div>
                  <label class="field">
                    <span>名前</span>
                    <input type="text" name="name" value={channel.name} maxlength={100} required />
                  </label>
                  <label class="field">
                    <span>説明（チャンネルの上に出る）</span>
                    <textarea name="topic" rows={2} maxlength={1024}>
                      {channel.topic ?? ''}
                    </textarea>
                  </label>
                  <input type="hidden" name="nsfwField" value="1" />
                  <AgeGate channel={channel} />
                  <div class="inline-actions">
                    <label class="field check">
                      <input type="radio" name="mode" value="writable" checked={mode === 'writable'} />
                      <span>書き込める</span>
                    </label>
                    <label class="field check">
                      <input type="radio" name="mode" value="readonly" checked={mode === 'readonly'} />
                      <span>読むだけ（リアクションは可）</span>
                    </label>
                    <button type="submit" class="ok">
                      保存
                    </button>
                  </div>
                </form>
                <MoveForm session={session} channel={channel} categories={categories} />
                <DeleteForm session={session} channel={channel} inUse={inUse(channel.id)} />
              </div>
            ))}
          </div>
          {g.voice.length > 0 && (
            <div class="voice-list">
              {g.voice.map((v) => (
                <div class="anchor" id={`ch-${v.id}`}>
                  <RenameForm session={session} channel={v} label="🔊 通話" ageGate />
                  <MoveForm session={session} channel={v} categories={categories} />
                  <DeleteForm session={session} channel={v} inUse={inUse(v.id)} />
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
      <CreateForm session={session} categories={props.groups.flatMap((g) => (g.category ? [g.category] : []))} roles={props.roles ?? []} />
    </Layout>
  );
}

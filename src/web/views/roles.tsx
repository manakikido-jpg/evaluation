import type { AdminSession, Member } from '../../db/schema.js';
import type { GuildRole } from '../../lib/discordRest.js';
import { dangerLabels, hasPerm, PERMISSION_GROUPS, permsOf } from '../../services/roles.js';
import { Avatar, Layout } from './layout.js';

export const ROLE_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '保存しました。Discord に反映しました。', kind: 'ok' },
  unchanged: { text: '変わったところがありませんでした。', kind: 'ok' },
  invalid: { text: '入力を確かめてください（名前は 1〜100 文字、色は #rrggbb）。', kind: 'warn' },
  need_confirm: { text: '「管理者」を付けるときは、確認のチェックを入れてください。', kind: 'warn' },
  locked: { text: 'このロールは BOT からは変えられません（BOT のロールより上・BOT などの自動のロール）。Discord のサーバー設定から変えてください。', kind: 'warn' },
  failed: { text: 'Discord に反映できませんでした。BOT の「ロールの管理」権限と、BOT のロールの位置を確かめてください。', kind: 'warn' },
  failed_some: { text: '一部のロールを Discord に反映できませんでした。BOT の「ロールの管理」権限と、BOT のロールの位置を確かめてください。', kind: 'warn' },
  need_confirm_all: { text: 'まとめて変えるときは、確認のチェックを入れてください。', kind: 'warn' },
  mentionable_on: { text: 'すべてのロールを、誰でも @ で呼べるようにしました（🔒 のロールはのぞく）。', kind: 'ok' },
  mentionable_off: { text: 'すべてのロールを、@ で呼べないようにしました（🔒 のロールはのぞく）。', kind: 'ok' },
  created: { text: 'ロールを作りました（いちばん下にできます。権限はここで付けてください）。', kind: 'ok' },
  deleted: { text: 'ロールを消しました。', kind: 'ok' },
  in_use: { text: 'このロールは BOT が使っているので消せません（役職・お守り・色守り・授与所の品物など）。', kind: 'warn' },
  confirm_name: { text: '消すときは、確認のためロールの名前をそのまま入力してください。', kind: 'warn' },
  nickname_locked: { text: '「ニックネームの変更」を外しました。これからは、メンバーは自分でニックネームを変えられません（運営がメンバーのページから変えられます）。', kind: 'ok' },
  invites_bot_only: { text: '「招待を作成」を外しました。これからは BOT の /招待リンク だけで招待できます。', kind: 'ok' },
};

function Flash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(ROLE_FLASH, props.code) ? ROLE_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/** ロールの色の丸（CSP で style 属性が使えないので SVG で） */
function Swatch(props: { color: number }) {
  return (
    <svg class="swatch-dot" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="6" fill={props.color ? hex(props.color) : '#99aab5'} />
    </svg>
  );
}

export type RoleRow = { role: GuildRole; kind?: string; members: number; locked: boolean };

export function RolesPage(props: { session: AdminSession; rows: RoleRow[]; flash?: string; loadFailed?: boolean }) {
  // @everyone は位置 0
  const editable = props.rows.filter((r) => !r.locked && r.role.position !== 0);
  const offCount = editable.filter((r) => !r.role.mentionable).length;
  // 「招待を作成」を持っているロール（@everyone を含む）
  const inviters = props.rows.filter((r) => !r.locked && (BigInt(r.role.permissions ?? '0') & 1n) !== 0n);
  // 「ニックネームの変更」を持っているロール
  const nicknamers = props.rows.filter((r) => !r.locked && (BigInt(r.role.permissions ?? '0') & (1n << 26n)) !== 0n);
  return (
    <Layout title="ロール" session={props.session} nav="roles">
      <div class="page-head">
        <h1>🎭 ロール</h1>
        <a class="button-link" href="/ranks">
          ⛩ 役職の設定 →
        </a>
        <a class="button-link primary" href="#new-role">
          ➕ ロールを作る
        </a>
      </div>
      <Flash code={props.flash} />
      {props.loadFailed && <p class="flash warn">Discord からロールを読めませんでした。時間をおいてもう一度開いてください。</p>}
      <p class="note">
        Discord のロール（上から順）と、持っている人数（今いる人・BOT を除く）、気をつける権限です。名前を押すと、権限の確認・変更と、持っている人の一覧が見られます。🔒 は BOT
        からは変えられないロールです（BOT のロールより上・BOT などの自動のロール）。
      </p>
      <details class="card tools">
        <summary>🧰 まとめて変える（@ で呼べる・招待リンク・ニックネーム）</summary>
        <div class="tool-list">
          <form method="post" action="/roles/mentionable-all" class="tool">
            <input type="hidden" name="_csrf" value={props.session.csrfToken} />
            <div>
              <strong>@ で呼べるようにする</strong>
              <p class="note">
                「誰でも @ で呼べる」にすると、メンバーが @ロール名 でそのロールの人全員に通知できます（今 @ で呼べないロール: {offCount} 個）。🔒 のロールと「みんな（@everyone）」は変えません。
              </p>
              <label class="field check">
                <input type="checkbox" name="confirm" value="yes" required />
                <span>すべてのロールをまとめて変える</span>
              </label>
            </div>
            <span class="inline-actions">
              <button type="submit" name="mentionable" value="on" class="ok">
                すべて @ で呼べるようにする
              </button>
              <button type="submit" name="mentionable" value="off">
                すべて @ で呼べないようにする
              </button>
            </span>
          </form>
          <form method="post" action="/roles/invites-bot-only" class="tool">
            <input type="hidden" name="_csrf" value={props.session.csrfToken} />
            <div>
              <strong>🔗 招待リンクは BOT だけ</strong>
              <p class="note">
                みんなとロールから「招待を作成」を外すと、メンバーは BOT の <code>/招待リンク</code> で自分専用のリンクをもらう形になります（だれの招待で入ったか分かります）。今「招待を作成」を持っているロール:{' '}
                {inviters.length ? inviters.map((r) => r.role.name).join('・') : 'なし'}。前に作られた招待リンクは、サーバー設定 →「招待」から消してください。
              </p>
              <label class="field check">
                <input type="checkbox" name="confirm" value="yes" required />
                <span>「招待を作成」を外す</span>
              </label>
            </div>
            <button type="submit" class="ok">
              招待リンクを BOT だけにする
            </button>
          </form>
          <form method="post" action="/roles/nickname-lock" class="tool">
            <input type="hidden" name="_csrf" value={props.session.csrfToken} />
            <div>
              <strong>🏷 ニックネームは自分で変えられないように</strong>
              <p class="note">
                みんなとロールから「ニックネームの変更」を外します。変えたいときは、運営がメンバーのページの「ニックネーム」から変えます。今「ニックネームの変更」を持っているロール:{' '}
                {nicknamers.length ? nicknamers.map((r) => r.role.name).join('・') : 'なし'}。
              </p>
              <label class="field check">
                <input type="checkbox" name="confirm" value="yes" required />
                <span>「ニックネームの変更」を外す</span>
              </label>
            </div>
            <button type="submit" class="ok">
              ニックネームを自分で変えられないようにする
            </button>
          </form>
        </div>
      </details>
      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">ロール</span>
          <span class="ch-count">{props.rows.length}</span>
        </div>
        <ul class="ch-list">
          {props.rows.map(({ role, kind, members, locked }) => {
            const danger = dangerLabels(permsOf(role));
            return (
              <li class="ch-row">
                <span class="ch-icon">
                  <Swatch color={role.color} />
                </span>
                <div class="ch-main">
                  <div class="ch-line">
                    <a class="ch-name" href={`/roles/${role.id}`} title={locked ? 'BOT からは変えられない' : undefined}>
                      {role.name}
                      {locked && ' 🔒'}
                    </a>
                    <span class="ch-tags">
                      {kind && <span class="tag bot">{kind}</span>}
                      {role.mentionable && <span class="tag green">@ で呼べる</span>}
                      {danger.map((d) => (
                        <span class="tag red">{d}</span>
                      ))}
                    </span>
                  </div>
                </div>
                <span class="ch-actions">
                  <span class="ch-count" title="持っている人">
                    👤 {members}
                  </span>
                  <a class="button-link small" href={`/roles/${role.id}`}>
                    開く
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <form method="post" action="/roles/new" class="card anchor" id="new-role">
        <input type="hidden" name="_csrf" value={props.session.csrfToken} />
        <h2>➕ ロールを作る</h2>
        <p class="note">いちばん下（@everyone のすぐ上）にできます。権限はなしで作るので、作ったあとに開くページで付けてください。並び順は Discord のサーバー設定 → ロールで変えられます。</p>
        <div class="fields">
          <label class="field">
            <span>名前</span>
            <input type="text" name="name" maxlength={100} required />
          </label>
          <label class="field">
            <span>色（名前の色）</span>
            <input type="color" name="color" value="#99aab5" />
          </label>
          <label class="field check">
            <input type="checkbox" name="noColor" value="yes" />
            <span>色なし</span>
          </label>
          <label class="field check">
            <input type="checkbox" name="hoist" value="yes" />
            <span>メンバー一覧で分けて表示</span>
          </label>
          <label class="field check">
            <input type="checkbox" name="mentionable" value="yes" checked />
            <span>誰でも @ で呼べる</span>
          </label>
        </div>
        <button type="submit" class="ok">
          作る
        </button>
      </form>
    </Layout>
  );
}

export function RolePage(props: {
  session: AdminSession;
  role: GuildRole;
  kind?: string;
  locked: boolean;
  /** BOT が使っているロール（消せない） */
  inUse?: boolean;
  isEveryone: boolean;
  members: Pick<Member, 'id' | 'displayName' | 'username' | 'avatarUrl'>[];
  flash?: string;
}) {
  const { session, role } = props;
  const bits = permsOf(role);
  const disabled = props.locked;
  return (
    <Layout title={`ロール: ${role.name}`} session={session} nav="roles">
      <p class="crumbs">
        <a href="/roles">← ロールの一覧</a>
      </p>
      <div class="page-head">
        <h1>
          <Swatch color={role.color} /> {role.name}
          {props.kind && <small> {props.kind}</small>}
        </h1>
      </div>
      <Flash code={props.flash} />
      {props.locked && <p class="flash warn">{ROLE_FLASH.locked!.text}</p>}
      <form method="post" action={`/roles/${role.id}`} class="card">
        <input type="hidden" name="_csrf" value={session.csrfToken} />
        {!props.isEveryone && (
          <div class="fields">
            <label class="field">
              <span>名前</span>
              <input type="text" name="name" value={role.name} maxlength={100} required disabled={disabled} />
            </label>
            <label class="field">
              <span>色（名前の色）</span>
              <input type="color" name="color" value={role.color ? hex(role.color) : '#000000'} disabled={disabled} />
            </label>
            <label class="field check">
              <input type="checkbox" name="noColor" value="yes" checked={!role.color} disabled={disabled} />
              <span>色なし</span>
            </label>
            <label class="field check">
              <input type="checkbox" name="hoist" value="yes" checked={Boolean(role.hoist)} disabled={disabled} />
              <span>メンバー一覧で分けて表示</span>
            </label>
            <label class="field check">
              <input type="checkbox" name="mentionable" value="yes" checked={Boolean(role.mentionable)} disabled={disabled} />
              <span>誰でも @ で呼べる</span>
            </label>
          </div>
        )}
        {props.isEveryone && <p class="note">「みんな（@everyone）」はサーバーの全員の基本の権限です。名前・色は変えられません。</p>}
        {PERMISSION_GROUPS.map((g) => (
          <fieldset class="perms">
            <legend>{g.title}</legend>
            {g.perms.map((p) => (
              <label class="field check">
                <input type="checkbox" name="perm" value={String(p.bit)} checked={hasPerm(bits, p.bit)} disabled={disabled} />
                <span>
                  {p.label}
                  {p.danger && <span class="tag red">注意</span>}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        {!disabled && (
          <>
            <label class="field check">
              <input type="checkbox" name="confirmAdmin" value="yes" />
              <span>「管理者」を付けるときはチェック（管理者はすべての権限を持ち、招待限定の部屋などにも入れます）</span>
            </label>
            <p class="note">チャンネルごとの権限（読むだけ・見える範囲など）は、ここではなく「チャンネル」ページやセットアップで決めています。</p>
            <button type="submit" class="ok">
              保存
            </button>
          </>
        )}
      </form>
      {!props.isEveryone && !props.locked && (
        <section class="card">
          <h2>🗑 ロールを消す</h2>
          {props.inUse ? (
            <p class="note">🔒 BOT が使っているので消せません（{props.kind ?? '授与所の品物'}）。</p>
          ) : (
            <form method="post" action={`/roles/${role.id}/delete`} class="inline-actions">
              <input type="hidden" name="_csrf" value={session.csrfToken} />
              <span class="note">持っている人からも外れて、元に戻せません。消すなら名前「{role.name}」を入力:</span>
              <input type="text" name="confirmName" maxlength={100} required aria-label="確認のための名前" />
              <button type="submit" class="danger">
                消す
              </button>
            </form>
          )}
        </section>
      )}
      <section class="card">
        <h2>このロールを持っている人（{props.members.length} 人）</h2>
        {props.members.length === 0 ? (
          <p class="empty">{props.isEveryone ? '全員が持っています。' : 'いません。'}</p>
        ) : (
          <ul class="role-members">
            {props.members.map((m) => (
              <li>
                <a class="who" href={`/members/${m.id}`}>
                  <Avatar url={m.avatarUrl} />
                  <span>
                    {m.displayName}
                    <small>@{m.username}</small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Layout>
  );
}

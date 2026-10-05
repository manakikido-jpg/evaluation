import type { AdminSession, Member } from '../../db/schema.js';
import type { GuildRole } from '../../lib/discordRest.js';
import { dangerLabels, hasPerm, PERMISSION_GROUPS, permsOf } from '../../services/roles.js';
import { bitLabels, bitList, TEMPLATE_MAX, type RoleTemplate } from '../../services/roleTemplates.js';
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
  members_added: { text: 'ロールを付けました。', kind: 'ok' },
  members_removed: { text: 'ロールを外しました。', kind: 'ok' },
  members_failed_some: { text: '一部の人にはできませんでした（抜けた人・BOT より上の運営など）。', kind: 'warn' },
  pick_members: { text: '人を選んでください。', kind: 'warn' },
  too_many_members: { text: '1 回に 50 人までです。分けてください。', kind: 'warn' },
  need_confirm_danger: { text: '注意の権限があるロールを付けるときは、確認のチェックを入れてください。', kind: 'warn' },
  template_saved: { text: '📋 今の権限をテンプレートにしました（同じ名前があれば上書き）。', kind: 'ok' },
  template_deleted: { text: '📋 テンプレートを消しました。', kind: 'ok' },
  template_invalid: { text: 'テンプレートの名前を 1〜40 文字で入れてください（はじめからあるものと同じ名前はつけられません）。', kind: 'warn' },
  template_too_many: { text: `テンプレートは ${TEMPLATE_MAX} 個までです。使わないものを消してください。`, kind: 'warn' },
  template_admin: { text: '「管理者」の入った権限はテンプレートにできません（作るときに付けると危ないため）。', kind: 'warn' },
};

/** テンプレートを選ぶ欄（option の value は key。data-bits に付く権限） */
function TemplateOptions(p: { templates: RoleTemplate[]; withNone?: boolean }) {
  const custom = p.templates.filter((t) => !t.builtin);
  return (
    <>
      {p.withNone && <option value="">使わない（権限なしで作る）</option>}
      <optgroup label="はじめからあるもの">
        {p.templates
          .filter((t) => t.builtin)
          .map((t) => (
            <option value={t.key} data-bits={bitList(t.bits)}>
              {t.name}
            </option>
          ))}
      </optgroup>
      {custom.length > 0 && (
        <optgroup label="作ったもの">
          {custom.map((t) => (
            <option value={t.key} data-bits={bitList(t.bits)}>
              📋 {t.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

/** ロールの一覧ページのテンプレートの一覧 */
function TemplateList(p: { templates: RoleTemplate[]; csrf: string }) {
  return (
    <section class="card anchor" id="role-templates">
      <h2>📋 権限のテンプレート</h2>
      <p class="note">
        ロールを作るとき・ロールのページで選ぶと、その権限にまとめてチェックが付きます。自分のテンプレートは、ロールのページの「今の権限をテンプレートにする」で作れます（{TEMPLATE_MAX} 個まで）。
      </p>
      <ul class="tpl-list">
        {p.templates.map((t) => {
          const labels = bitLabels(t.bits);
          return (
            <li>
              <div>
                <strong>{t.builtin ? t.name : `📋 ${t.name}`}</strong>
                {t.note && <span class="note"> {t.note}</span>}
                <details>
                  <summary class="note">付く権限（{labels.length}）</summary>
                  <p class="note">{labels.length ? labels.join('・') : 'なし'}</p>
                </details>
              </div>
              {!t.builtin && (
                <form method="post" action={`/roles/templates/${t.key.slice(2)}/delete`} class="inline-form">
                  <input type="hidden" name="_csrf" value={p.csrf} />
                  <button type="submit">消す</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Flash(props: { code?: string; n?: number }) {
  const f = props.code && Object.hasOwn(ROLE_FLASH, props.code) ? ROLE_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{props.n ? `${f.text}（${props.n} 人）` : f.text}</p> : null;
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

export function RolesPage(props: { session: AdminSession; rows: RoleRow[]; flash?: string; loadFailed?: boolean; templates?: RoleTemplate[] }) {
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
        <p class="note">いちばん下（@everyone のすぐ上）にできます。テンプレートを選ぶとその権限で、選ばなければ権限なしで作ります（あとから開くページで変えられます）。並び順は Discord のサーバー設定 → ロールで変えられます。</p>
        <div class="fields">
          <label class="field">
            <span>📋 権限のテンプレート</span>
            <select name="template">
              <TemplateOptions templates={props.templates ?? []} withNone />
            </select>
          </label>
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
      {props.templates && <TemplateList templates={props.templates} csrf={props.session.csrfToken} />}
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
  /** 付ける人を探した言葉と、見つかった人（まだ持っていない人） */
  q?: string;
  candidates?: Pick<Member, 'id' | 'displayName' | 'username' | 'avatarUrl'>[];
  /** 注意の権限（あれば付けるときに確認） */
  danger?: string[];
  templates?: RoleTemplate[];
  flash?: string;
  n?: number;
}) {
  const { session, role } = props;
  const canEdit = !props.isEveryone && !props.locked;
  const Csrf = () => <input type="hidden" name="_csrf" value={session.csrfToken} />;
  const Who = (p: { m: Pick<Member, 'id' | 'displayName' | 'username' | 'avatarUrl'> }) => (
    <span class="who">
      <Avatar url={p.m.avatarUrl} />
      <span>
        {p.m.displayName}
        <small>@{p.m.username}</small>
      </span>
    </span>
  );
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
      <Flash code={props.flash} n={props.n} />
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
        {!disabled && props.templates && (
          <div class="tpl-pick">
            <label class="field">
              <span>📋 テンプレートから選ぶ（下のチェックがまとめて変わります。保存するまで Discord は変わりません）</span>
              <span class="inline-actions">
                <select data-perm-template aria-label="権限のテンプレート">
                  <TemplateOptions templates={props.templates} />
                </select>
                <button type="button" data-perm-apply>
                  当てはめる
                </button>
              </span>
            </label>
            <p class="note" data-perm-applied hidden>
              テンプレートを当てはめました。確かめて「保存」を押すと Discord に入ります。
            </p>
          </div>
        )}
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
      {!props.locked && (
        <form method="post" action="/roles/templates" class="card anchor" id="role-template">
          <input type="hidden" name="_csrf" value={session.csrfToken} />
          <input type="hidden" name="roleId" value={role.id} />
          <h2>📋 今の権限をテンプレートにする</h2>
          <p class="note">保存してある今の権限（{bitLabels(bits).length} 個）を、名前をつけてテンプレートにします。ほかのロールを作るとき・直すときに選べます。同じ名前があれば上書きします。</p>
          <span class="inline-actions">
            <input type="text" name="name" maxlength={40} required placeholder="例: 配信者" aria-label="テンプレートの名前" />
            <button type="submit">テンプレートにする</button>
          </span>
        </form>
      )}
      {canEdit && (
        <section class="card anchor" id="role-add">
          <h2>➕ 人に付ける</h2>
          {props.kind && <p class="note">⚠ このロールは BOT も付けたり外したりします（{props.kind}）。ここで変えても、BOT が決まりに合わせて戻すことがあります。</p>}
          <form method="get" action={`/roles/${role.id}`} class="inline-actions">
            <input type="search" name="q" value={props.q ?? ''} maxlength={50} placeholder="名前・ユーザー名・ID" aria-label="付ける人を探す" />
            <button type="submit">探す</button>
          </form>
          {props.q &&
            (props.candidates?.length ? (
              <form method="post" action={`/roles/${role.id}/members/add`}>
                <Csrf />
                <ul class="role-members pick">
                  {props.candidates.map((m) => (
                    <li>
                      <label class="check">
                        <input type="checkbox" name="member" value={m.id} checked={props.candidates!.length === 1} />
                        <Who m={m} />
                      </label>
                    </li>
                  ))}
                </ul>
                {props.danger && props.danger.length > 0 && (
                  <label class="field check">
                    <input type="checkbox" name="confirmDanger" value="yes" />
                    <span>注意の権限（{props.danger.join('・')}）があるロールだと分かって付ける</span>
                  </label>
                )}
                <button type="submit" class="ok">
                  選んだ人に「{role.name}」を付ける
                </button>
                <p class="note">見つかったのは、まだこのロールを持っていない今いる人だけです（30 人まで。1 回に 50 人まで付けられます）。</p>
              </form>
            ) : (
              <p class="empty">「{props.q}」に合う人（まだこのロールを持っていない人）はいません。</p>
            ))}
        </section>
      )}
      <section class="card anchor" id="role-members">
        <h2>このロールを持っている人（{props.members.length} 人）</h2>
        {props.members.length === 0 ? (
          <p class="empty">{props.isEveryone ? '全員が持っています。' : 'いません。'}</p>
        ) : canEdit ? (
          <form method="post" action={`/roles/${role.id}/members/remove`}>
            <Csrf />
            <ul class="role-members pick">
              {props.members.map((m) => (
                <li>
                  <label class="check">
                    <input type="checkbox" name="member" value={m.id} />
                    <Who m={m} />
                  </label>
                  <a class="role-member-open" href={`/members/${m.id}`} title="メンバーのページ">
                    開く
                  </a>
                </li>
              ))}
            </ul>
            <button type="submit" class="danger">
              選んだ人から「{role.name}」を外す
            </button>
          </form>
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
    </Layout>
  );
}

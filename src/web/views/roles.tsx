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
  return (
    <Layout title="ロール" session={props.session} nav="roles">
      <h1>ロール</h1>
      <Flash code={props.flash} />
      {props.loadFailed && <p class="flash warn">Discord からロールを読めませんでした。時間をおいてもう一度開いてください。</p>}
      <p class="note">
        Discord のロールと、持っている人数（今いる人・BOT を除く）、気をつける権限です。名前を押すと、権限の確認・変更と、持っている人の一覧が見られます。🔒 は BOT
        からは変えられないロールです（BOT のロールより上・BOT などの自動のロール）。
      </p>
      <form method="post" action="/roles/mentionable-all" class="card">
        <input type="hidden" name="_csrf" value={props.session.csrfToken} />
        <h2>@ で呼べるようにする</h2>
        <p class="note">
          ロールを「誰でも @ で呼べる」にすると、メンバーが @ロール名 でそのロールの人全員に通知できます（今 @ で呼べないロール: {offCount} 個）。🔒 のロールと「みんな（@everyone）」は変えません。1 つずつ変えるときは、ロールの名前を押してください。
        </p>
        <label class="field check">
          <input type="checkbox" name="confirm" value="yes" required />
          <span>すべてのロールをまとめて変える</span>
        </label>
        <div class="actions">
          <button type="submit" name="mentionable" value="on" class="ok">
            すべて @ で呼べるようにする
          </button>
          <button type="submit" name="mentionable" value="off">
            すべて @ で呼べないようにする
          </button>
        </div>
      </form>
      <div class="table-wrap">
        <table class="members roles">
          <thead>
            <tr>
              <th>ロール</th>
              <th>このサーバーでの役目</th>
              <th>@</th>
              <th class="num">人数</th>
              <th>気をつける権限</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map(({ role, kind, members, locked }) => {
              const danger = dangerLabels(permsOf(role));
              return (
                <tr>
                  <td>
                    <a href={`/roles/${role.id}`} class="who">
                      <Swatch color={role.color} />
                      <span>
                        {role.name}
                        {locked && ' 🔒'}
                      </span>
                    </a>
                  </td>
                  <td>{kind ?? <small>—</small>}</td>
                  <td>{role.mentionable ? '✅' : <small>—</small>}</td>
                  <td class="num">{members}</td>
                  <td class="wrap">
                    {danger.map((d) => (
                      <span class="tag red">{d}</span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

export function RolePage(props: {
  session: AdminSession;
  role: GuildRole;
  kind?: string;
  locked: boolean;
  isEveryone: boolean;
  members: Pick<Member, 'id' | 'displayName' | 'username' | 'avatarUrl'>[];
  flash?: string;
}) {
  const { session, role } = props;
  const bits = permsOf(role);
  const disabled = props.locked;
  return (
    <Layout title={`ロール: ${role.name}`} session={session} nav="roles">
      <p>
        <a href="/roles">← ロールの一覧</a>
      </p>
      <h1>
        <Swatch color={role.color} /> {role.name}
        {props.kind && <small> {props.kind}</small>}
      </h1>
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

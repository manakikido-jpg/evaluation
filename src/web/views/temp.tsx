import type { AdminSession, TempGrant } from '../../db/schema.js';
import { DURATIONS, PERM_PRESETS, isPermPreset, jstShort, remaining } from '../../services/tempGrants.js';
import { Layout } from './layout.js';

export const TEMP_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  granted: { text: '付けました。期限が来たら BOT が外します。', kind: 'ok' },
  extended: { text: '期限をのばしました。', kind: 'ok' },
  revoked: { text: '外しました（チャンネルの権限は付ける前に戻しました）。', kind: 'ok' },
  invalid: { text: '相手・付けるもの・期間を選んでください。', kind: 'warn' },
  no_member: { text: 'その名前・ID の人が見つかりませんでした（同じ名前の人が何人かいるときは ID で入れてください）。', kind: 'warn' },
  self: { text: '自分には付けられません。', kind: 'warn' },
  guji_only: { text: '危ない権限を持つロール・運営のロールを付けられるのは宮司だけです。', kind: 'warn' },
  locked: { text: 'このロールは BOT からは付けられません（BOT のロールより上か、自動のロール）。', kind: 'warn' },
  already: { text: 'その方はもうこのロールを持っています（一時的なものではありません）。', kind: 'warn' },
  not_found: { text: 'ロールかチャンネルが見つかりませんでした。', kind: 'warn' },
  failed: { text: 'Discord に反映できませんでした。BOT の「ロールの管理」「チャンネルの管理」の権限を確かめてください。', kind: 'warn' },
  ended_already: { text: 'もう外れていました。', kind: 'ok' },
};

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

type Lookup = { member: (id: string) => string; role: (id: string) => string; channel: (id: string) => string };

const what = (g: TempGrant, l: Lookup) => (g.kind === 'role' ? `🎭 ${l.role(g.roleId ?? '')}` : `#${l.channel(g.channelId ?? '')} の ${isPermPreset(g.preset) ? PERM_PRESETS[g.preset].label : g.preset}`);
const END_LABEL: Record<string, string> = { expired: '⌛ 期限', revoked: '⏹ 手で外した', permanent: '♾ 期限なしにした' };

export function TempPage(props: {
  session: AdminSession;
  active: TempGrant[];
  ended: TempGrant[];
  lookup: Lookup;
  /** 付けられるロール（guji = 宮司だけ付けられる） */
  roles: { id: string; name: string; guji: boolean }[];
  channels: { id: string; name: string; category: string | null; voice: boolean }[];
  members: { id: string; name: string }[];
  prefillMember?: string;
  flash?: string;
  now: Date;
}) {
  const { session, lookup: l } = props;
  const guji = session.level === 'guji';
  const f = props.flash && Object.hasOwn(TEMP_FLASH, props.flash) ? TEMP_FLASH[props.flash] : undefined;
  return (
    <Layout title="一時的な権限" session={session} nav="temp">
      <div class="page-head">
        <h1>⏳ 一時的なロール・権限</h1>
        <a class="button-link primary" href="#temp-give">
          ＋ 付ける
        </a>
      </div>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        ロールやチャンネルの権限を、期限つきで付けます。期限が来たら BOT が外し、チャンネルの権限は付ける前の状態に戻します。Discord でも <code>/一時ロール</code> <code>/一時権限</code> で同じことができます。付けた・外したことは #記録 にも出ます。
      </p>

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">⏳ いま付いているもの</span>
          <span class="ch-count">{props.active.length}</span>
        </div>
        {props.active.length ? (
          <ul class="ch-list">
            {props.active.map((g) => (
              <li class="ch-row temp-row">
                <span class="ch-icon" aria-hidden="true">
                  {g.kind === 'role' ? '🎭' : g.preset === 'mute' ? '🔇' : '#'}
                </span>
                <div class="ch-main">
                  <div class="ch-line">
                    <a class="ch-name" href={`/members/${g.memberId}`}>
                      {l.member(g.memberId)}
                    </a>
                    <span>{what(g, l)}</span>
                    <span class={`tag ${g.expiresAt.getTime() - props.now.getTime() < 3_600_000 ? 'red' : 'gray'}`}>{remaining(g.expiresAt, props.now)}</span>
                  </div>
                  <div class="ch-topic">
                    {jstShort(g.expiresAt)} まで ・ 付けた人 {l.member(g.grantedBy)}
                    {g.reason ? ` ・ ${g.reason}` : ''}
                  </div>
                </div>
                <span class="ch-actions">
                  <form method="post" action={`/temp/${g.id}/extend`} class="row-actions">
                    <Csrf session={session} />
                    <select name="for" aria-label="のばす時間">
                      {DURATIONS.filter(([k]) => ['1h', '1d', '7d'].includes(k)).map(([k, label]) => (
                        <option value={k}>＋{label}</option>
                      ))}
                    </select>
                    <button type="submit">のばす</button>
                  </form>
                  <form method="post" action={`/temp/${g.id}/revoke`} class="row-actions">
                    <Csrf session={session} />
                    <button type="submit" class="danger">
                      今すぐ外す
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="note ch-empty">いま一時的に付いているものはありません。</p>
        )}
      </section>

      <form method="post" action="/temp" class="card anchor temp-give" id="temp-give">
        <Csrf session={session} />
        <h2>＋ 付ける</h2>
        <div class="fields">
          <label class="field">
            <span>相手（名前か ID）</span>
            <input type="text" name="member" list="temp-members" value={props.prefillMember ?? ''} required autocomplete="off" placeholder="名前を入れると候補が出ます" />
            <datalist id="temp-members">
              {props.members.map((m) => (
                <option value={m.name}>{m.id}</option>
              ))}
            </datalist>
          </label>
          <label class="field">
            <span>期間</span>
            <select name="for" required>
              {DURATIONS.map(([k, label]) => (
                <option value={k} selected={k === '1h'}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>理由（記録に残る・本人への DM にも書く）</span>
            <input type="text" name="reason" maxlength={200} />
          </label>
        </div>
        <fieldset class="field kind-pick">
          <legend>付けるもの</legend>
          <label class="choice">
            <input type="radio" name="kind" value="role" checked />
            <span>
              <strong>🎭 ロール</strong>
              <small>期限つきでロールを付ける</small>
            </span>
          </label>
          <label class="choice">
            <input type="radio" name="kind" value="perm" />
            <span>
              <strong># チャンネルの権限</strong>
              <small>そのチャンネルでだけ、書ける・見られる・話せる・書き込み禁止 など</small>
            </span>
          </label>
        </fieldset>
        <div class="fields only-role">
          <label class="field">
            <span>ロール</span>
            <select name="roleId">
              <option value="">（ロールを選ぶ）</option>
              {props.roles.map((r) => (
                <option value={r.id} disabled={r.guji && !guji}>
                  {r.name}
                  {r.guji ? '（宮司だけ）' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div class="only-perm">
          <div class="fields">
            <label class="field">
              <span>チャンネル</span>
              <select name="channelId">
                <option value="">（チャンネルを選ぶ）</option>
                {props.channels.map((c) => (
                  <option value={c.id}>
                    {c.category ? `${c.category} / ` : ''}
                    {c.voice ? '🔊 ' : '#'}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset class="field vis-pick">
            <legend>権限</legend>
            {Object.entries(PERM_PRESETS).map(([k, p]) => (
              <label class="choice">
                <input type="radio" name="preset" value={k} checked={k === 'write'} />
                <span>
                  <strong>{p.label}</strong>
                  <small>{p.note}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        <div class="inline-actions">
          <button type="submit" class="ok">
            付ける
          </button>
        </div>
      </form>

      <section class="card">
        <h2>これまで（新しい順）</h2>
        {props.ended.length ? (
          <div class="table-wrap">
            <table class="compact">
              <thead>
                <tr>
                  <th>相手</th>
                  <th>付けたもの</th>
                  <th>付けた</th>
                  <th>外れた</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                {props.ended.map((g) => (
                  <tr>
                    <td>
                      <a href={`/members/${g.memberId}`}>{l.member(g.memberId)}</a>
                    </td>
                    <td>{what(g, l)}</td>
                    <td class="nowrap">
                      {jstShort(g.grantedAt)}
                      <small> {l.member(g.grantedBy)}</small>
                    </td>
                    <td class="nowrap">
                      {g.endedAt ? jstShort(g.endedAt) : '—'}
                      <small> {END_LABEL[g.endReason ?? ''] ?? g.endReason}</small>
                    </td>
                    <td class="wrap">{g.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p class="note">まだありません。</p>
        )}
      </section>
    </Layout>
  );
}

import type { AdminSession, Invite, InviteLink } from '../../db/schema.js';
import type { GuildInvite } from '../../lib/discordRest.js';
import { SHARED_INVITER } from '../../services/invites.js';
import { jstShort, remaining } from '../../services/tempGrants.js';
import { Layout } from './layout.js';

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

export const INVITES_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  deleted: { text: '招待リンクを消しました（もう使えません）。', kind: 'ok' },
  failed: { text: '消せませんでした。BOT に「サーバーの管理」か、そのチャンネルの「チャンネルの管理」の権限があるか確かめてください。', kind: 'warn' },
  invalid: { text: 'リンクが見つかりませんでした。', kind: 'warn' },
};

/** 人が作ったリンクの期限（「あと 3 日」・「期限なし」） */
function expiryOf(i: GuildInvite, now: Date): { text: string; limited: boolean } {
  if (!i.max_age || !i.created_at) return { text: '期限なし', limited: false };
  const until = new Date(new Date(i.created_at).getTime() + i.max_age * 1000);
  return { text: `${jstShort(until)} まで（${remaining(until, now)}）`, limited: true };
}

function DeleteButton(props: { session: AdminSession; code: string; label?: string }) {
  return (
    <form method="post" action={`/invites/${encodeURIComponent(props.code)}/delete`} class="row-actions">
      <Csrf session={props.session} />
      <button type="submit" class="danger">
        {props.label ?? '消す'}
      </button>
    </form>
  );
}

export function InvitesPage(props: {
  session: AdminSession;
  joins: Invite[];
  links: InviteLink[];
  /** Discord にある、BOT 以外が作ったリンク（読めなければ null） */
  others: GuildInvite[] | null;
  /** Discord の今の使われた回数（読めたときだけ） */
  uses: Map<string, number>;
  name: (id: string) => string;
  flash?: string;
  now: Date;
}) {
  const { session, name } = props;
  const f = props.flash && Object.hasOwn(INVITES_FLASH, props.flash) ? INVITES_FLASH[props.flash] : undefined;
  const memberLinks = props.links.filter((l) => l.inviterId !== SHARED_INVITER);
  const shared = props.links.filter((l) => l.inviterId === SHARED_INVITER);
  const joinedBy = new Map<string, number>();
  for (const j of props.joins) joinedBy.set(j.inviterId, (joinedBy.get(j.inviterId) ?? 0) + 1);
  const usesOf = (l: InviteLink) => props.uses.get(l.code) ?? l.uses;
  const limited = (props.others ?? []).filter((i) => i.max_age);
  return (
    <Layout title="招待" session={session} nav="invites">
      <div class="page-head">
        <h1>🔗 招待</h1>
      </div>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        だれの招待リンクか・だれがだれを招待したかを見るページです。Discord の <b>サーバー設定 →「招待」</b> では、BOT が作ったリンク（<code>/招待リンク</code>・<code>/共通招待リンク</code>）は招待した人がすべて「BOT」と出ます（Discord の決まりで変えられません）。
        だれのリンクかは、ここでコード（<code>discord.gg/</code> のあと）を見比べてください。BOT が作るリンクはすべて期限なしです。
      </p>
      {limited.length > 0 && (
        <p class="flash warn">
          期限が付いているリンクが {limited.length} 個あります。これは Discord の「招待」ボタンで人が作ったもので、だれの招待かは記録されません（下の「人が作ったリンク」から消せます）。
          {session.level === 'guji' ? (
            <>
              これから人が作れないようにするには、<a href="/roles">ロール</a> の「招待リンクを BOT だけにする」を押してください。
            </>
          ) : (
            '人が作れないようにするのは、宮司が「ロール」のページからできます。'
          )}
        </p>
      )}

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">🤝 だれがだれを招待したか</span>
          <span class="ch-count">{props.joins.length}</span>
          <span class="note">新しい順（200 人まで）</span>
        </div>
        {props.joins.length ? (
          <ul class="ch-list">
            {props.joins.map((j) => (
              <li class="ch-row">
                <span class="ch-icon" aria-hidden="true">
                  🤝
                </span>
                <div class="ch-main">
                  <div class="ch-line">
                    <a class="ch-name" href={`/members/${j.inviterId}`}>
                      {name(j.inviterId)}
                    </a>
                    <span>→</span>
                    <a href={`/members/${j.memberId}`}>{name(j.memberId)}</a>
                    <span class={`tag ${j.source === 'link' ? 'green' : 'gray'}`}>{j.source === 'link' ? '招待リンクで入った' : '申請で選んだ'}</span>
                    {j.rewardedAt ? <span class="tag gray">お礼済み</span> : <span class="tag gray">まだ参拝者でない</span>}
                  </div>
                  <div class="ch-topic">{jstShort(j.createdAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p class="note ch-empty">まだ記録がありません。</p>
        )}
      </section>

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">👤 メンバーの招待リンク</span>
          <span class="ch-count">{memberLinks.length}</span>
          <span class="note">
            <code>/招待リンク</code> で作ったもの（1 人 1 つ・期限なし）
          </span>
        </div>
        {memberLinks.length ? (
          <ul class="ch-list">
            {memberLinks.map((l) => (
              <li class="ch-row">
                <span class="ch-icon" aria-hidden="true">
                  🔗
                </span>
                <div class="ch-main">
                  <div class="ch-line">
                    <a class="ch-name" href={`/members/${l.inviterId}`}>
                      {name(l.inviterId)}
                    </a>
                    <code>discord.gg/{l.code}</code>
                    <span class="tag gray">使われた {usesOf(l)} 回</span>
                    <span class="tag green">招待した人 {joinedBy.get(l.inviterId) ?? 0} 人</span>
                  </div>
                  <div class="ch-topic">{jstShort(l.createdAt)} に作った ・ 期限なし</div>
                </div>
                <span class="ch-actions">
                  <DeleteButton session={session} code={l.code} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="note ch-empty">まだありません。</p>
        )}
      </section>

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">📣 共通の招待リンク</span>
          <span class="ch-count">{shared.length}</span>
          <span class="note">
            <code>/共通招待リンク 作る</code> で作ったもの（SNS・宣伝用。だれの招待にもならない）
          </span>
        </div>
        {shared.length ? (
          <ul class="ch-list">
            {shared.map((l) => (
              <li class="ch-row">
                <span class="ch-icon" aria-hidden="true">
                  📣
                </span>
                <div class="ch-main">
                  <div class="ch-line">
                    <span class="ch-name">{l.label ? `「${l.label}」` : '（名前なし）'}</span>
                    <code>discord.gg/{l.code}</code>
                    <span class="tag gray">使われた {usesOf(l)} 回</span>
                  </div>
                  <div class="ch-topic">
                    {jstShort(l.createdAt)} に作った{l.createdBy ? ` ・ 作った人 ${name(l.createdBy)}` : ''} ・ 期限なし
                  </div>
                </div>
                <span class="ch-actions">
                  <DeleteButton session={session} code={l.code} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="note ch-empty">まだありません。</p>
        )}
      </section>

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">⚠ 人が作ったリンク</span>
          <span class="ch-count">{props.others?.length ?? '?'}</span>
          <span class="note">Discord の「招待」ボタンで作られたもの。だれの招待かは記録されません</span>
        </div>
        {props.others === null ? (
          <p class="note ch-empty">Discord から読めませんでした（BOT に「サーバーの管理」の権限が要ります）。Discord のサーバー設定 →「招待」で見てください。</p>
        ) : props.others.length ? (
          <ul class="ch-list">
            {props.others.map((i) => {
              const e = expiryOf(i, props.now);
              const who = i.inviter ? i.inviter.global_name || i.inviter.username : '（不明）';
              return (
                <li class="ch-row">
                  <span class="ch-icon" aria-hidden="true">
                    ⚠
                  </span>
                  <div class="ch-main">
                    <div class="ch-line">
                      {i.inviter ? (
                        <a class="ch-name" href={`/members/${i.inviter.id}`}>
                          {who}
                        </a>
                      ) : (
                        <span class="ch-name">{who}</span>
                      )}
                      <code>discord.gg/{i.code}</code>
                      <span class="tag gray">使われた {i.uses ?? 0} 回</span>
                      <span class={`tag ${e.limited ? 'red' : 'gray'}`}>{e.text}</span>
                    </div>
                    <div class="ch-topic">
                      {i.channel ? `#${i.channel.name}` : ''}
                      {i.created_at ? ` ・ ${jstShort(new Date(i.created_at))} に作った` : ''}
                      {i.max_uses ? ` ・ ${i.max_uses} 回まで` : ''}
                    </div>
                  </div>
                  <span class="ch-actions">
                    <DeleteButton session={session} code={i.code} />
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p class="note ch-empty">ありません（招待リンクはすべて BOT が作ったものです）。</p>
        )}
      </section>
    </Layout>
  );
}

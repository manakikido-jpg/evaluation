import type { GuildConfig } from '../../config.js';
import { highestRank } from '../../domain/ranks.js';
import type { InviteRewardRow } from '../../services/invites.js';
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
  rewards: InviteRewardRow[];
  cfg: GuildConfig;
  filter: 'all' | 'unknown' | 'waiting' | 'paid';
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
  const shown = props.rewards.filter(
    (r) =>
      props.filter === 'all' ||
      (props.filter === 'unknown' ? !r.inviterId : props.filter === 'paid' ? !!r.rewardedAt && !!r.ujikoRewardedAt : !!r.inviterId && (!r.rewardedAt || !r.ujikoRewardedAt)),
  );
  const totals = new Map<string, { invited: number; paid: number; waiting: number }>();
  for (const r of props.rewards)
    if (r.inviterId) {
      const v = totals.get(r.inviterId) ?? { invited: 0, paid: 0, waiting: 0 };
      v.invited++;
      v.paid += r.reward + r.ujikoReward;
      if (!r.rewardedAt || !r.ujikoRewardedAt) v.waiting++;
      totals.set(r.inviterId, v);
    }
  const status = (r: InviteRewardRow, stage: 'sanpaisha' | 'ujiko') => {
    const at = stage === 'sanpaisha' ? r.rewardedAt : r.ujikoRewardedAt;
    const amount = stage === 'sanpaisha' ? r.reward : r.ujikoReward;
    if (at)
      return (
        <>
          <span class="tag green">{r.legacyReward && (amount > 0 || (stage === 'ujiko' && r.reward >= 500)) ? '旧制度で支払済み' : amount > 0 ? '支払済み' : '報酬なし'}</span>
          <div class="note">
            {amount.toLocaleString('ja-JP')}
            {props.cfg.economy.currencyName} · {jstShort(at)}
          </div>
        </>
      );
    if (!r.inviterId) return <span class="tag gray">要確認・招待元不明</span>;
    if (r.leftAt) return <span class="tag gray">退出</span>;
    const rank = props.cfg.ranks.find((v) => v.key === stage && v.auto);
    const current = highestRank(
      props.cfg.ranks.filter((v) => v.auto),
      r.roleIds,
    );
    return <span class="tag gray">{rank && current && current.requiredGoen >= rank.requiredGoen ? '未払い・要確認' : '昇格待ち'}</span>;
  };

  return (
    <Layout title="招待" session={session} nav="invites">
      <div class="page-head">
        <h1>🔗 招待</h1>
      </div>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        だれの招待リンクか・だれがだれを招待したかを見るページです。Discord の <b>サーバー設定 →「招待」</b> では、BOT が作ったリンク（<code>/招待リンク</code>・
        <code>/共通招待リンク</code>）は招待した人がすべて「BOT」と出ます（Discord の決まりで変えられません）。 だれのリンクかは、ここでコード（<code>discord.gg/</code>{' '}
        のあと）を見比べてください。BOT が作るリンクはすべて期限なしです。
      </p>
      {limited.length > 0 && (
        <p class="flash warn">
          期限が付いているリンクが {limited.length} 個あります。これは Discord
          の「招待」ボタンで人が作ったもので、だれの招待かは記録されません（下の「人が作ったリンク」から消せます）。
          {session.level === 'guji' ? (
            <>
              これから人が作れないようにするには、<a href="/roles">ロール</a> の「招待リンクを BOT だけにする」を押してください。
            </>
          ) : (
            '人が作れないようにするのは、宮司が「ロール」のページからできます。'
          )}
        </p>
      )}

      <nav class="tabs" aria-label="招待管理の項目">
        <a href="#invite-rewards">参加者・報酬</a>
        <a href="#invite-inviters">招待した人</a>
        <a href="#invite-links">招待リンク</a>
      </nav>
      <section class="card" id="invite-rewards">
        <h2>参加者・報酬</h2>
        <p>
          🔰参拝者で {props.cfg.economy.inviteSanpaishaReward}
          {props.cfg.economy.currencyName}、🍃氏子で追加 {props.cfg.economy.inviteUjikoReward}
          {props.cfg.economy.currencyName}。各段階1人1回です。
        </p>
        <p class="note">新しい順・最大200人。以下の集計は表示対象の記録だけです。招待元が不明な人には自動で払いません。</p>
        <p>
          招待元不明 {props.rewards.filter((r) => !r.inviterId).length}人 · 両段階完了 {props.rewards.filter((r) => r.rewardedAt && r.ujikoRewardedAt).length}人 · 支払額{' '}
          {props.rewards.reduce((sum, r) => sum + r.reward + r.ujikoReward, 0).toLocaleString('ja-JP')}
          {props.cfg.economy.currencyName}
        </p>
        <nav class="tabs" aria-label="報酬の絞り込み">
          {(
            [
              ['all', 'すべて'],
              ['unknown', '招待元不明'],
              ['waiting', '段階待ち・未払い'],
              ['paid', '両段階完了'],
            ] as const
          ).map(([key, text]) => (
            <a class={props.filter === key ? 'on' : undefined} href={`/invites?filter=${key}#invite-rewards`} aria-current={props.filter === key ? 'page' : undefined}>
              {text}
            </a>
          ))}
        </nav>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>招待された人</th>
                <th>招待した人</th>
                <th>今の役職</th>
                <th>参拝者の報酬</th>
                <th>氏子の報酬</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr>
                  <td>
                    <a href={`/members/${r.memberId}`}>{name(r.memberId)}</a>
                    <div class="note">{jstShort(r.createdAt)}</div>
                  </td>
                  <td>
                    {r.inviterId ? <a href={`/members/${r.inviterId}`}>{name(r.inviterId)}</a> : '不明'}
                    <div class="note">{r.source === 'link' ? '招待リンクで入った' : r.source === 'answer' ? '申請で選んだ' : '招待元の記録なし'}</div>
                  </td>
                  <td>{r.leftAt ? '退出' : (highestRank(props.cfg.ranks, r.roleIds)?.name ?? '役職待ち')}</td>
                  <td>{status(r, 'sanpaisha')}</td>
                  <td>{status(r, 'ujiko')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length && <p class="note">該当する記録はありません。</p>}
        <p class="note">旧制度で500銭以上を支払った分は、両段階の支払済みとして扱います。氏子の欄の0銭は追加の支払いがないことを表します。</p>
      </section>
      <section class="card" id="invite-inviters">
        <h2>招待した人</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>招待した人</th>
                <th>招待人数</th>
                <th>段階待ち・未払い</th>
                <th>支払額</th>
              </tr>
            </thead>
            <tbody>
              {[...totals]
                .sort((a, b) => b[1].invited - a[1].invited)
                .map(([id, v]) => (
                  <tr>
                    <td>
                      <a href={`/members/${id}`}>{name(id)}</a>
                    </td>
                    <td>{v.invited}人</td>
                    <td>{v.waiting}人</td>
                    <td>
                      {v.paid.toLocaleString('ja-JP')}
                      {props.cfg.economy.currencyName}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <h2 id="invite-links">招待リンク</h2>
      <p class="note">リンクの持ち主・作成者と、実際にリンクを送った人は同じとは限りません。</p>

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

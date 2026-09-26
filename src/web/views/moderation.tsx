import type { GuildConfig } from '../../config.js';
import type { ActivityDaily, AdminSession, CoinTx, Memo, Yaku } from '../../db/schema.js';
import { ADMIN_COINS_MAX } from '../../services/economy.js';
import { fmtAgo, fmtDate, fmtDateTime } from '../format.js';
import { Avatar, Layout } from './layout.js';

type Names = Map<string, string>;
const who = (names: Names, id: string | null) => (id ? names.get(id) ?? `ID ${id}` : '—');

/** 操作のあとに出すメッセージ */
export const FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  warned: { text: '厄を付けました（1 つ目・注意）。本人に DM で知らせました。', kind: 'ok' },
  warned_nodm: { text: '厄を付けました（1 つ目・注意）。DM は届きませんでした（DM を受け取らない設定の可能性）。', kind: 'warn' },
  banned: { text: 'BAN しました。', kind: 'ok' },
  ban_failed: { text: 'BAN の記録はしましたが、Discord での BAN に失敗しました。BOT の権限を確認してください。', kind: 'warn' },
  cleared: { text: '厄を 1 つ取り消しました。', kind: 'ok' },
  no_yaku: { text: '取り消す厄がありません。', kind: 'warn' },
  kicked: { text: 'キックしました。', kind: 'ok' },
  kick_failed: { text: 'キックに失敗しました。BOT の権限を確認してください。', kind: 'warn' },
  unbanned: { text: 'BAN を解除しました。本人に招待リンクを送ると、入鯖申請からやり直せます（DM は BOT から送れません）。', kind: 'ok' },
  unbanned_already: { text: 'Discord ではすでに解除されていたので、厄の整理だけしました。', kind: 'ok' },
  unban_failed: { text: 'BAN を解除できませんでした。BOT の「メンバーを BAN」権限を確認してください。', kind: 'warn' },
  unban_forbidden: { text: 'BAN の解除は宮司のみできます。', kind: 'warn' },
  unban_not_banned: { text: 'この方は BAN されていません。', kind: 'warn' },
  memo: { text: 'メモを残しました。', kind: 'ok' },
  denied_self: { text: '自分自身には操作できません。', kind: 'warn' },
  denied_protected: { text: 'この方には操作できません（神職は神職・宮司に、宮司は宮司に操作できません）。', kind: 'warn' },
  denied_not_found: { text: 'その方の記録が見つかりません。', kind: 'warn' },
  invalid: { text: '入力が足りません（「その他」を選んだときは補足を書いてください）。', kind: 'warn' },
  coins_given: { text: '送りました。本人に DM で知らせました。', kind: 'ok' },
  coins_given_quiet: { text: '送りました（DM は送っていません）。', kind: 'ok' },
  coins_given_nodm: { text: '送りました。DM は届きませんでした（DM を受け取らない設定の可能性）。', kind: 'warn' },
  coins_taken: { text: '減らしました。', kind: 'ok' },
  coins_taken_short: { text: '残高が足りなかったので、残っていた分だけ減らしました。', kind: 'warn' },
  coins_dup: { text: 'この操作はもう済んでいます（二度押しなどで 2 回送られないようにしています）。', kind: 'warn' },
  coins_invalid: { text: `枚数（1〜${ADMIN_COINS_MAX.toLocaleString('ja-JP')}）と理由を入れてください。`, kind: 'warn' },
  coins_forbidden: { text: '送る・減らすのは宮司のみできます。', kind: 'warn' },
};

export function Flash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(FLASH, props.code) ? FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}

const COIN_REASON: Record<string, string> = {
  voice: '通話',
  shuin_give: '朱印を押した',
  shuin_receive: '朱印を頂いた',
  omikuji: 'おみくじ',
  join_bonus: '初期配布',
  shop: 'ショップ',
  shop_refund: 'ショップの払い戻し',
  gift_send: '贈り物を贈った',
  gift_receive: '贈り物をもらった',
  boost: '奉納（ブースト）のお礼',
  admin_grant: '運営から',
  admin_take: '運営が減らした',
  shuin_revoke: '朱印の取り消し',
  menzaifu: '免罪符',
  adjust: '調整',
};

/** メンバー詳細に足す「厄・操作・花びら・活動・メモ」 */
export function ModerationSection(props: {
  cfg: GuildConfig;
  memberId: string;
  csrf: string;
  canModerate: boolean;
  deniedText?: string;
  yaku: Yaku[];
  activeYaku: number;
  menzaifuUsed: number;
  wallet: { balance: number; lifetimeEarned: number };
  coinTx: CoinTx[];
  activity: ActivityDaily[];
  memos: Memo[];
  names: Names;
  /** BAN 中で、見ているのが宮司なら「BAN を解除する」を出す */
  showUnban?: boolean;
  /** 宮司なら「送る・減らす」を出す（二度押し対策の番号つき） */
  coinsNonce?: string;
}) {
  const { cfg, memberId, csrf } = props;
  const e = cfg.economy;
  const base = `/members/${memberId}`;
  const reasons = [...cfg.moderation.yakuReasons, 'その他'];
  return (
    <>
      <div class="grid2">
        <section class="card">
          <h2>
            厄 <span class={props.activeYaku ? 'tag red' : 'tag gray'}>{props.activeYaku ? `👹 今 ${props.activeYaku} つ` : 'なし'}</span>
          </h2>
          <p class="note">
            1 つ目は注意、2 つ目で BAN。免罪符（{e.currencyEmoji}
            {e.menzaifuPrice}）で祓える: あと {Math.max(0, e.menzaifuMaxUses - props.menzaifuUsed)} 回
          </p>
          {props.yaku.length === 0 ? (
            <p class="empty">厄の記録はありません。</p>
          ) : (
            <table class="compact">
              <tbody>
                {props.yaku.map((y) => (
                  <tr class={y.clearedAt ? 'revoked' : ''}>
                    <td>{fmtDateTime(y.createdAt)}</td>
                    <td>
                      {y.kind === 'instant_ban' ? <span class="tag red">一発 BAN</span> : null} {y.reason}
                      <small class="reason">
                        付けた人: {who(props.names, y.issuedBy)}
                        {y.clearedAt &&
                          ` ／ ${y.clearedReason === 'menzaifu' ? '免罪符で祓った' : y.clearedReason === 'unban' ? 'BAN 解除で祓った' : `取り消し（${who(props.names, y.clearedBy)}${y.clearedNote ? `: ${y.clearedNote}` : ''}）`} ${fmtDate(y.clearedAt)}`}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section class="card">
          <h2>操作</h2>
          {props.showUnban && (
            <form method="post" action={`${base}/unban`} class="actions unban">
              <input type="hidden" name="_csrf" value={csrf} />
              <h3>
                BAN を解除する <span class="tag red">BAN 中</span>
              </h3>
              <p class="note">解除すると、招待リンクからまた入れます（入鯖申請からやり直し）。残っている厄をどうするか選んでください。</p>
              <label class="field check">
                <input type="radio" name="keep" value="0" required />
                <span>厄を全部祓う（まっさらからやり直し）</span>
              </label>
              <label class="field check">
                <input type="radio" name="keep" value="1" />
                <span>厄を 1 つ残す（👹厄年からやり直し。次に厄が付くとまた BAN）</span>
              </label>
              <input type="text" name="note" maxlength={300} placeholder="解除する理由（必須・記録に残ります）" required />
              <button type="submit" class="ok">
                BAN を解除する
              </button>
            </form>
          )}
          {!props.canModerate ? (
            <p class="empty">{props.deniedText}</p>
          ) : (
            <div class="actions">
              <form method="post" action={`${base}/yaku`}>
                <input type="hidden" name="_csrf" value={csrf} />
                <h3>厄を付ける{props.activeYaku >= 1 && <span class="tag red">2 つ目 → BAN</span>}</h3>
                <select name="reason" required>
                  {reasons.map((r) => (
                    <option value={r}>{r}</option>
                  ))}
                </select>
                <input type="text" name="note" maxlength={300} placeholder="補足（任意・「その他」は必須）" />
                <button type="submit" class="danger">
                  厄を付ける
                </button>
              </form>
              {props.activeYaku > 0 && (
                <form method="post" action={`${base}/yaku/clear`}>
                  <input type="hidden" name="_csrf" value={csrf} />
                  <h3>厄を取り消す（間違えて付けたとき）</h3>
                  <input type="text" name="note" maxlength={300} placeholder="取り消す理由（必須）" required />
                  <button type="submit">取り消す</button>
                </form>
              )}
              <form method="post" action={`${base}/ban`}>
                <input type="hidden" name="_csrf" value={csrf} />
                <h3>一発 BAN（重大な違反）</h3>
                <select name="reason" required>
                  {cfg.moderation.instantBanReasons.map((r) => (
                    <option value={r}>{r}</option>
                  ))}
                </select>
                <input type="text" name="note" maxlength={300} placeholder="補足（任意）" />
                <button type="submit" class="danger">
                  一発 BAN…
                </button>
              </form>
              <form method="post" action={`${base}/kick`}>
                <input type="hidden" name="_csrf" value={csrf} />
                <h3>キック</h3>
                <input type="text" name="reason" maxlength={300} placeholder="理由（必須）" required />
                <button type="submit">キック…</button>
              </form>
            </div>
          )}
        </section>
      </div>

      <div class="grid2">
        <section class="card">
          <h2>メモ（神職どうしの申し送り）</h2>
          <form method="post" action={`${base}/memo`} class="memo-form">
            <input type="hidden" name="_csrf" value={csrf} />
            <textarea name="body" maxlength={1000} rows={2} placeholder="本人には見えません" required></textarea>
            <button type="submit">メモを残す</button>
          </form>
          {props.memos.length === 0 ? (
            <p class="empty">メモはありません。</p>
          ) : (
            <ul class="timeline">
              {props.memos.map((m) => (
                <li>
                  <time>{fmtDateTime(m.createdAt)}</time>
                  <span>
                    {m.body}
                    <small class="reason">{who(props.names, m.authorId)}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="card">
          <h2>
            {e.currencyName}と活動
          </h2>
          <p>
            {e.currencyEmoji} <strong class="big">{props.wallet.balance}</strong>
            <small>（これまでに {props.wallet.lifetimeEarned}）</small>
          </p>
          <h3>直近 14 日の活動</h3>
          {props.activity.length === 0 ? (
            <p class="empty">記録はありません。</p>
          ) : (
            <table class="compact">
              <thead>
                <tr>
                  <th>日付</th>
                  <th class="num">発言</th>
                  <th class="num">通話</th>
                  <th class="num">{e.currencyName}</th>
                </tr>
              </thead>
              <tbody>
                {props.activity.map((a) => (
                  <tr>
                    <td>{a.date}</td>
                    <td class="num">{a.messageCount}</td>
                    <td class="num">{fmtMinutes(a.vcMinutes)}</td>
                    <td class="num">{a.vcCoins ? `+${a.vcCoins}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {props.coinsNonce && (
            <form method="post" action={`${base}/coins`} class="actions coins">
              <input type="hidden" name="_csrf" value={csrf} />
              <input type="hidden" name="nonce" value={props.coinsNonce} />
              <h3>
                {e.currencyEmoji} {e.currencyName}を送る・減らす
              </h3>
              <div class="inline-actions">
                <label class="field check">
                  <input type="radio" name="mode" value="grant" checked />
                  <span>送る</span>
                </label>
                <label class="field check">
                  <input type="radio" name="mode" value="take" />
                  <span>減らす（送りすぎたときなど）</span>
                </label>
              </div>
              <input type="number" name="amount" min={1} max={ADMIN_COINS_MAX} placeholder="枚数" required />
              <input type="text" name="note" maxlength={200} placeholder="理由（必須・記録に残る。DM にも載る）" required />
              <label class="field check">
                <input type="checkbox" name="dm" value="yes" checked />
                <span>送ったことを本人に DM で知らせる</span>
              </label>
              <button type="submit" class="ok">
                実行する
              </button>
            </form>
          )}
          <h3>{e.currencyName}の出入り</h3>
          {props.coinTx.length === 0 ? (
            <p class="empty">記録はありません。</p>
          ) : (
            <table class="compact">
              <tbody>
                {props.coinTx.map((t) => (
                  <tr>
                    <td>{fmtDateTime(t.at)}</td>
                    <td>
                      {COIN_REASON[t.reason] ?? t.reason}
                      {(t.reason === 'admin_grant' || t.reason === 'admin_take') && typeof t.detail.note === 'string' && <small class="reason">{t.detail.note}</small>}
                    </td>
                    <td class="num">{t.amount > 0 ? `+${t.amount}` : t.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} 時間 ${m % 60} 分` : `${m} 分`);

/** BAN・キックなど取り返しのつかない操作の確認画面 */
export function ConfirmPage(props: {
  session: AdminSession;
  title: string;
  message: string;
  targetName: string;
  action: string;
  fields: Record<string, string>;
  button: string;
  backUrl: string;
}) {
  return (
    <Layout title={props.title} session={props.session} nav="members">
      <section class="card confirm">
        <h1>⚠️ {props.title}</h1>
        <p>
          <strong>{props.targetName}</strong> さま
        </p>
        <p>{props.message}</p>
        {props.fields.reason && <p class="note">理由: {props.fields.reason}{props.fields.note ? `（${props.fields.note}）` : ''}</p>}
        <form method="post" action={props.action}>
          <input type="hidden" name="_csrf" value={props.session.csrfToken} />
          {Object.entries(props.fields).map(([k, v]) => (
            <input type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="confirm" value="yes" />
          <button type="submit" class="danger">
            {props.button}
          </button>
          <a class="cancel" href={props.backUrl}>
            やめる
          </a>
        </form>
      </section>
    </Layout>
  );
}

/** 厄が付いている人の一覧 */
export function YakuPage(props: {
  session: AdminSession;
  rows: { memberId: string; active: number; latest: Date; displayName: string | null; username: string | null; avatarUrl: string | null; leftAt: Date | null }[];
  now: Date;
}) {
  return (
    <Layout title="厄" session={props.session} nav="yaku">
      <h1>👹 厄が付いている方</h1>
      <p class="note">1 つ目は注意、2 つ目で BAN。本人は免罪符で祓うことができます。</p>
      {props.rows.length === 0 ? (
        <p class="empty">厄が付いている方はいません。</p>
      ) : (
        <div class="table-wrap">
          <table class="members">
            <thead>
              <tr>
                <th>名前</th>
                <th class="num">厄</th>
                <th>最後に付いた日</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((r) => (
                <tr class={r.leftAt ? 'left' : ''}>
                  <td>
                    <a class="who" href={`/members/${r.memberId}`}>
                      <Avatar url={r.avatarUrl} />
                      <span>
                        {r.displayName ?? `ID ${r.memberId}`}
                        {r.username && <small>@{r.username}</small>}
                      </span>
                    </a>
                  </td>
                  <td class="num">{r.active}</td>
                  <td>
                    {fmtDate(r.latest)}（{fmtAgo(r.latest, props.now)}）
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}

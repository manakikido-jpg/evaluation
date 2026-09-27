import { GACHA_TIERS, TICKET_KINDS, type GachaConfig, type GachaTier, type TicketKind } from '../../config.js';
import type { AdminSession, GachaDraw } from '../../db/schema.js';
import { gachaRates, TIER_LABEL, untilPity } from '../../services/gacha.js';
import { TICKET_LABEL } from '../../services/tickets.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

type Names = Map<string, string>;

export const GACHA_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  tickets_given: { text: '券を渡しました。本人に DM で知らせました。', kind: 'ok' },
  tickets_given_quiet: { text: '券を渡しました（DM は送っていません）。', kind: 'ok' },
  tickets_given_nodm: { text: '券を渡しました。DM は届きませんでした（DM を受け取らない設定の可能性）。', kind: 'warn' },
  tickets_taken: { text: '券を減らしました。', kind: 'ok' },
  tickets_taken_short: { text: '持っている分が足りなかったので、持っていた分だけ減らしました。', kind: 'warn' },
  tickets_none: { text: 'その券は持っていないので、減らせませんでした。', kind: 'warn' },
  tickets_invalid: { text: '券の種類・枚数（1〜100）・理由を入れてください。', kind: 'warn' },
  tickets_forbidden: { text: '券を渡す・減らすのは宮司のみできます。', kind: 'warn' },
};

export function GachaFlash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(GACHA_FLASH, props.code) ? GACHA_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}

const fmt = (n: number) => n.toLocaleString('ja-JP');
const pct = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 1000) / 10}%` : '—');

/** 1 回分の中身（ロール名は分かれば） */
function prizeCell(d: GachaDraw, roleName: (id: string) => string) {
  const got: string[] = [];
  if (d.roleId) got.push(`「${roleName(d.roleId)}」`);
  if (d.ticket && d.ticket in TICKET_LABEL) {
    const t = TICKET_LABEL[d.ticket as TicketKind];
    got.push(`${t.emoji}${t.name} ×${d.ticketCount}`);
  }
  if (d.coins > 0) got.push(`花びら ${fmt(d.coins)}`);
  return got.join(' ＋ ') || 'なし';
}

function TierCell(props: { draw: GachaDraw }) {
  const t = TIER_LABEL[props.draw.tier];
  return (
    <span>
      {t.emoji} {t.name}
      {props.draw.pity && <small> 天井</small>}
    </span>
  );
}

function TicketCells(props: { tickets: Record<TicketKind, number> }) {
  return (
    <>
      {TICKET_KINDS.map((k) => (
        <td class="num">{props.tickets[k] || '—'}</td>
      ))}
    </>
  );
}

/** 物御籤のページ（運営みんなが見られる） */
export function GachaPage(props: {
  session: AdminSession;
  gacha: GachaConfig;
  coinName: string;
  stats: { total: number; spent: number; byTier: Record<GachaTier, number>; players: number };
  draws: GachaDraw[];
  tops: GachaDraw[];
  players: { memberId: string; total: number; sinceTop: number; tops: number }[];
  holders: { memberId: string; tickets: Record<TicketKind, number> }[];
  names: Names;
  roleNames: Map<string, string>;
}) {
  const { session, gacha: g, stats } = props;
  const who = (id: string) => <a href={`/members/${id}`}>{props.names.get(id) ?? id}</a>;
  const roleName = (id: string) => props.roleNames.get(id) ?? '（消えたロール）';
  const rates = gachaRates(g);
  return (
    <Layout title="物御籤" session={session} nav="gacha">
      <h1>🎁 物御籤</h1>
      <p class="note">
        {props.coinName}で引くくじです（本物のお金は扱いません）。
        {g.enabled ? `いまは 1 回 ${fmt(g.price)} 枚・10 連 ${fmt(g.price * 10)} 枚` : 'いまはお休み中です'}
        {g.pity > 0 ? `。大吉が出ないまま ${g.pity} 回目は必ず大吉。` : '。天井はありません。'}
        {session.level === 'guji' ? (
          <>
            {' '}
            値段・割合・中身は <a href="/settings#sec-gacha">設定 → 🎁 物御籤</a> で変えられます。券を渡す・減らすのはメンバーのページからできます。
          </>
        ) : (
          ' 設定を変えるのは宮司です。'
        )}
      </p>
      <div class="stats">
        <div class="stat">
          <div class="label">引かれた回数</div>
          <div class="value">{fmt(stats.total)}</div>
        </div>
        <div class="stat">
          <div class="label">引いた人</div>
          <div class="value">{fmt(stats.players)}</div>
        </div>
        <div class="stat">
          <div class="label">使われた{props.coinName}</div>
          <div class="value">{fmt(stats.spent)}</div>
        </div>
        <div class="stat">
          <div class="label">大吉</div>
          <div class="value">{fmt(stats.byTier.daikichi)}</div>
        </div>
      </div>

      <section class="card">
        <h2>運勢と中身</h2>
        <table class="compact">
          <thead>
            <tr>
              <th>運勢</th>
              <th class="num">決めた割合</th>
              <th class="num">実際に出た</th>
              <th>中身</th>
            </tr>
          </thead>
          <tbody>
            {GACHA_TIERS.map((t) => {
              const p = g.prizes[t];
              const ticket = p.ticket !== 'none' && p.count > 0 ? `${TICKET_LABEL[p.ticket].emoji}${TICKET_LABEL[p.ticket].name} ×${p.count}` : '';
              return (
                <tr>
                  <td>
                    {TIER_LABEL[t].emoji} {TIER_LABEL[t].name}
                  </td>
                  <td class="num">{rates[t]}%</td>
                  <td class="num">
                    {fmt(stats.byTier[t])} 回（{pct(stats.byTier[t], stats.total)}）
                  </td>
                  <td class="wrap">
                    {p.role && g.roleIds.length > 0 ? `限定ロール（まだ持っていないもの）${ticket ? `／全部持っていたら ${ticket}` : ''}` : ticket || 'なし'}
                    {p.coins > 0 && ` ＋ 花びら ${fmt(p.coins)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h3>物御籤限定のロール</h3>
        {g.roleIds.length === 0 ? (
          <p class="empty">まだ選んでいません（大吉は券になります）。</p>
        ) : (
          <ul>
            {g.roleIds.map((id) => (
              <li>{roleName(id)}</li>
            ))}
          </ul>
        )}
      </section>

      <section class="card">
        <h2>最近の大吉</h2>
        {props.tops.length === 0 ? (
          <p class="empty">まだありません。</p>
        ) : (
          <table class="compact">
            <tbody>
              {props.tops.map((d) => (
                <tr>
                  <td>{fmtDateTime(d.createdAt)}</td>
                  <td>{who(d.memberId)}</td>
                  <td>
                    <TierCell draw={d} />
                  </td>
                  <td class="wrap">{prizeCell(d, roleName)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section class="card">
        <h2>よく引いている人</h2>
        {props.players.length === 0 ? (
          <p class="empty">まだだれも引いていません。</p>
        ) : (
          <table class="compact">
            <thead>
              <tr>
                <th>メンバー</th>
                <th class="num">回数</th>
                <th class="num">大吉</th>
                <th class="num">天井まで</th>
              </tr>
            </thead>
            <tbody>
              {props.players.map((p) => (
                <tr>
                  <td>{who(p.memberId)}</td>
                  <td class="num">{fmt(p.total)}</td>
                  <td class="num">{p.tops}</td>
                  <td class="num">{untilPity(g, p.sinceTop) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section class="card">
        <h2>券を持っている人</h2>
        {props.holders.length === 0 ? (
          <p class="empty">だれも持っていません。</p>
        ) : (
          <table class="compact">
            <thead>
              <tr>
                <th>メンバー</th>
                {TICKET_KINDS.map((k) => (
                  <th class="num">
                    {TICKET_LABEL[k].emoji} {TICKET_LABEL[k].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.holders.map((h) => (
                <tr>
                  <td>{who(h.memberId)}</td>
                  <TicketCells tickets={h.tickets} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section class="card">
        <h2>最近引かれた物御籤</h2>
        {props.draws.length === 0 ? (
          <p class="empty">まだありません。</p>
        ) : (
          <div class="table-wrap">
            <table class="compact">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>メンバー</th>
                  <th>運勢</th>
                  <th>出たもの</th>
                </tr>
              </thead>
              <tbody>
                {props.draws.map((d) => (
                  <tr>
                    <td>{fmtDateTime(d.createdAt)}</td>
                    <td>{who(d.memberId)}</td>
                    <td>
                      <TierCell draw={d} />
                    </td>
                    <td class="wrap">{prizeCell(d, roleName)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Layout>
  );
}

/** メンバーのページ: 物御籤の回数・券・最近の結果。宮司は券を渡す・減らす */
export function MemberGachaSection(props: {
  session: AdminSession;
  memberId: string;
  gacha: GachaConfig;
  state: { sinceTop: number; total: number };
  tickets: Record<TicketKind, number>;
  draws: GachaDraw[];
  roleNames: Map<string, string>;
  flash?: string;
}) {
  const { session, gacha: g } = props;
  const roleName = (id: string) => props.roleNames.get(id) ?? '（消えたロール）';
  const left = untilPity(g, props.state.sinceTop);
  return (
    <section class="card anchor" id="sec-gacha">
      <h2>🎁 物御籤</h2>
      <GachaFlash code={props.flash} />
      <p>
        引いた回数 <strong>{fmt(props.state.total)}</strong>
        {props.state.total > 0 && left !== undefined && ` ／ 天井まであと ${left} 回`}
      </p>
      <table class="compact">
        <thead>
          <tr>
            {TICKET_KINDS.map((k) => (
              <th class="num">
                {TICKET_LABEL[k].emoji} {TICKET_LABEL[k].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <TicketCells tickets={props.tickets} />
          </tr>
        </tbody>
      </table>
      {session.level === 'guji' && (
        <form method="post" action={`/members/${props.memberId}/tickets`} class="actions coins">
          <input type="hidden" name="_csrf" value={session.csrfToken} />
          <h3>券を渡す・減らす</h3>
          <div class="inline-actions">
            <label class="field check">
              <input type="radio" name="mode" value="grant" checked />
              <span>渡す</span>
            </label>
            <label class="field check">
              <input type="radio" name="mode" value="take" />
              <span>減らす</span>
            </label>
          </div>
          <select name="kind" aria-label="券の種類" required>
            {TICKET_KINDS.map((k) => (
              <option value={k}>
                {TICKET_LABEL[k].emoji} {TICKET_LABEL[k].name}
              </option>
            ))}
          </select>
          <input type="number" name="count" min={1} max={100} placeholder="枚数" required />
          <input type="text" name="note" maxlength={200} placeholder="理由（必須・記録に残る。DM にも載る）" required />
          <label class="field check">
            <input type="checkbox" name="dm" value="yes" checked />
            <span>渡したことを本人に DM で知らせる</span>
          </label>
          <button type="submit" class="ok">
            実行する
          </button>
        </form>
      )}
      <h3>最近の結果</h3>
      {props.draws.length === 0 ? (
        <p class="empty">まだ引いていません。</p>
      ) : (
        <table class="compact">
          <tbody>
            {props.draws.map((d) => (
              <tr>
                <td>{fmtDateTime(d.createdAt)}</td>
                <td>
                  <TierCell draw={d} />
                </td>
                <td class="wrap">{prizeCell(d, roleName)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

import { GACHA_TIERS, TICKET_KINDS, type GachaConfig, type GachaTier, type TicketKind } from '../../config.js';
import type { AdminSession, GachaClaim, GachaDraw, GachaPrizeRow, ShopItem } from '../../db/schema.js';
import { effectiveRates, PRIZE_KIND_LABEL, PRIZE_KINDS, prizeChances, prizeLabel, TIER_LABEL, untilPity } from '../../services/gacha.js';
import { TICKET_GROUPS, TICKET_LABEL } from '../../services/tickets.js';
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
  gacha_saved: { text: '保存しました。BOT には 1 分以内に反映されます。', kind: 'ok' },
  gacha_on: { text: '物御籤を始めました（BOT には 1 分以内に反映されます）。', kind: 'ok' },
  gacha_off: { text: '物御籤を止めました（BOT には 1 分以内に反映されます）。', kind: 'ok' },
  gacha_invalid: { text: '入力を確かめてください（値段は 1 以上、出やすさは 0〜1000 で、どれか 1 つは 1 以上）。', kind: 'warn' },
  prize_added: { text: '中身を足しました。', kind: 'ok' },
  prize_saved: { text: '中身を保存しました。', kind: 'ok' },
  prize_on: { text: '中身を ON にしました。', kind: 'ok' },
  prize_off: { text: '中身を OFF にしました。', kind: 'ok' },
  prize_deleted: { text: '中身を削除しました。', kind: 'ok' },
  prize_invalid: { text: '中身の入力を確かめてください（限定ロール・ショップの品は選んでください。枚数・重みは 1 以上）。', kind: 'warn' },
  prize_not_found: { text: 'その中身はもうありません。', kind: 'warn' },
  prize_bulk: { text: 'まとめて変えました。', kind: 'ok' },
  prize_bulk_none: { text: '変える中身を選んでください（左のチェック）。', kind: 'warn' },
  claim_done: { text: '「渡した」にしました。', kind: 'ok' },
  claim_done_already: { text: 'もう「渡した」になっています。', kind: 'warn' },
  gacha_reset: { text: '物御籤をリセットしました（銭を返し、出たものを取り上げました）。くわしくは「記録」に残っています。', kind: 'ok' },
  gacha_reset_confirm: { text: 'リセットするときは「リセット」と入れてください。', kind: 'warn' },
};

export function GachaFlash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(GACHA_FLASH, props.code) ? GACHA_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}

const fmt = (n: number) => n.toLocaleString('ja-JP');
const pct = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 1000) / 10}%` : '—');

/** 1 回分の中身（ロール名は分かれば） */
function prizeCell(d: GachaDraw, roleName: (id: string) => string, shop?: Map<number, ShopItem>) {
  const got: string[] = [];
  const item = d.shopItemId ? shop?.get(d.shopItemId) : undefined;
  if (item) got.push(`${item.emoji}${item.name}`);
  else if (d.roleId) got.push(`「${roleName(d.roleId)}」`);
  if (d.ticket && d.ticket in TICKET_LABEL) {
    const t = TICKET_LABEL[d.ticket as TicketKind];
    got.push(`${t.emoji}${t.name} ×${d.ticketCount}`);
  }
  if (d.coins > 0) got.push(`銭 ${fmt(d.coins)}`);
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

/** 持っている券の一覧（持っていない券は出さない） */
function TicketList(props: { tickets: Record<TicketKind, number> }) {
  const owned = TICKET_KINDS.filter((k) => props.tickets[k] > 0);
  if (!owned.length) return <span class="empty">なし</span>;
  return (
    <span>
      {owned.map((k, i) => (
        <>
          {i > 0 && '・'}
          {TICKET_LABEL[k].emoji}
          {TICKET_LABEL[k].name} ×{props.tickets[k]}
        </>
      ))}
    </span>
  );
}

/** 券を選ぶ（まとまりごと） */
export function TicketSelect(props: { name: string; selected?: string }) {
  return (
    <select name={props.name} required>
      {TICKET_GROUPS.map((grp) => (
        <optgroup label={grp.label}>
          {grp.kinds.map((k) => (
            <option value={k} selected={props.selected === k}>
              {TICKET_LABEL[k].emoji} {TICKET_LABEL[k].name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** 運勢を選ぶ（いまの割合つき） */
function TierPick(props: { rates: Record<GachaTier, number>; checked?: GachaTier }) {
  return (
    <fieldset class="tier-pick">
      <legend>運勢</legend>
      {GACHA_TIERS.map((t, i) => (
        <label>
          <input type="radio" name="tier" value={t} checked={props.checked ? props.checked === t : i === GACHA_TIERS.length - 1} required />
          <span>
            {TIER_LABEL[t].emoji} {TIER_LABEL[t].name}
            <small> {props.rates[t] > 0 ? `${props.rates[t]}%` : 'まだ出ない'}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** 重み・ほかが出せないときだけ */
function WeightFields() {
  return (
    <>
      <label class="field">
        <span>重み（1〜10000）</span>
        <input type="number" name="weight" value="1" min={1} max={10000} required />
      </label>
      <label class="field check">
        <input type="checkbox" name="fallback" value="yes" />
        <span>ほかが出せないときだけ出す（ロールを全部持っている人への代わり）</span>
      </label>
    </>
  );
}

/** 物御籤のページ（運営みんなが見られる。変えられるのは宮司） */
export function GachaPage(props: {
  session: AdminSession;
  gacha: GachaConfig;
  coinName: string;
  coinEmoji?: string;
  stats: { total: number; spent: number; byTier: Record<GachaTier, number>; players: number };
  prizes: GachaPrizeRow[];
  /** 物御籤で出せるショップの品（ロールの品） */
  shopItems: ShopItem[];
  /** 限定ロールに選べるロール */
  roles: { id: string; name: string }[];
  draws: GachaDraw[];
  tops: GachaDraw[];
  players: { memberId: string; total: number; sinceTop: number; tops: number }[];
  holders: { memberId: string; tickets: Record<TicketKind, number> }[];
  names: Names;
  roleNames: Map<string, string>;
  flash?: string;
  /** 運営が渡す賞品の当たり */
  claims: GachaClaim[];
  /** リセットしたら返す・取り上げる量（宮司だけ） */
  reset?: { members: number; draws: number; refund: number; coins: number; tickets: number; roles: number };
}) {
  const { session, gacha: g, stats } = props;
  const guji = session.level === 'guji';
  const who = (id: string) => <a href={`/members/${id}`}>{props.names.get(id) ?? id}</a>;
  const roleName = (id: string) => props.roleNames.get(id) ?? '（消えたロール）';
  const shopById = new Map(props.shopItems.map((i) => [i.id, i]));
  const labelNames = { role: (id: string) => props.roleNames.get(id), shop: (id: number) => shopById.get(id), coin: props.coinName };
  const rates = effectiveRates(g, props.prizes);
  const chances = prizeChances(g, props.prizes);
  const csrf = <input type="hidden" name="_csrf" value={session.csrfToken} />;
  return (
    <Layout title="物御籤" session={session} nav="gacha">
      <h1>🎁 物御籤</h1>
      <GachaFlash code={props.flash} />
      <p class="note">
        {props.coinName}で引くくじです（本物のお金は扱いません）。運勢（大吉・中吉・小吉・吉）を出やすさで決めて、その運勢の中身から重みで 1
        つ出します。持っているロールは出ません。
        {guji ? '' : ' 変えられるのは宮司です。'}
      </p>

      <section class="card anchor" id="gacha-basic">
        <h2>基本</h2>
        <div class="inline-actions">
          <p>{g.enabled ? <strong>🟢 いま引けます</strong> : <strong>⏸ お休み中（だれも引けません）</strong>}</p>
          {guji && (
            <form method="post" action="/gacha/toggle">
              {csrf}
              <input type="hidden" name="enabled" value={g.enabled ? 'no' : 'yes'} />
              <button type="submit" class={g.enabled ? 'danger' : 'ok'}>
                {g.enabled ? '物御籤を止める' : '物御籤を始める'}
              </button>
            </form>
          )}
        </div>
        {guji ? (
          <form method="post" action="/gacha/settings">
            {csrf}
            <div class="fields">
              <label class="field">
                <span>1 回の値段（{props.coinName}。10 連は 10 倍）</span>
                <input type="number" name="price" value={String(g.price)} min={1} max={1000000} required />
              </label>
              <label class="field">
                <span>天井（大吉が出ないまま、この回数目は必ず大吉。0 でなし）</span>
                <input type="number" name="pity" value={String(g.pity)} min={0} max={1000} required />
              </label>
              {GACHA_TIERS.map((t) => (
                <label class="field">
                  <span>
                    {TIER_LABEL[t].emoji} {TIER_LABEL[t].name}の出やすさ（いま {rates[t]}%）
                  </span>
                  <input type="number" name={`rate.${t}`} value={String(g.rates[t])} min={0} max={1000} step="0.01" required />
                </label>
              ))}
            </div>
            <p class="note">出やすさは合計が 100 でなくても大丈夫です（割合で出します）。0 にした運勢と、中身が 1 つもない運勢は出ません。</p>
            <button type="submit" class="ok">
              保存する
            </button>
          </form>
        ) : (
          <p>
            1 回 {fmt(g.price)} 枚・10 連 {fmt(g.price * 10)} 枚 ／ 天井 {g.pity > 0 ? `${g.pity} 回目` : 'なし'} ／{' '}
            {GACHA_TIERS.map((t) => `${TIER_LABEL[t].name} ${rates[t]}%`).join('・')}
          </p>
        )}
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
        <p class="note">
          実際に出た割合: {GACHA_TIERS.map((t) => `${TIER_LABEL[t].name} ${fmt(stats.byTier[t])} 回（${pct(stats.byTier[t], stats.total)}）`).join(' ／ ')}
        </p>
      </section>

      <section class="card anchor" id="gacha-prizes">
        <h2>中身</h2>
        <p class="note">
          「出る確率」は、全体の中でその中身が出る確率です（何も持っていない人のとき）。「ほかが出せないときだけ」にした中身は、同じ運勢のほかの中身（ロールなど）を全部持っている人にだけ出ます。止めた中身は出ません。
        </p>
        {guji && props.prizes.length > 0 && (
          <form method="post" action="/gacha/prizes/bulk" id="gp-bulk" class="inline-actions bulk-bar">
            {csrf}
            <span>☑ 選んだものを</span>
            <button type="submit" name="action" value="on" class="ok">
              ON にする
            </button>
            <button type="submit" name="action" value="off">
              OFF にする
            </button>
            <button type="submit" name="action" value="delete" class="danger">
              削除
            </button>
            <span class="sep">／ 全部を</span>
            <button type="submit" name="action" value="all_on" class="ok">
              全部 ON
            </button>
            <button type="submit" name="action" value="all_off">
              全部 OFF
            </button>
          </form>
        )}
        {GACHA_TIERS.map((t) => {
          const list = props.prizes.filter((p) => p.tier === t);
          return (
            <>
              <h3>
                {TIER_LABEL[t].emoji} {TIER_LABEL[t].name}（{rates[t]}%）
              </h3>
              {list.length === 0 ? (
                <p class="empty">中身がありません（この運勢は出ません）。</p>
              ) : (
                <div class="table-wrap">
                  <table class="compact">
                    <thead>
                      <tr>
                        {guji && <th></th>}
                        <th>中身</th>
                        <th class="num">枚数・残り</th>
                        <th class="num">重み</th>
                        <th>ほかが出せないときだけ</th>
                        <th class="num">出る確率</th>
                        <th>状態</th>
                        {guji && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((p) => {
                        const f = `gp-${p.id}`;
                        return (
                          <tr class={p.enabled ? '' : 'muted'}>
                            {guji && (
                              <td>
                                <input type="checkbox" name="ids" value={String(p.id)} form="gp-bulk" aria-label="選ぶ" />
                              </td>
                            )}
                            <td class="wrap prize-name">
                              <small>{PRIZE_KIND_LABEL[p.kind]}</small> {prizeLabel(p, labelNames)}
                              {p.kind === 'ticket' && p.ticket && TICKET_LABEL[p.ticket] && (
                                <>
                                  <br />
                                  <small>{TICKET_LABEL[p.ticket].note}</small>
                                </>
                              )}
                            </td>
                            <td class="num">
                              {guji && (p.kind === 'ticket' || p.kind === 'coins') ? (
                                <input
                                  type="number"
                                  name="amount"
                                  form={f}
                                  value={String(p.amount)}
                                  min={1}
                                  max={p.kind === 'coins' ? 1000000 : 100}
                                  required
                                  aria-label="枚数"
                                />
                              ) : p.kind === 'ticket' || p.kind === 'coins' ? (
                                fmt(p.amount)
                              ) : p.kind === 'special' ? (
                                guji ? (
                                  <input
                                    type="number"
                                    name="stock"
                                    form={f}
                                    value={p.stock === null ? '' : String(p.stock)}
                                    min={0}
                                    max={1000}
                                    placeholder="いくらでも"
                                    aria-label="残り"
                                  />
                                ) : p.stock === null ? (
                                  'いくらでも'
                                ) : (
                                  `残り ${p.stock}`
                                )
                              ) : (
                                '—'
                              )}
                            </td>
                            <td class="num">
                              {guji ? <input type="number" name="weight" form={f} value={String(p.weight)} min={1} max={10000} required aria-label="重み" /> : p.weight}
                            </td>
                            <td>
                              {guji ? (
                                <label class="field check">
                                  <input type="checkbox" name="fallback" value="yes" form={f} checked={p.fallback} />
                                  <span>そうする</span>
                                </label>
                              ) : p.fallback ? (
                                'はい'
                              ) : (
                                ''
                              )}
                            </td>
                            <td class="num">{!p.enabled ? '—' : (chances.get(p.id) ?? 0) > 0 ? `${chances.get(p.id)}%` : p.fallback ? '代わり' : '0%'}</td>
                            <td>{p.enabled ? '🟢 ON' : '⏸ OFF'}</td>
                            {guji && (
                              <td class="inline-actions">
                                <form method="post" action={`/gacha/prizes/${p.id}`} id={f}>
                                  {csrf}
                                  <button type="submit" class="ok">
                                    保存
                                  </button>
                                </form>
                                <form method="post" action={`/gacha/prizes/${p.id}/toggle`}>
                                  {csrf}
                                  <button type="submit">{p.enabled ? 'OFF にする' : 'ON にする'}</button>
                                </form>
                                <form method="post" action={`/gacha/prizes/${p.id}/delete`}>
                                  {csrf}
                                  <button type="submit" class="danger">
                                    削除
                                  </button>
                                </form>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        })}
      </section>

      {guji && (
        <section class="card anchor" id="gacha-add">
          <h2>中身を足す</h2>
          <p class="note">足したい種類のところで、運勢と中身を選んで「足す」を押してください。重みは同じ運勢の中での出やすさです（ほかの中身が 1 なら、2 で 2 倍出やすい）。</p>
          <div class="prize-add">
            <form method="post" action="/gacha/prizes" class="card prize-kind">
              {csrf}
              <input type="hidden" name="kind" value="role" />
              <h3>🎀 限定ロール</h3>
              <p class="note">物御籤でしか手に入らない色守り・称号など。持っている人には出ません。ロールは「ロール」ページで先に作ってください（BOT のロールより下に）。</p>
              <TierPick rates={rates} />
              <label class="field">
                <span>ロール</span>
                <select name="roleId" required>
                  <option value="">選んでください</option>
                  {props.roles.map((r) => (
                    <option value={r.id}>{r.name}</option>
                  ))}
                </select>
              </label>
              <WeightFields />
              <button type="submit" class="ok">
                足す
              </button>
            </form>

            <form method="post" action="/gacha/prizes" class="card prize-kind">
              {csrf}
              <input type="hidden" name="kind" value="ticket" />
              <h3>🎟 券</h3>
              <p class="note">部屋代・授与所の割引・使うと効く札など。</p>
              <TierPick rates={rates} />
              <label class="field">
                <span>券</span>
                <TicketSelect name="ticket" />
              </label>
              <label class="field">
                <span>枚数（1〜100）</span>
                <input type="number" name="amount" value="1" min={1} max={100} required />
              </label>
              <WeightFields />
              <button type="submit" class="ok">
                足す
              </button>
            </form>

            <form method="post" action="/gacha/prizes" class="card prize-kind">
              {csrf}
              <input type="hidden" name="kind" value="coins" />
              <h3>
                {props.coinEmoji} {props.coinName}
              </h3>
              <p class="note">
                お賽銭返し。はずれの代わりに少し、大吉に大きく、など（1 回の値段は {fmt(g.price)} 枚）。
              </p>
              <TierPick rates={rates} />
              <label class="field">
                <span>枚数</span>
                <input type="number" name="amount" value="100" min={1} max={1000000} required />
              </label>
              <WeightFields />
              <button type="submit" class="ok">
                足す
              </button>
            </form>

            <form method="post" action="/gacha/prizes" class="card prize-kind">
              {csrf}
              <input type="hidden" name="kind" value="shop" />
              <h3>🛍 ショップの品</h3>
              <p class="note">授与所のロールの品（色守り・称号・開業権利など）。ショップで止めている品も出せます。期限つきは持っていれば延長、同じ組の色は入れ替え。</p>
              <TierPick rates={rates} />
              <label class="field">
                <span>品</span>
                <select name="shopItemId" required>
                  <option value="">選んでください</option>
                  {props.shopItems.map((i) => (
                    <option value={String(i.id)}>
                      {i.emoji}
                      {i.name}
                      {i.durationDays ? `（${i.durationDays} 日）` : '（ずっと）'}
                      {i.enabled ? '' : '（ショップでは止めている）'}
                    </option>
                  ))}
                </select>
              </label>
              <WeightFields />
              <button type="submit" class="ok">
                足す
              </button>
            </form>

            <form method="post" action="/gacha/prizes" class="card prize-kind">
              {csrf}
              <input type="hidden" name="kind" value="special" />
              <h3>🎊 運営が渡す賞品</h3>
              <p class="note">
                Discord Nitro など、運営が手で渡すもの。当たると運営のチャンネル（呼び鈴の知らせ先か #記録）に知らせ、当たった人に DM します。渡したら下の「🎊 運営が渡す賞品」で「渡した」を押してください。ふつうは🎊超大当たりに入れます。
              </p>
              <TierPick rates={rates} checked="super" />
              <label class="field">
                <span>賞品の名前</span>
                <input type="text" name="label" maxlength={100} placeholder="例: Discord Nitro 1 か月分" required />
              </label>
              <label class="field">
                <span>残りの数（空にするといくらでも。0 になったら出ない）</span>
                <input type="number" name="stock" value="1" min={0} max={1000} />
              </label>
              <WeightFields />
              <button type="submit" class="ok">
                足す
              </button>
            </form>
          </div>
        </section>
      )}

      {guji && props.reset && (
        <section class="card anchor danger-zone" id="gacha-reset">
          <h2>🗑 物御籤をリセット</h2>
          {props.reset.draws === 0 ? (
            <p class="empty">引かれた記録がないので、リセットするものはありません。</p>
          ) : (
            <>
              <p>
                これまでに引かれた <strong>{fmt(props.reset.draws)} 回</strong>（{props.reset.members} 人）を取り消します。
              </p>
              <ul>
                <li>
                  払った{props.coinName} <strong>{fmt(props.reset.refund)} 枚</strong> を、それぞれに返します
                </li>
                <li>
                  出たものを取り上げます: {props.coinName} {fmt(props.reset.coins)} 枚・券 {fmt(props.reset.tickets)} 枚・ロール {fmt(props.reset.roles)} 個（{props.coinName}と券は、残っている分まで）
                </li>
                <li>引いた記録と、天井までの回数も消します（中身と設定はそのまま）</li>
              </ul>
              <form method="post" action="/gacha/reset">
                {csrf}
                <label class="field">
                  <span>
                    元に戻せません。よければ <strong>リセット</strong> と入れてください
                  </span>
                  <input type="text" name="confirm" required autocomplete="off" />
                </label>
                <label class="field check">
                  <input type="checkbox" name="dm" value="yes" checked />
                  <span>引いた人に DM で知らせる</span>
                </label>
                <button type="submit" class="danger">
                  リセットする
                </button>
              </form>
            </>
          )}
        </section>
      )}

      <section class="card anchor" id="gacha-claims">
        <h2>🎊 運営が渡す賞品</h2>
        {props.claims.length === 0 ? (
          <p class="empty">まだ当たりはありません。</p>
        ) : (
          <table class="compact">
            <thead>
              <tr>
                <th>当たった日時</th>
                <th>メンバー</th>
                <th>賞品</th>
                <th>渡した</th>
              </tr>
            </thead>
            <tbody>
              {props.claims.map((cl) => (
                <tr>
                  <td>{fmtDateTime(cl.createdAt)}</td>
                  <td>{who(cl.memberId)}</td>
                  <td class="wrap">🎊 {cl.label}</td>
                  <td>
                    {cl.deliveredAt ? (
                      <span>
                        ✅ {fmtDateTime(cl.deliveredAt)}
                        {cl.deliveredBy && <small> {props.names.get(cl.deliveredBy) ?? cl.deliveredBy}</small>}
                      </span>
                    ) : guji ? (
                      <form method="post" action={`/gacha/claims/${cl.id}/done`}>
                        {csrf}
                        <button type="submit" class="ok">
                          渡した
                        </button>
                      </form>
                    ) : (
                      <span class="tag red">まだ</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  <td class="wrap">{prizeCell(d, roleName, shopById)}</td>
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
                <th>持っている券</th>
              </tr>
            </thead>
            <tbody>
              {props.holders.map((h) => (
                <tr>
                  <td>{who(h.memberId)}</td>
                  <td class="wrap">
                    <TicketList tickets={h.tickets} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {guji && <p class="note">券を渡す・減らすのはメンバーのページからできます。</p>}
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
                    <td class="wrap">{prizeCell(d, roleName, shopById)}</td>
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
      <p>
        🎟 持っている券: <TicketList tickets={props.tickets} />
      </p>
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
          <TicketSelect name="kind" />
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

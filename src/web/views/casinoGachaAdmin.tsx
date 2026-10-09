import type { CasinoGachaConfig } from '../../config.js';
import type { casinoStyleDraws } from '../../db/schema.js';
import { GACHA_RANGES, type GachaSummary } from '../../services/casino/gachaStats.js';
import { GIVABLE_STYLES, STYLE_ITEMS, STYLE_SLOTS, drawCost, styleChances, styleItem, styleWeight, type StyleState } from '../../services/casino/styles.js';
import { CasinoAdminTabs } from './casinoAdmin.js';
import { Layout, type SessionView } from './layout.js';

/**
 * 🎴 勝負の御籤のタブ（社務所Web）: 値段・天井・割合・品ごとの出やすさと名前（宮司が変える）、期間ごとの回数と売上・品ごとに出た数・最近の引いた記録
 */

const fmt = (n: number) => n.toLocaleString('ja-JP');
const pct = (n: number) => `${n.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}％`;

export const GACHA_ADMIN_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '🎴 勝負の御籤の設定を保存しました（1 分以内に反映されます）。', kind: 'ok' },
  invalid: { text: '保存できませんでした。値段・天井・割合（見た目の品と大勝負の札の合計は 100％まで）・出やすさ（0〜100）・名前（30 文字まで）を確かめてください。', kind: 'warn' },
};

type Draw = typeof casinoStyleDraws.$inferSelect;

export function CasinoGachaAdminPage(p: {
  session: SessionView;
  g: CasinoGachaConfig;
  coinName: string;
  summaries: GachaSummary[];
  counts: Map<string, number>;
  recent: Draw[];
  names: Map<string, string>;
  guji: boolean;
  flash?: string;
}) {
  const { g } = p;
  const f = p.flash && Object.hasOwn(GACHA_ADMIN_FLASH, p.flash) ? GACHA_ADMIN_FLASH[p.flash] : undefined;
  // はじめて引く人（何も持っていない人）の出る割合
  const chances = new Map(styleChances(g, []).map((i) => [i.key, i.chance]));
  const pulls30 = [...p.counts.values()].reduce((n, x) => n + x, 0);
  const off = !p.guji;
  return (
    <Layout title="勝負の御籤" session={p.session} nav="casino">
      <h1>🎴 勝負の御籤</h1>
      <CasinoAdminTabs on="gacha" />
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}

      <section class="card">
        <h2>📊 回数と売上</h2>
        <table class="compact">
          <thead>
            <tr>
              <th>期間</th>
              <th class="num">押した回数</th>
              <th class="num">引いた数（10 連は 10）</th>
              <th class="num">売上（{p.coinName}）</th>
              <th class="num">引いた人</th>
            </tr>
          </thead>
          <tbody>
            {p.summaries.map((s) => (
              <tr>
                <td>{GACHA_RANGES[s.range].label}</td>
                <td class="num">{fmt(s.draws)}</td>
                <td class="num">{fmt(s.pulls)}</td>
                <td class="num">{fmt(s.sales)}</td>
                <td class="num">{fmt(s.players)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="note">売上は、引いた人が払った{p.coinName}です（サーバーから出回る{p.coinName}が減った分）。</p>
      </section>

      <form method="post" action="/economy/casino/gacha" class="card">
        <input type="hidden" name="_csrf" value={p.session.csrfToken} />
        <h2>⚙ 値段・天井・割合</h2>
        {off && <p class="note">変えられるのは宮司だけです。</p>}
        <div class="fields">
          <label class="field check">
            <input type="checkbox" name="enabled" value="yes" checked={g.enabled} disabled={off} />
            <span>開く（外すとお休み。中身の紹介は見られる）</span>
          </label>
          <label class="field">
            <span>祈願所のチャンネル ID（御籤を引くところ）</span>
            <input type="text" name="prayerChannelId" inputmode="numeric" pattern="[0-9]{17,20}" value={g.prayerChannelId} required disabled={off} />
          </label>
          <label class="field">
            <span>1 回の値段（{p.coinName}）</span>
            <input type="number" name="price" min={1} max={100000} value={String(g.price)} required disabled={off} />
          </label>
          <label class="field">
            <span>10 連の値段（0 なら 1 回 × 10 ＝ {fmt(g.price * 10)}。いま {fmt(drawCost(g, 10))}）</span>
            <input type="number" name="tenPrice" min={0} max={1000000} value={String(g.tenPrice)} required disabled={off} />
          </label>
          <label class="field">
            <span>天井（この回数までに、まだ持っていない見た目の品が必ず出る）</span>
            <input type="number" name="pity" min={1} max={1000} value={String(g.pity)} required disabled={off} />
          </label>
          <label class="field">
            <span>見た目の品の割合（％）</span>
            <input type="number" name="cosmeticPercent" min={0} max={100} step="0.1" value={String(g.cosmeticPercent)} required disabled={off} />
          </label>
          <label class="field">
            <span>大勝負の札の割合（％）</span>
            <input type="number" name="boostPercent" min={0} max={100} step="0.1" value={String(g.boostPercent)} required disabled={off} />
          </label>
        </div>
        <p class="note">
          残り（100％ − 見た目の品 − 大勝負の札）は見た目のお試し券です。見た目の品の割合は、その人がまだ持っていない「出す」品の中で、出やすさ（重み）に合わせて分けます。全部そろった人は、見た目の品の分もお試し券になります。
        </p>

        <h2>🎁 品ごと（出す・出やすさ・名前）</h2>
        <p class="note">
          出やすさは重みです（1 が標準・2 で 2 倍出やすい・0.5 で半分・0 で出さない）。「出す」を外した品は御籤から出ません（もう持っている人はそのまま使えます）。名前・絵文字・説明を空にすると、はじめの名前に戻ります。「今の割合」は、何も持っていない人が引いたときの割合です。
        </p>
        <div class="table-wrap">
          <table class="compact">
            <thead>
              <tr>
                <th>品</th>
                <th>種類</th>
                <th>出す</th>
                <th>出やすさ</th>
                <th>名前</th>
                <th>絵文字</th>
                <th>説明</th>
                <th class="num">今の割合</th>
                <th class="num">30 日で出た数</th>
              </tr>
            </thead>
            <tbody>
              {STYLE_ITEMS.map((base) => {
                const i = styleItem(base.key)!;
                const o = g.items[base.key];
                const fixed = base.key === 'trial';
                return (
                  <tr>
                    <td>
                      {i.emoji} {i.name}
                      {(o?.name || o?.emoji || o?.note) && <small class="reason">はじめ: {base.emoji} {base.name}</small>}
                    </td>
                    <td>{base.slot ? STYLE_SLOTS[base.slot] : base.key === 'boost' ? '券（持ち物）' : '券（着せ替え）'}</td>
                    <td>
                      {fixed ? (
                        <span class="note">いつも（残り）</span>
                      ) : (
                        <input type="checkbox" name={`on.${base.key}`} value="yes" checked={o?.enabled !== false} disabled={off} aria-label={`${base.name}を出す`} />
                      )}
                    </td>
                    <td>
                      {base.slot ? (
                        <input type="number" name={`w.${base.key}`} min={0} max={100} step="0.1" value={String(o?.weight ?? 1)} disabled={off} aria-label={`${base.name}の出やすさ`} />
                      ) : (
                        <span class="note">割合で決める</span>
                      )}
                    </td>
                    <td>
                      <input type="text" name={`name.${base.key}`} maxlength={30} value={o?.name ?? ''} placeholder={base.name} disabled={off} aria-label={`${base.name}の名前`} />
                    </td>
                    <td>
                      <input type="text" name={`emoji.${base.key}`} maxlength={16} value={o?.emoji ?? ''} placeholder={base.emoji} disabled={off} aria-label={`${base.name}の絵文字`} />
                    </td>
                    <td>
                      <input type="text" name={`note.${base.key}`} maxlength={100} value={o?.note ?? ''} placeholder={base.note} disabled={off} aria-label={`${base.name}の説明`} />
                    </td>
                    <td class="num">{pct(chances.get(base.key) ?? 0)}</td>
                    <td class="num">{fmt(p.counts.get(base.key) ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p class="note">30 日で引いた数 {fmt(pulls30)}。見た目の品の重みの合計 {fmt(STYLE_ITEMS.filter((i) => i.slot).reduce((n, i) => n + styleWeight(g, i.key), 0))}。</p>
        {!off && (
          <button type="submit" class="ok">
            保存する
          </button>
        )}
      </form>

      <section class="card">
        <h2>🧾 最近の引いた記録（新しい順・50 件）</h2>
        {p.recent.length === 0 ? (
          <p class="empty">まだだれも引いていません。</p>
        ) : (
          <table class="compact">
            <thead>
              <tr>
                <th>日時</th>
                <th>引いた人</th>
                <th class="num">回数</th>
                <th class="num">{p.coinName}</th>
                <th>出た品</th>
              </tr>
            </thead>
            <tbody>
              {p.recent.map((d) => (
                <tr>
                  <td>{d.at.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>
                    <a href={`/members/${d.memberId}`}>{p.names.get(d.memberId) ?? d.memberId}</a>
                  </td>
                  <td class="num">{d.results.length}</td>
                  <td class="num">{fmt(d.cost)}</td>
                  <td>{d.results.map((k) => `${styleItem(k)?.emoji ?? ''}${styleItem(k)?.name ?? k}`).join('・')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Layout>
  );
}

/** メンバー詳細の「🎴 勝負の御籤の品」: 持っている見た目の品・お試し券と、宮司が渡す・取り上げるフォーム */
export function CasinoStyleMemberSection(p: { memberId: string; csrf: string; state: StyleState; guji: boolean }) {
  const owned = p.state.owned.map((k) => styleItem(k)).filter((i): i is NonNullable<typeof i> => !!i);
  return (
    <section class="card anchor" id="sec-style">
      <h2>🎴 勝負の御籤の品（カジノの見た目）</h2>
      <p>
        {owned.length ? owned.map((i) => `${i.emoji} ${i.name}`).join('・') : '見た目の品はまだありません。'}
        <small class="reason">お試し券 {p.state.tickets} 枚・天井まで あと {p.state.pity} 回分引いた</small>
      </p>
      {p.guji && (
        <form method="post" action={`/members/${p.memberId}/casino-style`} class="actions">
          <input type="hidden" name="_csrf" value={p.csrf} />
          <h3>渡す・取り上げる（宮司）</h3>
          <div class="inline-actions">
            <label class="field check">
              <input type="radio" name="mode" value="give" checked />
              <span>渡す</span>
            </label>
            <label class="field check">
              <input type="radio" name="mode" value="take" />
              <span>取り上げる（渡しまちがえたとき）</span>
            </label>
          </div>
          <select name="styleKey" required aria-label="品">
            <option value="">品を選んでください</option>
            <option value="__all__">🎁 見た目の品を全部（持っていない品だけ・お試し券はのぞく）</option>
            {GIVABLE_STYLES.map((base) => {
              const i = styleItem(base.key)!;
              return (
                <option value={i.key}>
                  {i.emoji} {i.name}
                  {base.key !== 'trial' && p.state.owned.includes(base.key) ? '（持っている）' : ''}
                </option>
              );
            })}
          </select>
          <input type="text" name="note" maxlength={200} placeholder="理由（必須・記録に残る。DM にも載る）" required />
          <label class="field check">
            <input type="checkbox" name="dm" value="yes" checked />
            <span>渡したことを本人に DM で知らせる</span>
          </label>
          <button type="submit" class="ok">
            実行する
          </button>
          <p class="note">見た目の品は 1 人 1 つ（もう持っていれば渡せません）。お試し券は 1 枚ずつ。🎰 大勝負の札は、下の「券を渡す」から渡せます。</p>
        </form>
      )}
    </section>
  );
}

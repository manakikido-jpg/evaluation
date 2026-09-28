import type { EconomyConfig } from '../../config.js';
import type { AdminSession, ShopItem, ShopPurchase } from '../../db/schema.js';
import type { GuildRole } from '../../lib/discordRest.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

export const SHOP_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '保存しました。Discord のショップには、次に一覧を開いたときから反映されます。', kind: 'ok' },
  created: { text: '授与品を追加しました。', kind: 'ok' },
  deleted: { text: '授与品を消しました（買った人のロールはそのまま、期限が来たら外れます）。', kind: 'ok' },
  invalid: { text: '入力を確かめてください（名前は必須、値段・日数は 0 以上の数）。', kind: 'warn' },
  role_taken: { text: 'そのロールは、もうほかの授与品に使われています。', kind: 'warn' },
};

const KIND_LABEL: Record<ShopItem['kind'], string> = {
  role: 'ロール',
  hanafubuki: '花吹雪',
  gift: '贈り物',
  ema_pin: '絵馬の奉納',
  omikuji_extra: 'おみくじもう 1 回',
  menzaifu: '免罪符',
  otoshidama: 'お年玉袋',
  mycolor: '自分だけの色',
};

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

function Flash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(SHOP_FLASH, props.code) ? SHOP_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}

export function ShopPage(props: {
  session: AdminSession;
  items: ShopItem[];
  roles: GuildRole[];
  purchases: ShopPurchase[];
  names: Map<string, string>;
  economy: EconomyConfig;
  flash?: string;
}) {
  const { session, economy: e } = props;
  const roleName = (id: string | null) => (id ? (props.roles.find((r) => r.id === id)?.name ?? `（見つからないロール ${id}）`) : '');
  const itemName = (id: number) => props.items.find((i) => i.id === id)?.name ?? `#${id}`;
  const usedRoles = new Set(props.items.map((i) => i.roleId).filter(Boolean));
  const freeRoles = props.roles.filter((r) => !r.managed && r.name !== '@everyone' && !usedRoles.has(r.id)).sort((a, b) => b.position - a.position);
  return (
    <Layout title="ショップ" session={session} nav="shop">
      <div class="page-head">
        <h1>🛍 ショップ（授与品）</h1>
        <a class="button-link primary" href="#shop-add">
          ＋ ロールの品物を追加
        </a>
      </div>
      <Flash code={props.flash} />
      <p class="note">
        #授与所 の「授与品を見る」に並ぶ品物です。行を押すと、値段・名前・説明・日数・販売のオン／オフを変えられます。免罪符の値段と、贈り物の量の上限は
        <a href="/settings#sec-coins">設定</a>で変えます。
      </p>

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">品物</span>
          <span class="ch-count">{props.items.length}</span>
          <span class="note">販売中 {props.items.filter((i) => i.enabled).length}</span>
        </div>
        <ul class="ch-list">
          {props.items.map((i) => (
            <li class={`item-row${i.enabled ? '' : ' off'}`}>
              <details>
                <summary class="ch-row">
                  <span class="ch-icon big" aria-hidden="true">
                    {i.emoji || '🎁'}
                  </span>
                  <div class="ch-main">
                    <div class="ch-line">
                      <span class="ch-name">{i.name}</span>
                      <span class="ch-tags">
                        <span class="tag gray">{KIND_LABEL[i.kind]}</span>
                        {!i.enabled && <span class="tag gray">お休み</span>}
                        {i.boosterOnly && <span class="tag red">🏮 奉納限定</span>}
                        {i.durationDays !== null && (i.kind === 'role' || i.kind === 'ema_pin' || i.kind === 'mycolor') && <span class="tag gray">{i.durationDays} 日</span>}
                      </span>
                    </div>
                    <div class="ch-topic">
                      {i.kind === 'role' ? `ロール: ${roleName(i.roleId)}${i.roleGroup === 'color' ? '（色守り）' : ''} ・ ` : ''}
                      {i.description}
                    </div>
                  </div>
                  <span class="ch-actions">
                    <span class="price">
                      {i.kind === 'menzaifu'
                        ? e.menzaifuPrice
                        : i.kind === 'gift'
                          ? `${e.giftMin}〜${e.giftMax}`
                          : i.kind === 'otoshidama'
                            ? `好きな量＋手数料 ${i.price.toLocaleString('ja-JP')}`
                            : i.price.toLocaleString('ja-JP')}{' '}
                      銭
                    </span>
                    <span class="button-link small">編集</span>
                  </span>
                </summary>
                <form method="post" action={`/shop/items/${i.id}`} class="shop-item">
                  <Csrf session={session} />
                  <div class="fields">
                    <label class="field">
                      <span>絵文字</span>
                      <input type="text" name="emoji" value={i.emoji} maxlength={10} />
                    </label>
                    <label class="field">
                      <span>名前</span>
                      <input type="text" name="name" value={i.name} maxlength={60} required />
                    </label>
                    <label class="field">
                      <span>{i.kind === 'otoshidama' ? '手数料（銭。袋に入れる量とは別に払う）' : '値段（銭）'}</span>
                      {i.kind === 'menzaifu' ? (
                        <input type="text" value={`${e.menzaifuPrice}（設定で変える）`} disabled />
                      ) : i.kind === 'gift' ? (
                        <input type="text" value={`${e.giftMin}〜${e.giftMax}（設定で変える）`} disabled />
                      ) : (
                        <input type="number" name="price" value={String(i.price)} min={0} required />
                      )}
                    </label>
                    {(i.kind === 'role' || i.kind === 'ema_pin' || i.kind === 'mycolor') && (
                      <label class="field">
                        <span>日数（空でずっと）</span>
                        <input type="number" name="durationDays" value={i.durationDays === null ? '' : String(i.durationDays)} min={1} />
                      </label>
                    )}
                    <label class="field">
                      <span>並び順</span>
                      <input type="number" name="position" value={String(i.position)} />
                    </label>
                  </div>
                  <label class="field">
                    <span>説明</span>
                    <input type="text" name="description" value={i.description} maxlength={100} />
                  </label>
                  {i.kind === 'mycolor' && (
                    <p class="note">
                      買った人ごとに、BOT が「🎨 名前」の色ロールを作って付けます（その人の色つきのロールより上に置くので、名前がその色になる）。期限が来たらロールごと消します。もう一度買うと色を変えて期間が延びます。
                    </p>
                  )}
                  {i.kind === 'otoshidama' && (
                    <p class="note">
                      買った人が 100〜10,000 枚・2〜20 人分の袋をチャンネルに置き、先着の人が「もらう」で受け取ります（1 人ずつの量は運しだい。1 人 1 回・入鯖が承認された人だけ）。24 時間で締め切り、残りは置いた人に戻ります。置けるのは贈り物と同じく 2 段目の役職以上。
                    </p>
                  )}
                  {i.kind === 'role' && (
                    <p class="note">
                      ロール: {roleName(i.roleId)}
                      {i.roleGroup === 'color' ? '（色守り: 買い替えると前の色は外れる）' : ''}
                    </p>
                  )}
                  <div class="inline-actions">
                    <label class="field check">
                      <input type="checkbox" name="enabled" value="yes" checked={i.enabled} />
                      <span>販売する</span>
                    </label>
                    {i.kind !== 'menzaifu' && i.kind !== 'gift' && i.kind !== 'otoshidama' && (
                      <label class="field check">
                        <input type="checkbox" name="boosterOnly" value="yes" checked={i.boosterOnly} />
                        <span>🏮 奉納限定（ブーストしている人だけ。ロールは奉納をやめると外れる）</span>
                      </label>
                    )}
                    <button type="submit" class="ok">
                      保存
                    </button>
                  </div>
                </form>
                {i.kind === 'role' && (
                  <form method="post" action={`/shop/items/${i.id}/delete`} class="inline-actions item-delete">
                    <Csrf session={session} />
                    <label class="field check">
                      <input type="checkbox" name="confirm" value="yes" required />
                      <span>この品物を消す（ロールは残る）</span>
                    </label>
                    <button type="submit" class="danger">
                      消す
                    </button>
                  </form>
                )}
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section class="card anchor" id="shop-add">
        <h2>＋ ロールの品物を追加</h2>
        <p class="note">Discord で作ったロールを、授与品にできます（色守り・称号など）。BOT のロールより下にあるロールだけ付け外しできます。</p>
        <form method="post" action="/shop/items" class="shop-item">
          <Csrf session={session} />
          <div class="fields">
            <label class="field">
              <span>ロール</span>
              <select name="roleId" required>
                <option value="">選んでください</option>
                {freeRoles.map((r) => (
                  <option value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>種類</span>
              <select name="roleGroup">
                <option value="color">色守り（1 人 1 色まで）</option>
                <option value="title">称号</option>
                <option value="">そのほか</option>
              </select>
            </label>
            <label class="field">
              <span>絵文字</span>
              <input type="text" name="emoji" maxlength={10} />
            </label>
            <label class="field">
              <span>名前</span>
              <input type="text" name="name" maxlength={60} required />
            </label>
            <label class="field">
              <span>値段（銭）</span>
              <input type="number" name="price" min={0} value="1500" required />
            </label>
            <label class="field">
              <span>日数（空でずっと）</span>
              <input type="number" name="durationDays" min={1} value="30" />
            </label>
          </div>
          <label class="field">
            <span>説明</span>
            <input type="text" name="description" maxlength={100} />
          </label>
          <label class="field check">
            <input type="checkbox" name="boosterOnly" value="yes" />
            <span>🏮 奉納限定（ブーストしている人だけ。奉納をやめると外れる）</span>
          </label>
          <button type="submit" class="ok">
            追加
          </button>
        </form>
      </section>

      <section class="card">
        <h2>最近の購入</h2>
        {props.purchases.length === 0 ? (
          <p class="empty">まだありません。</p>
        ) : (
          <table class="compact">
            <thead>
              <tr>
                <th>日時</th>
                <th>買った人</th>
                <th>授与品</th>
                <th class="num">値段</th>
                <th>相手・期限</th>
              </tr>
            </thead>
            <tbody>
              {props.purchases.map((p) => (
                <tr class={p.endedAt && !p.expiresAt ? 'revoked' : ''}>
                  <td>{fmtDateTime(p.createdAt)}</td>
                  <td>
                    <a href={`/members/${p.memberId}`}>{props.names.get(p.memberId) ?? p.memberId}</a>
                  </td>
                  <td>{itemName(p.itemId)}</td>
                  <td class="num">{p.price}</td>
                  <td>
                    {p.targetId ? `→ ${props.names.get(p.targetId) ?? p.targetId}` : ''}
                    {p.expiresAt ? `${fmtDateTime(p.expiresAt)} まで${p.endedAt ? '（終了）' : ''}` : p.endedAt ? '払い戻し・終了' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Layout>
  );
}

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
      <h1>ショップ（授与品）</h1>
      <Flash code={props.flash} />
      <p class="note">
        #授与所 の「授与品を見る」に並ぶ品物です。値段・名前・説明・日数・販売のオン／オフをここで変えられます。免罪符の値段と、贈り物の量の上限は
        <a href="/settings">設定</a>で変えます。
      </p>

      <section class="card">
        <h2>品物</h2>
        <div class="shop-items">
          {props.items.map((i) => (
            <form method="post" action={`/shop/items/${i.id}`} class={`shop-item${i.enabled ? '' : ' off'}`}>
              <Csrf session={session} />
              <div class="shop-item-head">
                <span class="tag gray">{KIND_LABEL[i.kind]}</span>
                {i.kind === 'role' && <small>ロール: {roleName(i.roleId)}{i.roleGroup === 'color' ? '（色守り: 買い替えると前の色は外れる）' : ''}</small>}
              </div>
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
                  <span>値段（花びら）</span>
                  {i.kind === 'menzaifu' ? (
                    <input type="text" value={`${e.menzaifuPrice}（設定で変える）`} disabled />
                  ) : i.kind === 'gift' ? (
                    <input type="text" value={`${e.giftMin}〜${e.giftMax}（設定で変える）`} disabled />
                  ) : (
                    <input type="number" name="price" value={String(i.price)} min={0} required />
                  )}
                </label>
                {(i.kind === 'role' || i.kind === 'ema_pin') && (
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
              <div class="inline-actions">
                <label class="field check">
                  <input type="checkbox" name="enabled" value="yes" checked={i.enabled} />
                  <span>販売する</span>
                </label>
                <button type="submit" class="ok">
                  保存
                </button>
              </div>
            </form>
          ))}
        </div>
        {props.items.filter((i) => i.kind === 'role').length > 0 && (
          <details>
            <summary>ロールの品物を消す</summary>
            {props.items
              .filter((i) => i.kind === 'role')
              .map((i) => (
                <form method="post" action={`/shop/items/${i.id}/delete`} class="inline-actions">
                  <Csrf session={session} />
                  <span>
                    {i.emoji} {i.name}
                  </span>
                  <label class="field check">
                    <input type="checkbox" name="confirm" value="yes" required />
                    <span>消す</span>
                  </label>
                  <button type="submit" class="danger">
                    消す
                  </button>
                </form>
              ))}
          </details>
        )}
      </section>

      <section class="card">
        <h2>ロールの品物を追加</h2>
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
              <span>値段（花びら）</span>
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

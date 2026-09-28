import type { AdminSession, GlossaryTerm } from '../../db/schema.js';
import { GLOSSARY_CATEGORIES, GLOSSARY_CATEGORY_KEYS, type GlossaryCategory } from '../../services/glossaryDefaults.js';
import { Layout } from './layout.js';

export const GLOSSARY_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  added: { text: '言葉を足しました。「掲示に反映」を押すと、ルールのチャンネル・#用語集 の掲示に入ります（/用語 にはすぐ出ます）。', kind: 'ok' },
  saved: { text: '保存しました。「掲示に反映」を押すと、掲示にも入ります（/用語 にはすぐ出ます）。', kind: 'ok' },
  deleted: { text: '言葉を消しました。', kind: 'ok' },
  toggled: { text: '出す・出さないを変えました。', kind: 'ok' },
  invalid: { text: '言葉と説明を入れてください（言葉は 40 文字・説明は 300 文字まで）。', kind: 'warn' },
  seeded: { text: '標準の言葉を入れました。内容を見て、よければ「掲示に反映」を押してください。', kind: 'ok' },
  seeded_none: { text: '入れる言葉はありませんでした（もう入っています）。', kind: 'ok' },
  synced: { text: '掲示を作り直しました。掲示のページで内容を見て「すべて反映」を押すと Discord に出ます。', kind: 'ok' },
  synced_nochannel: { text: 'ルールのチャンネルの用語集を作り直しました。#用語集 のチャンネルがないので、カテゴリごとのカードは作っていません（下の「出すチャンネル」で選ぶか、作れます）。', kind: 'warn' },
  synced_norules: { text: '#用語集 のカードを作り直しました。ルールのチャンネル（#しきたり）は選ばれていないので、そちらの用語集は作っていません。', kind: 'warn' },
  synced_none: { text: '出すチャンネルが決まっていません。下の「出すチャンネル」で、ルールのチャンネル（#しきたり にあたるもの）か #用語集 を選んで保存してから、もう一度押してください。', kind: 'warn' },
  places_saved: { text: '出すチャンネルを保存しました。続けて「掲示に反映」を押してください。', kind: 'ok' },
  places_invalid: { text: 'そのチャンネルは選べません（テキストチャンネルを選んでください）。', kind: 'warn' },
  channel_created: { text: '#用語集 を作って、出すチャンネルにしました（読むだけ）。続けて「掲示に反映」を押してください。', kind: 'ok' },
  channel_exists: { text: '#用語集 はもうあります。', kind: 'ok' },
  channel_nocategory: { text: '#用語集 を置くカテゴリを選んでください。', kind: 'warn' },
  channel_failed: { text: '#用語集 を作れませんでした（BOT に「チャンネルの管理」の権限がないかもしれません）。', kind: 'warn' },
  discord_error: { text: 'Discord から読めませんでした。少し待ってからもう一度お試しください。', kind: 'warn' },
};

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

const catLabel = (c: string, coin: string) => (Object.hasOwn(GLOSSARY_CATEGORIES, c) ? GLOSSARY_CATEGORIES[c as GlossaryCategory].label.replaceAll('{通貨}', coin) : c);

function CategorySelect(props: { selected?: string; coin: string }) {
  return (
    <select name="category" required>
      {GLOSSARY_CATEGORY_KEYS.map((k) => (
        <option value={k} selected={props.selected === k}>
          {GLOSSARY_CATEGORIES[k].emoji} {catLabel(k, props.coin)}
        </option>
      ))}
    </select>
  );
}

/** 言葉の入力欄（足す・直すで同じ） */
function TermFields(props: { t?: GlossaryTerm; coin: string }) {
  const t = props.t;
  return (
    <div class="fields">
      <label class="field">
        <span>カテゴリ</span>
        <CategorySelect selected={t?.category} coin={props.coin} />
      </label>
      <label class="field">
        <span>絵文字（なくてもよい）</span>
        <input type="text" name="emoji" value={t?.emoji ?? ''} maxlength={16} />
      </label>
      <label class="field">
        <span>言葉</span>
        <input type="text" name="term" value={t?.term ?? ''} maxlength={40} required />
      </label>
      <label class="field">
        <span>読みがな（なくてもよい）</span>
        <input type="text" name="reading" value={t?.reading ?? ''} maxlength={40} />
      </label>
      <label class="field wide">
        <span>説明（{'{通貨}'} {'{#チャンネル名}'} などの差し込みも使える）</span>
        <input type="text" name="description" value={t?.description ?? ''} maxlength={300} required />
      </label>
      <label class="field">
        <span>別の呼び名（カンマ区切り。/用語 で探せる）</span>
        <input type="text" name="aliases" value={t?.aliases ?? ''} maxlength={100} placeholder="例: ガチャ,くじ" />
      </label>
    </div>
  );
}

export type PlaceChannel = { id: string; name: string; category: string | null };

function ChannelSelect(props: { name: string; channels: PlaceChannel[]; selected?: string; empty: string }) {
  return (
    <select name={props.name}>
      <option value="">{props.empty}</option>
      {props.channels.map((ch) => (
        <option value={ch.id} selected={props.selected === ch.id}>
          {ch.category ? `${ch.category} / ` : ''}#{ch.name}
        </option>
      ))}
    </select>
  );
}

/** 用語集を出すチャンネル（ルールのチャンネルと #用語集）を選ぶ・#用語集 を作る */
function PlacesCard(props: {
  session: AdminSession;
  places: { rulesChannelId?: string; glossaryChannelId?: string };
  current: { rules?: string; glossary?: string };
  channels: PlaceChannel[];
  categories: { id: string; name: string }[];
  defaultCategoryId?: string;
}) {
  const { places, current } = props;
  return (
    <section class="card anchor" id="glossary-places">
      <h2>📍 出すチャンネル</h2>
      <p class="note">
        今は、ルールのチャンネル: <strong>{current.rules ? `#${current.rules}` : 'なし'}</strong> ／ #用語集: <strong>{current.glossary ? `#${current.glossary}` : 'なし'}</strong>
        <br />
        選ばないときは名前で探します（「しきたり」「ルール」「用語集」など）。見つからないときは、ここで選んでください。
      </p>
      <form method="post" action="/glossary/places">
        <Csrf session={props.session} />
        <div class="fields">
          <label class="field">
            <span>ルールのチャンネル（ここに「用語集」をまとめて 1 枚）</span>
            <ChannelSelect name="rulesChannelId" channels={props.channels} selected={places.rulesChannelId} empty="（選ばない・名前で探す）" />
          </label>
          <label class="field">
            <span>#用語集（ここにカテゴリごとのカード）</span>
            <ChannelSelect name="glossaryChannelId" channels={props.channels} selected={places.glossaryChannelId} empty="（選ばない・名前で探す）" />
          </label>
        </div>
        <button type="submit" class="ok">
          保存
        </button>
      </form>
      {!current.glossary && (
        <form method="post" action="/glossary/channel" class="inline-actions">
          <Csrf session={props.session} />
          <label class="field">
            <span>#用語集 を新しく作る（読むだけのチャンネル）カテゴリ:</span>
            <select name="categoryId" required>
              <option value="">（カテゴリを選ぶ）</option>
              {props.categories.map((cat) => (
                <option value={cat.id} selected={props.defaultCategoryId === cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">#用語集 を作る</button>
        </form>
      )}
    </section>
  );
}

export function GlossaryPage(props: {
  session: AdminSession;
  terms: GlossaryTerm[];
  coin: string;
  flash?: string;
  /** 見本（差し込み済み） */
  render: (s: string) => string;
  places: { rulesChannelId?: string; glossaryChannelId?: string };
  /** 今使うチャンネルの名前（選んだもの、なければ名前で見つけたもの） */
  current: { rules?: string; glossary?: string };
  channels: PlaceChannel[];
  categories: { id: string; name: string }[];
  defaultCategoryId?: string;
  editId?: number;
}) {
  const { session } = props;
  const guji = session.level === 'guji';
  const f = props.flash && Object.hasOwn(GLOSSARY_FLASH, props.flash) ? GLOSSARY_FLASH[props.flash] : undefined;
  const groups = GLOSSARY_CATEGORY_KEYS.map((c) => ({ c, terms: props.terms.filter((t) => t.category === c) }));
  return (
    <Layout title="用語集" session={session} nav="glossary">
      <h1>📖 用語集</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        サーバーの言葉（宮司・朱印・物御籤など）とその意味です。ここで直すと、Discord の <code>/用語</code> にはすぐ出ます。ルールのチャンネル（#しきたり など）の「用語集」と #用語集
        のカテゴリごとのカードは、「掲示に反映」で作り直してから、掲示のページで「すべて反映」を押すと Discord に出ます。
      </p>

      {guji && (
        <div class="inline-actions">
          <form method="post" action="/glossary/sync">
            <Csrf session={session} />
            <button type="submit" class="ok">
              掲示に反映（{props.current.rules ? `#${props.current.rules}` : 'ルールのチャンネル'}・{props.current.glossary ? `#${props.current.glossary}` : '#用語集'}）
            </button>
          </form>
          <form method="post" action="/glossary/seed">
            <Csrf session={session} />
            <button type="submit">標準の言葉を入れる</button>
          </form>
          <a class="button-link" href="/notices">
            掲示のページへ →
          </a>
        </div>
      )}
      {guji && <p class="note">「掲示に反映」は、ルールのチャンネルの「用語集」の文面をここの言葉で置きかえます（掲示のページで手で直していた分は消えます）。</p>}
      {guji && (
        <PlacesCard
          session={session}
          places={props.places}
          current={props.current}
          channels={props.channels}
          categories={props.categories}
          defaultCategoryId={props.defaultCategoryId}
        />
      )}

      {props.terms.length === 0 && (
        <section class="card">
          <p class="empty">まだ言葉がありません。{guji ? '「標準の言葉を入れる」を押すと、今の用語集と新しい言葉（物御籤・券・札など）が入ります。' : ''}</p>
        </section>
      )}

      {groups
        .filter((g) => g.terms.length)
        .map((g) => (
          <section class="card anchor" id={`cat-${g.c}`}>
            <h2>
              {GLOSSARY_CATEGORIES[g.c].emoji} {catLabel(g.c, props.coin)}
            </h2>
            <table class="compact glossary">
              <tbody>
                {g.terms.map((t, i) =>
                  guji && props.editId === t.id ? (
                    <tr class="anchor" id={`term-${t.id}`}>
                      <td colspan={3}>
                        <form method="post" action={`/glossary/${t.id}`}>
                          <Csrf session={session} />
                          <TermFields t={t} coin={props.coin} />
                          <div class="inline-actions">
                            <button type="submit" class="ok">
                              保存
                            </button>
                            <a href={`/glossary#term-${t.id}`}>やめる</a>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr class={t.enabled ? 'anchor' : 'anchor muted'} id={`term-${t.id}`}>
                      <td class="nowrap">
                        {t.emoji} <strong>{props.render(t.term)}</strong>
                        {t.reading && <small>（{t.reading}）</small>}
                        {!t.enabled && <small>（出さない）</small>}
                      </td>
                      <td class="wrap">
                        {props.render(t.description)}
                        {t.aliases && <small class="note"> ／ 別名: {t.aliases}</small>}
                      </td>
                      {guji && (
                        <td class="nowrap">
                          <a href={`/glossary?edit=${t.id}#term-${t.id}`}>直す</a>
                          <form method="post" action={`/glossary/${t.id}/move`} class="inline">
                            <Csrf session={session} />
                            <button type="submit" name="dir" value="up" disabled={i === 0} title="上へ">
                              ↑
                            </button>
                            <button type="submit" name="dir" value="down" disabled={i === g.terms.length - 1} title="下へ">
                              ↓
                            </button>
                          </form>
                          <form method="post" action={`/glossary/${t.id}/toggle`} class="inline">
                            <Csrf session={session} />
                            <button type="submit">{t.enabled ? '出さない' : '出す'}</button>
                          </form>
                          <form method="post" action={`/glossary/${t.id}/delete`} class="inline">
                            <Csrf session={session} />
                            <button type="submit" class="danger" title="消す">
                              消す
                            </button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </section>
        ))}

      {guji && (
        <section class="card anchor" id="glossary-add">
          <h2>＋ 言葉を足す</h2>
          <form method="post" action="/glossary">
            <Csrf session={session} />
            <TermFields coin={props.coin} />
            <button type="submit" class="ok">
              足す
            </button>
          </form>
        </section>
      )}
    </Layout>
  );
}

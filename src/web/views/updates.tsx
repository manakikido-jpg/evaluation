import { CHANGELOG, type ChangelogEntry, type ChangelogKind } from '../../changelog.js';
import { fmtNewsDay, inScope, newsEmbed, type UpdateNewsSettings } from '../../services/updateNews.js';
import type { SessionView } from './layout.js';
import { Layout } from './layout.js';

export const KIND_LABEL: Record<ChangelogKind, { text: string; cls: string }> = {
  new: { text: '新機能', cls: 'red' },
  improve: { text: '改善', cls: 'green' },
  fix: { text: '修正', cls: 'gray' },
};

const fmtDay = (d: string) => `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

export const NEWS_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  news_saved: { text: '更新速報の設定を保存しました。', kind: 'ok' },
  news_posted: { text: '#更新速報 に出しました。', kind: 'ok' },
  news_nochannel: { text: '出す先のチャンネルが見つかりません。「出すチャンネル」で選んで保存してください。', kind: 'warn' },
  news_none: { text: '出す更新がありません（「出す更新」の範囲に入るものがありません）。', kind: 'warn' },
  news_failed: { text: 'Discord に出せませんでした（BOT がそのチャンネルに書き込めるか確かめてください）。', kind: 'warn' },
};

/** Discord でのカードの見た目（だいたい） */
export function NewsCardPreview(props: { e: ChangelogEntry }) {
  const card = newsEmbed(props.e);
  return (
    <div class={`news-card kind-${props.e.kind}`}>
      <div class="news-author">{card.author?.name}</div>
      <div class="news-title">{card.title}</div>
      <ul>
        {props.e.items.map((t) => (
          <li>{t}</li>
        ))}
      </ul>
      <div class="news-footer">{card.footer?.text}</div>
    </div>
  );
}

function NewsSettings(props: {
  session: SessionView;
  news: UpdateNewsSettings;
  channels: { id: string; name: string; category: string | null }[];
  currentChannel?: string;
}) {
  const { news } = props;
  const csrf = <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
  const latest = CHANGELOG.filter((e) => inScope(e, news.scope));
  const latestDay = latest[0]?.date;
  const sample = latest[0];
  return (
    <section class="card anchor" id="update-news">
      <h2>📰 Discord の #更新速報 に出す</h2>
      <p class="note">
        更新の内容を、種類ごとに色分けしたカードで Discord に出します。自動にしておくと、アップデートが入るたびに BOT が新しい分を出します（前に出した分は出しません）。
        今の出す先: <strong>{props.currentChannel ? `#${props.currentChannel}` : '見つかりません'}</strong>
      </p>
      <form method="post" action="/updates/news">
        {csrf}
        <div class="fields">
          <label class="field check">
            <input type="checkbox" name="enabled" value="yes" checked={news.enabled} />
            <span>アップデートが入ったら自動で出す</span>
          </label>
          <label class="field">
            <span>出すチャンネル</span>
            <select name="channelId">
              <option value="">（選ばない・「更新速報」の名前で探す）</option>
              {props.channels.map((c) => (
                <option value={c.id} selected={news.channelId === c.id}>
                  {c.category ? `${c.category} / ` : ''}#{c.name}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>出す更新</span>
            <select name="scope">
              <option value="discord" selected={news.scope === 'discord'}>
                Discord の変更だけ（メンバー向け）
              </option>
              <option value="all" selected={news.scope === 'all'}>
                すべて（社務所Web・サーバーの裏側も。運営だけのチャンネル向け）
              </option>
            </select>
          </label>
        </div>
        <button type="submit" class="ok">
          保存
        </button>
      </form>
      {latestDay && (
        <form method="post" action="/updates/news/post" class="inline-actions">
          {csrf}
          <input type="hidden" name="date" value={latestDay} />
          <button type="submit">いちばん新しい日（{fmtNewsDay(latestDay)}）の更新を今出す</button>
        </form>
      )}
      {sample && (
        <details>
          <summary>Discord での見た目</summary>
          <div class="news-preview">
            <div class="news-head">📰 更新速報</div>
            <div class="note">{fmtNewsDay(sample.date)}のアップデート</div>
            {(['new', 'improve', 'fix'] as const)
              .map((k) => latest.find((e) => e.kind === k))
              .filter((e): e is ChangelogEntry => Boolean(e))
              .map((e) => (
                <NewsCardPreview e={e} />
              ))}
          </div>
        </details>
      )}
    </section>
  );
}

function Entry(props: { e: ChangelogEntry; isNew: boolean; post?: { csrf: string } }) {
  const { e } = props;
  return (
    <li class="update">
      <div class="update-head">
        <span class={`tag ${KIND_LABEL[e.kind].cls}`}>{KIND_LABEL[e.kind].text}</span>
        <strong>{e.title}</strong>
        {props.isNew && <span class="tag new">NEW</span>}
        <small>{e.where.join('・')}</small>
        {props.post && (
          <form method="post" action="/updates/news/post" class="inline">
            <input type="hidden" name="_csrf" value={props.post.csrf} />
            <input type="hidden" name="id" value={e.id} />
            <button type="submit" class="link" title="この更新を #更新速報 に出す">
              📰 出す
            </button>
          </form>
        )}
      </div>
      <ul>
        {e.items.map((t) => (
          <li>{t}</li>
        ))}
      </ul>
    </li>
  );
}

/** 更新履歴（新しい順・日付ごと） */
export function UpdatesPage(props: {
  session: SessionView;
  unseenIds: Set<string>;
  flash?: string;
  /** 宮司だけ: 更新速報の設定 */
  news?: { settings: UpdateNewsSettings; channels: { id: string; name: string; category: string | null }[]; currentChannel?: string };
}) {
  const f = props.flash && Object.hasOwn(NEWS_FLASH, props.flash) ? NEWS_FLASH[props.flash] : undefined;
  const post = props.news ? { csrf: props.session.csrfToken } : undefined;
  const days: { date: string; entries: ChangelogEntry[] }[] = [];
  for (const e of CHANGELOG) {
    const last = days.at(-1);
    if (last?.date === e.date) last.entries.push(e);
    else days.push({ date: e.date, entries: [e] });
  }
  return (
    <Layout title="更新履歴" session={props.session} nav="updates">
      <h1>📰 更新履歴</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        アップデートで変わったことです（新しい順）。「Discord」はメンバーにも見える変更、「社務所Web」は運営だけ、「運用」は VPS・セットアップの変更です。
      </p>
      {props.news && <NewsSettings session={props.session} news={props.news.settings} channels={props.news.channels} currentChannel={props.news.currentChannel} />}
      {days.map((d) => (
        <section class="card">
          <h2>{fmtDay(d.date)}</h2>
          <ul class="updates">
            {d.entries.map((e) => (
              <Entry e={e} isNew={props.unseenIds.has(e.id)} post={post} />
            ))}
          </ul>
        </section>
      ))}
    </Layout>
  );
}

/** ホームに出す、最近の更新 */
export function RecentUpdates(props: { unseen: number }) {
  return (
    <section class="card">
      <h2>
        最近の更新{props.unseen > 0 && <span class="tag new">{props.unseen} 件の新しい更新</span>}
      </h2>
      <ul class="recent-updates">
        {CHANGELOG.slice(0, 3).map((e) => (
          <li>
            <span class={`tag ${KIND_LABEL[e.kind].cls}`}>{KIND_LABEL[e.kind].text}</span> {e.title} <small>{`${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8, 10))}`}</small>
          </li>
        ))}
      </ul>
      <p class="more">
        <a href="/updates">更新履歴をすべて見る →</a>
      </p>
    </section>
  );
}

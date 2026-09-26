import { CHANGELOG, type ChangelogEntry, type ChangelogKind } from '../../changelog.js';
import type { SessionView } from './layout.js';
import { Layout } from './layout.js';

export const KIND_LABEL: Record<ChangelogKind, { text: string; cls: string }> = {
  new: { text: '新機能', cls: 'red' },
  improve: { text: '改善', cls: 'green' },
  fix: { text: '修正', cls: 'gray' },
};

const fmtDay = (d: string) => `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

function Entry(props: { e: ChangelogEntry; isNew: boolean }) {
  const { e } = props;
  return (
    <li class="update">
      <div class="update-head">
        <span class={`tag ${KIND_LABEL[e.kind].cls}`}>{KIND_LABEL[e.kind].text}</span>
        <strong>{e.title}</strong>
        {props.isNew && <span class="tag new">NEW</span>}
        <small>{e.where.join('・')}</small>
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
export function UpdatesPage(props: { session: SessionView; unseenIds: Set<string> }) {
  const days: { date: string; entries: ChangelogEntry[] }[] = [];
  for (const e of CHANGELOG) {
    const last = days.at(-1);
    if (last?.date === e.date) last.entries.push(e);
    else days.push({ date: e.date, entries: [e] });
  }
  return (
    <Layout title="更新履歴" session={props.session} nav="updates">
      <h1>更新履歴</h1>
      <p class="note">
        アップデートで変わったことです（新しい順）。「Discord」はメンバーにも見える変更、「社務所Web」は運営だけ、「運用」は VPS・セットアップの変更です。
      </p>
      {days.map((d) => (
        <section class="card">
          <h2>{fmtDay(d.date)}</h2>
          <ul class="updates">
            {d.entries.map((e) => (
              <Entry e={e} isNew={props.unseenIds.has(e.id)} />
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

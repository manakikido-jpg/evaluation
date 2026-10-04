import { classOf, fmtOdds, KB_APT, KB_BET_LABEL, KB_CLASSES, KB_COATS, KB_GOINGS, KB_SEXES, KB_STYLES, KB_SURFACES, isKbBetType } from '../../services/casino/keiba.js';
import type { DirectoryRow, HorseProfile, KeibaBetRow, MyBetStats, Tally } from '../../services/casino/keibaRecords.js';
import { CasinoLayout, type CasinoMe } from './casino.js';

/**
 * 🏇 みんなでダービーの成績ページ: 馬の成績（1 走ずつ）・馬名鑑・自分の馬券成績
 */

const fmt = (n: number) => n.toLocaleString('ja-JP');
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');
const NO = '①②③④⑤⑥⑦⑧';
const dateJst = (d: Date) => {
  const j = new Date(d.getTime() + 9 * 3_600_000);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, '0')}:${String(j.getUTCMinutes()).padStart(2, '0')}`;
};
const record = (t: { starts: number; wins: number; seconds?: number; thirds?: number; top2?: number; top3?: number }) => {
  const second = t.seconds ?? (t.top2 ?? 0) - t.wins;
  const third = t.thirds ?? (t.top3 ?? 0) - (t.top2 ?? 0);
  return `[${t.wins}-${second}-${third}-${Math.max(0, t.starts - t.wins - second - third)}]`;
};

const Back = () => (
  <p class="c-back">
    <a href="/casino/tables/keiba">← みんなでダービーへ</a>
  </p>
);

const Silk = (p: { silk: { base: string; accent: string; pattern: number } }) => <span class={`kb-silk kb-pat${p.silk.pattern}`} data-base={p.silk.base} data-accent={p.silk.accent} aria-hidden="true"></span>;

/** 馬名（成績ページへのリンク） */
export const HorseLink = (p: { id: number; name: string }) => (p.id > 0 ? <a href={`/casino/keiba/horse/${p.id}`}>{p.name}</a> : <>{p.name}</>);

function TallyRows(p: { rows: { label: string; t: Tally }[] }) {
  return (
    <table class="kb-rec-table">
      <thead>
        <tr>
          <th class="l"></th>
          <th>成績</th>
          <th>勝率</th>
          <th>連対率</th>
          <th>複勝率</th>
        </tr>
      </thead>
      <tbody>
        {p.rows.map((r) => (
          <tr>
            <th class="l">{r.label}</th>
            <td>{record(r.t)}</td>
            <td>{pct(r.t.wins, r.t.starts)}</td>
            <td>{pct(r.t.top2, r.t.starts)}</td>
            <td>{pct(r.t.top3, r.t.starts)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 🐎 馬の成績ページ */
export function KbHorsePage(p: { me: CasinoMe; profile: HorseProfile }) {
  const { horse: h, entries } = p.profile;
  const coin = p.me.coin;
  const top2 = h.wins + h.seconds;
  const top3 = top2 + h.thirds;
  const status = h.retiredAt ? (h.breeding ? '繁殖入り' : '引退') : KB_CLASSES[classOf(h)];
  return (
    <CasinoLayout title={h.name} me={p.me}>
      <Back />
      <h1 class="c-h1 kb-horse-title">
        <Silk silk={h.silk} />
        {h.name}
        <span class="c-tag">{status}</span>
      </h1>
      <p class="c-muted kb-horse-line">
        {KB_SEXES[h.sex]}
        {h.age}・{KB_COATS[h.coat]}・{KB_STYLES[h.style]}・{KB_APT[h.apt]}が得意・{h.surf === 2 ? '芝もダートも' : `${KB_SURFACES[h.surf]}が得意`}・馬体重 {h.weight}kg
        {p.profile.sire && (
          <>
            ・父 <HorseLink id={p.profile.sire.id} name={p.profile.sire.name} />
          </>
        )}
        {p.profile.ownerName ? `・馬主 ${p.profile.ownerName}` : '・馬主なし'}
      </p>
      <section class="c-panel">
        <h2>📊 通算成績</h2>
        <div class="kb-tiles">
          <div>
            <span>成績</span>
            <b>
              {h.starts} 戦 {h.wins} 勝
            </b>
            <small>{record(h)}</small>
          </div>
          <div>
            <span>勝率</span>
            <b>{pct(h.wins, h.starts)}</b>
          </div>
          <div>
            <span>連対率</span>
            <b>{pct(top2, h.starts)}</b>
          </div>
          <div>
            <span>複勝率</span>
            <b>{pct(top3, h.starts)}</b>
          </div>
          <div>
            <span>獲得賞金</span>
            <b>
              {coin.emoji}
              {fmt(h.prize)}
            </b>
          </div>
          <div>
            <span>平均人気</span>
            <b>{p.profile.avgPop === null ? '—' : p.profile.avgPop.toFixed(1)}</b>
          </div>
          <div>
            <span>平均着順</span>
            <b>{p.profile.avgPos === null ? '—' : p.profile.avgPos.toFixed(1)}</b>
          </div>
          <div>
            <span>持ちタイム</span>
            <b class="kb-tile-small">{p.profile.best.length ? p.profile.best.map((b) => `${b.dist}m ${b.time}`).join('・') : '—'}</b>
          </div>
        </div>
      </section>
      {entries.length > 0 && (
        <section class="c-panel">
          <h2>📏 距離・馬場の成績</h2>
          <TallyRows rows={[...p.profile.byDist.map((x) => ({ label: `${fmt(x.dist)}m`, t: x.t })), ...p.profile.bySurface.map((x) => ({ label: KB_SURFACES[x.surface] ?? '', t: x.t }))]} />
        </section>
      )}
      <section class="c-panel">
        <h2>🏁 レースの記録{entries.length ? `（新しい順・${entries.length} 走）` : ''}</h2>
        {entries.length === 0 ? (
          <p class="c-muted">
            まだ記録がありません。{h.starts > 0 ? '1 走ずつの記録は、この機能が入ってからのレースから残ります。' : ''}
            {h.recent.length > 0 && `近走: ${h.recent.map((r) => `${r.pos} 着（${r.race}）`).join('・')}`}
          </p>
        ) : (
          <div class="kb-card-wrap">
            <table class="kb-rec-table kb-entries">
              <thead>
                <tr>
                  <th>日時</th>
                  <th class="l">レース</th>
                  <th>距離</th>
                  <th>頭数</th>
                  <th>馬番</th>
                  <th>人気</th>
                  <th>単勝</th>
                  <th>着順</th>
                  <th>タイム</th>
                  <th>着差</th>
                  <th>上がり</th>
                  <th>通過</th>
                  <th>賞金</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr class={e.pos <= 3 ? `kb-top${e.pos}` : ''}>
                    <td>{dateJst(e.at)}</td>
                    <td class="l">
                      {e.race}
                      {KB_CLASSES[e.cls] !== e.race && <small>{KB_CLASSES[e.cls]}</small>}
                    </td>
                    <td>
                      {KB_SURFACES[e.surface]?.slice(0, 1)}
                      {e.dist}
                      <small>{KB_GOINGS[e.going]}</small>
                    </td>
                    <td>{e.field}</td>
                    <td>{e.no}</td>
                    <td>{e.pop}</td>
                    <td>{fmtOdds(e.odds)}</td>
                    <td class="kb-fin">{e.pos}</td>
                    <td>{e.time}</td>
                    <td>{e.margin || '—'}</td>
                    <td>{(e.last3f / 10).toFixed(1)}</td>
                    <td>{e.corners || '—'}</td>
                    <td>{e.prize > 0 ? fmt(e.prize) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {p.profile.foals.length > 0 && (
        <section class="c-panel">
          <h2>🌸 産駒</h2>
          <ul class="kb-mini-stable">
            {p.profile.foals.map((f) => (
              <li>
                <b>
                  <HorseLink id={f.id} name={f.name} />
                </b>
                <span class="c-muted">
                  {f.starts} 戦 {f.wins} 勝{f.retired ? '・引退' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </CasinoLayout>
  );
}

/** 📖 馬名鑑（走っている馬） */
export function KbDirectoryPage(p: { me: CasinoMe; horses: DirectoryRow[] }) {
  return (
    <CasinoLayout title="馬名鑑" me={p.me}>
      <Back />
      <h1 class="c-h1">📖 馬名鑑</h1>
      <p class="c-muted">いま走っている馬です（獲得賞金の多い順）。馬名を押すと、その馬の成績が見られます。</p>
      <section class="c-panel">
        {p.horses.length === 0 ? (
          <p class="c-muted">まだ馬がいません。</p>
        ) : (
          <div class="kb-card-wrap">
            <table class="kb-rec-table">
              <thead>
                <tr>
                  <th class="l">馬名</th>
                  <th>クラス</th>
                  <th>成績</th>
                  <th>勝率</th>
                  <th>賞金</th>
                  <th class="l">馬主</th>
                </tr>
              </thead>
              <tbody>
                {p.horses.map((h) => (
                  <tr>
                    <td class="l">
                      <Silk silk={h.silk} />
                      <HorseLink id={h.id} name={h.name} />
                      <small>
                        {KB_SEXES[h.sex]}
                        {h.age}・{KB_STYLES[h.style]}・{KB_APT[h.apt]}
                      </small>
                    </td>
                    <td>{KB_CLASSES[classOf(h)]}</td>
                    <td>
                      {h.starts} 戦 {h.wins} 勝<small>{record(h)}</small>
                    </td>
                    <td>{pct(h.wins, h.starts)}</td>
                    <td>{fmt(h.prize)}</td>
                    <td class="l">{h.ownerName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </CasinoLayout>
  );
}

const keyLabel = (key: string) =>
  key
    .split(/[->]/)
    .map((n) => NO[Number(n) - 1] ?? n)
    .join(key.includes('>') ? '→' : '-');
const typeName = (t: string) => (isKbBetType(t) ? KB_BET_LABEL[t].name : t);

function BetList(p: { rows: KeibaBetRow[]; coin: CasinoMe['coin'] }) {
  return (
    <ul class="kb-tickets kb-bet-history">
      {p.rows.map((b) => (
        <li class={b.payout > 0 ? 'hit' : 'miss'}>
          <span>
            <small class="c-muted">{dateJst(b.at)}・{b.race}</small>
            {typeName(b.type)} {keyLabel(b.key)}
            <small class="c-muted">{b.names}</small>
          </span>
          <span>
            {p.coin.emoji}
            {fmt(b.amount)}
          </span>
          <b>{b.payout > 0 ? `的中 ×${fmtOdds(b.odds)} → ${fmt(b.payout)}` : 'はずれ'}</b>
        </li>
      ))}
    </ul>
  );
}

/** 🎫 自分の馬券成績 */
export function KbMyBetsPage(p: { me: CasinoMe; stats: MyBetStats }) {
  const { total: t } = p.stats;
  const coin = p.me.coin;
  const net = t.payout - t.bet;
  return (
    <CasinoLayout title="馬券の成績" me={p.me}>
      <Back />
      <h1 class="c-h1">🎫 あなたの馬券成績</h1>
      {t.tickets === 0 ? (
        <section class="c-panel">
          <p class="c-muted">まだ記録がありません。馬券を買ってレースの結果が出ると、ここに残ります。</p>
        </section>
      ) : (
        <>
          <section class="c-panel">
            <div class="kb-tiles">
              <div>
                <span>レース</span>
                <b>{fmt(t.races)}</b>
              </div>
              <div>
                <span>馬券</span>
                <b>{fmt(t.tickets)} 枚</b>
              </div>
              <div>
                <span>的中率</span>
                <b>{pct(t.hits, t.tickets)}</b>
                <small>{fmt(t.hits)} 枚 的中</small>
              </div>
              <div>
                <span>回収率</span>
                <b>{pct(t.payout, t.bet)}</b>
              </div>
              <div>
                <span>賭けた</span>
                <b>
                  {coin.emoji}
                  {fmt(t.bet)}
                </b>
              </div>
              <div>
                <span>戻った</span>
                <b>
                  {coin.emoji}
                  {fmt(t.payout)}
                </b>
              </div>
              <div>
                <span>収支</span>
                <b class={net > 0 ? 'c-win' : net < 0 ? 'c-lose' : ''}>{net > 0 ? `+${fmt(net)}` : fmt(net)}</b>
              </div>
              <div>
                <span>いちばんの的中</span>
                <b>{p.stats.best[0] ? fmt(p.stats.best[0].payout) : '—'}</b>
                {p.stats.best[0] && <small>×{fmtOdds(p.stats.best[0].odds)}</small>}
              </div>
            </div>
          </section>
          <section class="c-panel">
            <h2>🎯 賭け方ごと</h2>
            <div class="kb-card-wrap">
              <table class="kb-rec-table">
                <thead>
                  <tr>
                    <th class="l">賭け方</th>
                    <th>枚数</th>
                    <th>的中</th>
                    <th>的中率</th>
                    <th>賭けた</th>
                    <th>戻った</th>
                    <th>回収率</th>
                  </tr>
                </thead>
                <tbody>
                  {p.stats.byType
                    .filter((x) => x.t.tickets > 0)
                    .map(({ type, t: x }) => (
                      <tr>
                        <th class="l">{KB_BET_LABEL[type].name}</th>
                        <td>{fmt(x.tickets)}</td>
                        <td>{fmt(x.hits)}</td>
                        <td>{pct(x.hits, x.tickets)}</td>
                        <td>{fmt(x.bet)}</td>
                        <td>{fmt(x.payout)}</td>
                        <td class={x.payout > x.bet ? 'c-win' : ''}>{pct(x.payout, x.bet)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
          {p.stats.best.length > 0 && (
            <section class="c-panel">
              <h2>🏆 大きく当たった馬券</h2>
              <BetList rows={p.stats.best} coin={coin} />
            </section>
          )}
          <section class="c-panel">
            <h2>🕒 最近の馬券（{p.stats.recent.length} 枚）</h2>
            <BetList rows={p.stats.recent} coin={coin} />
          </section>
        </>
      )}
    </CasinoLayout>
  );
}
